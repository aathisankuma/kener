// Settings → UniFi: the UniFi Site Manager API key, and the access points Kener follows.
//
// Each chosen access point becomes a Cloud Service monitor (provider "unifi-device") with the name
// the admin gives it. Access points of one location are joined in a group monitor named after the
// location, so visitors and subscribers pick a location ("Bern, Haus A") and get its access points.
import db from "../db/db.js";
import GC from "../../global-constants.js";
import { ChosenComponents, CLOUD_UNIFI_DEVICE, ServiceIconUrl } from "../../cloudServices.js";
import {
  ClearUnifiCache,
  FetchUnifiDevices,
  IsUnifiAccessPoint,
  LocationFromName,
  MapUnifiStatus,
  type UnifiDevice,
} from "../unifiClient.js";
import { AddMonitorToPage, GetPageById, GetPageMonitors } from "./pagesController.js";
import {
  CreateMonitorAlertConfig,
  GetMonitorAlertConfigs,
  UpdateMonitorAlertConfig,
} from "./monitorAlertConfigController.js";

const KEY = "unifiConnection";
/** Tag prefixes of what Kener makes here; never reused for anything else. */
export const UNIFI_AP_TAG_PREFIX = "unifi-ap-";
export const UNIFI_LOCATION_TAG_PREFIX = "unifi-ort-";
/** Marks the one alert rule Kener keeps for the access points. */
export const UNIFI_ALERT_DESCRIPTION = "UniFi access point offline (Settings → UniFi)";

const CACHE_MS = 30 * 1000;
let cached: { at: number; apiKey: string } | null = null;

async function readStoredKey(): Promise<string> {
  const row = await db.getSiteDataByKey(KEY);
  if (!row?.value) return "";
  try {
    return String(JSON.parse(row.value).apiKey ?? "");
  } catch {
    return "";
  }
}

/** The API key: from the settings page, else the UNIFI_API_KEY environment variable. */
export async function GetUnifiApiKey(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.apiKey;
  const apiKey = (await readStoredKey()) || (process.env.UNIFI_API_KEY || "").trim();
  cached = { at: Date.now(), apiKey };
  return apiKey;
}

/** Test hook. */
export function ClearUnifiSettingsCache(): void {
  cached = null;
}

export interface UnifiSettingsView {
  hasApiKey: boolean;
  fromEnvironment: boolean;
}

export async function GetUnifiSettingsView(): Promise<UnifiSettingsView> {
  return {
    hasApiKey: !!(await readStoredKey()),
    fromEnvironment: !!(process.env.UNIFI_API_KEY || "").trim(),
  };
}

/** A new key replaces the saved one; an empty one keeps it, and removeApiKey deletes it. */
export async function SaveUnifiSettings(data: Record<string, unknown>): Promise<UnifiSettingsView> {
  const newKey = String(data.apiKey ?? "").trim();
  const apiKey = data.removeApiKey === true ? "" : newKey || (await readStoredKey());
  if (newKey && /\s/.test(newKey)) throw new Error("The API key must not contain spaces.");
  await db.insertOrUpdateSiteData(KEY, JSON.stringify({ apiKey }), "object");
  ClearUnifiSettingsCache();
  ClearUnifiCache();
  return GetUnifiSettingsView();
}

async function requireKey(): Promise<string> {
  const apiKey = await GetUnifiApiKey();
  if (!apiKey) throw new Error("Enter the UniFi API key first.");
  return apiKey;
}

/** Reads the account's devices with the saved key. */
export async function TestUnifiSettings(): Promise<{ devices: number; accessPoints: number; consoles: string[] }> {
  ClearUnifiCache();
  const devices = await FetchUnifiDevices(await requireKey());
  return {
    devices: devices.length,
    accessPoints: devices.filter(IsUnifiAccessPoint).length,
    consoles: [...new Set(devices.map((d) => d.hostName).filter(Boolean))],
  };
}

/** One device on the settings page, with what Kener already made of it. */
export interface UnifiDeviceRow {
  id: string;
  unifiName: string;
  model: string;
  hostName: string;
  ip: string;
  status: string;
  /** UP, DOWN, … */
  kenerStatus: string;
  isAccessPoint: boolean;
  /** Followed by Kener (an active monitor exists). */
  followed: boolean;
  /** The name visitors see: the monitor's, else the UniFi name. */
  name: string;
  /** The location: saved with the monitor, else a guess from the UniFi name. */
  location: string;
  monitorTag: string;
}

interface UnifiTypeData {
  provider?: string;
  component?: string;
  components?: string[];
  location?: string;
}

function parseTypeData(value: unknown): UnifiTypeData {
  if (typeof value !== "string") return (value as UnifiTypeData) || {};
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

/** The access-point monitors Kener made, by UniFi device id. */
async function existingApMonitors(): Promise<
  Map<string, { tag: string; name: string; location: string; active: boolean; id: number }>
> {
  const monitors = await db.getMonitors({ monitor_type: "CLOUD" } as never);
  const out = new Map<string, { tag: string; name: string; location: string; active: boolean; id: number }>();
  for (const m of monitors) {
    const data = parseTypeData(m.type_data);
    const deviceId = ChosenComponents(data)[0];
    if (data.provider !== CLOUD_UNIFI_DEVICE || !deviceId) continue;
    out.set(deviceId, {
      tag: m.tag,
      name: m.name,
      location: data.location || "",
      active: m.status === "ACTIVE",
      id: m.id,
    });
  }
  return out;
}

export async function ListUnifiDevices(): Promise<{ devices: UnifiDeviceRow[] }> {
  const [devices, existing] = await Promise.all([FetchUnifiDevices(await requireKey()), existingApMonitors()]);
  const rows = devices.map((d: UnifiDevice): UnifiDeviceRow => {
    const known = existing.get(d.id);
    return {
      id: d.id,
      unifiName: d.name,
      model: d.model,
      hostName: d.hostName,
      ip: d.ip,
      status: d.status,
      kenerStatus: MapUnifiStatus(d.status),
      isAccessPoint: IsUnifiAccessPoint(d),
      followed: !!known?.active,
      name: known?.name || d.name,
      location: known?.location || LocationFromName(d.name) || d.hostName,
      monitorTag: known?.tag || "",
    };
  });
  rows.sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));
  return { devices: rows };
}

/** A monitor tag from free text: lowercase letters, digits and hyphens. */
export function TagPart(value: string, max = 40): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "x";
}

/** Equal weights that add up to exactly 1, like the group monitor form. */
export function EqualWeights(count: number): number[] {
  if (count <= 0) return [];
  const w = Math.round((1 / count) * 1000) / 1000;
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? Math.round((1 - w * (count - 1)) * 1000) / 1000 : w,
  );
}

export interface UnifiSyncItem {
  id: string;
  name: string;
  location: string;
  follow: boolean;
}

export interface UnifiSyncInput {
  items: UnifiSyncItem[];
  /** Status page to show the locations on; null leaves pages as they are. */
  pageId?: number | null;
  /** Open an incident when an access point is offline this many minutes; 0 turns it off. */
  alertMinutes?: number;
}

export interface UnifiSyncResult {
  accessPoints: number;
  locations: string[];
  stopped: number;
}

const MONITOR_DEFAULTS = {
  description: "",
  cron: "* * * * *",
  default_status: GC.UP,
  category_name: "Home",
  day_degraded_minimum_count: 1,
  day_down_minimum_count: 1,
  include_degraded_in_downtime: "NO",
  is_hidden: "NO",
  external_url: "",
  confirmation_threshold: 1,
  monitor_settings_json: JSON.stringify({
    uptime_formula_numerator: GC.defaultNumeratorStr,
    uptime_formula_denominator: GC.defaultDenominatorStr,
  }),
};

async function uniqueTag(base: string, taken: Set<string>): Promise<string> {
  let tag = base;
  for (let n = 2; taken.has(tag) || (await db.getMonitorsByTag(tag)); n++) tag = `${base}-${n}`;
  taken.add(tag);
  return tag;
}

/**
 * Makes Kener follow the chosen access points: creates or renames their monitors, joins them per
 * location in group monitors, stops following the others (their history stays), puts the locations
 * on a status page and keeps one alert rule that opens an incident when an access point is offline.
 */
export async function SyncUnifiAccessPoints(input: UnifiSyncInput): Promise<UnifiSyncResult> {
  if (!Array.isArray(input?.items)) throw new Error("items must be a list");
  const items = input.items
    .filter((i) => i && typeof i.id === "string" && i.id)
    .map((i) => ({
      id: i.id,
      follow: i.follow === true,
      name: String(i.name ?? "")
        .trim()
        .slice(0, 120),
      location: String(i.location ?? "")
        .trim()
        .slice(0, 120),
    }));
  for (const i of items) {
    if (i.follow && !i.name) throw new Error("Every access point you follow needs a name.");
    if (i.follow && !i.location) throw new Error("Every access point you follow needs a location.");
  }

  const existing = await existingApMonitors();
  const taken = new Set<string>();
  const icon = ServiceIconUrl(CLOUD_UNIFI_DEVICE);
  const byLocation = new Map<string, string[]>();
  let stopped = 0;

  for (const item of items) {
    const known = existing.get(item.id);
    if (!item.follow) {
      if (known?.active) {
        await db.updateMonitor({ ...(await db.getMonitorsByTag(known.tag))!, status: "INACTIVE" });
        stopped++;
      }
      continue;
    }
    const typeData = JSON.stringify({
      provider: CLOUD_UNIFI_DEVICE,
      component: "",
      components: [item.id],
      location: item.location,
      errorStatus: "DEGRADED",
      timeout: 15000,
    });
    let tag: string;
    if (known) {
      tag = known.tag;
      taken.add(tag);
      const row = (await db.getMonitorsByTag(tag))!;
      await db.updateMonitor({ ...row, name: item.name, type_data: typeData, status: "ACTIVE" });
    } else {
      tag = await uniqueTag(UNIFI_AP_TAG_PREFIX + TagPart(item.id), taken);
      await db.insertMonitor({
        ...MONITOR_DEFAULTS,
        tag,
        name: item.name,
        image: icon,
        monitor_type: "CLOUD",
        status: "ACTIVE",
        type_data: typeData,
      });
    }
    const list = byLocation.get(item.location) ?? [];
    list.push(tag);
    byLocation.set(item.location, list);
  }

  // One group monitor per location; locations without access points stop.
  const groups = (await db.getMonitors({ monitor_type: "GROUP" } as never)).filter((m) =>
    m.tag.startsWith(UNIFI_LOCATION_TAG_PREFIX),
  );
  const groupByName = new Map(groups.map((g) => [g.name, g]));
  const groupTags: string[] = [];
  for (const [location, tags] of [...byLocation.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const weights = EqualWeights(tags.length);
    const typeData = JSON.stringify({
      monitors: tags.map((tag, i) => ({ tag, weight: weights[i] })),
      executionDelay: 1000,
      latencyCalculation: "AVG",
    });
    const group = groupByName.get(location);
    if (group) {
      await db.updateMonitor({ ...group, type_data: typeData, status: "ACTIVE" });
      groupTags.push(group.tag);
      groupByName.delete(location);
    } else {
      const tag = await uniqueTag(UNIFI_LOCATION_TAG_PREFIX + TagPart(location), taken);
      await db.insertMonitor({
        ...MONITOR_DEFAULTS,
        tag,
        name: location,
        image: icon,
        monitor_type: "GROUP",
        status: "ACTIVE",
        type_data: typeData,
      });
      groupTags.push(tag);
    }
  }
  for (const unused of groupByName.values()) {
    if (unused.status === "ACTIVE") await db.updateMonitor({ ...unused, status: "INACTIVE" });
  }

  // Show the locations on the chosen page.
  if (input.pageId) {
    const page = await GetPageById(Number(input.pageId));
    if (!page) throw new Error("That status page does not exist.");
    const onPage = new Set((await GetPageMonitors(page.id)).map((m) => m.monitor_tag));
    for (const tag of groupTags) if (!onPage.has(tag)) await AddMonitorToPage(page.id, tag);
  }

  await syncAlert([...byLocation.values()].flat(), Number(input.alertMinutes) || 0);

  return { accessPoints: [...byLocation.values()].flat().length, locations: [...byLocation.keys()], stopped };
}

/** One alert rule for all followed access points: offline N minutes → incident. */
async function syncAlert(apTags: string[], minutes: number): Promise<void> {
  const existing = (await GetMonitorAlertConfigs({} as never)).find(
    (c) => c.alert_description === UNIFI_ALERT_DESCRIPTION,
  );
  const active = minutes > 0 && apTags.length > 0;
  if (!existing) {
    if (!active) return;
    await CreateMonitorAlertConfig({
      monitor_tags: apTags,
      alert_for: "STATUS",
      alert_value: "DOWN",
      failure_threshold: Math.min(Math.max(Math.round(minutes), 1), 120),
      success_threshold: 1,
      alert_description: UNIFI_ALERT_DESCRIPTION,
      create_incident: "YES",
      is_active: "YES",
      severity: "WARNING",
    } as never);
    return;
  }
  await UpdateMonitorAlertConfig({
    id: existing.id,
    ...(apTags.length > 0 ? { monitor_tags: apTags } : {}),
    ...(active ? { failure_threshold: Math.min(Math.max(Math.round(minutes), 1), 120) } : {}),
    is_active: active ? "YES" : "NO",
  } as never);
}

/** What the settings page shows of the alert rule. */
export async function GetUnifiAlertMinutes(): Promise<number> {
  const existing = (await GetMonitorAlertConfigs({} as never)).find(
    (c) => c.alert_description === UNIFI_ALERT_DESCRIPTION,
  );
  return existing && existing.is_active === "YES" ? Number(existing.failure_threshold) || 0 : 0;
}
