import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

// Admins create a local user with a password they set: no invitation email.
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
import bcrypt from "bcrypt";
import { CreateLocalUserWithPassword } from "./userController";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

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
});

describe("local users with a password set by an admin", () => {
  it("creates a user who can sign in at once", async () => {
    await CreateLocalUserWithPassword(
      " Lena@Band.test ",
      ["editor"],
      "Lena Muster",
      "Start-Passw0rd",
      "Start-Passw0rd",
    );
    const user = await db.getUserByEmail("lena@band.test");
    expect(user).toMatchObject({ email: "lena@band.test", name: "Lena Muster", auth_provider: "local" });
    expect(user!.role_ids).toEqual(["editor"]);
    const row = await knex("users").where("id", user!.id).first();
    expect(Number(row.is_active)).toBe(1);
    expect(await bcrypt.compare("Start-Passw0rd", row.password_hash)).toBe(true);
  });

  it("refuses weak or mismatched passwords, missing roles and taken emails", async () => {
    await expect(CreateLocalUserWithPassword("a@band.test", ["editor"], "Anna", "short", "short")).rejects.toThrow(
      "Password must contain",
    );
    await expect(
      CreateLocalUserWithPassword("a@band.test", ["editor"], "Anna", "Start-Passw0rd", "Other-Passw0rd"),
    ).rejects.toThrow("Passwords do not match");
    await expect(
      CreateLocalUserWithPassword("a@band.test", [], "Anna", "Start-Passw0rd", "Start-Passw0rd"),
    ).rejects.toThrow("At least one role");
    await CreateLocalUserWithPassword("a@band.test", ["viewer"], "Anna", "Start-Passw0rd", "Start-Passw0rd");
    await expect(
      CreateLocalUserWithPassword("A@band.test", ["viewer"], "Anna", "Start-Passw0rd", "Start-Passw0rd"),
    ).rejects.toThrow("already exists");
  });
});
