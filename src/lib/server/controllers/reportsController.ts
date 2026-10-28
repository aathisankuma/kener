// Two kinds of reports to the people who run the status page:
//  - the "not working" button: staff report a service with one click; when enough different
//    browsers report the same service within a short time, the chosen addresses get an email;
//  - the monthly uptime report: on the 1st of each month, uptime, incidents and downtime per
//    service for the past month, compared with the month before.
import crypto from "node:crypto";
import { Cron } from "croner";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import db from "../db/db.js";
import GC from "../../global-constants.js";
import { GetNowTimestampUTC, UptimeCalculator } from "../tool.js";
import sendEmail from "../notification/email_notification.js";
import { IsEmailSetup } from "./emailController.js";
import { GetAllSiteData } from "./siteDataController.js";
import { siteDataToVariables } from "../notification/notification_utils.js";
import type { MonitorRecord } from "../types/db.js";

// ============ Settings ============

export interface ProblemReportSettings {
  /** Who is emailed when a service is reported often enough. */
  recipients: string[];
  /** Different browsers that must report a service within windowMinutes. */
  threshold: number;
  windowMinutes: number;
  /** Show staff how many others reported the service. */
  showCount: boolean;
  /** Where staff ask for personal help, e.g. the service desk portal. */
  helpUrl: string;
}

export interface UptimeReportSettings {
  enabled: boolean;
  recipients: string[];
  /** Months start and end at midnight in this time zone. */
  timezone: string;
  /** The last month sent, as YYYY-MM. */
  lastSentMonth: string | null;
  lastError: string | null;
}

export const DEFAULT_PROBLEM_SETTINGS: ProblemReportSettings = {
  recipients: [],
  threshold: 3,
  windowMinutes: 15,
  showCount: true,
  helpUrl: "",
};

export const DEFAULT_UPTIME_REPORT_SETTINGS: UptimeReportSettings = {
  enabled: false,
  recipients: [],
  timezone: "UTC",
  lastSentMonth: null,
  lastError: null,
};

const PROBLEM_KEY = "problemReportSettings";
const UPTIME_KEY = "uptimeReportSettings";
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

async function readSetting<T extends object>(key: string, defaults: T): Promise<T> {
  const row = await db.getSiteDataByKey(key);
  if (!row?.value) return { ...defaults };
  try {
    return { ...defaults, ...JSON.parse(row.value) };
  } catch {
    return { ...defaults };
  }
}

async function writeSetting(key: string, value: object): Promise<void> {
  await db.insertOrUpdateSiteData(key, JSON.stringify(value), "object");
}

/** Email addresses from a list or from text separated by commas, semicolons or new lines. */
export function ParseRecipients(input: unknown): string[] {
  const parts = Array.isArray(input) ? input.map(String) : String(input ?? "").split(/[\s,;]+/);
  const emails = [...new Set(parts.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) throw new Error(`Not an email address: ${invalid.join(", ")}`);
  if (emails.length > 50) throw new Error("At most 50 email addresses");
  return emails;
}

function wholeNumber(value: unknown, name: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

export function IsValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export const GetProblemReportSettings = () => readSetting(PROBLEM_KEY, DEFAULT_PROBLEM_SETTINGS);
export const GetUptimeReportSettings = () => readSetting(UPTIME_KEY, DEFAULT_UPTIME_REPORT_SETTINGS);

export async function SaveProblemReportSettings(data: Record<string, unknown>): Promise<ProblemReportSettings> {
  const helpUrl = String(data.helpUrl ?? "").trim();
  if (helpUrl && !/^https?:\/\/\S+$/i.test(helpUrl))
    throw new Error("The help link must start with http:// or https://");
  const settings: ProblemReportSettings = {
    recipients: ParseRecipients(data.recipients),
    threshold: wholeNumber(data.threshold, "Reports needed", 1, 50),
    windowMinutes: wholeNumber(data.windowMinutes, "Minutes", 5, 1440),
    showCount: data.showCount !== false,
    helpUrl,
  };
  await writeSetting(PROBLEM_KEY, settings);
  return settings;
}

export async function SaveUptimeReportSettings(data: Record<string, unknown>): Promise<UptimeReportSettings> {
  const timezone = String(data.timezone ?? "UTC").trim() || "UTC";
  if (!IsValidTimezone(timezone)) throw new Error(`Unknown time zone: ${timezone}`);
  const current = await GetUptimeReportSettings();
  const settings: UptimeReportSettings = {
    ...current,
    enabled: data.enabled === true,
    recipients: ParseRecipients(data.recipients),
    timezone,
  };
  if (settings.enabled && settings.recipients.length === 0) throw new Error("Add at least one email address");
  // Switched on: the first report goes out on the next 1st, not right away for last month.
  if (settings.enabled && !current.enabled) {
    const { year, month } = PreviousMonth(GetNowTimestampUTC(), timezone);
    settings.lastSentMonth = `${year}-${String(month).padStart(2, "0")}`;
  }
  await writeSetting(UPTIME_KEY, settings);
  return settings;
}

// ============ "Not working" button ============

export function ProblemButtonEnabled(monitor: Pick<MonitorRecord, "monitor_settings_json"> | undefined): boolean {
  if (!monitor?.monitor_settings_json) return false;
  try {
    const settings =
      typeof monitor.monitor_settings_json === "string"
        ? JSON.parse(monitor.monitor_settings_json)
        : monitor.monitor_settings_json;
    return settings?.problem_button === true;
  } catch {
    return false;
  }
}

/** What a status page needs to show the button: the count per service, or null when hidden. */
export interface ProblemButtonData {
  /** Services with the button, and how many reported each within the window. */
  counts: Record<string, number>;
  showCount: boolean;
  helpUrl: string;
}

export async function GetProblemButtonData(enabledTags: string[]): Promise<ProblemButtonData | null> {
  if (enabledTags.length === 0) return null;
  const settings = await GetProblemReportSettings();
  const since = GetNowTimestampUTC() - settings.windowMinutes * 60;
  const counted = settings.showCount ? await db.countProblemReporters(enabledTags, since) : {};
  return {
    counts: Object.fromEntries(enabledTags.map((tag) => [tag, counted[tag] ?? 0])),
    showCount: settings.showCount,
    helpUrl: settings.helpUrl,
  };
}

// Reports per network address, against a script pressing the button endlessly. An office
// shares one address, so the limit is generous.
const IP_LIMIT = 60;
const IP_WINDOW_S = 10 * 60;
const recentByIp = new Map<string, number[]>();

function tooManyFrom(ip: string, now: number): boolean {
  const recent = (recentByIp.get(ip) ?? []).filter((t) => t > now - IP_WINDOW_S);
  recent.push(now);
  recentByIp.set(ip, recent);
  if (recentByIp.size > 5000) recentByIp.clear();
  return recent.length > IP_LIMIT;
}

/** Reports older than this are deleted. */
const KEEP_REPORTS_S = 180 * 86400;

export class ProblemReportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Records that a browser finds a service not working. A browser counts once per service and
 * window. When enough different browsers reported the service, the recipients are emailed once
 * per window.
 */
export async function ReportProblem(input: {
  monitorTag: string;
  browserId: string;
  ip: string;
}): Promise<{ count: number; alreadyReported: boolean; alerted: boolean }> {
  const monitor = await db.getMonitorByTag(input.monitorTag);
  if (!monitor || monitor.status !== "ACTIVE" || monitor.is_hidden === "YES" || !ProblemButtonEnabled(monitor)) {
    throw new ProblemReportError("This service cannot be reported", 404);
  }
  const now = GetNowTimestampUTC();
  if (tooManyFrom(input.ip, now)) throw new ProblemReportError("Too many reports, please try again later", 429);

  const settings = await GetProblemReportSettings();
  const since = now - settings.windowMinutes * 60;
  const reporter = crypto
    .createHash("sha256")
    .update(`${process.env.KENER_SECRET_KEY ?? ""}:${input.browserId}`)
    .digest("hex");

  const alreadyReported = await db.hasProblemReport(monitor.tag, reporter, since);
  let reportId: number | null = null;
  if (!alreadyReported) {
    reportId = await db.insertProblemReport({ monitor_tag: monitor.tag, reporter, created_at: now });
    if (reportId % 50 === 0) await db.deleteProblemReportsBefore(now - KEEP_REPORTS_S);
  }
  const count = (await db.countProblemReporters([monitor.tag], since))[monitor.tag] ?? 0;

  let alerted = false;
  if (
    reportId !== null &&
    count >= settings.threshold &&
    settings.recipients.length > 0 &&
    !(await db.wasProblemAlertSent(monitor.tag, since))
  ) {
    try {
      await sendProblemAlert(monitor, count, settings);
      await db.markProblemReportAlerted(reportId, now);
      alerted = true;
    } catch (e) {
      // The next report tries again.
      console.error(`Could not send the "not working" alert for ${monitor.tag}:`, e);
    }
  }
  return { count, alreadyReported, alerted };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function siteUrl(): Promise<string> {
  try {
    return siteDataToVariables(await GetAllSiteData()).site_url || "";
  } catch {
    return "";
  }
}

async function sendProblemAlert(monitor: MonitorRecord, count: number, settings: ProblemReportSettings) {
  if (!IsEmailSetup()) throw new Error("Email is not set up");
  const url = await siteUrl();
  const name = escapeHtml(monitor.name);
  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#172b4d">
  <p><b>${count} people</b> reported in the last ${settings.windowMinutes} minutes that <b>${name}</b> is not working.</p>
  <p>Check the service, and if there is an outage, post an incident so that everyone sees it on the status page.</p>
  ${
    url
      ? `<p><a href="${escapeHtml(url)}monitors/${encodeURIComponent(monitor.tag)}">Open ${name} on the status page</a> ·
     <a href="${escapeHtml(url)}manage/app/incidents/new">Post an incident</a></p>`
      : ""
  }
  <p style="color:#6b778c;font-size:12px">Sent by the "not working" button. Change who gets this in Kener under Reports.</p>
</div>`;
  await sendEmail(
    "{{{html}}}",
    "{{{subject}}}",
    { html, subject: `${count} reports: ${monitor.name} not working` },
    settings.recipients,
  );
}

/** Services reported in the last days, for the admin page. */
export async function GetProblemReportOverview(days = 7) {
  const since = GetNowTimestampUTC() - days * 86400;
  const summary = await db.getProblemReportSummary(since);
  const monitors = await db.getMonitors({});
  const names = new Map(monitors.map((m) => [m.tag, m.name]));
  const enabled = monitors.filter((m) => ProblemButtonEnabled(m)).map((m) => ({ tag: m.tag, name: m.name }));
  return {
    days,
    services: summary.map((s) => ({ ...s, name: names.get(s.monitor_tag) ?? s.monitor_tag })),
    enabled,
  };
}

// ============ Monthly uptime report ============

export interface UptimeReportRow {
  tag: string;
  name: string;
  hidden: boolean;
  /** Percent as text, "-" without data. */
  uptime: string;
  previousUptime: string;
  incidents: number;
  /** Estimated seconds the service was down. */
  downtimeSeconds: number;
}

export interface UptimeReport {
  /** YYYY-MM of the month reported. */
  month: string;
  label: string;
  timezone: string;
  rows: UptimeReportRow[];
}

/** Start (inclusive) and end (exclusive) in UTC seconds of a month in a time zone. */
export function MonthRange(year: number, month: number, timezone: string): [number, number] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const start = fromZonedTime(`${year}-${pad(month)}-01T00:00:00`, timezone).getTime() / 1000;
  const end = fromZonedTime(`${next[0]}-${pad(next[1])}-01T00:00:00`, timezone).getTime() / 1000;
  return [start, end];
}

/** The month before the one containing the timestamp, in the time zone. */
export function PreviousMonth(timestamp: number, timezone: string): { year: number; month: number } {
  const local = toZonedTime(new Date(timestamp * 1000), timezone);
  const year = local.getFullYear();
  const month = local.getMonth() + 1;
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function secondsPerCheck(cron: string | null): number {
  try {
    const runs = new Cron(cron || "* * * * *", { paused: true }).nextRuns(2);
    const s = (runs[1].getTime() - runs[0].getTime()) / 1000;
    return s > 0 ? s : 60;
  } catch {
    return 60;
  }
}

function parseSettings(json: string | null) {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

export async function BuildUptimeReport(year: number, month: number, timezone: string): Promise<UptimeReport> {
  const [start, end] = MonthRange(year, month, timezone);
  const prev = month === 1 ? MonthRange(year - 1, 12, timezone) : MonthRange(year, month - 1, timezone);
  const monitors = (await db.getMonitors({ status: "ACTIVE" })).sort((a, b) => a.name.localeCompare(b.name));
  const rows: UptimeReportRow[] = [];
  for (const monitor of monitors) {
    const settings = parseSettings(monitor.monitor_settings_json);
    const [now, before] = await Promise.all([
      db.getStatusCountsByInterval(monitor.tag, start, end - start, 1),
      db.getStatusCountsByInterval(monitor.tag, prev[0], prev[1] - prev[0], 1),
    ]);
    const incidents = (await db.getIncidentsByMonitorTag(monitor.tag, start, end - 1)).filter(
      (i) => i.incident_type === GC.INCIDENT,
    );
    const down = now.reduce((sum, d) => sum + d.countOfDown, 0);
    rows.push({
      tag: monitor.tag,
      name: monitor.name,
      hidden: monitor.is_hidden === "YES",
      uptime: UptimeCalculator(now, settings.uptime_formula_numerator, settings.uptime_formula_denominator).uptime,
      previousUptime: UptimeCalculator(before, settings.uptime_formula_numerator, settings.uptime_formula_denominator)
        .uptime,
      incidents: new Set(incidents.map((i) => i.id)).size,
      downtimeSeconds: down * secondsPerCheck(monitor.cron),
    });
  }
  const label = new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { month: `${year}-${String(month).padStart(2, "0")}`, label, timezone, rows };
}

export function FormatDowntime(seconds: number): string {
  if (seconds <= 0) return "–";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

export function UptimeReportHtml(report: UptimeReport, url: string): string {
  const cell = "padding:6px 10px;border-bottom:1px solid #dfe1e6";
  const change = (now: string, before: string) => {
    const a = parseFloat(now);
    const b = parseFloat(before);
    if (isNaN(a) || isNaN(b) || Math.abs(a - b) < 0.005) return "";
    const diff = (a - b).toFixed(2);
    return ` <span style="color:${a > b ? "#36b37e" : "#de350b"};font-size:12px">${a > b ? "+" : ""}${diff}</span>`;
  };
  const pct = (v: string) =>
    v === "-" || isNaN(parseFloat(v)) ? "no data" : `${parseFloat(parseFloat(v).toFixed(2))}%`;
  const rows = report.rows
    .map(
      (r) => `<tr>
  <td style="${cell}">${escapeHtml(r.name)}${r.hidden ? ' <span style="color:#6b778c">(hidden)</span>' : ""}</td>
  <td style="${cell};text-align:right"><b>${pct(r.uptime)}</b>${change(r.uptime, r.previousUptime)}</td>
  <td style="${cell};text-align:right;color:#6b778c">${pct(r.previousUptime)}</td>
  <td style="${cell};text-align:right">${r.incidents || "–"}</td>
  <td style="${cell};text-align:right">${FormatDowntime(r.downtimeSeconds)}</td>
</tr>`,
    )
    .join("");
  const head = "padding:6px 10px;border-bottom:2px solid #dfe1e6;text-align:right;font-size:12px;color:#6b778c";
  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#172b4d">
  <h2 style="margin:0 0 4px">Uptime report: ${escapeHtml(report.label)}</h2>
  <p style="margin:0 0 16px;color:#6b778c">Per service, compared with the month before. Times in ${escapeHtml(report.timezone)}.</p>
  <table style="border-collapse:collapse;width:100%;max-width:720px">
    <tr><th style="${head};text-align:left">Service</th><th style="${head}">Uptime</th><th style="${head}">Month before</th><th style="${head}">Incidents</th><th style="${head}">Downtime</th></tr>
    ${rows || `<tr><td style="${cell}" colspan="5">No active services.</td></tr>`}
  </table>
  <p style="color:#6b778c;font-size:12px;margin-top:16px">Downtime is estimated from the checks that failed.${
    url ? ` <a href="${escapeHtml(url)}">Open the status page</a>.` : ""
  } Change who gets this report in Kener under Reports.</p>
</div>`;
}

/** Builds the report of the month before now and emails it. */
export async function SendUptimeReport(to?: string[]): Promise<{ month: string; recipients: number }> {
  const settings = await GetUptimeReportSettings();
  const recipients = to ?? settings.recipients;
  if (recipients.length === 0) throw new Error("Add at least one email address");
  if (!IsEmailSetup()) throw new Error("Email is not set up: configure SMTP or Resend first");
  const { year, month } = PreviousMonth(GetNowTimestampUTC(), settings.timezone);
  const report = await BuildUptimeReport(year, month, settings.timezone);
  await sendEmail(
    "{{{html}}}",
    "{{{subject}}}",
    { html: UptimeReportHtml(report, await siteUrl()), subject: `Uptime report ${report.label}` },
    recipients,
  );
  return { month: report.month, recipients: recipients.length };
}

/** The report goes out from this hour on the 1st, local time. */
const SEND_FROM_HOUR = 7;
let lastCheck = 0;

/** Called by the app scheduler; sends last month's report once, from 07:00 on the 1st. */
export async function SendUptimeReportIfDue(): Promise<void> {
  const now = GetNowTimestampUTC();
  if (now - lastCheck < 300) return;
  lastCheck = now;
  try {
    const settings = await GetUptimeReportSettings();
    if (!settings.enabled || settings.recipients.length === 0) return;
    const local = toZonedTime(new Date(now * 1000), settings.timezone);
    const { year, month } = PreviousMonth(now, settings.timezone);
    const due = `${year}-${String(month).padStart(2, "0")}`;
    if (settings.lastSentMonth === due) return;
    if (local.getDate() === 1 && local.getHours() < SEND_FROM_HOUR) return;
    try {
      await SendUptimeReport();
      await writeSetting(UPTIME_KEY, { ...(await GetUptimeReportSettings()), lastSentMonth: due, lastError: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await writeSetting(UPTIME_KEY, { ...(await GetUptimeReportSettings()), lastError: message.slice(0, 500) });
    }
  } catch (e) {
    console.error("Monthly uptime report check failed:", e);
  }
}

/** For tests: forget when the report was last checked. */
export function ResetUptimeReportCheck(): void {
  lastCheck = 0;
}
