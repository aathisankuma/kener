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

const { sentMails } = vi.hoisted(() => ({
  sentMails: [] as Array<{ to: string[]; subject: string; html: string }>,
}));
vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));
vi.mock("$lib/server/notification/email_notification", () => ({
  default: async (_body: string, _subject: string, vars: { html: string; subject: string }, to: string[]) => {
    sentMails.push({ to, subject: vars.subject, html: vars.html });
  },
}));
vi.mock("$lib/server/controllers/emailController", () => ({ IsEmailSetup: () => true }));

import db from "$lib/server/db/db";
import GC from "$lib/global-constants";
import { seed as seedPermissions } from "../../../../seeds/permissions";
import { seed as seedRoles } from "../../../../seeds/roles";
import { seed as seedSiteData } from "../../../../seeds/site_data";
import {
  BuildUptimeReport,
  GetProblemButtonData,
  MonthRange,
  ReportProblem,
  ResetUptimeReportCheck,
  SaveProblemReportSettings,
  SaveUptimeReportSettings,
  SendUptimeReportIfDue,
  UptimeReportHtml,
} from "./reportsController";

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

const monitorRow = (tag: string, name: string, extra: Record<string, unknown> = {}) => ({
  tag,
  name,
  status: "ACTIVE",
  is_hidden: "NO",
  monitor_type: "NONE",
  type_data: "{}",
  cron: "* * * * *",
  monitor_settings_json: JSON.stringify({ problem_button: true }),
  ...extra,
});

const report = (browserId: string, monitorTag = "jira") => ReportProblem({ monitorTag, browserId, ip: "10.0.0.1" });

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
  sentMails.length = 0;
  vi.useRealTimers();
  await seedSiteData(knex);
  await knex("monitors").insert([
    monitorRow("jira", "Jira"),
    monitorRow("vpn", "VPN", { monitor_settings_json: "{}" }),
    monitorRow("secret", "Secret", { is_hidden: "YES" }),
  ]);
  await SaveProblemReportSettings({
    recipients: "it@example.test\nboss@example.test",
    threshold: 3,
    windowMinutes: 15,
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await knex.destroy();
});

describe('the "not working" button', () => {
  it("is refused for services without the button and for hidden ones", async () => {
    await expect(report("a", "vpn")).rejects.toThrow("cannot be reported");
    await expect(report("a", "secret")).rejects.toThrow("cannot be reported");
    await expect(report("a", "nope")).rejects.toThrow("cannot be reported");
  });

  it("counts each browser once and emails once when enough people report", async () => {
    expect(await report("a")).toMatchObject({ count: 1, alreadyReported: false });
    expect(await report("a")).toMatchObject({ count: 1, alreadyReported: true });
    expect(await report("b")).toMatchObject({ count: 2 });
    expect(sentMails).toHaveLength(0);

    expect(await report("c")).toMatchObject({ count: 3, alerted: true });
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toEqual(["it@example.test", "boss@example.test"]);
    expect(sentMails[0].subject).toBe("3 reports: Jira not working");

    expect(await report("d")).toMatchObject({ count: 4, alerted: false });
    expect(sentMails).toHaveLength(1);
  });

  it("emails again after the window has passed", async () => {
    for (const id of ["a", "b", "c"]) await report(id);
    await knex("problem_reports").update({ created_at: knex.raw("created_at - ?", [16 * 60]) });
    await knex("problem_reports")
      .whereNotNull("alerted_at")
      .update({ alerted_at: knex.raw("alerted_at - ?", [16 * 60]) });
    expect(await report("a")).toMatchObject({ count: 1, alreadyReported: false });
    for (const id of ["b", "c"]) await report(id);
    expect(sentMails).toHaveLength(2);
  });

  it("counts without emailing when nobody is set to receive it", async () => {
    await SaveProblemReportSettings({ recipients: "", threshold: 1, windowMinutes: 15 });
    expect(await report("a")).toMatchObject({ count: 1, alerted: false });
    expect(sentMails).toHaveLength(0);
  });

  it("gives the status page the counts of the services with the button", async () => {
    await report("a");
    expect(await GetProblemButtonData(["jira"])).toEqual({
      counts: { jira: 1 },
      showCount: true,
      helpUrl: "",
      canReport: true,
    });
    expect(await GetProblemButtonData([])).toBeNull();
  });

  it("lets only signed-in people report when set, counting each person once", async () => {
    await SaveProblemReportSettings({ recipients: "", threshold: 3, windowMinutes: 15, whoCanReport: "signed_in" });
    await expect(report("a")).rejects.toThrow("Sign in to report a problem");
    const anna = { id: 7, auth_provider: "local" } as never;
    expect(await ReportProblem({ monitorTag: "jira", browserId: "laptop", ip: "10.0.0.1", user: anna })).toMatchObject({
      count: 1,
      alreadyReported: false,
    });
    // Same person on her phone: still one report.
    expect(await ReportProblem({ monitorTag: "jira", browserId: "phone", ip: "10.0.0.2", user: anna })).toMatchObject({
      count: 1,
      alreadyReported: true,
    });
    expect((await GetProblemButtonData(["jira"], null))?.canReport).toBe(false);
    expect((await GetProblemButtonData(["jira"], anna))?.canReport).toBe(true);
  });

  it("lets only people signed in with SSO report when set", async () => {
    await SaveProblemReportSettings({ recipients: "", threshold: 3, windowMinutes: 15, whoCanReport: "sso" });
    const local = { id: 7, auth_provider: "local" } as never;
    const sso = { id: 8, auth_provider: "oidc" } as never;
    await expect(ReportProblem({ monitorTag: "jira", browserId: "a", ip: "10.0.0.1", user: local })).rejects.toThrow(
      "Sign in with SSO to report a problem",
    );
    expect(await ReportProblem({ monitorTag: "jira", browserId: "b", ip: "10.0.0.1", user: sso })).toMatchObject({
      count: 1,
    });
    expect((await GetProblemButtonData(["jira"], local))?.canReport).toBe(false);
    expect((await GetProblemButtonData(["jira"], sso))?.canReport).toBe(true);
  });

  it("checks the settings", async () => {
    await expect(
      SaveProblemReportSettings({ recipients: "not-an-email", threshold: 3, windowMinutes: 15 }),
    ).rejects.toThrow("Not an email address: not-an-email");
    await expect(SaveProblemReportSettings({ recipients: "", threshold: 0, windowMinutes: 15 })).rejects.toThrow(
      "Reports needed must be a whole number from 1 to 50",
    );
    await expect(
      SaveProblemReportSettings({ recipients: "", threshold: 3, windowMinutes: 15, helpUrl: "javascript:alert(1)" }),
    ).rejects.toThrow("must start with http");
  });
});

describe("the monthly uptime report", () => {
  const TZ = "Europe/Zurich";

  it("reports uptime, incidents and downtime per service, against the month before", async () => {
    const [sepStart] = MonthRange(2026, 9, TZ);
    const [octStart] = MonthRange(2026, 10, TZ);
    const rows = [];
    // September: 3 up, 1 down. August: 4 up.
    for (let i = 0; i < 4; i++) {
      rows.push({
        monitor_tag: "jira",
        timestamp: sepStart + 3600 + i * 60,
        status: i === 0 ? GC.DOWN : GC.UP,
        latency: 10,
        type: "REALTIME",
      });
      rows.push({
        monitor_tag: "jira",
        timestamp: sepStart - 86400 + i * 60,
        status: GC.UP,
        latency: 10,
        type: "REALTIME",
      });
    }
    // October does not count.
    rows.push({ monitor_tag: "jira", timestamp: octStart + 60, status: GC.DOWN, latency: 10, type: "REALTIME" });
    await knex("monitoring_data").insert(rows);
    const incident = await insert("incidents", {
      title: "Jira langsam",
      start_date_time: sepStart + 7200,
      status: "OPEN",
      state: "RESOLVED",
      incident_type: "INCIDENT",
    });
    await knex("incident_monitors").insert({ incident_id: incident, monitor_tag: "jira", monitor_impact: "DOWN" });

    const result = await BuildUptimeReport(2026, 9, TZ);
    expect(result.month).toBe("2026-09");
    expect(result.label).toBe("September 2026");
    const jira = result.rows.find((r) => r.tag === "jira")!;
    expect(jira).toMatchObject({
      uptime: "75",
      previousUptime: "100",
      incidents: 1,
      downtimeSeconds: 60,
      hidden: false,
    });
    expect(result.rows.find((r) => r.tag === "secret")).toMatchObject({ hidden: true, uptime: "-" });
    const html = UptimeReportHtml(result, "https://status.example.test/");
    expect(html).toContain("Uptime report: September 2026");
    expect(html).toContain("75%");
    expect(html).toContain("1 min");
  });

  it("is sent once a month, from 07:00 on the 1st, but not right after switching it on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    await SaveUptimeReportSettings({ enabled: true, recipients: "boss@example.test", timezone: TZ });
    ResetUptimeReportCheck();
    await SendUptimeReportIfDue();
    expect(sentMails).toHaveLength(0);

    // 1 November, 06:30 in Zurich: not yet.
    vi.setSystemTime(new Date("2026-11-01T05:30:00Z"));
    ResetUptimeReportCheck();
    await SendUptimeReportIfDue();
    expect(sentMails).toHaveLength(0);

    // 07:30 in Zurich: the October report goes out once.
    vi.setSystemTime(new Date("2026-11-01T06:30:00Z"));
    ResetUptimeReportCheck();
    await SendUptimeReportIfDue();
    ResetUptimeReportCheck();
    await SendUptimeReportIfDue();
    expect(sentMails.map((m) => [m.to, m.subject])).toEqual([[["boss@example.test"], "Uptime report October 2026"]]);
  });
});
