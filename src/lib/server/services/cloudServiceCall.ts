import axios from "axios";
import GC from "../../global-constants.js";
import type { CloudServiceMonitor, MonitoringResult } from "../types/monitor.js";
import { ChosenComponents, GetCloudProvider, IsAzureResourceId, type CloudProvider } from "../../cloudServices.js";
import { WorstStatus } from "../instatusClient.js";
import { FetchAzureCurrent, MapAzureAvailability } from "../azureResourceHealth.js";
import {
  CloudHttpOptions,
  ClearCloudProviderCache,
  FindM365Service,
  M365HealthOverviews,
  M365MatchNames,
  ResolveM365Credentials,
  StatuspageBase,
} from "../cloudProviderClient.js";
import {
  FetchInstatusComponents,
  FetchInstatusSummary,
  FindInstatusComponent,
  InstatusComponentLabel,
  InstatusPageStatus,
  MapInstatusStatus,
} from "../instatusClient.js";

/** Statuspage page indicator -> Kener status. `ignoreMinor` lets a minor incident read UP. */
export function MapStatuspageIndicator(indicator: string, ignoreMinor = false): string | null {
  switch (String(indicator).toLowerCase()) {
    case "none":
      return GC.UP;
    case "minor":
      return ignoreMinor ? GC.UP : GC.DEGRADED;
    case "major":
    case "critical":
      return GC.DOWN;
    case "maintenance":
      return GC.MAINTENANCE;
    default:
      return null;
  }
}

/** Statuspage component status -> Kener status. `ignoreMinor` lets degraded performance read UP. */
export function MapStatuspageComponent(status: string, ignoreMinor = false): string | null {
  switch (String(status).toLowerCase()) {
    case "operational":
      return GC.UP;
    case "degraded_performance":
      return ignoreMinor ? GC.UP : GC.DEGRADED;
    case "partial_outage":
      return GC.DEGRADED;
    case "major_outage":
      return GC.DOWN;
    case "under_maintenance":
      return GC.MAINTENANCE;
    default:
      return null;
  }
}

// Microsoft Graph serviceHealthStatus values, compared ignoring case: Graph answers in both
// camelCase ("serviceOperational") and PascalCase ("ServiceOperational").
const M365_UP = new Set([
  "serviceoperational",
  "servicerestored",
  "postincidentreviewpublished",
  "falsepositive",
  "investigationsuspended",
  "resolved",
  "resolvedexternal",
  "mitigated",
  "mitigatedexternal",
]);
const M365_DOWN = new Set(["serviceinterruption"]);

/** Microsoft 365 service health -> Kener status. Anything still in progress reads DEGRADED. */
export function MapM365Status(status: string): string {
  const s = String(status).toLowerCase();
  if (M365_UP.has(s)) return GC.UP;
  if (M365_DOWN.has(s)) return GC.DOWN;
  return GC.DEGRADED;
}

/** Test hook: forget cached Microsoft tokens and health data. */
export const ClearCloudServiceCache = ClearCloudProviderCache;

class CloudServiceCall {
  monitor: CloudServiceMonitor;

  constructor(monitor: CloudServiceMonitor) {
    this.monitor = monitor;
  }

  async execute(): Promise<MonitoringResult> {
    const data = this.monitor.type_data;
    const provider = GetCloudProvider(data?.provider);
    if (!data || !provider) {
      return this.fail(GC.ERROR, "Cloud Service monitor has no valid provider");
    }
    try {
      if (provider.kind === "m365") return await this.checkM365(provider);
      if (provider.kind === "azure") return await this.checkAzure();
      if (provider.kind === "instatus") return await this.checkInstatus(provider);
      return await this.checkStatuspage(provider);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      const timeout = data.timeout || 10000;
      if (error.code === "ECONNABORTED" || (error.message && error.message.includes("timeout"))) {
        return this.fail(GC.TIMEOUT, `Request timed out after ${timeout}ms`);
      }
      return this.fail(GC.ERROR, error.message || "Network error");
    }
  }

  // ---------------------------------------------------------------- Statuspage

  private async checkStatuspage(provider: CloudProvider): Promise<MonitoringResult> {
    const data = this.monitor.type_data;
    const base = StatuspageBase(provider, data);
    if (!base) {
      return this.fail(GC.ERROR, "Statuspage URL is missing or not http(s)");
    }
    const chosen = ChosenComponents(data);
    const started = Date.now();
    let response = await axios(
      `${base}/api/v2/${chosen.length > 0 ? "components" : "status"}.json`,
      CloudHttpOptions(data.timeout || 10000),
    );
    // Pages that only copy part of the Statuspage API (incident.io, e.g. OpenAI) may lack
    // status.json; summary.json carries the same indicator.
    const hasIndicator = (r: typeof response) =>
      r.status >= 200 && r.status < 300 && typeof r.data?.status?.indicator === "string";
    if (chosen.length === 0 && !hasIndicator(response)) {
      const summary = await axios(`${base}/api/v2/summary.json`, CloudHttpOptions(data.timeout || 10000));
      if (hasIndicator(summary)) response = summary;
    }
    const latency = Date.now() - started;

    if (response.status < 200 || response.status >= 300) {
      return this.fail(GC.ERROR, `Statuspage answered HTTP ${response.status}`);
    }
    const body = response.data;

    if (chosen.length === 0) {
      const indicator = body?.status?.indicator;
      const status = typeof indicator === "string" ? MapStatuspageIndicator(indicator, !!data.ignoreMinor) : null;
      if (!status) {
        return this.fail(GC.ERROR, "Not a Statuspage status response");
      }
      return { status, latency, type: GC.REALTIME, raw_status: indicator };
    }

    const components: Array<{ id?: string; name?: string; status?: string }> = Array.isArray(body?.components)
      ? body.components
      : [];
    const found: Array<{ name: string; status: string }> = [];
    const missing: string[] = [];
    for (const component of chosen) {
      const wanted = component.toLowerCase();
      const match = components.find(
        (c) => (c.id && c.id.toLowerCase() === wanted) || (c.name && c.name.trim().toLowerCase() === wanted),
      );
      if (match) found.push({ name: String(match.name ?? component), status: String(match.status) });
      else missing.push(component);
    }
    if (missing.length > 0) {
      const names = components.map((c) => c.name).filter(Boolean);
      return this.fail(
        GC.ERROR,
        `Component${missing.length > 1 ? "s" : ""} ${missing.map((m) => `"${m}"`).join(", ")} not found. Available: ${names.join(", ") || "none"}`,
      );
    }
    return this.worstOf(found, (s) => MapStatuspageComponent(s, !!data.ignoreMinor), latency);
  }

  // ---------------------------------------------------------------- Instatus

  private async checkInstatus(provider: CloudProvider): Promise<MonitoringResult> {
    const data = this.monitor.type_data;
    const base = StatuspageBase(provider, data);
    if (!base) {
      return this.fail(GC.ERROR, "Status page URL is missing or not http(s)");
    }
    const timeout = data.timeout || 10000;
    const ignoreMinor = !!data.ignoreMinor;
    const chosen = ChosenComponents(data);
    const started = Date.now();

    if (chosen.length > 0) {
      const components = await FetchInstatusComponents(base, timeout);
      const latency = Date.now() - started;
      const found: Array<{ name: string; status: string }> = [];
      const missing: string[] = [];
      for (const component of chosen) {
        const match = FindInstatusComponent(components, component);
        if (match) found.push({ name: InstatusComponentLabel(match, components), status: match.status });
        else missing.push(component);
      }
      if (missing.length > 0) {
        const names = components.map((c) => InstatusComponentLabel(c, components));
        return this.fail(
          GC.ERROR,
          `Component${missing.length > 1 ? "s" : ""} ${missing.map((m) => `"${m}"`).join(", ")} not found. Available: ${names.join(", ") || "none"}`,
        );
      }
      return this.worstOf(found, (s) => MapInstatusStatus(s, ignoreMinor), latency);
    }

    const summary = await FetchInstatusSummary(base, timeout);
    // Only a page with issues needs its components to tell how serious they are.
    const needsComponents = String(summary.page.status).toUpperCase() === "HASISSUES";
    const components = needsComponents ? await FetchInstatusComponents(base, timeout).catch(() => null) : null;
    const latency = Date.now() - started;
    const status = InstatusPageStatus(summary, components, ignoreMinor);
    if (!status) {
      return this.fail(GC.ERROR, `Unknown page status "${summary.page.status}"`);
    }
    return { status, latency, type: GC.REALTIME, raw_status: String(summary.page.status) };
  }

  // ---------------------------------------------------------------- Azure

  private async checkAzure(): Promise<MonitoringResult> {
    const data = this.monitor.type_data;
    const resourceId = (data.azureResourceId || "").trim();
    if (!IsAzureResourceId(resourceId)) {
      return this.fail(GC.ERROR, "Azure resource ID is missing or not /subscriptions/…/providers/…");
    }
    const resolved = ResolveM365Credentials(data);
    if ("error" in resolved) {
      return this.fail(GC.ERROR, resolved.error);
    }
    const started = Date.now();
    const current = await FetchAzureCurrent(resolved.credentials, resourceId, data.timeout || 10000);
    const latency = Date.now() - started;
    const state = String(current.properties?.availabilityState ?? "");
    const status = MapAzureAvailability(current.properties);
    if (!status) {
      return this.fail(GC.ERROR, `Azure reports the resource as "${state || "Unknown"}"`);
    }
    return { status, latency, type: GC.REALTIME, raw_status: state };
  }

  // ---------------------------------------------------------------- Microsoft 365

  private async checkM365(provider: CloudProvider): Promise<MonitoringResult> {
    const data = this.monitor.type_data;
    const resolved = ResolveM365Credentials(data);
    if ("error" in resolved) {
      return this.fail(GC.ERROR, resolved.error);
    }
    const match = M365MatchNames(provider, data);
    if (match.length === 0) {
      return this.fail(GC.ERROR, "Microsoft 365 service name is missing");
    }

    const started = Date.now();
    const overviews = await M365HealthOverviews(resolved.credentials, data.timeout || 10000);
    const latency = Date.now() - started;

    const service = FindM365Service(overviews, match);
    if (!service) {
      const names = overviews.map((o) => o.service).filter(Boolean);
      return this.fail(GC.ERROR, `Service not found in this tenant. Available: ${names.join(", ") || "none"}`);
    }
    return { status: MapM365Status(service.status), latency, type: GC.REALTIME, raw_status: String(service.status) };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * The worst status among the followed components. raw_status names the component that decides
   * it, or the shared state when all agree, e.g. "major_outage (Search)".
   */
  private worstOf(
    found: Array<{ name: string; status: string }>,
    map: (status: string) => string | null,
    latency: number,
  ): MonitoringResult {
    let worst: string = GC.UP;
    let decidedBy: { name: string; status: string } | null = null;
    for (const c of found) {
      const status = map(c.status);
      if (!status) return this.fail(GC.ERROR, `Unknown status "${c.status}" of component "${c.name}"`);
      if (!decidedBy || WorstStatus(worst, status) !== worst) {
        worst = WorstStatus(worst, status);
        decidedBy = c;
      }
    }
    const raw =
      found.length === 1 || !decidedBy || worst === GC.UP ? found[0].status : `${decidedBy.status} (${decidedBy.name})`;
    return { status: worst, latency, type: GC.REALTIME, raw_status: raw };
  }

  private configuredStatus(value: string | undefined): string {
    const map: Record<string, string> = { UP: GC.UP, DEGRADED: GC.DEGRADED, DOWN: GC.DOWN };
    return map[value || "DEGRADED"] ?? GC.DEGRADED;
  }

  /** The provider could not be read: status follows errorStatus (default DEGRADED), the reason is kept. */
  private fail(type: string, message: string): MonitoringResult {
    const error_message = message.length > 200 ? message.substring(0, 200) + "..." : message;
    return {
      status: this.configuredStatus(this.monitor.type_data?.errorStatus),
      latency: 0,
      type,
      error_message,
    };
  }
}

export default CloudServiceCall;
