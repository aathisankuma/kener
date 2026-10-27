import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import knex, { type Knex } from "knex";
import { UsersRepository } from "./users";
import { up as createUsersMonitors } from "../../../../../migrations/20261027120000_add_users_monitors";

// TEST_DATABASE_URL=postgresql://… or mysql://… runs this file on that engine (already migrated)
// instead of in-memory SQLite. It empties users_monitors and adds test users, so use a throwaway
// database.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

describe("UsersRepository: services a user manages", () => {
  let db: Knex;
  let repo: UsersRepository;
  let anna: number;
  let ben: number;

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL) {
      const { default: knexOb } = await import("../../../../../knexfile");
      db = knex(knexOb);
    } else {
      db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
      await db.schema.createTable("users", (table) => {
        table.increments("id").primary();
        table.string("email", 255).notNullable().unique();
        table.string("name", 255).notNullable();
        table.string("password_hash", 255).notNullable();
      });
    }
    await createUsersMonitors(db);
    // The migration runs twice without error.
    await createUsersMonitors(db);
    repo = new UsersRepository(db);

    await db("users").whereIn("email", ["anna.lift@band.test", "ben.lift@band.test"]).del();
    const insert = async (email: string, name: string) => {
      const rows = await db("users").insert({ email, name, password_hash: "x" }, ["id"]);
      const first = rows[0] as number | { id: number };
      return typeof first === "object" ? Number(first.id) : Number(first);
    };
    anna = await insert("anna.lift@band.test", "Anna");
    ben = await insert("ben.lift@band.test", "Ben");
  });

  beforeEach(async () => {
    await db("users_monitors").del();
  });

  afterAll(async () => {
    await db("users_monitors").del();
    await db("users").whereIn("id", [anna, ben]).del();
    await db.destroy();
  });

  it("stores and replaces a user's services, without repeats", async () => {
    await repo.setMonitorTagsForUser(anna, ["lift", "lift", "kaffeemaschine"]);
    expect(await repo.getMonitorTagsForUser(anna)).toEqual(["kaffeemaschine", "lift"]);

    await repo.setMonitorTagsForUser(anna, ["lift"]);
    expect(await repo.getMonitorTagsForUser(anna)).toEqual(["lift"]);

    await repo.setMonitorTagsForUser(anna, []);
    expect(await repo.getMonitorTagsForUser(anna)).toEqual([]);
  });

  it("lets two people share a service and lists services per user", async () => {
    await repo.setMonitorTagsForUser(anna, ["lift"]);
    await repo.setMonitorTagsForUser(ben, ["lift", "parkhaus"]);
    const byUser = await repo.getMonitorTagsForUsers([anna, ben, 999999]);
    expect(byUser.get(anna)).toEqual(["lift"]);
    expect(byUser.get(ben)).toEqual(["lift", "parkhaus"]);
    expect(byUser.has(999999)).toBe(false);
    expect((await repo.getMonitorTagsForUsers([])).size).toBe(0);
  });

  it("forgets a deleted monitor for everyone", async () => {
    await repo.setMonitorTagsForUser(anna, ["lift", "parkhaus"]);
    await repo.setMonitorTagsForUser(ben, ["lift"]);
    expect(await repo.deleteUserMonitorsByTag("lift")).toBe(2);
    expect(await repo.getMonitorTagsForUser(anna)).toEqual(["parkhaus"]);
    expect(await repo.getMonitorTagsForUser(ben)).toEqual([]);
  });
});
