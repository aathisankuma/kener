import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

// Single sign-on into an existing account with the same email ("link_local_accounts").
// TEST_DATABASE_URL=postgresql://… or mysql://… runs this file on that engine instead of in-memory
// SQLite. It empties the users tables: use a throwaway database.
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
import { seed as seedPermissions } from "../../../../seeds/permissions";
import { seed as seedRoles } from "../../../../seeds/roles";
import { FindOrCreateOidcUser } from "./oidcController";
import type { OidcSettings } from "$lib/types/site";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

const settings = (extra: Partial<OidcSettings> = {}): OidcSettings => ({
  enabled: true,
  provider_name: "Microsoft",
  issuer_url: "https://login.example/tenant/v2.0",
  client_id: "c",
  client_secret: "s",
  scopes: "openid profile email",
  groups_claim: "groups",
  allow_local_login: true,
  auto_create_users: true,
  default_role_id: "viewer",
  ...extra,
});
const login = { sub: "entra-123", email: "aathi@band.test", name: "Aathi Kumar", groups: [] };

let adminId: number;

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
  await knex("users_roles").del();
  await knex("users").del();
  await db.insertUser({
    email: "aathi@band.test",
    name: "Aathi",
    password_hash: "hash-of-local-password",
    role_ids: ["admin"],
    is_active: 1,
    is_verified: 1,
  });
  adminId = (await db.getUserByEmail("aathi@band.test"))!.id;
});

describe("single sign-on into an existing account", () => {
  it("refuses while linking is off, as before", async () => {
    await expect(FindOrCreateOidcUser(settings(), login)).rejects.toMatchObject({ code: "email_conflict" });
  });

  it("signs in to the existing account and keeps its roles and password", async () => {
    const user = await FindOrCreateOidcUser(settings({ link_local_accounts: true }), login);
    expect(user.id).toBe(adminId);
    expect(user.oidc_sub).toBe("entra-123");
    expect(user.role_ids).toContain("admin");
    expect(user.name).toBe("Aathi Kumar");
    const row = await knex("users").where("id", adminId).first();
    expect(row.password_hash).toBe("hash-of-local-password");

    // Next time it is found by the identity provider's id.
    const again = await FindOrCreateOidcUser(settings({ link_local_accounts: true }), login);
    expect(again.id).toBe(adminId);
    expect(Number((await knex("users").count({ n: "*" }).first())?.n)).toBe(1);
  });

  it("does not link a deactivated account or one linked to another sign-in", async () => {
    await knex("users").where("id", adminId).update({ is_active: 0 });
    await expect(FindOrCreateOidcUser(settings({ link_local_accounts: true }), login)).rejects.toMatchObject({
      code: "email_conflict",
    });

    await knex("users").where("id", adminId).update({ is_active: 1, oidc_sub: "someone-else" });
    await expect(FindOrCreateOidcUser(settings({ link_local_accounts: true }), login)).rejects.toMatchObject({
      code: "email_conflict",
    });
  });
});
