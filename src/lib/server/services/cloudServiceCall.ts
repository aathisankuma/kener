import axios from "axios";
import GC from "../../global-constants.js";
import type { CloudServiceMonitor, MonitoringResult } from "../types/monitor.js";
import { GetCloudProvider, type CloudProvider } from "../../cloudServices.js";
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
    const component = (data.component || "").trim();
    const started = Date.now();
    let response = await axios(
      `${base}/api/v2/${component ? "components" : "status"}.json`,
      CloudHttpOptions(data.timeout || 10000),
    );
    // Pages that only copy part of the Statuspage API (incident.io, e.g. OpenAI) may lack
    // status.json; summary.json carries the same indicator.
    const hasIndicator = (r: typeof response) =>
      r.status >= 200 && r.status < 300 && typeof r.data?.status?.indicator === "string";
    if (!component && !hasIndicator(response)) {
      const summary = await axios(`${base}/api/v2/summary.json`, CloudHttpOptions(data.timeout || 10000));
      if (hasIndicator(summary)) response = summary;
    }
    const latency = Date.now() - started;

    if (response.status < 200 || response.status >= 300) {
      return this.fail(GC.ERROR, `Statuspage answered HTTP ${response.status}`);
    }
    const body = response.data;

    if (!component) {
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
    const wanted = component.toLowerCase();
    const match = components.find(
      (c) => (c.id && c.id.toLowerCase() === wanted) || (c.name && c.name.trim().toLowerCase() === wanted),
    );
    if (!match) {
      const names = components.map((c) => c.name).filter(Boolean);
      return this.fail(GC.ERROR, `Component "${component}" not found. Available: ${names.join(", ") || "none"}`);
    }
    const status = MapStatuspageComponent(String(match.status), !!data.ignoreMinor);
    if (!status) {
      return this.fail(GC.ERROR, `Unknown component status "${match.status}"`);
    }
    return { status, latency, type: GC.REALTIME, raw_status: String(match.status) };
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
    const component = (data.component || "").trim();
    const started = Date.now();

    if (component) {
      const components = await FetchInstatusComponents(base, timeout);
      const latency = Date.now() - started;
      const match = FindInstatusComponent(components, component);
      if (!match) {
        const names = components.map((c) => InstatusComponentLabel(c, components));
        return this.fail(GC.ERROR, `Component "${component}" not found. Available: ${names.join(", ") || "none"}`);
      }
      const status = MapInstatusStatus(match.status, ignoreMinor);
      if (!status) {
        return this.fail(GC.ERROR, `Unknown component status "${match.status}"`);
      }
      return { status, latency, type: GC.REALTIME, raw_status: match.status };
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
