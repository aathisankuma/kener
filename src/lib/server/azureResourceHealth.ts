// Reads Azure Resource Health for one resource, e.g. an Azure OpenAI account:
//   …/{resourceId}/providers/Microsoft.ResourceHealth/availabilityStatuses/current   current state
//   …/{resourceId}/providers/Microsoft.ResourceHealth/availabilityStatuses           recent history
// Signed in with the Microsoft app registration, which needs a role that can read the resource
// (Reader is enough).
import GC from "../global-constants.js";
import type { CloudComponent, CloudIncident, CloudStatus } from "../cloudServices.js";
import { AzureGet, M365CacheKey, type M365Credentials } from "./cloudProviderClient.js";

const API_VERSION = "2022-10-01";

export interface AzureAvailability {
  id?: string;
  properties?: {
    availabilityState?: string;
    title?: string;
    summary?: string;
    detailedStatus?: string;
    reasonType?: string;
    category?: string;
    occuredTime?: string;
    reportedTime?: string;
    resolutionETA?: string;
    recentlyResolved?: { unavailableOccuredTime?: string; resolvedTime?: string; unavailableSummary?: string };
  };
}

/** The resource's Resource Health URL. */
export function AzureHealthUrl(resourceId: string, current: boolean): string {
  const id = resourceId.trim().replace(/\/+$/, "");
  return (
    `https://management.azure.com${id}/providers/Microsoft.ResourceHealth/availabilityStatuses` +
    `${current ? "/current" : ""}?api-version=${API_VERSION}`
  );
}

/**
 * Azure availability -> Kener status, or null for "Unknown" (Azure cannot tell right now).
 * Planned unavailability, e.g. an Azure update, reads MAINTENANCE.
 */
export function MapAzureAvailability(a: AzureAvailability["properties"]): string | null {
  const planned = [a?.reasonType, a?.category].some((v) => String(v).toLowerCase() === "planned");
  switch (String(a?.availabilityState).toLowerCase()) {
    case "available":
      return GC.UP;
    case "degraded":
      return GC.DEGRADED;
    case "unavailable":
      return planned ? GC.MAINTENANCE : GC.DOWN;
    default:
      return null;
  }
}

// Monitor checks and visitors of the detail page share one read per resource and minute.
const currentCache = new Map<string, { at: number; data: Promise<AzureAvailability> }>();
const CURRENT_TTL_MS = 50 * 1000;

/** Test hook. */
export function ClearAzureHealthCache(): void {
  currentCache.clear();
}

export async function FetchAzureCurrent(
  c: M365Credentials,
  resourceId: string,
  timeout = 10000,
): Promise<AzureAvailability> {
  const key = `${M365CacheKey(c)}|${resourceId.trim().toLowerCase()}`;
  const cached = currentCache.get(key);
  if (cached && Date.now() - cached.at < CURRENT_TTL_MS) return cached.data;
  const data = AzureGet(AzureHealthUrl(resourceId, true), c, timeout).then((r) => r.data as AzureAvailability);
  currentCache.set(key, { at: Date.now(), data });
  data.catch(() => currentCache.delete(key));
  return data;
}

function toSeconds(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** The resource's name, the last part of its ID. */
export function AzureResourceName(resourceId: string): string {
  return resourceId.trim().replace(/\/+$/, "").split("/").pop() || resourceId;
}

/** The resource as one component, with Azure's summary as its description. */
export function AzureComponent(resourceId: string, current: AzureAvailability): CloudComponent {
  const p = current.properties;
  return {
    id: resourceId,
    name: AzureResourceName(resourceId),
    description: [p?.summary, p?.detailedStatus].filter(Boolean).join(" ") || null,
    status: (MapAzureAvailability(p) ?? GC.UP) as CloudStatus,
    group: null,
  };
}

/**
 * Periods the resource was not available, newest first, from its history. The newest entry is
 * the current state; an older one ended when the next newer entry began.
 */
export function AzureIncidents(history: AzureAvailability[]): CloudIncident[] {
  const sorted = [...history]
    .map((h) => ({ h, at: toSeconds(h.properties?.occuredTime) ?? toSeconds(h.properties?.reportedTime) ?? 0 }))
    .sort((a, b) => b.at - a.at);
  const incidents: CloudIncident[] = [];
  sorted.forEach(({ h, at }, i) => {
    const p = h.properties;
    const status = MapAzureAvailability(p);
    if (!status || status === GC.UP) return;
    const resolvedAt = i === 0 ? null : sorted[i - 1].at;
    const body = [p?.summary, p?.detailedStatus].filter(Boolean).join(" ");
    incidents.push({
      id: h.id || `azure-${at}`,
      title: p?.title || String(p?.availabilityState || "Unavailable"),
      impact: status as CloudStatus,
      status: String(p?.availabilityState || ""),
      resolved: i !== 0,
      startedAt: at,
      resolvedAt,
      url: null,
      affected: [],
      updates: body ? [{ status: String(p?.availabilityState || ""), body, isHtml: false, at }] : [],
    });
  });
  return incidents;
}

export async function FetchAzureHistory(
  c: M365Credentials,
  resourceId: string,
  timeout = 10000,
): Promise<AzureAvailability[]> {
  const response = await AzureGet(AzureHealthUrl(resourceId, false), c, timeout);
  return Array.isArray(response.data?.value) ? response.data.value : [];
}
