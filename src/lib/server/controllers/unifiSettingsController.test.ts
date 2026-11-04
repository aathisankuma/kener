import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

// TEST_DATABASE_URL=postgresql://… or mysql://… runs this file on that engine instead of in-memory
// SQLite. It empties the tables it uses: use a throwaway database.
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
const { FetchUnifiDevices } = vi.hoisted(() => ({ FetchUnifiDevices: vi.fn() }));
vi.mock("$lib/server/unifiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/server/unifiClient")>()),
  FetchUnifiDevices,
}));

import db from "$lib/server/db/db";
import { seed as seedPermissions } from "../../../../seeds/permissions";
import { seed as seedRoles } from "../../../../seeds/roles";
import {
  ClearUnifiSettingsCache,
  EqualWeights,
  GetUnifiAlertMinutes,
  GetUnifiApiKey,
  GetUnifiSettingsView,
  ListUnifiDevices,
  SaveUnifiSettings,
  SyncUnifiAccessPoints,
  TagPart,
  UNIFI_ALERT_DESCRIPTION,
} from "./unifiSettingsController";
import { MaskSiteDataSecret } from "./siteDataController";
import CloudServiceCall, { SetUnifiApiKeyLoader } from "../services/cloudServiceCall";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

const device = (id: string, name: string, status = "online", model = "U6 Pro") => ({
  id,
  mac: id.toLowerCase(),
  name,
  model,
  shortname: "",
  ip: "10.0.0.1",
  status,
  productLine: "network",
  isConsole: false,
  hostId: "h1",
  hostName: "UDM Bern",
});

let pageId: number;

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
  for (const table of ["monitor_alerts_config_monitors", "monitor_alerts_config_triggers", "monitor_alerts_config"]) {
    if (await knex.schema.hasTable(table)) await knex(table).del();
  }
  await knex("pages_monitors").del();
  await knex("monitors").del();
  await knex("pages").del();
  await knex("site_data").where("key", "unifiConnection").del();
  ClearUnifiSettingsCache();
  delete process.env.UNIFI_API_KEY;
  await knex("pages").insert({ page_path: "wlan", page_title: "WLAN", page_header: "WLAN" });
  pageId = (await knex("pages").where("page_path", "wlan").first()).id;
  FetchUnifiDevices.mockReset();
});

const monitors = async () =>
  (await knex("monitors").orderBy("tag")).map((m) => ({
    tag: m.tag,
    name: m.name,
    type: m.monitor_type,
    status: m.status,
    data: JSON.parse(m.type_data),
  }));

describe("UniFi settings", () => {
  it("keeps the API key out of every answer", async () => {
    expect(await SaveUnifiSettings({ apiKey: "abcd-1234-efgh" })).toEqual({ hasApiKey: true, fromEnvironment: false });
    expect(await GetUnifiApiKey()).toBe("abcd-1234-efgh");
    // Saving without a key keeps it; removing deletes it and the environment is used.
    await SaveUnifiSettings({});
    expect(await GetUnifiApiKey()).toBe("abcd-1234-efgh");
    const stored = await knex("site_data").where("key", "unifiConnection").first();
    expect(JSON.stringify(MaskSiteDataSecret("unifiConnection", JSON.parse(stored.value)))).not.toContain("abcd");
    process.env.UNIFI_API_KEY = "from-env";
    await SaveUnifiSettings({ removeApiKey: true });
    expect(await GetUnifiSettingsView()).toEqual({ hasApiKey: false, fromEnvironment: true });
    expect(await GetUnifiApiKey()).toBe("from-env");
  });

  it("makes tags and weights a group monitor accepts", () => {
    expect(TagPart("Zürich Straße 5")).toBe("zurich-strasse-5");
    expect(TagPart("!!!")).toBe("x");
    for (const n of [1, 3, 7]) expect(EqualWeights(n).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("follows access points by location, on a page, with one alert rule", async () => {
    const result = await SyncUnifiAccessPoints({
      items: [
        { id: "AA01", name: "Empfang", location: "Bern Haus A", follow: true },
        { id: "AA02", name: "Sitzungszimmer", location: "Bern Haus A", follow: true },
        { id: "BB01", name: "Lager", location: "Thun", follow: true },
        { id: "CC01", name: "Switch", location: "Thun", follow: false },
      ],
      pageId,
      alertMinutes: 5,
    });
    expect(result).toEqual({ accessPoints: 3, locations: ["Bern Haus A", "Thun"], stopped: 0 });

    const all = await monitors();
    expect(all.filter((m) => m.type === "CLOUD")).toMatchObject([
      {
        tag: "unifi-ap-aa01",
        name: "Empfang",
        status: "ACTIVE",
        data: { provider: "unifi-device", components: ["AA01"] },
      },
      { tag: "unifi-ap-aa02", name: "Sitzungszimmer" },
      { tag: "unifi-ap-bb01", name: "Lager", data: { location: "Thun" } },
    ]);
    const bern = all.find((m) => m.tag === "unifi-ort-bern-haus-a")!;
    expect(bern).toMatchObject({ type: "GROUP", name: "Bern Haus A", status: "ACTIVE" });
    expect(bern.data.monitors).toEqual([
      { tag: "unifi-ap-aa01", weight: 0.5 },
      { tag: "unifi-ap-aa02", weight: 0.5 },
    ]);
    const onPage = (await knex("pages_monitors").where("page_id", pageId)).map((r) => r.monitor_tag).sort();
    expect(onPage).toEqual(["unifi-ort-bern-haus-a", "unifi-ort-thun"]);

    const rule = await knex("monitor_alerts_config").where("alert_description", UNIFI_ALERT_DESCRIPTION).first();
    expect(rule).toMatchObject({ alert_for: "STATUS", alert_value: "DOWN", create_incident: "YES", is_active: "YES" });
    expect(Number(rule.failure_threshold)).toBe(5);
    expect(await GetUnifiAlertMinutes()).toBe(5);

    // Rename one, stop another, move nothing else; the alert turns off.
    const again = await SyncUnifiAccessPoints({
      items: [
        { id: "AA01", name: "Empfang EG", location: "Bern Haus A", follow: true },
        { id: "AA02", name: "Sitzungszimmer", location: "Bern Haus A", follow: false },
        { id: "BB01", name: "Lager", location: "Thun", follow: true },
      ],
      pageId: null,
      alertMinutes: 0,
    });
    expect(again.stopped).toBe(1);
    const after = await monitors();
    expect(after.find((m) => m.tag === "unifi-ap-aa01")).toMatchObject({ name: "Empfang EG", status: "ACTIVE" });
    expect(after.find((m) => m.tag === "unifi-ap-aa02")).toMatchObject({ status: "INACTIVE" });
    expect(after.find((m) => m.tag === "unifi-ort-bern-haus-a")!.data.monitors).toEqual([
      { tag: "unifi-ap-aa01", weight: 1 },
    ]);
    expect(await GetUnifiAlertMinutes()).toBe(0);
  });

  it("refuses access points without a name or location", async () => {
    await expect(
      SyncUnifiAccessPoints({ items: [{ id: "A", name: "AP", location: " ", follow: true }] }),
    ).rejects.toThrow("Every access point you follow needs a location.");
  });

  it("lists devices with what Kener made of them", async () => {
    await SaveUnifiSettings({ apiKey: "k" });
    await SyncUnifiAccessPoints({ items: [{ id: "AA01", name: "Empfang", location: "Bern", follow: true }] });
    FetchUnifiDevices.mockResolvedValue([
      device("AA01", "BE-HA-AP1"),
      device("BB01", "Thun-Lager-AP2", "offline"),
      device("SW01", "Thun-Switch", "online", "USW Pro 24"),
    ]);
    const { devices } = await ListUnifiDevices();
    expect(devices).toMatchObject([
      { id: "AA01", name: "Empfang", location: "Bern", followed: true, isAccessPoint: true, kenerStatus: "UP" },
      { id: "BB01", name: "Thun-Lager-AP2", location: "Thun Lager", followed: false, kenerStatus: "DOWN" },
      { id: "SW01", isAccessPoint: false },
    ]);
  });

  it("checks an access point with the shared device list", async () => {
    SetUnifiApiKeyLoader(async () => "k");
    FetchUnifiDevices.mockResolvedValue([device("AA01", "a", "offline"), device("BB01", "b")]);
    const check = (id: string) =>
      new CloudServiceCall({
        tag: "t",
        type_data: { provider: "unifi-device", components: [id] },
      } as never).execute();
    expect(await check("BB01")).toMatchObject({ status: "UP", raw_status: "online" });
    expect(await check("aa01")).toMatchObject({ status: "DOWN" });
    expect(await check("ZZ99")).toMatchObject({ status: "DOWN", error_message: "Device not found in UniFi" });
    SetUnifiApiKeyLoader(async () => "");
    expect(await check("BB01")).toMatchObject({ error_message: expect.stringContaining("API key is missing") });
  });
});
