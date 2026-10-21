import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { AxiosProxyConfig } from "../proxy.js";
import GC from "../../global-constants.js";
import version from "../../version.js";
import { GetRequiredSecrets, ReplaceAllOccurrences } from "../tool.js";
import type { CloudServiceMonitor, MonitoringResult } from "../types/monitor.js";
import { GetCloudProvider, CLOUD_CUSTOM_M365, type CloudProvider } from "../../cloudServices.js";

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

interface HealthOverview {
  id: string;
  service: string;
  status: string;
}

// Tokens and health overviews are shared by every CLOUD monitor of the same app registration, so
// ten Microsoft 365 monitors cost one token per hour and one Graph call per minute.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const overviewCache = new Map<string, { at: number; data: Promise<HealthOverview[]> }>();
const OVERVIEW_TTL_MS = 50 * 1000;

/** Test hook: forget cached Microsoft tokens and health data. */
export function ClearCloudServiceCache(): void {
  tokenCache.clear();
  overviewCache.clear();
}

class CloudServiceCall {
  monitor: CloudServiceMonitor;
  envSecrets: Array<{ find: string; replace: string | undefined }>;

  constructor(monitor: CloudServiceMonitor) {
    this.monitor = monitor;
    const td = monitor.type_data;
    this.envSecrets = GetRequiredSecrets(`${td?.tenantId ?? ""} ${td?.clientId ?? ""} ${td?.clientSecret ?? ""}`);
  }

  async execute(): Promise<MonitoringResult> {
    const data = this.monitor.type_data;
    const provider = GetCloudProvider(data?.provider);
    if (!data || !provider) {
      return this.fail(GC.ERROR, "Cloud Service monitor has no valid provider");
    }
    try {
      return provider.kind === "m365" ? await this.checkM365(provider) : await this.checkStatuspage(provider);
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
    const base = (provider.url || data.statuspageUrl || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) {
      return this.fail(GC.ERROR, "Statuspage URL is missing or not http(s)");
    }
    const component = (data.component || "").trim();
    const started = Date.now();
    const response = await axios(`${base}/api/v2/${component ? "components" : "status"}.json`, this.httpOptions());
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

  // ---------------------------------------------------------------- Microsoft 365

  private async checkM365(provider: CloudProvider): Promise<MonitoringResult> {
    const data = this.monitor.type_data;
    const tenantId = this.secret(data.tenantId);
    const clientId = this.secret(data.clientId);
    const clientSecret = this.secret(data.clientSecret);
    if (!tenantId || !clientId || !clientSecret) {
      return this.fail(GC.ERROR, "Microsoft 365 needs tenant id, client id and client secret");
    }
    if (/^\$\w+$/.test(clientSecret)) {
      return this.fail(GC.ERROR, `Environment variable ${clientSecret.slice(1)} is not set`);
    }
    const match = (provider.id === CLOUD_CUSTOM_M365 ? [data.m365Service || ""] : provider.m365Match || [])
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean);
    if (match.length === 0) {
      return this.fail(GC.ERROR, "Microsoft 365 service name is missing");
    }

    const started = Date.now();
    const overviews = await this.healthOverviews(tenantId, clientId, clientSecret);
    const latency = Date.now() - started;

    const service = overviews.find(
      (o) => match.includes(String(o.id).toLowerCase()) || match.includes(String(o.service).toLowerCase()),
    );
    if (!service) {
      const names = overviews.map((o) => o.service).filter(Boolean);
      return this.fail(GC.ERROR, `Service not found in this tenant. Available: ${names.join(", ") || "none"}`);
    }
    return { status: MapM365Status(service.status), latency, type: GC.REALTIME, raw_status: String(service.status) };
  }

  private async healthOverviews(tenantId: string, clientId: string, clientSecret: string): Promise<HealthOverview[]> {
    const key = `${tenantId}|${clientId}`;
    const cached = overviewCache.get(key);
    if (cached && Date.now() - cached.at < OVERVIEW_TTL_MS) {
      return cached.data;
    }
    const data = this.fetchHealthOverviews(key, tenantId, clientId, clientSecret);
    overviewCache.set(key, { at: Date.now(), data });
    // A failed read must not be served to the next monitor from the cache.
    data.catch(() => overviewCache.delete(key));
    return data;
  }

  private async fetchHealthOverviews(
    key: string,
    tenantId: string,
    clientId: string,
    clientSecret: string,
  ): Promise<HealthOverview[]> {
    const token = await this.accessToken(key, tenantId, clientId, clientSecret);
    const result: HealthOverview[] = [];
    let url: string | undefined =
      "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews?$select=id,service,status";
    for (let page = 0; url && page < 5; page++) {
      const response: AxiosResponse = await axios(url, {
        ...this.httpOptions(),
        headers: { ...this.httpOptions().headers, Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        tokenCache.delete(key);
        throw new Error(
          `Microsoft Graph refused access (HTTP ${response.status}). Grant the app ServiceHealth.Read.All with admin consent.`,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Microsoft Graph answered HTTP ${response.status}`);
      }
      const value = Array.isArray(response.data?.value) ? response.data.value : [];
      result.push(...value);
      url = response.data?.["@odata.nextLink"];
    }
    return result;
  }

  private async accessToken(key: string, tenantId: string, clientId: string, clientSecret: string): Promise<string> {
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt - 5 * 60 * 1000 > Date.now()) {
      return cached.token;
    }
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    const response = await axios(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        ...this.httpOptions(),
        method: "POST",
        headers: { ...this.httpOptions().headers, "Content-Type": "application/x-www-form-urlencoded" },
        data: form.toString(),
      },
    );
    const token = response.data?.access_token;
    if (response.status < 200 || response.status >= 300 || typeof token !== "string") {
      // Microsoft's own text names the cause, e.g. a wrong or expired secret (AADSTS7000215).
      const reason = response.data?.error_description || response.data?.error || `HTTP ${response.status}`;
      throw new Error(`Microsoft sign-in failed: ${String(reason).split("\r\n")[0]}`);
    }
    const expiresIn = Number(response.data?.expires_in) || 3600;
    tokenCache.set(key, { token, expiresAt: Date.now() + expiresIn * 1000 });
    return token;
  }

  // ---------------------------------------------------------------- helpers

  private httpOptions(): AxiosRequestConfig & { headers: Record<string, string> } {
    return {
      method: "GET",
      timeout: this.monitor.type_data.timeout || 10000,
      headers: { "User-Agent": `Kener/${version()}`, Accept: "application/json" },
      validateStatus: () => true,
      ...AxiosProxyConfig(undefined, {}, {}),
    };
  }

  private secret(value: string | undefined): string {
    let result = (value || "").trim();
    for (const s of this.envSecrets) {
      if (s.replace !== undefined) result = ReplaceAllOccurrences(result, s.find, s.replace);
    }
    return result;
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
