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

const { subscriberQueue, jira } = vi.hoisted(() => ({
  subscriberQueue: { push: vi.fn() },
  // A fake Jira: tickets the Kener account takes part in, with their public replies.
  jira: {
    tickets: new Map<string, { summary: string; status: string; statusCategory: string; createdAt: number }>(),
    comments: new Map<string, Array<{ id: string; body: string; createdAt: number }>>(),
    failing: new Set<string>(),
  },
}));
vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));
vi.mock("$lib/server/queues/subscriberQueue", () => ({ default: subscriberQueue }));
vi.mock("$lib/server/queues/alertingQueue", () => ({ default: { push: vi.fn() } }));
vi.mock("$lib/server/jsmClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("$lib/server/jsmClient")>();
  const ticket = (key: string) => {
    if (jira.failing.has(key)) throw new Error("Kener cannot see this ticket (HTTP 404)");
    const t = jira.tickets.get(key);
    if (!t) throw new Error("Kener cannot see this ticket (HTTP 404)");
    return { key, url: `https://jsm.example.test/browse/${key}`, ...t };
  };
  return {
    ...original,
    JsmConfigured: () => true,
    JsmListSharedTickets: async () => [...jira.tickets.keys()].map(ticket),
    JsmGetTicket: async (key: string) => ticket(key),
    JsmGetPublicComments: async (key: string) => {
      ticket(key);
      return jira.comments.get(key) ?? [];
    },
  };
});

import db from "$lib/server/db/db";
import GC from "$lib/global-constants";
import { GenerateToken } from "$lib/server/controllers/commonController";
import { GetNowTimestampUTC } from "$lib/server/tool";
import { seed as seedPermissions } from "../../../../seeds/permissions";
import { seed as seedRoles } from "../../../../seeds/roles";
import { seed as seedSiteData } from "../../../../seeds/site_data";
import * as manageApi from "../../../routes/(manage)/manage/api/+server";
import { DeleteIncident } from "./incidentController";
import { SyncJsmTickets } from "./jsmController";
import { GetTopAndPastIncidents, TOP_RESOLVED_KEEP_S } from "./dashboardController";

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

let admin: Cookies;
let member: Cookies;

async function call(cookies: Cookies, action: string, data: Record<string, unknown> = {}) {
  const response = await manageApi.POST({
    request: new Request("http://localhost/manage/api", { method: "POST", body: JSON.stringify({ action, data }) }),
    cookies,
  } as never);
  return { status: response.status, body: await response.json() };
}

const cookiesFor = async (email: string): Promise<Cookies> => {
  const token = await GenerateToken((await db.getUserByEmail(email))!);
  return { get: (name: string) => (name === "kener-user" ? token : undefined) } as unknown as Cookies;
};

const NOW = GetNowTimestampUTC();
const updates = async (incidentId: number) =>
  (await knex("incident_comments").where({ incident_id: incidentId }).orderBy("id", "asc")).map((c) => [
    c.comment,
    c.state,
  ]);

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
  jira.tickets.clear();
  jira.comments.clear();
  jira.failing.clear();
  await seedSiteData(knex);
  for (const [email, role] of [
    ["admin@example.test", "admin"],
    ["member@example.test", "member"],
  ]) {
    const id = await insert("users", { email, name: role, password_hash: "x", is_active: 1, is_verified: 1 });
    await knex("users_roles").insert({ users_id: id, roles_id: role });
  }
  const monitorRow = {
    status: "ACTIVE",
    is_hidden: "NO",
    monitor_type: "NONE",
    type_data: "{}",
    cron: "* * * * *",
    monitor_settings_json: JSON.stringify({
      uptime_formula_numerator: GC.defaultNumeratorStr,
      uptime_formula_denominator: GC.defaultDenominatorStr,
    }),
  };
  await knex("monitors").insert([
    { tag: "printer", name: "Windows Print Server", ...monitorRow },
    { tag: "vpn", name: "VPN", ...monitorRow },
  ]);
  admin = await cookiesFor("admin@example.test");
  member = await cookiesFor("member@example.test");

  jira.tickets.set("IT-1", {
    summary: "Drucker 2. OG ausgefallen",
    status: "Offen",
    statusCategory: "NEW",
    createdAt: NOW - 3600,
  });
  jira.comments.set("IT-1", [{ id: "100", body: "Hallo Peter, bitte neu starten.", createdAt: NOW - 3000 }]);
  jira.tickets.set("IT-2", { summary: "Passwort vergessen", status: "Offen", statusCategory: "NEW", createdAt: NOW });
});

afterAll(async () => {
  await knex.destroy();
});

describe("the list of shared tickets", () => {
  it("shows new tickets until they are linked or ignored", async () => {
    const before = (await call(admin, "getJsmTickets")).body;
    expect(before.shared.map((t: { key: string }) => t.key).sort()).toEqual(["IT-1", "IT-2"]);

    await call(admin, "linkJsmTicket", { issue_key: "IT-1", monitor_tag: "printer", impact: "DOWN" });
    await call(admin, "ignoreJsmTicket", { issue_key: "IT-2" });
    const after = (await call(admin, "getJsmTickets")).body;
    expect(after.shared).toEqual([]);
    expect(after.linked).toMatchObject([
      {
        issue_key: "IT-1",
        summary: "Drucker 2. OG ausgefallen",
        monitor_tag: "printer",
        incident_state: "INVESTIGATING",
      },
    ]);
    expect(after.ignored).toEqual([
      { issue_key: "IT-2", summary: "Passwort vergessen", url: "https://jsm.example.test/browse/IT-2" },
    ]);

    await call(admin, "unignoreJsmTicket", { issue_key: "IT-2" });
    expect((await call(admin, "getJsmTickets")).body.shared.map((t: { key: string }) => t.key)).toEqual(["IT-2"]);
  });

  it("is read-only for members and closed to everyone else's write", async () => {
    expect((await call(member, "getJsmTickets")).status).toBe(200);
    expect((await call(member, "linkJsmTicket", { issue_key: "IT-1" })).status).toBe(403);
  });
});

describe("linking", () => {
  it("creates an incident on the service without copying earlier replies", async () => {
    const linked = await call(admin, "linkJsmTicket", {
      issue_key: "https://jsm.example.test/browse/it-1",
      monitor_tag: "printer",
      impact: "DOWN",
    });
    expect(linked.status).toBe(200);
    const id = linked.body.incident_id;
    expect(await knex("incidents").where({ id }).first()).toMatchObject({
      title: "Drucker 2. OG ausgefallen",
      is_global: "NO",
      state: "INVESTIGATING",
    });
    expect(await knex("incident_monitors").where({ incident_id: id }).select("monitor_tag", "monitor_impact")).toEqual([
      { monitor_tag: "printer", monitor_impact: "DOWN" },
    ]);
    expect(await updates(id)).toEqual([["Drucker 2. OG ausgefallen", "INVESTIGATING"]]);
    expect(subscriberQueue.push.mock.calls[0][2]).toEqual(["printer"]);
  });

  it("refuses a ticket Kener cannot see, a second link and a missing service", async () => {
    expect(
      (await call(admin, "linkJsmTicket", { issue_key: "IT-9", monitor_tag: "printer", impact: "DOWN" })).body.error,
    ).toContain("cannot see this ticket");
    await call(admin, "linkJsmTicket", { issue_key: "IT-1", monitor_tag: "printer", impact: "DOWN" });
    expect(
      (await call(admin, "linkJsmTicket", { issue_key: "IT-1", monitor_tag: "printer", impact: "DOWN" })).body.error,
    ).toBe("IT-1 is already linked");
    expect(
      (await call(admin, "linkJsmTicket", { issue_key: "IT-2", monitor_tag: "", impact: "DOWN" })).body.error,
    ).toBe("Choose a service, or show the ticket to everyone");
    expect(Number((await knex("incidents").count({ n: "*" }).first())?.n)).toBe(1);
  });
});

describe("showing a ticket to everyone", () => {
  it("links a ticket without a service at the top, and emails every subscriber", async () => {
    const linked = await call(admin, "linkJsmTicket", {
      issue_key: "IT-2",
      monitor_tag: "",
      impact: "DEGRADED",
      show_at_top: true,
    });
    expect(linked.status).toBe(200);
    const id = linked.body.incident_id;
    expect(await knex("incidents").where({ id }).first()).toMatchObject({
      incident_source: "JSM",
      top_impact: "DEGRADED",
      is_global: "NO",
    });
    expect(await knex("incident_monitors").where({ incident_id: id })).toEqual([]);
    // No monitor filter: every subscriber hears of it.
    expect(subscriberQueue.push.mock.calls[0][2]).toBeNull();
    expect(subscriberQueue.push.mock.calls[0][0]).toMatchObject({ incident_impact: "DEGRADED" });
    const linkedRow = (await call(admin, "getJsmTickets")).body.linked[0];
    expect(linkedRow).toMatchObject({ issue_key: "IT-2", monitor_tag: null, show_at_top: true });
  });

  it("puts a linked ticket at the top and takes it away again", async () => {
    const id = (await call(admin, "linkJsmTicket", { issue_key: "IT-1", monitor_tag: "printer", impact: "DOWN" })).body
      .incident_id;
    await call(admin, "moveJsmTicket", {
      issue_key: "IT-1",
      monitor_tag: "printer",
      impact: "DOWN",
      show_at_top: true,
    });
    expect((await knex("incidents").where({ id }).first()).top_impact).toBe("DOWN");

    // Without a service it must stay at the top.
    expect(
      (await call(admin, "moveJsmTicket", { issue_key: "IT-1", monitor_tag: "", impact: "DOWN", show_at_top: false }))
        .body.error,
    ).toBe("Choose a service, or show the ticket to everyone");
    await call(admin, "moveJsmTicket", { issue_key: "IT-1", monitor_tag: "", impact: "DOWN", show_at_top: true });
    expect(await knex("incident_monitors").where({ incident_id: id })).toEqual([]);

    await call(admin, "moveJsmTicket", { issue_key: "IT-1", monitor_tag: "vpn", impact: "DOWN", show_at_top: false });
    expect((await knex("incidents").where({ id }).first()).top_impact).toBeNull();
    expect(await knex("incident_monitors").where({ incident_id: id }).pluck("monitor_tag")).toEqual(["vpn"]);
  });
});

describe("the top of the status page and its past incidents", () => {
  const DAY = 86400;
  const incident = async (row: Record<string, unknown>, monitorTag?: string) => {
    const id = await insert("incidents", {
      start_date_time: NOW - 2 * DAY,
      status: "OPEN",
      incident_type: "INCIDENT",
      is_global: "NO",
      incident_source: "JSM",
      ...row,
    });
    if (monitorTag)
      await knex("incident_monitors").insert({ incident_id: id, monitor_tag: monitorTag, monitor_impact: "DOWN" });
    await knex("incident_comments").insert({
      incident_id: id,
      comment: `Update on ${row.title}`,
      state: row.state,
      commented_at: (row.end_date_time as number) ?? NOW - DAY,
      status: "ACTIVE",
    });
    return id;
  };

  it("shows open and recently resolved top incidents, and past JSM incidents the page may show", async () => {
    await knex("monitors").where({ tag: "vpn" }).update({ is_hidden: "YES" });
    const open = await incident({ title: "Telefonie", state: "IDENTIFIED", top_impact: "DOWN" });
    const onPrinter = await incident({ title: "Drucker", state: "INVESTIGATING", top_impact: "DEGRADED" }, "printer");
    const justResolved = await incident({
      title: "Internet",
      state: "RESOLVED",
      end_date_time: NOW - 3600,
      top_impact: "DOWN",
    });
    const longResolved = await incident({
      title: "WLAN",
      state: "RESOLVED",
      end_date_time: NOW - TOP_RESOLVED_KEEP_S - 60,
      top_impact: "DOWN",
    });
    const pastOnService = await incident(
      { title: "Druckerstau", state: "RESOLVED", end_date_time: NOW - 10 * DAY },
      "printer",
    );
    await incident({ title: "Geheim", state: "RESOLVED", end_date_time: NOW - DAY }, "vpn");
    await incident(
      { title: "Uralt", state: "RESOLVED", end_date_time: NOW - 100 * DAY, start_date_time: NOW - 101 * DAY },
      "printer",
    );
    await incident(
      { title: "Vom Dashboard", state: "RESOLVED", end_date_time: NOW - DAY, incident_source: "DASHBOARD" },
      "printer",
    );
    await incident({ title: "Normal offen", state: "INVESTIGATING" }, "printer");

    const { topIncidents, pastJsmIncidents } = await GetTopAndPastIncidents(["printer"], NOW);

    expect(topIncidents.map((i) => [i.title, i.state, i.top_impact, i.href]).sort()).toEqual(
      [
        ["Telefonie", "IDENTIFIED", "DOWN", `/incidents/${open}`],
        ["Drucker", "INVESTIGATING", "DEGRADED", "/monitors/printer"],
        ["Internet", "RESOLVED", "DOWN", `/incidents/${justResolved}`],
      ].sort(),
    );
    expect(topIncidents.find((i) => i.id === onPrinter)?.latest?.comment).toBe("Update on Drucker");
    // Off the top after 24 hours, then in the past list; the hidden service's incident never.
    expect(pastJsmIncidents.map((i) => i.id)).toEqual([longResolved, pastOnService]);
    expect(pastJsmIncidents[1].monitorNames).toEqual(["Windows Print Server"]);
  });
});

describe("keeping the incident up to date", () => {
  let id: number;
  beforeEach(async () => {
    id = (await call(admin, "linkJsmTicket", { issue_key: "IT-1", monitor_tag: "printer", impact: "DOWN" })).body
      .incident_id;
    vi.clearAllMocks();
  });

  it("posts new replies to customers once, in order", async () => {
    jira.tickets.get("IT-1")!.statusCategory = "INDETERMINATE";
    jira.comments
      .get("IT-1")!
      .push(
        { id: "101", body: "Der Techniker ist unterwegs.", createdAt: NOW - 60 },
        { id: "102", body: "Der Techniker ist vor Ort.", createdAt: NOW - 30 },
      );
    expect(await SyncJsmTickets()).toEqual({ tickets: 1, updates: 2 });
    expect(await SyncJsmTickets()).toEqual({ tickets: 1, updates: 0 });
    expect((await updates(id)).slice(1)).toEqual([
      ["Der Techniker ist unterwegs.", "IDENTIFIED"],
      ["Der Techniker ist vor Ort.", "IDENTIFIED"],
    ]);
    expect(subscriberQueue.push).toHaveBeenCalledTimes(2);
  });

  it("closes the incident when the ticket is done, and reopens it with the ticket", async () => {
    Object.assign(jira.tickets.get("IT-1")!, { status: "Erledigt", statusCategory: "DONE" });
    await SyncJsmTickets();
    expect(await knex("incidents").where({ id }).first()).toMatchObject({ state: "RESOLVED" });
    expect((await updates(id)).at(-1)).toEqual(["Status: Erledigt", "RESOLVED"]);
    expect((await db.getJsmLinkByKey("IT-1"))?.done_at).toBeGreaterThan(0);

    Object.assign(jira.tickets.get("IT-1")!, { status: "Wieder offen", statusCategory: "NEW" });
    await SyncJsmTickets();
    const incident = await knex("incidents").where({ id }).first();
    expect(incident).toMatchObject({ state: "INVESTIGATING", end_date_time: null });
    expect((await db.getJsmLinkByKey("IT-1"))?.done_at).toBeNull();
  });

  it("resolves with the last of several new replies, not before", async () => {
    Object.assign(jira.tickets.get("IT-1")!, { status: "Erledigt", statusCategory: "DONE" });
    jira.comments
      .get("IT-1")!
      .push(
        { id: "101", body: "Teil ist bestellt.", createdAt: NOW - 60 },
        { id: "102", body: "Drucker läuft wieder.", createdAt: NOW - 30 },
      );
    await SyncJsmTickets();
    expect((await updates(id)).slice(1)).toEqual([
      ["Teil ist bestellt.", "IDENTIFIED"],
      ["Drucker läuft wieder.", "RESOLVED"],
    ]);
  });

  it("stops reading a ticket done for more than 7 days", async () => {
    await db.updateJsmLink("IT-1", { done_at: NOW - 8 * 86400, last_status_category: "DONE" });
    expect(await SyncJsmTickets()).toEqual({ tickets: 0, updates: 0 });
  });

  it("keeps the incident and notes the reason when the ticket cannot be read", async () => {
    jira.failing.add("IT-1");
    await SyncJsmTickets();
    expect((await db.getJsmLinkByKey("IT-1"))?.last_error).toContain("cannot see this ticket");
    expect(await updates(id)).toHaveLength(1);
  });

  it("moves the incident to another service", async () => {
    expect(
      (await call(admin, "moveJsmTicket", { issue_key: "IT-1", monitor_tag: "vpn", impact: "DEGRADED" })).status,
    ).toBe(200);
    expect(await knex("incident_monitors").where({ incident_id: id }).select("monitor_tag", "monitor_impact")).toEqual([
      { monitor_tag: "vpn", monitor_impact: "DEGRADED" },
    ]);
  });

  it("stops updating after unlinking, and forgets the link when the incident is deleted", async () => {
    await call(admin, "unlinkJsmTicket", { issue_key: "IT-1" });
    jira.comments.get("IT-1")!.push({ id: "101", body: "Neu", createdAt: NOW });
    expect(await SyncJsmTickets()).toEqual({ tickets: 0, updates: 0 });
    expect(await knex("incidents").where({ id }).first()).toBeTruthy();

    const again = (await call(admin, "linkJsmTicket", { issue_key: "IT-1", monitor_tag: "printer", impact: "DOWN" }))
      .body.incident_id;
    await DeleteIncident(again);
    expect(await db.getJsmLinkByKey("IT-1")).toBeUndefined();
  });
});
