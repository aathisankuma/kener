// The shared Microsoft connection of the "Microsoft 365" settings page: one app registration
// (tenant, client id, secret) for every Microsoft 365 and Azure Cloud Service monitor whose own
// fields are empty. It comes before the M365_* environment variables.
import db from "../db/db.js";
import {
  ClearCloudProviderCache,
  M365HealthOverviews,
  ResolveM365Credentials,
  type M365Credentials,
} from "../cloudProviderClient.js";

const KEY = "m365Connection";
const EMPTY: M365Credentials = { tenantId: "", clientId: "", clientSecret: "" };

/** What the settings page sees: the ids, never the secret. */
export interface M365SettingsView {
  tenantId: string;
  clientId: string;
  hasSecret: boolean;
  /** Which values Kener's environment provides as a fallback (M365_*). */
  fromEnvironment: { tenantId: boolean; clientId: boolean; clientSecret: boolean };
}

// Every Microsoft monitor reads the connection on each check: keep it for a short while.
const CACHE_MS = 30 * 1000;
let cached: { at: number; value: M365Credentials } | null = null;

async function readStored(): Promise<M365Credentials> {
  const row = await db.getSiteDataByKey(KEY);
  if (!row?.value) return { ...EMPTY };
  try {
    const parsed = JSON.parse(row.value);
    return {
      tenantId: String(parsed.tenantId ?? ""),
      clientId: String(parsed.clientId ?? ""),
      clientSecret: String(parsed.clientSecret ?? ""),
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function GetM365SharedConnection(): Promise<M365Credentials> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await readStored();
  cached = { at: Date.now(), value };
  return value;
}

/** Test hook. */
export function ClearM365SettingsCache(): void {
  cached = null;
}

export async function GetM365SettingsView(): Promise<M365SettingsView> {
  const stored = await readStored();
  const env = (name: string) => !!(process.env[name] || "").trim();
  return {
    tenantId: stored.tenantId,
    clientId: stored.clientId,
    hasSecret: !!stored.clientSecret,
    fromEnvironment: {
      tenantId: env("M365_TENANT_ID"),
      clientId: env("M365_CLIENT_ID"),
      clientSecret: env("M365_CLIENT_SECRET"),
    },
  };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function ValidateM365Ids(tenantId: string, clientId: string): void {
  if (tenantId && !GUID.test(tenantId) && !DOMAIN.test(tenantId)) {
    throw new Error(
      "The Tenant ID looks wrong. Use the Directory (tenant) ID, e.g. 3f2a9c71-8b4d-4e2a-9f10-6c5d7e8a1b2c, or your domain.",
    );
  }
  if (clientId && !GUID.test(clientId)) {
    throw new Error(
      "The Client ID looks wrong. Use the Application (client) ID, e.g. a7c41e09-2f3b-4d8a-b615-0e9f2c7d4a3b.",
    );
  }
}

/**
 * Saves the ids. A new secret replaces the saved one; leaving it empty keeps it, and
 * removeSecret deletes it.
 */
export async function SaveM365Settings(data: Record<string, unknown>): Promise<M365SettingsView> {
  const current = await readStored();
  const tenantId = String(data.tenantId ?? "").trim();
  const clientId = String(data.clientId ?? "").trim();
  const newSecret = String(data.clientSecret ?? "").trim();
  ValidateM365Ids(tenantId, clientId);
  if (newSecret && GUID.test(newSecret)) {
    throw new Error(
      "This looks like the Secret ID. Paste the secret's Value from Certificates & secrets (it usually contains a ~).",
    );
  }
  const settings: M365Credentials = {
    tenantId,
    clientId,
    clientSecret: data.removeSecret === true ? "" : newSecret || current.clientSecret,
  };
  await db.insertOrUpdateSiteData(KEY, JSON.stringify(settings), "object");
  ClearM365SettingsCache();
  // A new secret must sign in again instead of using a token of the old one.
  ClearCloudProviderCache();
  return GetM365SettingsView();
}

/** Signs in with the shared connection and reads the tenant's services. */
export async function TestM365Settings(): Promise<{ services: string[] }> {
  const resolved = ResolveM365Credentials({ provider: "" }, await GetM365SharedConnection());
  if ("error" in resolved) throw new Error(resolved.error);
  ClearCloudProviderCache();
  const overviews = await M365HealthOverviews(resolved.credentials, 15000);
  return { services: overviews.map((o) => o.service).filter(Boolean) };
}
