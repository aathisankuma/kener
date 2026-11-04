import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

// TEST_DATABASE_URL=postgresql://… or mysql://… runs this file on that engine instead of in-memory
// SQLite. It empties the monitors table: use a throwaway database.
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
const { fetchIcon } = vi.hoisted(() => ({ fetchIcon: vi.fn() }));
vi.mock("../cloudServiceIcon.js", () => ({ FetchCloudServiceIcon: fetchIcon }));

import db from "$lib/server/db/db";
import { FetchMissingCloudIcons } from "./cloudIconsController";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

const monitor = (tag: string, type: string, image: string | null, typeData: Record<string, unknown>) => ({
  tag,
  name: tag.toUpperCase(),
  monitor_type: type,
  image,
  status: "ACTIVE",
  cron: "* * * * *",
  default_status: "NONE",
  type_data: JSON.stringify(typeData),
});

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name.slice("/migrations/".length),
      getMigration: async (name: string) => migrations[name],
    },
  });
});

beforeEach(async () => {
  await knex("monitors").del();
  fetchIcon.mockReset();
});

describe("load missing icons", () => {
  it("gives Cloud Service monitors without an image their icon and leaves the rest alone", async () => {
    await knex("monitors").insert([
      monitor("sharepoint", "CLOUD", null, { provider: "m365-sharepoint" }),
      monitor("teams", "CLOUD", "/assets/images/own.png", { provider: "m365-teams" }),
      monitor("web", "API", null, { url: "https://example.com" }),
      monitor("swiss21", "CLOUD", "", { provider: "swiss21" }),
    ]);
    fetchIcon.mockImplementation(async (data: { provider: string }) => {
      if (data.provider === "swiss21") throw new Error("Could not find a usable icon on swiss21.org");
      return `/assets/images/${data.provider}.png`;
    });

    const result = await FetchMissingCloudIcons();

    expect(result.updated).toEqual(["SHAREPOINT"]);
    expect(result.failed).toEqual([{ name: "SWISS21", reason: "Could not find a usable icon on swiss21.org" }]);
    const images = Object.fromEntries(
      (await knex("monitors").select("tag", "image")).map((r: { tag: string; image: string | null }) => [
        r.tag,
        r.image,
      ]),
    );
    expect(images).toEqual({
      sharepoint: "/assets/images/m365-sharepoint.png",
      teams: "/assets/images/own.png",
      web: null,
      swiss21: "",
    });
    expect(fetchIcon).toHaveBeenCalledTimes(2);
  });
});
