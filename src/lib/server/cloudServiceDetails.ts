// What the provider itself shows for a Cloud Service monitor: its components, incidents and
// maintenances, read live from the Statuspage API or Microsoft Graph and normalized into one shape.
import axios from "axios";
import GC from "../global-constants.js";
import type { CloudServiceMonitorTypeData } from "./types/monitor.js";
import {
  GetCloudProvider,
  type CloudComponent,
  type CloudDetails,
  type CloudIncident,
  type CloudMaintenance,
  type CloudProvider,
  type CloudStatus,
} from "../cloudServices.js";
import { MapM365Status, MapStatuspageComponent } from "./services/cloudServiceCall.js";
import {
  CloudHttpOptions,
  FindM365Service,
  M365Get,
  M365HealthOverviews,
  M365MatchNames,
  ResolveM365Credentials,
  StatuspageBase,
} from "./cloudProviderClient.js";
import {
  FetchInstatusComponents,
  FetchInstatusSummary,
  FindInstatusComponent,
  MapInstatusStatus,
  type InstatusIncident,
  type InstatusMaintenance,
} from "./instatusClient.js";

/** ISO date -> UTC seconds, or null. */
function toSeconds(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function statuspageImpact(impact: unknown): CloudStatus {
  switch (String(impact).toLowerCase()) {
    case "critical":
    case "major":
      return GC.DOWN as CloudStatus;
    case "minor":
      return GC.DEGRADED as CloudStatus;
    case "maintenance":
      return GC.MAINTENANCE as CloudStatus;
    default:
      return GC.UP as CloudStatus;
  }
}

// ---------------------------------------------------------------- Statuspage

interface SpComponent {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  position?: number;
  group?: boolean;
  group_id?: string | null;
  only_show_if_degraded?: boolean;
}
interface SpUpdate {
  status?: string;
  body?: string;
  created_at?: string;
  display_at?: string;
}
interface SpIncident {
  id: string;
  name: string;
  status: string;
  impact?: string;
  created_at?: string;
  started_at?: string;
  resolved_at?: string | null;
  shortlink?: string;
  scheduled_for?: string | null;
  scheduled_until?: string | null;
  components?: Array<{ id: string; name: string }>;
  incident_updates?: SpUpdate[];
}

export function NormalizeStatuspageComponents(raw: SpComponent[], only: string): CloudComponent[] {
  const groups = new Map(raw.filter((c) => c.group).map((c) => [c.id, c.name]));
  const wanted = only.trim().toLowerCase();
  return raw
    .filter((c) => !c.group)
    .filter((c) => !(c.only_show_if_degraded && String(c.status).toLowerCase() === "operational"))
    .filter((c) => !wanted || c.id.toLowerCase() === wanted || c.name.trim().toLowerCase() === wanted)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description?.trim() || null,
      status: (MapStatuspageComponent(c.status) ?? GC.UP) as CloudStatus,
      group: (c.group_id && groups.get(c.group_id)) || null,
    }));
}

export function NormalizeStatuspageIncident(i: SpIncident): CloudIncident {
  const updates = (i.incident_updates ?? [])
    .map((u) => ({
      status: String(u.status || ""),
      body: String(u.body || ""),
      isHtml: false,
      at: toSeconds(u.display_at) ?? toSeconds(u.created_at) ?? 0,
    }))
    .sort((a, b) => b.at - a.at);
  const resolvedStates = ["resolved", "postmortem", "completed"];
  return {
    id: i.id,
    title: i.name,
    impact: statuspageImpact(i.impact),
    status: String(i.status),
    resolved: resolvedStates.includes(String(i.status).toLowerCase()),
    startedAt: toSeconds(i.started_at) ?? toSeconds(i.created_at) ?? 0,
    resolvedAt: toSeconds(i.resolved_at),
    url: i.shortlink || null,
    affected: (i.components ?? []).map((c) => c.name),
    updates,
  };
}

/** Keep incidents that name the chosen component, or name none (they concern the whole page). */
function affectsComponent(i: SpIncident, only: string): boolean {
  const wanted = only.trim().toLowerCase();
  if (!wanted || !i.components || i.components.length === 0) return true;
  return i.components.some((c) => c.id.toLowerCase() === wanted || c.name.trim().toLowerCase() === wanted);
}

async function statuspageDetails(provider: CloudProvider, data: CloudServiceMonitorTypeData): Promise<CloudDetails> {
  const base = StatuspageBase(provider, data);
  if (!base) throw new Error("Statuspage URL is missing or not http(s)");
  const options = CloudHttpOptions(data.timeout || 10000);
  const [summary, history] = await Promise.all([
    axios(`${base}/api/v2/summary.json`, options),
    axios(`${base}/api/v2/incidents.json`, options),
  ]);
  if (summary.status < 200 || summary.status >= 300) {
    throw new Error(`Statuspage answered HTTP ${summary.status}`);
  }
  const only = data.component || "";
  const incidents: SpIncident[] =
    history.status >= 200 && history.status < 300 && Array.isArray(history.data?.incidents)
      ? history.data.incidents
      : Array.isArray(summary.data?.incidents)
        ? summary.data.incidents
        : [];
  const maintenances: SpIncident[] = Array.isArray(summary.data?.scheduled_maintenances)
    ? summary.data.scheduled_maintenances
    : [];

  return {
    // A custom URL names itself: show "Jira", not "Other Statuspage (URL)".
    provider: {
      label: (provider.url ? "" : String(summary.data?.page?.name || "").trim()) || provider.label,
      kind: "statuspage",
      pageUrl: base,
    },
    components: NormalizeStatuspageComponents(
      Array.isArray(summary.data?.components) ? summary.data.components : [],
      only,
    ),
    incidents: incidents.filter((i) => affectsComponent(i, only)).map(NormalizeStatuspageIncident),
    maintenances: maintenances
      .filter((m) => affectsComponent(m, only))
      .map((m) => ({
        ...NormalizeStatuspageIncident(m),
        impact: GC.MAINTENANCE as CloudStatus,
        scheduledFor: toSeconds(m.scheduled_for),
        scheduledUntil: toSeconds(m.scheduled_until),
      })),
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

// ---------------------------------------------------------------- Instatus

const INSTATUS_DONE = ["resolved", "completed"];

export function NormalizeInstatusIncident(i: InstatusIncident, resolved: boolean): CloudIncident {
  const startedAt = toSeconds(i.started) ?? 0;
  const message = String(i.lastUpdate?.message || "").trim();
  return {
    id: String(i.id ?? i.name ?? startedAt),
    title: String(i.name || "Incident"),
    impact: (MapInstatusStatus(String(i.impact)) ?? GC.DEGRADED) as CloudStatus,
    status: resolved ? "RESOLVED" : String(i.status || ""),
    resolved: resolved || INSTATUS_DONE.includes(String(i.status).toLowerCase()),
    startedAt,
    resolvedAt: toSeconds(i.resolved),
    url: i.url || null,
    affected: [],
    // The public API gives the latest update only.
    updates: message
      ? [
          {
            status: String(i.status || ""),
            body: message,
            isHtml: false,
            at: toSeconds(i.lastUpdate?.createdAt) ?? toSeconds(i.updatedAt) ?? startedAt,
          },
        ]
      : [],
  };
}

export function NormalizeInstatusMaintenance(m: InstatusMaintenance): CloudMaintenance {
  const scheduledFor = toSeconds(m.start);
  const minutes = Number(m.duration);
  return {
    id: String(m.id ?? m.name ?? scheduledFor),
    title: String(m.name || "Maintenance"),
    impact: GC.MAINTENANCE as CloudStatus,
    status: String(m.status || ""),
    resolved: String(m.status).toUpperCase() === "COMPLETED",
    startedAt: scheduledFor ?? 0,
    resolvedAt: null,
    url: m.url || null,
    affected: [],
    updates: [],
    scheduledFor,
    scheduledUntil:
      scheduledFor !== null && Number.isFinite(minutes) && minutes > 0 ? scheduledFor + minutes * 60 : null,
  };
}

async function instatusDetails(provider: CloudProvider, data: CloudServiceMonitorTypeData): Promise<CloudDetails> {
  const base = StatuspageBase(provider, data);
  if (!base) throw new Error("Status page URL is missing or not http(s)");
  const timeout = data.timeout || 10000;
  const [summary, all] = await Promise.all([
    FetchInstatusSummary(base, timeout),
    FetchInstatusComponents(base, timeout).catch(() => []),
  ]);
  const only = (data.component || "").trim();
  const chosen = only ? FindInstatusComponent(all, only) : null;
  const shown = only ? (chosen ? [chosen] : []) : all;

  const active = summary.activeIncidents.map((i) => NormalizeInstatusIncident(i, false));
  const past = summary.recentlyResolvedIncidents.map((i) => NormalizeInstatusIncident(i, true));
  const seen = new Set(active.map((i) => i.id));

  return {
    provider: {
      label: (provider.url ? "" : String(summary.page.name || "").trim()) || provider.label,
      kind: "instatus",
      pageUrl: base,
    },
    // Instatus does not say which components an incident affects.
    incidentsFromPage: only ? String(summary.page.name || "").trim() || new URL(base).host : null,
    components: shown.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: (MapInstatusStatus(c.status) ?? GC.UP) as CloudStatus,
      group: c.group,
    })),
    incidents: [...active, ...past.filter((i) => !seen.has(i.id))].sort((a, b) => b.startedAt - a.startedAt),
    maintenances: summary.activeMaintenances.map(NormalizeInstatusMaintenance).filter((m) => !m.resolved),
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

// ---------------------------------------------------------------- Microsoft 365

interface M365Issue {
  id: string;
  title: string;
  impactDescription?: string;
  classification?: string;
  status: string;
  startDateTime?: string;
  endDateTime?: string | null;
  isResolved?: boolean;
  feature?: string | null;
  featureGroup?: string | null;
  posts?: Array<{ createdDateTime?: string; description?: { content?: string; contentType?: string } }>;
}

export function NormalizeM365Issue(issue: M365Issue): CloudIncident {
  const status = MapM365Status(issue.status) as CloudStatus;
  // An advisory is a minor issue; an incident in progress keeps Microsoft's own severity.
  const isAdvisory = String(issue.classification).toLowerCase() === "advisory";
  const impact: CloudStatus = isAdvisory
    ? (GC.DEGRADED as CloudStatus)
    : status === "UP"
      ? (GC.DOWN as CloudStatus)
      : status;
  const updates = (issue.posts ?? [])
    .map((p) => ({
      status: "",
      body: String(p.description?.content || ""),
      isHtml: String(p.description?.contentType || "").toLowerCase() === "html",
      at: toSeconds(p.createdDateTime) ?? 0,
    }))
    .sort((a, b) => b.at - a.at);
  if (issue.impactDescription && updates.length === 0) {
    updates.push({ status: "", body: issue.impactDescription, isHtml: false, at: toSeconds(issue.startDateTime) ?? 0 });
  }
  const affected = [issue.featureGroup, issue.feature].filter((x): x is string => !!x);
  return {
    id: issue.id,
    title: issue.title,
    impact,
    status: String(issue.status),
    resolved: issue.isResolved === true,
    startedAt: toSeconds(issue.startDateTime) ?? 0,
    resolvedAt: issue.isResolved ? toSeconds(issue.endDateTime) : null,
    url: null,
    affected: affected.length === 2 ? [`${affected[0]} › ${affected[1]}`] : affected,
    updates,
  };
}

async function m365Details(provider: CloudProvider, data: CloudServiceMonitorTypeData): Promise<CloudDetails> {
  const resolved = ResolveM365Credentials(data);
  if ("error" in resolved) throw new Error(resolved.error);
  const timeout = data.timeout || 10000;
  const service = FindM365Service(
    await M365HealthOverviews(resolved.credentials, timeout),
    M365MatchNames(provider, data),
  );
  if (!service) throw new Error("Service not found in this tenant");

  const response = await M365Get(
    `https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews/${encodeURIComponent(service.service)}?$expand=issues`,
    resolved.credentials,
    timeout,
  );
  const issues: M365Issue[] = Array.isArray(response.data?.issues) ? response.data.issues : [];
  const normalized = issues.map(NormalizeM365Issue).sort((a, b) => b.startedAt - a.startedAt);

  // Microsoft lists no fixed parts per service. The service is one row; each feature group with an
  // open issue becomes a row too, so the page shows which part is affected.
  const components: CloudComponent[] = [
    {
      id: service.id,
      name: service.service,
      description: null,
      status: MapM365Status(service.status) as CloudStatus,
      group: null,
    },
  ];
  const openGroups = new Map<string, CloudStatus>();
  for (const issue of issues.filter((i) => !i.isResolved)) {
    const name = issue.featureGroup || issue.feature;
    if (!name) continue;
    const current = openGroups.get(name);
    const next = NormalizeM365Issue(issue).impact;
    if (!current || (current !== "DOWN" && next === "DOWN")) openGroups.set(name, next);
  }
  for (const [name, status] of openGroups) {
    components.push({ id: `${service.id}:${name}`, name, description: null, status, group: service.service });
  }

  return {
    provider: { label: provider.label, kind: "m365", pageUrl: null },
    components,
    incidents: normalized,
    maintenances: [],
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

// ---------------------------------------------------------------- entry point

// Visitors open the same page many times; the provider is asked at most once a minute per monitor.
const detailsCache = new Map<string, { at: number; data: Promise<CloudDetails> }>();
const DETAILS_TTL_MS = 60 * 1000;

/** Test hook. */
export function ClearCloudDetailsCache(): void {
  detailsCache.clear();
}

export async function GetCloudServiceDetails(
  cacheKey: string,
  data: CloudServiceMonitorTypeData,
): Promise<CloudDetails> {
  const cached = detailsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached.data;

  const provider = GetCloudProvider(data?.provider);
  if (!provider) throw new Error("Cloud Service monitor has no valid provider");
  const result =
    provider.kind === "m365"
      ? m365Details(provider, data)
      : provider.kind === "instatus"
        ? instatusDetails(provider, data)
        : statuspageDetails(provider, data);
  detailsCache.set(cacheKey, { at: Date.now(), data: result });
  result.catch(() => detailsCache.delete(cacheKey));
  return result;
}
