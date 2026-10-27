// Links Jira Service Management tickets to Kener incidents and keeps them in step: the ticket's
// replies to customers become incident updates and its status opens, moves and closes the
// incident. Kener sees only tickets its customer account was added to as request participant,
// and only after an admin picks the service; it never writes to Jira.
import db from "../db/db.js";
import GC from "../../global-constants.js";
import { GetNowTimestampUTC } from "../tool.js";
import {
  IncidentStateFor,
  JsmConfigured,
  JsmGetPublicComments,
  JsmGetTicket,
  JsmListSharedTickets,
  ParseTicketKey,
  type JsmTicket,
} from "../jsmClient.js";
import {
  AddIncidentComment,
  AddIncidentMonitor,
  CreateIncident,
  RemoveIncidentMonitor,
  UpdateIncident,
} from "./incidentController.js";
import type { JsmLinkRecord } from "../db/repositories/jsmLinks.js";

export const JSM_IMPACTS = [GC.DOWN, GC.DEGRADED] as const;
/** How often linked tickets are read. */
export const JSM_SYNC_EVERY_S = 120;

export interface JsmLinkedTicket {
  issue_key: string;
  summary: string;
  status: string | null;
  url: string | null;
  incident_id: number | null;
  incident_title: string | null;
  incident_state: string | null;
  monitor_tag: string | null;
  monitor_impact: string | null;
  /** Shown in the box at the top of every status page. */
  show_at_top: boolean;
  last_synced_at: number | null;
  last_error: string | null;
}

export interface JsmOverview {
  configured: boolean;
  /** Why the list of shared tickets could not be read, if it could not. */
  error: string | null;
  /** Tickets shared with Kener that are neither linked nor ignored. */
  shared: JsmTicket[];
  linked: JsmLinkedTicket[];
  ignored: Array<{ issue_key: string; summary: string; url: string | null }>;
}

const parseIds = (raw: string | null): string[] => {
  try {
    const ids = JSON.parse(raw || "[]");
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
};

function requireKey(input: unknown): string {
  const key = ParseTicketKey(String(input ?? ""));
  if (!key) throw new Error("Please enter a ticket key such as IT-1234, or its link");
  return key;
}

function requireImpact(impact: unknown): string {
  if (!(JSM_IMPACTS as readonly string[]).includes(String(impact))) {
    throw new Error(`Impact must be one of ${JSM_IMPACTS.join(", ")}`);
  }
  return String(impact);
}

/** The chosen service, or null for none. Without a service the ticket must be shown at the top. */
async function chosenMonitor(tag: unknown, showAtTop: boolean): Promise<string | null> {
  const monitorTag = String(tag ?? "").trim();
  if (!monitorTag) {
    if (!showAtTop) throw new Error("Choose a service, or show the ticket to everyone");
    return null;
  }
  if (!(await db.getMonitorByTag(monitorTag))) throw new Error(`There is no service with the tag ${monitorTag}`);
  return monitorTag;
}

export const GetJsmOverview = async (): Promise<JsmOverview> => {
  const links = await db.getJsmLinks();
  const configured = JsmConfigured();
  let shared: JsmTicket[] = [];
  let error: string | null = null;
  if (configured) {
    try {
      shared = await JsmListSharedTickets();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const byKey = new Map(shared.map((t) => [t.key, t]));
  const known = new Set(links.map((l) => l.issue_key));

  const linked: JsmLinkedTicket[] = [];
  for (const link of links.filter((l) => l.status === "LINKED")) {
    const incident = link.incident_id ? await db.getIncidentById(link.incident_id) : undefined;
    const ticket = byKey.get(link.issue_key);
    linked.push({
      issue_key: link.issue_key,
      summary: ticket?.summary ?? incident?.title ?? link.issue_key,
      status: ticket?.status ?? null,
      url: ticket?.url ?? null,
      incident_id: link.incident_id,
      incident_title: incident?.title ?? null,
      incident_state: incident?.state ?? null,
      monitor_tag: link.monitor_tag,
      monitor_impact: link.monitor_impact,
      show_at_top: !!incident?.top_impact,
      last_synced_at: link.last_synced_at,
      last_error: link.last_error,
    });
  }
  return {
    configured,
    error,
    shared: shared.filter((t) => !known.has(t.key)),
    linked,
    ignored: links
      .filter((l) => l.status === "IGNORED")
      .map((l) => ({
        issue_key: l.issue_key,
        summary: byKey.get(l.issue_key)?.summary ?? l.issue_key,
        url: byKey.get(l.issue_key)?.url ?? null,
      })),
  };
};

/**
 * Creates an incident for a shared ticket on the chosen service, at the top of every status
 * page, or both, and links them. Replies already in the ticket are not copied: only replies
 * written from now on reach the status page.
 */
export const LinkJsmTicket = async (data: {
  issue_key: unknown;
  monitor_tag?: unknown;
  impact: unknown;
  show_at_top?: unknown;
}): Promise<{ incident_id: number }> => {
  const key = requireKey(data.issue_key);
  const showAtTop = data.show_at_top === true;
  const monitorTag = await chosenMonitor(data.monitor_tag, showAtTop);
  const impact = requireImpact(data.impact);
  const existing = await db.getJsmLinkByKey(key);
  if (existing?.status === "LINKED") throw new Error(`${key} is already linked`);

  const ticket = await JsmGetTicket(key);
  const comments = await JsmGetPublicComments(key);
  const now = GetNowTimestampUTC();
  const state = IncidentStateFor(ticket.statusCategory);

  const { incident_id } = await CreateIncident({
    title: ticket.summary,
    start_date_time: Math.min(ticket.createdAt || now, now),
    state: GC.INVESTIGATING,
    is_global: "NO",
    incident_source: "JSM",
    top_impact: showAtTop ? impact : null,
  });
  if (monitorTag) await AddIncidentMonitor(incident_id, monitorTag, impact);
  await AddIncidentComment(incident_id, ticket.summary, state, now);

  const row = {
    status: "LINKED" as const,
    incident_id,
    monitor_tag: monitorTag,
    monitor_impact: impact,
    synced_comment_ids: JSON.stringify(comments.map((c) => c.id)),
    last_status_category: ticket.statusCategory,
    done_at: state === GC.RESOLVED ? now : null,
    last_synced_at: now,
    last_error: null,
  };
  if (existing) await db.updateJsmLink(key, row);
  else await db.insertJsmLink({ issue_key: key, ...row });
  return { incident_id };
};

/**
 * Moves a linked ticket's incident to another service or to none, changes its impact, or puts
 * it at the top of every status page or takes it away. Leaving show_at_top out keeps it as is.
 */
export const MoveJsmTicket = async (data: {
  issue_key: unknown;
  monitor_tag?: unknown;
  impact: unknown;
  show_at_top?: unknown;
}) => {
  const key = requireKey(data.issue_key);
  const link = await db.getJsmLinkByKey(key);
  if (!link || link.status !== "LINKED" || !link.incident_id) throw new Error(`${key} is not linked`);
  const incident = await db.getIncidentById(link.incident_id);
  const showAtTop = typeof data.show_at_top === "boolean" ? data.show_at_top : !!incident?.top_impact;
  const monitorTag = await chosenMonitor(data.monitor_tag, showAtTop);
  const impact = requireImpact(data.impact);

  if (link.monitor_tag && link.monitor_tag !== monitorTag) {
    await RemoveIncidentMonitor(link.incident_id, link.monitor_tag);
  }
  if (monitorTag) await AddIncidentMonitor(link.incident_id, monitorTag, impact);
  await UpdateIncident(link.incident_id, { top_impact: showAtTop ? impact : null });
  await db.updateJsmLink(key, { monitor_tag: monitorTag, monitor_impact: impact });
};

/** Stops updating the incident from the ticket. The incident itself stays as it is. */
export const UnlinkJsmTicket = async (issueKey: unknown) => {
  await db.deleteJsmLink(requireKey(issueKey));
};

/** Keeps a shared ticket out of the list of new tickets. */
export const IgnoreJsmTicket = async (issueKey: unknown) => {
  const key = requireKey(issueKey);
  const existing = await db.getJsmLinkByKey(key);
  if (existing?.status === "LINKED") throw new Error(`${key} is linked; unlink it first`);
  if (!existing) await db.insertJsmLink({ issue_key: key, status: "IGNORED" });
};

/** Brings an ignored ticket back to the list of new tickets. */
export const UnignoreJsmTicket = async (issueKey: unknown) => {
  const key = requireKey(issueKey);
  const existing = await db.getJsmLinkByKey(key);
  if (existing?.status === "IGNORED") await db.deleteJsmLink(key);
};

/** Brings one linked incident up to date with its ticket. Returns the updates it posted. */
export const SyncJsmLink = async (link: JsmLinkRecord): Promise<number> => {
  const now = GetNowTimestampUTC();
  const incident = link.incident_id ? await db.getIncidentById(link.incident_id) : undefined;
  if (!incident) {
    await db.deleteJsmLink(link.issue_key);
    return 0;
  }
  try {
    const ticket = await JsmGetTicket(link.issue_key);
    const comments = await JsmGetPublicComments(link.issue_key);
    const synced = new Set(parseIds(link.synced_comment_ids));
    const fresh = comments.filter((c) => !synced.has(c.id));
    const target = IncidentStateFor(ticket.statusCategory);
    const categoryChanged = (link.last_status_category || "") !== ticket.statusCategory;
    let posted = 0;

    // Each new reply becomes an update. Only the last carries a resolution, so the incident
    // does not close and reopen within one pass.
    for (let i = 0; i < fresh.length; i++) {
      const last = i === fresh.length - 1;
      const state = target === GC.RESOLVED && !last ? GC.IDENTIFIED : target;
      const at = Math.min(Math.max(fresh[i].createdAt, incident.start_date_time), now);
      await AddIncidentComment(incident.id, fresh[i].body, state, at);
      synced.add(fresh[i].id);
      posted++;
    }
    // A status change without a reply is posted on its own, in the ticket's own words.
    if (fresh.length === 0 && categoryChanged) {
      await AddIncidentComment(incident.id, `Status: ${ticket.status}`, target, now);
      posted++;
    }

    const done = ticket.statusCategory === "DONE";
    await db.updateJsmLink(link.issue_key, {
      synced_comment_ids: JSON.stringify([...synced]),
      last_status_category: ticket.statusCategory,
      done_at: done ? (link.done_at ?? now) : null,
      last_synced_at: now,
      last_error: null,
    });
    return posted;
  } catch (e) {
    await db.updateJsmLink(link.issue_key, {
      last_synced_at: now,
      last_error: e instanceof Error ? e.message.slice(0, 500) : String(e),
    });
    return 0;
  }
};

/** Brings every linked incident up to date. */
export const SyncJsmTickets = async (): Promise<{ tickets: number; updates: number }> => {
  if (!JsmConfigured()) return { tickets: 0, updates: 0 };
  const links = await db.getJsmLinksToSync(GetNowTimestampUTC());
  let updates = 0;
  for (const link of links) updates += await SyncJsmLink(link);
  return { tickets: links.length, updates };
};

let lastRun = 0;
let running = false;

/** Called by the app scheduler every few seconds; reads Jira at most every JSM_SYNC_EVERY_S. */
export const SyncJsmIfDue = async (): Promise<void> => {
  const now = GetNowTimestampUTC();
  if (running || now - lastRun < JSM_SYNC_EVERY_S || !JsmConfigured()) return;
  running = true;
  lastRun = now;
  try {
    await SyncJsmTickets();
  } catch (e) {
    console.error("Jira Service Management sync failed:", e);
  } finally {
    running = false;
  }
};
