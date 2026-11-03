import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

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

const { posts, teamsReply } = vi.hoisted(() => ({
  posts: [] as Array<{ url: string; body: any }>,
  teamsReply: { status: 202 },
}));
vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));
vi.mock("$lib/server/queues/subscriberQueue", () => ({ default: { push: vi.fn() } }));
vi.mock("$lib/server/controllers/emailController", () => ({ IsEmailSetup: () => false }));

import db from "$lib/server/db/db";
import GC from "$lib/global-constants";
import { seed as seedPermissions } from "../../../../seeds/permissions";
import { seed as seedRoles } from "../../../../seeds/roles";
import { seed as seedSiteData } from "../../../../seeds/site_data";
import {
  BuildTeamsMessage,
  GetTeamsSettings,
  GetTeamsSettingsView,
  NotifyTeamsOfAlert,
  SaveTeamsSettings,
} from "./teamsController";
import { AddIncidentComment, AddIncidentMonitor, CreateIncident } from "./incidentController";
import { ReportProblem, SaveProblemReportSettings } from "./reportsController";

const HOOK = "https://prod-12.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=secret";
const card = (i = 0) => posts[i].body.attachments[0].content;

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
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return new Response(teamsReply.status < 300 ? "" : "Bad request", { status: teamsReply.status });
  });
});

beforeEach(async () => {
  await clearTables();
  posts.length = 0;
  teamsReply.status = 202;
  await seedSiteData(knex);
  await knex("monitors").insert({
    tag: "jira",
    name: "Jira",
    status: "ACTIVE",
    is_hidden: "NO",
    monitor_type: "NONE",
    type_data: "{}",
    cron: "* * * * *",
    monitor_settings_json: JSON.stringify({ problem_button: true }),
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await knex.destroy();
});

describe("Teams settings", () => {
  it("keeps the webhook secret, keeps it when left empty, and removes it on request", async () => {
    await expect(SaveTeamsSettings({ webhookUrl: "http://example.test/hook" })).rejects.toThrow("https://");
    await expect(SaveTeamsSettings({ webhookUrl: "no url" })).rejects.toThrow("Paste the whole webhook URL");

    const view = await SaveTeamsSettings({ webhookUrl: HOOK, alerts: true, incidents: false, problemReports: true });
    expect(view).toEqual({
      hasWebhook: true,
      webhookHost: "prod-12.westeurope.logic.azure.com",
      alerts: true,
      incidents: false,
      problemReports: true,
    });
    expect(JSON.stringify(await GetTeamsSettingsView())).not.toContain("sig=");

    await SaveTeamsSettings({ webhookUrl: "", alerts: false, incidents: true, problemReports: true });
    expect((await GetTeamsSettings()).webhookUrl).toBe(HOOK);
    expect((await GetTeamsSettings()).alerts).toBe(false);

    await SaveTeamsSettings({ removeWebhook: true });
    expect((await GetTeamsSettingsView()).hasWebhook).toBe(false);
  });
});

describe("the Teams message", () => {
  it("is one Adaptive Card with title, facts, local time and buttons", () => {
    const message = BuildTeamsMessage({
      title: "🔴 Störung: Jira",
      color: "Attention",
      facts: [
        { title: "Dienst", value: "Jira" },
        { title: "Leer", value: "" },
      ],
      time: "2026-11-03T03:40:00.000Z",
      actions: [
        { title: "Dienst ansehen", url: "https://status.example.test/monitors/jira" },
        { title: "Ohne Adresse", url: "monitors/jira" },
      ],
    }) as any;
    expect(message.type).toBe("message");
    const content = message.attachments[0].content;
    expect(message.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(content.type).toBe("AdaptiveCard");
    expect(content.body[0]).toMatchObject({ text: "🔴 Störung: Jira", color: "Attention" });
    expect(content.body[1].facts).toEqual([{ title: "Dienst", value: "Jira" }]);
    expect(content.body[2].text).toBe("{{DATE(2026-11-03T03:40:00Z, SHORT)}} {{TIME(2026-11-03T03:40:00Z)}}");
    expect(content.actions).toEqual([
      { type: "Action.OpenUrl", title: "Dienst ansehen", url: "https://status.example.test/monitors/jira" },
    ]);
  });
});

describe("what reaches Teams", () => {
  beforeEach(async () => {
    await SaveTeamsSettings({ webhookUrl: HOOK, alerts: true, incidents: true, problemReports: true });
  });

  it("sends alerts with the service's name", async () => {
    const base = {
      monitorTag: "jira",
      alertFor: "STATUS",
      alertValue: "DOWN",
      severity: "CRITICAL",
      timestamp: new Date().toISOString(),
    };
    expect(await NotifyTeamsOfAlert({ ...base, isTriggered: true })).toBe(true);
    expect(await NotifyTeamsOfAlert({ ...base, isTriggered: false })).toBe(true);
    expect(posts[0].url).toBe(HOOK);
    expect(card(0).body[0]).toMatchObject({ text: "🔴 Störung: Jira", color: "Attention" });
    expect(card(1).body[0]).toMatchObject({ text: "✅ Behoben: Jira", color: "Good" });
    expect(card(0).body[1].facts).toContainEqual({ title: "Schweregrad", value: "Kritisch" });
    expect(card(0).body[1].facts).toContainEqual({ title: "Bedingung", value: "Dienst ist ausgefallen" });
  });

  it("sends every incident update, and only when switched on", async () => {
    const { incident_id } = await CreateIncident({ title: "Jira langsam", start_date_time: 1000, is_global: "NO" });
    await AddIncidentMonitor(incident_id, "jira", "DEGRADED");
    await AddIncidentComment(incident_id, "Wir prüfen das.", GC.INVESTIGATING, 1100);
    await AddIncidentComment(incident_id, "Läuft wieder.", GC.RESOLVED, 1200);
    expect(posts.map((p) => p.body.attachments[0].content.body[0].text)).toEqual([
      "📣 Vorfall: Jira langsam",
      "✅ Vorfall: Jira langsam",
    ]);
    expect(card(0).body[1].text).toBe("Wir prüfen das.");
    expect(card(0).body[2].facts).toEqual([
      { title: "Status", value: "Wird untersucht" },
      { title: "Betroffen", value: "Jira" },
    ]);

    await SaveTeamsSettings({ incidents: false });
    await AddIncidentComment(incident_id, "Nachtrag", GC.RESOLVED, 1300);
    expect(posts).toHaveLength(2);
  });

  it("never stops an incident update when Teams fails", async () => {
    teamsReply.status = 400;
    const { incident_id } = await CreateIncident({ title: "Telefonie", start_date_time: 1000, is_global: "NO" });
    await expect(AddIncidentComment(incident_id, "Gestört", GC.INVESTIGATING, 1100)).resolves.toBeTruthy();
    expect(posts).toHaveLength(1);
  });

  it('sends the "not working" alert to Teams even without email addresses', async () => {
    await SaveProblemReportSettings({ recipients: "", threshold: 2, windowMinutes: 15 });
    await ReportProblem({ monitorTag: "jira", browserId: "a", ip: "10.0.0.1" });
    expect(await ReportProblem({ monitorTag: "jira", browserId: "b", ip: "10.0.0.1" })).toMatchObject({
      alerted: true,
    });
    expect(card(0).body[0].text).toBe("⚠️ 2 Meldungen: Jira funktioniert nicht");
    // Once per period.
    await ReportProblem({ monitorTag: "jira", browserId: "c", ip: "10.0.0.1" });
    expect(posts).toHaveLength(1);
  });
});
