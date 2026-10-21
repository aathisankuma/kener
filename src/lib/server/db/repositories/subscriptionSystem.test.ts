import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import knex, { type Knex } from "knex";
import { SubscriptionSystemRepository } from "./subscriptionSystem";
import { up as createMethodMonitors } from "../../../../../migrations/20261021120000_add_subscriber_method_monitors";

// TEST_DATABASE_URL=postgresql://… or mysql://… runs this file on that engine (already migrated)
// instead of in-memory SQLite. It empties the subscriber tables, so use a throwaway database.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

describe("SubscriptionSystemRepository monitor choices", () => {
  let db: Knex;
  let repo: SubscriptionSystemRepository;

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL) {
      const { default: knexOb } = await import("../../../../../knexfile");
      db = knex(knexOb);
    } else {
      db = knex({
        client: "better-sqlite3",
        connection: { filename: ":memory:" },
        useNullAsDefault: true,
      });
      await db.schema.createTable("subscriber_users", (table) => {
        table.increments("id").primary();
        table.string("email").notNullable();
        table.string("status").defaultTo("ACTIVE");
      });
      await db.schema.createTable("subscriber_methods", (table) => {
        table.increments("id").primary();
        table.integer("subscriber_user_id").notNullable();
        table.string("method_type").notNullable();
        table.string("method_value").notNullable();
        table.string("status").defaultTo("ACTIVE");
        table.text("meta");
        table.timestamp("created_at").defaultTo(db.fn.now());
        table.timestamp("updated_at").defaultTo(db.fn.now());
      });
    }
    await createMethodMonitors(db);
    // The migration runs twice without error.
    await createMethodMonitors(db);
    repo = new SubscriptionSystemRepository(db);
  });

  beforeEach(async () => {
    await db("subscriber_method_monitors").del();
    await db("user_subscriptions_v2")
      .del()
      .catch(() => {});
    await db("subscriber_methods").del();
    await db("subscriber_users").del();
    await db("subscriber_users").insert([
      { id: 1, email: "a@example.com", status: "ACTIVE" },
      { id: 2, email: "b@example.com", status: "ACTIVE" },
    ]);
    await db("subscriber_methods").insert([
      { id: 1, subscriber_user_id: 1, method_type: "email", method_value: "a@example.com" },
      { id: 2, subscriber_user_id: 2, method_type: "email", method_value: "b@example.com" },
    ]);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("returns no choices for a method that chose nothing", async () => {
    expect(await repo.getMonitorTagsForMethod(1)).toEqual([]);
  });

  it("stores, replaces and clears a method's choices", async () => {
    await repo.setMonitorTagsForMethod(1, ["printer", "confluence", "printer"]);
    expect(await repo.getMonitorTagsForMethod(1)).toEqual(["confluence", "printer"]);

    await repo.setMonitorTagsForMethod(1, ["abacus"]);
    expect(await repo.getMonitorTagsForMethod(1)).toEqual(["abacus"]);

    await repo.setMonitorTagsForMethod(1, []);
    expect(await repo.getMonitorTagsForMethod(1)).toEqual([]);
  });

  it("reads the choices of several methods at once", async () => {
    await repo.setMonitorTagsForMethod(1, ["printer"]);
    await repo.setMonitorTagsForMethod(2, ["confluence", "abacus"]);
    const choices = await repo.getMonitorTagsForMethods([1, 2, 3]);
    expect(choices.get(1)).toEqual(["printer"]);
    expect([...(choices.get(2) ?? [])].sort()).toEqual(["abacus", "confluence"]);
    expect(choices.has(3)).toBe(false);
    expect((await repo.getMonitorTagsForMethods([])).size).toBe(0);
  });

  it("removes a method's choices with the method", async () => {
    await repo.setMonitorTagsForMethod(1, ["printer"]);
    await repo.deleteSubscriberMethod(1);
    expect(await db("subscriber_method_monitors").where("subscriber_method_id", 1)).toEqual([]);
  });
});
