// Reads an Instatus status page through its public JSON API (no login):
//   /v3/summary.json     page status, active incidents and maintenances, recently resolved incidents
//   /v3/components.json  components with their status; groups hold their parts in `children`
// Older pages answer at /summary.json and /v2/components.json, which are tried next.
import axios, { type AxiosResponse } from "axios";
import GC from "../global-constants.js";
import { CloudHttpOptions } from "./cloudProviderClient.js";

export interface InstatusComponent {
  id: string;
  name: string;
  status: string;
  description: string | null;
  /** Name of the group the component sits in, or null. */
  group: string | null;
}

export interface InstatusIncident {
  id?: string;
  name?: string;
  started?: string;
  resolved?: string;
  status?: string;
  impact?: string;
  url?: string;
  updatedAt?: string;
  lastUpdate?: { message?: string; createdAt?: string };
}

export interface InstatusMaintenance {
  id?: string;
  name?: string;
  start?: string;
  status?: string;
  /** Minutes. Instatus sends it as a number or a string. */
  duration?: number | string;
  url?: string;
  updatedAt?: string;
}

export interface InstatusSummary {
  page: { name?: string; url?: string; status?: string };
  activeIncidents: InstatusIncident[];
  activeMaintenances: InstatusMaintenance[];
  recentlyResolvedIncidents: InstatusIncident[];
}

const RANK: Record<string, number> = { UP: 0, MAINTENANCE: 1, DEGRADED: 2, DOWN: 3 };

/** The more serious of two Kener statuses. */
export function WorstStatus(a: string, b: string): string {
  return (RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a;
}

/**
 * Instatus component status or incident impact -> Kener status, or null when unknown.
 * `ignoreMinor` lets degraded performance read UP.
 */
export function MapInstatusStatus(value: string, ignoreMinor = false): string | null {
  switch (String(value).toUpperCase()) {
    case "OPERATIONAL":
      return GC.UP;
    case "DEGRADEDPERFORMANCE":
      return ignoreMinor ? GC.UP : GC.DEGRADED;
    case "PARTIALOUTAGE":
      return GC.DEGRADED;
    case "MAJOROUTAGE":
      return GC.DOWN;
    case "UNDERMAINTENANCE":
      return GC.MAINTENANCE;
    default:
      return null;
  }
}

/** Components of a components.json answer, with group parts flattened and named by their group. */
export function FlattenInstatusComponents(body: unknown): InstatusComponent[] {
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as { components?: unknown })?.components)
      ? (body as { components: unknown[] }).components
      : [];
  const out: InstatusComponent[] = [];
  const add = (raw: Record<string, unknown>, group: string | null) => {
    const name = String(raw?.name ?? "").trim();
    if (!name) return;
    out.push({
      id: String(raw.id ?? name),
      name,
      status: String(raw.status ?? ""),
      description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : null,
      group,
    });
  };
  for (const raw of list as Array<Record<string, unknown>>) {
    const children = Array.isArray(raw?.children) ? (raw.children as Array<Record<string, unknown>>) : [];
    if (children.length > 0) {
      const group = String(raw.name ?? "").trim() || null;
      for (const child of children) add(child, group);
    } else {
      add(raw, null);
    }
  }
  return out;
}

/** The component a monitor follows: by id, by name, or by "Group / Name" when a name repeats. */
export function FindInstatusComponent(components: InstatusComponent[], wanted: string): InstatusComponent | null {
  const w = wanted
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, " / ");
  if (!w) return null;
  return (
    components.find((c) => c.id.toLowerCase() === w) ??
    components.find((c) => c.group && `${c.group} / ${c.name}`.toLowerCase() === w) ??
    components.find((c) => c.name.toLowerCase() === w) ??
    null
  );
}

/** How a component is named in lists and saved: "Group / Name" when its name is not unique. */
export function InstatusComponentLabel(c: InstatusComponent, all: InstatusComponent[]): string {
  const repeated = all.filter((o) => o.name.toLowerCase() === c.name.toLowerCase()).length > 1;
  return repeated && c.group ? `${c.group} / ${c.name}` : c.name;
}

async function getFirst(
  urls: string[],
  timeout: number,
  accept: (r: AxiosResponse) => boolean,
): Promise<AxiosResponse> {
  let lastStatus = 0;
  for (const url of urls) {
    const response: AxiosResponse = await axios(url, CloudHttpOptions(timeout));
    if (response.status >= 200 && response.status < 300 && accept(response)) return response;
    lastStatus = response.status;
  }
  throw new Error(
    lastStatus >= 200 && lastStatus < 300
      ? "Not an Instatus status page response"
      : `Instatus answered HTTP ${lastStatus}`,
  );
}

export async function FetchInstatusSummary(base: string, timeout: number): Promise<InstatusSummary> {
  const response = await getFirst(
    [`${base}/v3/summary.json`, `${base}/summary.json`],
    timeout,
    (r) => typeof r.data?.page?.status === "string",
  );
  const body = response.data;
  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  return {
    page: body.page,
    activeIncidents: list<InstatusIncident>(body.activeIncidents),
    activeMaintenances: list<InstatusMaintenance>(body.activeMaintenances),
    recentlyResolvedIncidents: list<InstatusIncident>(body.recentlyResolvedIncidents),
  };
}

export async function FetchInstatusComponents(base: string, timeout: number): Promise<InstatusComponent[]> {
  const response = await getFirst(
    [`${base}/v3/components.json`, `${base}/v2/components.json`],
    timeout,
    (r) => Array.isArray(r.data) || Array.isArray(r.data?.components),
  );
  return FlattenInstatusComponents(response.data);
}

/**
 * The Kener status of a whole Instatus page. "HASISSUES" says only that something is wrong, so the
 * worst active incident and the worst component decide how serious it is.
 */
export function InstatusPageStatus(
  summary: InstatusSummary,
  components: InstatusComponent[] | null,
  ignoreMinor = false,
): string | null {
  switch (String(summary.page?.status).toUpperCase()) {
    case "UP":
      return GC.UP;
    case "UNDERMAINTENANCE":
      return GC.MAINTENANCE;
    case "HASISSUES": {
      let worst: string = GC.UP;
      for (const incident of summary.activeIncidents) {
        worst = WorstStatus(worst, MapInstatusStatus(String(incident.impact), ignoreMinor) ?? GC.UP);
      }
      for (const c of components ?? []) {
        worst = WorstStatus(worst, MapInstatusStatus(c.status, ignoreMinor) ?? GC.UP);
      }
      // An issue the page reports that no incident or component explains: treat it as minor.
      return worst !== GC.UP ? worst : ignoreMinor ? GC.UP : GC.DEGRADED;
    }
    default:
      return null;
  }
}
