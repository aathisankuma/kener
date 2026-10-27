import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import type { Cookies } from "@sveltejs/kit";

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

const { subscriberQueue, alertingQueue } = vi.hoisted(() => ({
  subscriberQueue: { push: vi.fn() },
  alertingQueue: { push: vi.fn() },
}));
vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));
vi.mock("$lib/server/queues/subscriberQueue", () => ({ default: subscriberQueue }));
vi.mock("$lib/server/queues/alertingQueue", () => ({ default: alertingQueue }));

import db from "$lib/server/db/db";
import GC from "$lib/global-constants";
import { GenerateToken } from "$lib/server/controllers/commonController";
import { GetMinuteStartNowTimestampUTC } from "$lib/server/tool";
import { seed as seedPermissions } from "../../../../seeds/permissions";
import { seed as seedRoles } from "../../../../seeds/roles";
import { seed as seedSiteData } from "../../../../seeds/site_data";
import * as manageApi from "../../../routes/(manage)/manage/api/+server";
import { DeleteMonitorCompletelyUsingTag } from "./monitorsController";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;
const client = knex.client.config.client as string;
const SEEDED_ONCE = new Set(["knex_migrations", "knex_migrations_lock", "permissions", "roles", "roles_permissions"]);

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [result]: (number | { id: number })[] =
    client === "mysql2" ? await knex(table).insert(row) : await knex(table).insert(row, ["id"]);
  return typeof result === "object" ? result.id : result;
};

async function clearTables(): Promise<void> {
  if (client === "pg") {
    const { rows }: { rows: { tablename: string }[] } = await knex.raw(
      "select tablename from pg_tables where schemaname = current_schema()",
    );
    const names = rows.map((r) => r.tablename).filter((name) => !SEEDED_ONCE.has(name));
    await knex.raw(`truncate table ${names.map(() => "??").join(", ")} restart identity cascade`, names);
  } else if (client === "mysql2") {
    const [rows] = (await knex.raw("show tables")) as [Record<string, string>[]];
    const names = rows.map((r) => Object.values(r)[0]).filter((name) => !SEEDED_ONCE.has(name));
    await knex.transaction(async (trx) => {
      await trx.raw("set foreign_key_checks = 0");
      for (const name of names) await trx.raw("truncate table ??", [name]);
      await trx.raw("set foreign_key_checks = 1");
    });
  } else {
    const tables: { name: string }[] = await knex.raw(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'",
    );
    for (const { name } of tables) if (!SEEDED_ONCE.has(name)) await knex(name).del();
    await knex("sqlite_sequence")
      .whereNotIn("name", [...SEEDED_ONCE])
      .del();
  }
}

const cookiesFor = async (email: string): Promise<Cookies> => {
  const token = await GenerateToken((await db.getUserByEmail(email))!);
  return { get: (name: string) => (name === "kener-user" ? token : undefined) } as unknown as Cookies;
};

async function call(cookies: Cookies, action: string, data: Record<string, unknown> = {}) {
  const response = await manageApi.POST({
    request: new Request("http://localhost/manage/api", { method: "POST", body: JSON.stringify({ action, data }) }),
    cookies,
  } as never);
  return { status: response.status, body: await response.json() };
}

let admin: Cookies;
let anna: Cookies;
let annaId: number;

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
  await clearTables();
  vi.clearAllMocks();
  await seedSiteData(knex);
  const adminId = await insert("users", {
    email: "admin@band.test",
    name: "Admin",
    password_hash: "x",
    is_active: 1,
    is_verified: 1,
  });
  await knex("users_roles").insert({ users_id: adminId, roles_id: "admin" });
  annaId = await insert("users", {
    email: "anna@band.test",
    name: "Anna Haustechnik",
    password_hash: "x",
    is_active: 1,
    is_verified: 1,
  });
  await knex("users_roles").insert({ users_id: annaId, roles_id: "service_manager" });

  const monitorRow = {
    status: "ACTIVE",
    is_hidden: "NO",
    cron: "* * * * *",
    monitor_settings_json: JSON.stringify({
      uptime_formula_numerator: GC.defaultNumeratorStr,
      uptime_formula_denominator: GC.defaultDenominatorStr,
    }),
  };
  await knex("monitors").insert([
    { tag: "lift", name: "Lift", monitor_type: "NONE", type_data: "{}", ...monitorRow },
    { tag: "parkhaus", name: "Parkhaus", monitor_type: "API", type_data: '{"url":"https://p.test"}', ...monitorRow },
    { tag: "web", name: "Website", monitor_type: "NONE", type_data: "{}", ...monitorRow },
  ]);
  await db.setMonitorTagsForUser(annaId, ["lift", "parkhaus"]);

  admin = await cookiesFor("admin@band.test");
  anna = await cookiesFor("anna@band.test");
});

afterAll(async () => {
  await knex.destroy();
});

describe("the Service Manager role", () => {
  it("has only the permission for its own services", async () => {
    const permissions = await db.getUserPermissionIds(annaId);
    expect(permissions).toEqual(["services.manage_assigned"]);
  });

  it("cannot use the rest of the dashboard", async () => {
    for (const action of ["getMonitors", "getIncidents", "createIncident", "updateMonitoringData", "getUsers"]) {
      expect((await call(anna, action)).status).toBe(403);
    }
  });

  it("lists only the assigned services, and says which ones take a status by hand", async () => {
    const { status, body } = await call(anna, "getMyServices");
    expect(status).toBe(200);
    expect(body.services.map((s: { tag: string; manualStatus: boolean }) => [s.tag, s.manualStatus])).toEqual([
      ["lift", true],
      ["parkhaus", false],
    ]);
  });
});

describe("setting the status", () => {
  it("records a manual status and keeps it from being replaced by the default", async () => {
    expect((await call(anna, "setMyServiceStatus", { monitor_tag: "lift", status: "DOWN" })).status).toBe(200);

    const row = await knex("monitoring_data")
      .where({ monitor_tag: "lift", timestamp: GetMinuteStartNowTimestampUTC() })
      .first();
    expect(row).toMatchObject({ status: "DOWN", type: GC.MANUAL });
    const monitor = await db.getMonitorByTag("lift");
    expect(JSON.parse(String(monitor?.type_data)).overrideWithLastKnownStatus).toBe(true);
    expect(alertingQueue.push).toHaveBeenCalledWith("lift", expect.any(Number), "DOWN");
  });

  it("refuses services of others, checked services and unknown statuses", async () => {
    const other = await call(anna, "setMyServiceStatus", { monitor_tag: "web", status: "DOWN" });
    expect(other.body.error).toBe("This service is not assigned to you");
    const checked = await call(anna, "setMyServiceStatus", { monitor_tag: "parkhaus", status: "DOWN" });
    expect(checked.body.error).toContain("Kener checks this service itself");
    const bogus = await call(anna, "setMyServiceStatus", { monitor_tag: "lift", status: "BROKEN" });
    expect(bogus.body.error).toContain("Status must be one of");
    expect(Number((await knex("monitoring_data").count({ n: "*" }).first())?.n)).toBe(0);
  });
});

describe("incidents", () => {
  it("posts an incident on the service and tells only its subscribers", async () => {
    const created = await call(anna, "createMyServiceIncident", {
      monitor_tag: "lift",
      title: "Lift steht",
      message: "Techniker ist informiert, kommt um 14 Uhr.",
      impact: "DOWN",
    });
    expect(created.status).toBe(200);
    const id = created.body.incident_id;

    expect(await knex("incidents").where({ id }).first()).toMatchObject({ title: "Lift steht", is_global: "NO" });
    expect(await knex("incident_monitors").where({ incident_id: id }).select("monitor_tag", "monitor_impact")).toEqual([
      { monitor_tag: "lift", monitor_impact: "DOWN" },
    ]);
    expect(subscriberQueue.push).toHaveBeenCalledTimes(1);
    expect(subscriberQueue.push.mock.calls[0][2]).toEqual(["lift"]);

    const listed = (await call(anna, "getMyServices")).body.services[0];
    expect(listed.openIncidents).toMatchObject([
      { id, title: "Lift steht", impact: "DOWN", updates: [{ text: "Techniker ist informiert, kommt um 14 Uhr." }] },
    ]);
  });

  it("adds updates and closes the incident", async () => {
    const id = (
      await call(anna, "createMyServiceIncident", { monitor_tag: "lift", title: "Lift steht", impact: "DOWN" })
    ).body.incident_id;
    const update = await call(anna, "addMyServiceIncidentUpdate", {
      incident_id: id,
      message: "Lift läuft wieder.",
      state: "RESOLVED",
    });
    expect(update.status).toBe(200);
    expect(await knex("incidents").where({ id }).first()).toMatchObject({ state: "RESOLVED" });
    expect((await call(anna, "getMyServices")).body.services[0].openIncidents).toEqual([]);
  });

  it("refuses incidents of other services and empty updates", async () => {
    const adminIncident = await call(admin, "createIncident", { title: "Website down", start_date_time: 1 });
    await call(admin, "addMonitor", {
      incident_id: adminIncident.body.incident_id,
      monitor_tag: "web",
      monitor_impact: "DOWN",
    });
    const other = await call(anna, "addMyServiceIncidentUpdate", {
      incident_id: adminIncident.body.incident_id,
      message: "Hallo",
      state: "RESOLVED",
    });
    expect(other.body.error).toBe("This incident does not concern your services");

    const notMine = await call(anna, "createMyServiceIncident", { monitor_tag: "web", title: "x", impact: "DOWN" });
    expect(notMine.body.error).toBe("This service is not assigned to you");
    const noTitle = await call(anna, "createMyServiceIncident", { monitor_tag: "lift", title: " ", impact: "DOWN" });
    expect(noTitle.body.error).toBe("Please enter a title");
  });
});

describe("maintenance", () => {
  it("plans maintenance for the service, lists it and cancels it", async () => {
    const start = GetMinuteStartNowTimestampUTC() + 86400;
    const created = await call(anna, "createMyServiceMaintenance", {
      monitor_tag: "lift",
      title: "Lift-Wartung",
      description: "Jährliche Kontrolle",
      start,
      duration_minutes: 120,
    });
    expect(created.status).toBe(200);
    expect(await knex("maintenances").where({ id: created.body.maintenance_id }).first()).toMatchObject({
      is_global: "NO",
      duration_seconds: 7200,
    });

    const [planned] = (await call(anna, "getMyServices")).body.services[0].maintenances;
    expect(planned).toMatchObject({ title: "Lift-Wartung", startsAt: start, endsAt: start + 7200, canCancel: true });

    expect((await call(anna, "cancelMyServiceMaintenance", { event_id: planned.eventId })).status).toBe(200);
    expect((await call(anna, "getMyServices")).body.services[0].maintenances).toEqual([]);
  });

  it("does not let a service manager cancel maintenance that also covers other services", async () => {
    const start = GetMinuteStartNowTimestampUTC() + 86400;
    const created = await call(admin, "createMaintenance", {
      title: "Stromunterbruch",
      start_date_time: start,
      rrule: "FREQ=MINUTELY;COUNT=1",
      duration_seconds: 3600,
      is_global: "NO",
      monitors: [
        { monitor_tag: "lift", monitor_impact: "DOWN" },
        { monitor_tag: "web", monitor_impact: "DOWN" },
      ],
    });
    expect(created.status).toBe(200);
    const [shared] = (await call(anna, "getMyServices")).body.services[0].maintenances;
    expect(shared.canCancel).toBe(false);
    const refused = await call(anna, "cancelMyServiceMaintenance", { event_id: shared.eventId });
    expect(refused.body.error).toBe("Only maintenance of your own services can be cancelled here");
  });

  it("refuses maintenance in the past and of other services", async () => {
    const past = await call(anna, "createMyServiceMaintenance", {
      monitor_tag: "lift",
      title: "x",
      start: 1000,
      duration_minutes: 60,
    });
    expect(past.body.error).toBe("The maintenance would already be over");
    const other = await call(anna, "createMyServiceMaintenance", {
      monitor_tag: "web",
      title: "x",
      start: GetMinuteStartNowTimestampUTC() + 3600,
      duration_minutes: 60,
    });
    expect(other.body.error).toBe("This service is not assigned to you");
  });
});

describe("assigning services", () => {
  it("lets an admin set a user's services and shows them in the users list", async () => {
    const set = await call(admin, "setUserServices", { user_id: annaId, monitor_tags: ["web", "lift", "web"] });
    expect(set.body.monitor_tags).toEqual(["lift", "web"]);
    const users = (await call(admin, "getUsers", { page: 1, limit: 10 })).body.users;
    expect(users.find((u: { id: number }) => u.id === annaId).monitor_tags).toEqual(["lift", "web"]);

    const unknown = await call(admin, "setUserServices", { user_id: annaId, monitor_tags: ["nope"] });
    expect(unknown.body.error).toBe('Monitor "nope" does not exist');
    expect(await db.getMonitorTagsForUser(annaId)).toEqual(["lift", "web"]);
  });

  it("is not open to service managers themselves", async () => {
    expect((await call(anna, "setUserServices", { user_id: annaId, monitor_tags: ["web"] })).status).toBe(403);
  });

  it("forgets a deleted monitor", async () => {
    await DeleteMonitorCompletelyUsingTag("lift");
    expect(await db.getMonitorTagsForUser(annaId)).toEqual(["parkhaus"]);
  });
});
