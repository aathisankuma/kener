// Messages to a Microsoft Teams chat or channel through a Teams "Workflows" webhook (template
// "Send webhook alerts to a chat"). Kener builds the Adaptive Card itself, so the admin only
// pastes the webhook URL and chooses what to send: monitoring alerts, incident updates and
// "not working" reports.
import db from "../db/db.js";
import GC from "../../global-constants.js";
import { GetAllSiteData } from "./siteDataController.js";
import { siteDataToVariables } from "../notification/notification_utils.js";
import type { IncidentCommentRecord } from "../types/db.js";

export interface TeamsSettings {
  webhookUrl: string;
  /** Monitoring alerts, when triggered and when resolved. */
  alerts: boolean;
  /** Each update posted on an incident. */
  incidents: boolean;
  /** When enough people pressed the "not working" button. */
  problemReports: boolean;
}

/** What the admin page sees: never the URL itself, which works like a password. */
export interface TeamsSettingsView extends Omit<TeamsSettings, "webhookUrl"> {
  hasWebhook: boolean;
  /** The webhook's host, to recognise which one is saved. */
  webhookHost: string | null;
}

const KEY = "teamsSettings";
const DEFAULTS: TeamsSettings = { webhookUrl: "", alerts: true, incidents: true, problemReports: true };

export async function GetTeamsSettings(): Promise<TeamsSettings> {
  const row = await db.getSiteDataByKey(KEY);
  if (!row?.value) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULTS };
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function GetTeamsSettingsView(): Promise<TeamsSettingsView> {
  const { webhookUrl, ...rest } = await GetTeamsSettings();
  return { ...rest, hasWebhook: !!webhookUrl, webhookHost: webhookUrl ? hostOf(webhookUrl) : null };
}

export function ValidateWebhookUrl(input: string): string {
  const url = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Paste the whole webhook URL from Teams Workflows, starting with https://");
  }
  if (parsed.protocol !== "https:") throw new Error("The webhook URL must start with https://");
  return url;
}

/**
 * Saves what to send. A new webhook URL replaces the saved one; leaving it empty keeps it, and
 * removeWebhook deletes it.
 */
export async function SaveTeamsSettings(data: Record<string, unknown>): Promise<TeamsSettingsView> {
  const current = await GetTeamsSettings();
  const incoming = String(data.webhookUrl ?? "").trim();
  const settings: TeamsSettings = {
    webhookUrl: data.removeWebhook === true ? "" : incoming ? ValidateWebhookUrl(incoming) : current.webhookUrl,
    alerts: data.alerts !== false,
    incidents: data.incidents !== false,
    problemReports: data.problemReports !== false,
  };
  await db.insertOrUpdateSiteData(KEY, JSON.stringify(settings), "object");
  return GetTeamsSettingsView();
}

// ============ Cards ============

export type CardColor = "Attention" | "Warning" | "Good" | "Accent" | "Default";

export interface TeamsCard {
  title: string;
  color: CardColor;
  /** Markdown, as Teams shows it in a card. */
  text?: string;
  facts?: Array<{ title: string; value: string }>;
  /** ISO time, shown in each reader's own time zone. */
  time?: string;
  actions?: Array<{ title: string; url: string }>;
}

/** The message body a Teams Workflows webhook expects: one Adaptive Card. */
export function BuildTeamsMessage(card: TeamsCard): Record<string, unknown> {
  const body: Array<Record<string, unknown>> = [
    { type: "TextBlock", text: card.title, size: "Large", weight: "Bolder", color: card.color, wrap: true },
  ];
  if (card.text) body.push({ type: "TextBlock", text: card.text, wrap: true });
  const facts = (card.facts ?? []).filter((f) => f.value);
  if (facts.length > 0) body.push({ type: "FactSet", facts });
  if (card.time) {
    // Teams fills in DATE() and TIME() in the reader's own time zone.
    const at = card.time.replace(/\.\d{3}Z$/, "Z");
    body.push({
      type: "TextBlock",
      text: `{{DATE(${at}, SHORT)}} {{TIME(${at})}}`,
      isSubtle: true,
      size: "Small",
      wrap: true,
    });
  }
  const actions = (card.actions ?? []).filter((a) => /^https?:\/\//.test(a.url));
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body,
          ...(actions.length > 0 ? { actions: actions.map((a) => ({ type: "Action.OpenUrl", ...a })) } : {}),
        },
      },
    ],
  };
}

/** Sends a card to the saved webhook. Throws when Teams does not accept it. */
export async function PostTeamsCard(card: TeamsCard, webhookUrl?: string): Promise<void> {
  const url = webhookUrl ?? (await GetTeamsSettings()).webhookUrl;
  if (!url) throw new Error("No Teams webhook is saved");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BuildTeamsMessage(card)),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    const reason = cause?.code || cause?.message || (e instanceof Error ? e.message : String(e));
    throw new Error(`Kener could not reach Teams (${reason}). Check the webhook URL and the server's internet access.`);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Teams refused the message (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  }
}

async function siteUrl(): Promise<string> {
  try {
    return siteDataToVariables(await GetAllSiteData()).site_url || "";
  } catch {
    return "";
  }
}

/** Sends when the kind is switched on; a failure is logged and never stops the caller. */
async function sendIf(kind: keyof Omit<TeamsSettings, "webhookUrl">, build: (url: string) => Promise<TeamsCard>) {
  try {
    const settings = await GetTeamsSettings();
    if (!settings.webhookUrl || !settings[kind]) return false;
    await PostTeamsCard(await build(await siteUrl()), settings.webhookUrl);
    return true;
  } catch (e) {
    console.error(`Teams message (${kind}) failed:`, e);
    return false;
  }
}

export async function SendTeamsTest(): Promise<void> {
  const url = await siteUrl();
  await PostTeamsCard({
    title: "✅ Kener ist mit diesem Chat verbunden",
    color: "Good",
    text: "Störungen, Vorfälle und Meldungen erscheinen ab jetzt hier.",
    time: new Date().toISOString(),
    actions: url ? [{ title: "Statusseite öffnen", url }] : [],
  });
}

// ============ What is sent ============

const STATE_DE: Record<string, string> = {
  INVESTIGATING: "Wird untersucht",
  IDENTIFIED: "Ursache gefunden",
  MONITORING: "Wird beobachtet",
  RESOLVED: "Behoben",
};

const STATE_COLOR: Record<string, CardColor> = {
  INVESTIGATING: "Attention",
  IDENTIFIED: "Warning",
  MONITORING: "Accent",
  RESOLVED: "Good",
};

/** The alert's condition in words, e.g. "Status ist DOWN" or "Antwortzeit über 500 ms". */
export function DescribeAlertCondition(alertFor: string, value: string | number): string {
  const v = String(value ?? "");
  if (alertFor === GC.STATUS) {
    const status: Record<string, string> = { DOWN: "ausgefallen", DEGRADED: "eingeschränkt" };
    return `Dienst ist ${status[v] ?? v}`;
  }
  if (alertFor === GC.LATENCY) return `Antwortzeit über ${v} ms`;
  if (alertFor === GC.UPTIME) return `Verfügbarkeit unter ${v} %`;
  return `${alertFor} ${v}`.trim();
}

export interface AlertForTeams {
  monitorTag: string;
  isTriggered: boolean;
  alertFor: string;
  alertValue: string | number;
  severity: string;
  timestamp: string;
  incidentId?: number;
}

/** A monitoring alert, triggered or resolved. */
export async function NotifyTeamsOfAlert(alert: AlertForTeams): Promise<boolean> {
  return sendIf("alerts", async (url) => {
    const monitor = await db.getMonitorByTag(alert.monitorTag);
    const name = monitor?.name || alert.monitorTag;
    return {
      title: alert.isTriggered ? `🔴 Störung: ${name}` : `✅ Behoben: ${name}`,
      color: alert.isTriggered ? "Attention" : "Good",
      facts: [
        { title: "Dienst", value: name },
        { title: "Status", value: alert.isTriggered ? "Ausgelöst" : "Behoben" },
        {
          title: "Schweregrad",
          value:
            alert.severity === "CRITICAL"
              ? "Kritisch"
              : alert.severity === "WARNING"
                ? "Warnung"
                : String(alert.severity || ""),
        },
        { title: "Bedingung", value: DescribeAlertCondition(alert.alertFor, alert.alertValue) },
      ],
      time: alert.timestamp,
      actions: url
        ? [
            { title: "Dienst ansehen", url: `${url}monitors/${encodeURIComponent(alert.monitorTag)}` },
            ...(alert.incidentId ? [{ title: "Vorfall ansehen", url: `${url}incidents/${alert.incidentId}` }] : []),
          ]
        : [],
    };
  });
}

/** An update posted on an incident. */
export async function NotifyTeamsOfIncidentUpdate(
  incident: { id: number; title: string; top_impact?: string | null },
  comment: Pick<IncidentCommentRecord, "comment" | "state" | "commented_at">,
): Promise<boolean> {
  return sendIf("incidents", async (url) => {
    const monitors = await db.getMonitorsByIncidentId(incident.id, true);
    const affected = monitors.map((m) => m.monitor_name || m.monitor_tag).join(", ");
    const text = comment.comment.length > 1500 ? `${comment.comment.slice(0, 1500)}…` : comment.comment;
    return {
      title: `${comment.state === GC.RESOLVED ? "✅" : "📣"} Vorfall: ${incident.title}`,
      color: STATE_COLOR[comment.state] ?? "Default",
      text,
      facts: [
        { title: "Status", value: STATE_DE[comment.state] ?? comment.state },
        { title: "Betroffen", value: affected || (incident.top_impact ? "Alle (oben auf der Statusseite)" : "") },
      ],
      time: new Date(comment.commented_at * 1000).toISOString(),
      actions: url ? [{ title: "Vorfall ansehen", url: `${url}incidents/${incident.id}` }] : [],
    };
  });
}

/** Enough people pressed "not working" on a service. */
export async function NotifyTeamsOfProblemReports(
  monitor: { tag: string; name: string },
  count: number,
  windowMinutes: number,
): Promise<boolean> {
  return sendIf("problemReports", async (url) => ({
    title: `⚠️ ${count} Meldungen: ${monitor.name} funktioniert nicht`,
    color: "Warning",
    text: `${count} Personen haben in den letzten ${windowMinutes} Minuten gemeldet, dass **${monitor.name}** nicht funktioniert. Bitte prüfen und bei einer Störung einen Vorfall erfassen.`,
    time: new Date().toISOString(),
    actions: url
      ? [
          { title: "Dienst ansehen", url: `${url}monitors/${encodeURIComponent(monitor.tag)}` },
          { title: "Vorfall erfassen", url: `${url}manage/app/incidents/new` },
        ]
      : [],
  }));
}
