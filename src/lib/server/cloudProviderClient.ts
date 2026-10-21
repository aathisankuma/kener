// Shared HTTP and Microsoft 365 sign-in for Cloud Service monitors: the status check
// (services/cloudServiceCall.ts) and the detail view (cloudServiceDetails.ts) use one token cache.
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { AxiosProxyConfig } from "./proxy.js";
import version from "../version.js";
import { GetRequiredSecrets, ReplaceAllOccurrences } from "./tool.js";
import type { CloudServiceMonitorTypeData } from "./types/monitor.js";
import type { CloudProvider } from "../cloudServices.js";

export function CloudHttpOptions(timeout = 10000): AxiosRequestConfig & { headers: Record<string, string> } {
  return {
    method: "GET",
    timeout,
    headers: { "User-Agent": `Kener/${version()}`, Accept: "application/json" },
    validateStatus: () => true,
    ...AxiosProxyConfig(undefined, {}, {}),
  };
}

/** The Statuspage base URL of a provider, without a trailing slash, or "" when there is none. */
export function StatuspageBase(provider: CloudProvider, data: CloudServiceMonitorTypeData): string {
  const base = (provider.url || data.statuspageUrl || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? base : "";
}

export interface M365Credentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * The Microsoft 365 connection of a monitor. Each empty field falls back to M365_TENANT_ID,
 * M365_CLIENT_ID or M365_CLIENT_SECRET, so one app registration serves every monitor.
 * Fields may name environment variables as $NAME.
 */
export function ResolveM365Credentials(
  data: CloudServiceMonitorTypeData,
): { credentials: M365Credentials } | { error: string } {
  const envSecrets = GetRequiredSecrets(`${data.tenantId ?? ""} ${data.clientId ?? ""} ${data.clientSecret ?? ""}`);
  const secret = (value: string | undefined) => {
    let result = (value || "").trim();
    for (const s of envSecrets) {
      if (s.replace !== undefined) result = ReplaceAllOccurrences(result, s.find, s.replace);
    }
    return result;
  };
  const credentials = {
    tenantId: secret(data.tenantId) || (process.env.M365_TENANT_ID || "").trim(),
    clientId: secret(data.clientId) || (process.env.M365_CLIENT_ID || "").trim(),
    clientSecret: secret(data.clientSecret) || (process.env.M365_CLIENT_SECRET || "").trim(),
  };
  const envNames = { tenantId: "M365_TENANT_ID", clientId: "M365_CLIENT_ID", clientSecret: "M365_CLIENT_SECRET" };
  const missing = (Object.keys(credentials) as Array<keyof M365Credentials>)
    .filter((key) => !credentials[key])
    .map((key) => envNames[key]);
  if (missing.length > 0) {
    return { error: `Microsoft 365 connection is missing: set ${missing.join(", ")} or fill in the fields` };
  }
  const unresolved = Object.values(credentials).find((value) => /^\$\w+$/.test(value));
  if (unresolved) {
    return { error: `Environment variable ${unresolved.slice(1)} is not set` };
  }
  return { credentials };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Test hook: forget cached Microsoft tokens. */
export function ClearM365TokenCache(): void {
  tokenCache.clear();
}

export function M365CacheKey(c: M365Credentials): string {
  return `${c.tenantId}|${c.clientId}`;
}

async function M365AccessToken(c: M365Credentials, timeout: number): Promise<string> {
  const key = M365CacheKey(c);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - 5 * 60 * 1000 > Date.now()) {
    return cached.token;
  }
  const options = CloudHttpOptions(timeout);
  const response = await axios(
    `https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`,
    {
      ...options,
      method: "POST",
      headers: { ...options.headers, "Content-Type": "application/x-www-form-urlencoded" },
      data: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
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

/** GET a Microsoft Graph URL with the app's token. Throws with a readable reason on failure. */
export async function M365Get(url: string, c: M365Credentials, timeout = 10000): Promise<AxiosResponse> {
  const token = await M365AccessToken(c, timeout);
  const options = CloudHttpOptions(timeout);
  const response: AxiosResponse = await axios(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    tokenCache.delete(M365CacheKey(c));
    throw new Error(
      `Microsoft Graph refused access (HTTP ${response.status}). Grant the app ServiceHealth.Read.All with admin consent.`,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Microsoft Graph answered HTTP ${response.status}`);
  }
  return response;
}

/** Ids and names to look for in Graph's health overviews, lower-cased. */
export function M365MatchNames(provider: CloudProvider, data: CloudServiceMonitorTypeData): string[] {
  return (provider.kind === "m365" && !provider.m365Match ? [data.m365Service || ""] : provider.m365Match || [])
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
}

export interface HealthOverview {
  id: string;
  service: string;
  status: string;
}

// Shared by every Microsoft 365 monitor of the same app registration: ten monitors cost one Graph
// call per minute. A failed read is dropped at once so the next monitor retries.
const overviewCache = new Map<string, { at: number; data: Promise<HealthOverview[]> }>();
const OVERVIEW_TTL_MS = 50 * 1000;

/** Test hook: forget cached Microsoft tokens and health data. */
export function ClearCloudProviderCache(): void {
  tokenCache.clear();
  overviewCache.clear();
}

/** Health of every Microsoft 365 service in the tenant. */
export async function M365HealthOverviews(c: M365Credentials, timeout = 10000): Promise<HealthOverview[]> {
  const key = M365CacheKey(c);
  const cached = overviewCache.get(key);
  if (cached && Date.now() - cached.at < OVERVIEW_TTL_MS) {
    return cached.data;
  }
  const data = (async () => {
    const result: HealthOverview[] = [];
    let url: string | undefined =
      "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews?$select=id,service,status";
    for (let page = 0; url && page < 5; page++) {
      const response = await M365Get(url, c, timeout);
      result.push(...(Array.isArray(response.data?.value) ? response.data.value : []));
      url = response.data?.["@odata.nextLink"];
    }
    return result;
  })();
  overviewCache.set(key, { at: Date.now(), data });
  data.catch(() => overviewCache.delete(key));
  return data;
}

/** The tenant's overview entry for a monitor's service, matched by Graph id or name. */
export function FindM365Service(overviews: HealthOverview[], match: string[]): HealthOverview | undefined {
  return overviews.find(
    (o) => match.includes(String(o.id).toLowerCase()) || match.includes(String(o.service).toLowerCase()),
  );
}
