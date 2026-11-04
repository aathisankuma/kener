import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import type { Cookies } from "@sveltejs/kit";

// A viewer (e.g. anyone signing in with single sign-on and no other role) has no admin area and
// subscribes with the email of their account, without a code.
// TEST_DATABASE_URL=postgresql://… or mysql://… runs this file on that engine instead of in-memory
// SQLite. It empties every table except the seeded roles and permissions: use a throwaway database.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
vi.mock("$lib/server/db/db", async () => {
  const { default: DbImpl } = await import("$lib/server/db/dbimpl");
  if (process.env.TEST_DATABASE_URL) {
    const { default: knexOb } = await import("../../../../knexfile");
    return { default: new DbImpl(knexOb) };
  }
  return {
    default: new DbImpl({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true }),
  };
});
vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));

import db from "$lib/server/db/db";
import { HomePathFor } from "$lib/allPerms";
import { GenerateToken } from "$lib/server/controllers/commonController";
import { GetUserPermissions } from "$lib/server/controllers/userController";
import { VerifySubscriberToken } from "$lib/server/controllers/userSubscriptionsController";
import { seed as seedPermissions } from "../../../../seeds/permissions";
import { seed as seedRoles } from "../../../../seeds/roles";
import post from "../api-server/subscription/post";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;
const client = knex.client.config.client as string;

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [result]: (number | { id: number })[] =
    client === "mysql2" ? await knex(table).insert(row) : await knex(table).insert(row, ["id"]);
  return typeof result === "object" ? result.id : result;
};

const SITE_KEY = "subscriptionsSettings";
async function setSubscriptions(value: Record<string, unknown>) {
  await knex("site_data").where("key", SITE_KEY).del();
  await knex("site_data").insert({ key: SITE_KEY, value: JSON.stringify(value), data_type: "object" });
}

let viewerId: number;
let viewer: Cookies;

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name.slice("/migrations/".length),
      getMigration: async (name: string) => migrations[name],
    },
  });
  await seedPermissions(knex);
  await seedRoles(knex);
});

beforeEach(async () => {
  for (const table of [
    "subscriber_method_monitors",
    "user_subscriptions_v2",
    "subscriber_methods",
    "subscriber_users",
  ]) {
    if (await knex.schema.hasTable(table)) await knex(table).del();
  }
  await knex("users_roles").del();
  await knex("users").del();
  viewerId = await insert("users", {
    email: "Lena.Muster@band.test",
    name: "Lena Muster",
    password_hash: "",
    is_active: 1,
    is_verified: 1,
  });
  await knex("users_roles").insert({ users_id: viewerId, roles_id: "viewer" });
  const token = await GenerateToken((await db.getUserByEmail("Lena.Muster@band.test"))!);
  viewer = { get: (name: string) => (name === "kener-user" ? token : undefined) } as unknown as Cookies;
  await setSubscriptions({
    enable: true,
    requireSignIn: true,
    methods: { emails: { incidents: true, maintenances: true } },
  });
});

describe("viewers", () => {
  it("is a built-in role without permissions that starts on the status page", async () => {
    const role = await knex("roles").where("id", "viewer").first();
    expect(role).toMatchObject({ role_name: "Viewer" });
    expect(await knex("roles_permissions").where("roles_id", "viewer")).toHaveLength(0);
    expect(HomePathFor(await GetUserPermissions(viewerId))).toBe("/");
  });

  it("subscribe with the email of their account, once, without a code", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = await (await post({ body: { action: "account" }, cookies: viewer } as any)).json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const again = await (await post({ body: { action: "account" }, cookies: viewer } as any)).json();

    const subscribers = await knex("subscriber_users").select("email", "status");
    expect(subscribers).toEqual([{ email: "lena.muster@band.test", status: "ACTIVE" }]);

    for (const { token } of [first, again]) {
      const verified = await VerifySubscriberToken(token);
      expect(verified.success).toBe(true);
      expect(verified.method?.method_value).toBe("lena.muster@band.test");
    }
  });

  it("cannot use the email-and-code way while only signed-in people may subscribe", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      post({ body: { action: "login", email: "someone@else.test" } } as any),
    ).rejects.toMatchObject({ status: 403 });
    expect(Number((await knex("subscriber_users").count({ n: "*" }).first())?.n)).toBe(0);
  });
});
