// UniFi devices from the UniFi Site Manager API (api.ui.com), the cloud behind unifi.ui.com.
// An API key from Site Manager → API reads every console (host) of the account and its devices with
// their state (online / offline …). The API allows 100 requests a minute, so the device list is
// fetched once and shared by every UniFi monitor for a short while.
import axios from "axios";
import GC from "../global-constants.js";

/** UniFi Site Manager; UNIFI_API_URL replaces it (tests, or a proxy in front of it). */
export const UNIFI_API_BASE = "https://api.ui.com";
const apiBase = () => (process.env.UNIFI_API_URL || "").trim().replace(/\/+$/, "") || UNIFI_API_BASE;

export interface UnifiDevice {
  id: string;
  mac: string;
  name: string;
  model: string;
  shortname: string;
  ip: string;
  status: string;
  productLine: string;
  isConsole: boolean;
  hostId: string;
  hostName: string;
}

interface RawDevice {
  id?: unknown;
  mac?: unknown;
  name?: unknown;
  model?: unknown;
  shortname?: unknown;
  ip?: unknown;
  status?: unknown;
  productLine?: unknown;
  isConsole?: unknown;
}

interface RawHostDevices {
  hostId?: unknown;
  hostName?: unknown;
  devices?: RawDevice[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** The flat device list of one page of /v1/devices, which groups devices by console (host). */
export function ParseUnifiDevices(body: unknown): UnifiDevice[] {
  const data = (body as { data?: RawHostDevices[] })?.data;
  if (!Array.isArray(data)) return [];
  const out: UnifiDevice[] = [];
  for (const host of data) {
    for (const d of Array.isArray(host?.devices) ? host.devices : []) {
      const id = str(d.id) || str(d.mac);
      if (!id) continue;
      out.push({
        id,
        mac: str(d.mac),
        name: str(d.name) || str(d.model) || id,
        model: str(d.model),
        shortname: str(d.shortname),
        ip: str(d.ip),
        status: str(d.status).toLowerCase(),
        productLine: str(d.productLine),
        isConsole: d.isConsole === true,
        hostId: str(host.hostId),
        hostName: str(host.hostName),
      });
    }
  }
  return out;
}

const AP_MODEL = /^(U6|U7|UAP|UAL|UAC|UAE|E7|UWB|UMA|UBB|UDB|ULR|UK)/i;
const AP_WORDS = /\b(AP|access point|nanoHD|FlexHD|BeaconHD)\b/i;
const NOT_AP = /^(USW|US-|US\d|UDM|UDR|UXG|USG|UCG|UCK|UNVR|UNAS|UX|UGW|UP-|UVC|UA-|UTR|UPS|USP)/i;

/** True for a UniFi access point, by its model (consoles, switches and gateways are not). */
export function IsUnifiAccessPoint(device: Pick<UnifiDevice, "model" | "shortname" | "isConsole">): boolean {
  if (device.isConsole) return false;
  const names = [device.model, device.shortname].filter(Boolean);
  if (names.some((n) => NOT_AP.test(n))) return false;
  return names.some((n) => AP_MODEL.test(n) || AP_WORDS.test(n));
}

/** UniFi device state → Kener status. */
export function MapUnifiStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "online":
    case "connected":
      return GC.UP;
    case "offline":
    case "disconnected":
      return GC.DOWN;
    case "updating":
    case "upgrading":
      return GC.MAINTENANCE;
    default:
      return GC.DEGRADED;
  }
}

/**
 * A first guess of where an access point hangs, from its name: the name without the trailing part
 * that names the access point itself, e.g. "Bern-HausA-2OG-AP1" → "Bern HausA 2OG". Empty when the
 * name says nothing more.
 */
export function LocationFromName(name: string): string {
  const parts = name.split(/[-_\s/]+/).filter(Boolean);
  const apPart = /^((ap|wap|wlan|wifi|u6|u7|uap)\d*[a-z]?|\d+)$/i;
  while (parts.length > 1 && apPart.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 1 && apPart.test(parts[0])) parts.pop();
  return parts.join(" ");
}

// One device list per API key for a short while: every UniFi monitor checks each minute.
const CACHE_MS = 55 * 1000;
const cache = new Map<string, { at: number; devices: Promise<UnifiDevice[]> }>();

/** Test hook. */
export function ClearUnifiCache(): void {
  cache.clear();
}

async function fetchAll(apiKey: string, timeout: number): Promise<UnifiDevice[]> {
  const headers = { "X-API-Key": apiKey, Accept: "application/json" };
  const devices: UnifiDevice[] = [];
  let path = "/v1/devices";
  let nextToken = "";
  for (let page = 0; page < 50; page++) {
    const params: Record<string, string> = { pageSize: "200" };
    if (nextToken) params.nextToken = nextToken;
    let response;
    try {
      response = await axios.get(`${apiBase()}${path}`, { headers, params, timeout });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      // Accounts on the early-access API answer under /ea/.
      if (status === 404 && path === "/v1/devices" && page === 0) {
        path = "/ea/devices";
        page--;
        continue;
      }
      if (status === 401 || status === 403) throw new Error("UniFi did not accept the API key");
      if (status === 429) throw new Error("UniFi rate limit reached; try again in a minute");
      throw err;
    }
    devices.push(...ParseUnifiDevices(response.data));
    nextToken = str((response.data as { nextToken?: unknown })?.nextToken);
    if (!nextToken) break;
  }
  return devices;
}

/** Every device of the account, shared by all callers for about a minute. */
export async function FetchUnifiDevices(apiKey: string, timeout = 15000): Promise<UnifiDevice[]> {
  const hit = cache.get(apiKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.devices;
  const devices = fetchAll(apiKey, timeout);
  cache.set(apiKey, { at: Date.now(), devices });
  try {
    return await devices;
  } catch (err) {
    cache.delete(apiKey);
    throw err;
  }
}
