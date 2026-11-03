// Reads a public UptimeRobot status page, e.g. status.swiss21.org. UptimeRobot has no documented
// API for status pages, so this reads what the page itself loads:
//   GET {page}                                  HTML with the page id in <input id="pspi" value="…">
//   GET {origin}/api/getMonitorList/{id}?page=N  the page's monitors (30 per page) with statusClass
// statusClass: "success" = up, "danger" = down, "black" = paused (not checked). Pages on
// stats.uptimerobot.com carry the id in the URL: https://stats.uptimerobot.com/{id}.
import axios from "axios";
import GC from "../global-constants.js";
import { CloudHttpOptions } from "./cloudProviderClient.js";

export interface UptimeRobotMonitor {
  id: string;
  name: string;
  /** success, danger, black (paused), or whatever UptimeRobot adds later. */
  statusClass: string;
  group: string | null;
  /** The monitor's latest outage, if the page lists one. UTC seconds. */
  lastDowntime: { at: number; durationSeconds: number; reason: string } | null;
}

export interface UptimeRobotPage {
  /** Where the API answers, e.g. https://status.swiss21.org. */
  origin: string;
  pageId: string;
  monitors: UptimeRobotMonitor[];
}

/** UptimeRobot statusClass -> Kener status; null for paused or unknown classes. */
export function MapUptimeRobotStatus(statusClass: string): string | null {
  switch (String(statusClass).toLowerCase()) {
    case "success":
      return GC.UP;
    case "danger":
      return GC.DOWN;
    case "warning":
      return GC.DEGRADED;
    default:
      return null;
  }
}

export const IsPausedUptimeRobotMonitor = (m: UptimeRobotMonitor) => m.statusClass.toLowerCase() === "black";

/** Page id from the page's HTML, or from a stats.uptimerobot.com/{id} URL. */
export function UptimeRobotPageIdFromHtml(html: string): string | null {
  const tag = html.match(/<input[^>]*\bid=["']pspi["'][^>]*>/i)?.[0];
  const value = tag?.match(/\bvalue=["']([A-Za-z0-9_-]+)["']/i)?.[1];
  return value || null;
}

function idFromUrl(base: string): string | null {
  try {
    const url = new URL(base);
    const segment = url.pathname.split("/").filter(Boolean).pop();
    return url.host.toLowerCase() === "stats.uptimerobot.com" && segment && /^[A-Za-z0-9_-]+$/.test(segment)
      ? segment
      : null;
  } catch {
    return null;
  }
}

/** "2026-10-21 11:07:55" in the page's offset ("+00:00") -> UTC seconds. */
function parseDate(date: unknown, offset: string): number | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(date.trim())) return null;
  const tz = /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "Z";
  const ms = Date.parse(`${date.trim().replace(" ", "T")}${tz}`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function ParseUptimeRobotMonitors(body: unknown): { monitors: UptimeRobotMonitor[]; total: number | null } {
  const psp = (body as { psp?: Record<string, unknown> })?.psp;
  const list = Array.isArray(psp?.monitors) ? (psp.monitors as Array<Record<string, unknown>>) : null;
  if (!list) throw new Error("Not an UptimeRobot status page answer");
  const offset = typeof psp?.timezone === "string" ? psp.timezone : "+00:00";
  const monitors = list
    .filter((m) => typeof m?.name === "string" && m.name.trim())
    .map((m) => {
      const down = m.lastDowntime as { date?: unknown; duration?: unknown; reason?: unknown } | null | undefined;
      const at = down ? parseDate(down.date, offset) : null;
      const group =
        typeof m.groupName === "string" && m.groupName.trim() && Number(m.groupId) !== 0 ? m.groupName.trim() : null;
      return {
        id: String(m.monitorId ?? m.name),
        name: String(m.name).trim(),
        statusClass: String(m.statusClass ?? ""),
        group,
        lastDowntime:
          at !== null
            ? { at, durationSeconds: Math.max(0, Number(down?.duration) || 0), reason: String(down?.reason || "Down") }
            : null,
      };
    });
  const total = Number(psp?.totalMonitors);
  return { monitors, total: Number.isFinite(total) ? total : null };
}

// The page id rarely changes; reading the HTML each minute is not needed.
const PAGE_ID_TTL_MS = 60 * 60 * 1000;
const pageIds = new Map<string, { origin: string; pageId: string; at: number }>();

export function ClearUptimeRobotCache(): void {
  pageIds.clear();
}

async function resolvePage(base: string, timeout: number): Promise<{ origin: string; pageId: string }> {
  const fromUrl = idFromUrl(base);
  if (fromUrl) return { origin: new URL(base).origin, pageId: fromUrl };
  const cached = pageIds.get(base);
  if (cached && Date.now() - cached.at < PAGE_ID_TTL_MS) return cached;
  const options = CloudHttpOptions(timeout);
  const response = await axios(base, {
    ...options,
    headers: { ...options.headers, Accept: "text/html" },
    responseType: "text",
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Status page answered HTTP ${response.status}`);
  }
  const pageId = UptimeRobotPageIdFromHtml(String(response.data ?? ""));
  if (!pageId) throw new Error("Not an UptimeRobot status page: its page id was not found");
  const resolved = { origin: new URL(base).origin, pageId, at: Date.now() };
  pageIds.set(base, resolved);
  return resolved;
}

/** All monitors of the page, in the page's order. */
export async function FetchUptimeRobotPage(base: string, timeout: number): Promise<UptimeRobotPage> {
  const { origin, pageId } = await resolvePage(base, timeout);
  const monitors: UptimeRobotMonitor[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await axios(
      `${origin}/api/getMonitorList/${encodeURIComponent(pageId)}?page=${page}`,
      CloudHttpOptions(timeout),
    );
    if (response.status < 200 || response.status >= 300) {
      // The id may have changed: read it from the page again next time.
      pageIds.delete(base);
      throw new Error(`UptimeRobot answered HTTP ${response.status}`);
    }
    const { monitors: batch, total } = ParseUptimeRobotMonitors(response.data);
    monitors.push(...batch);
    if (batch.length === 0 || total === null || monitors.length >= total) break;
  }
  return { origin, pageId, monitors };
}

/** The monitor a Kener monitor follows: by id or by name, ignoring case. */
export function FindUptimeRobotMonitor(monitors: UptimeRobotMonitor[], wanted: string): UptimeRobotMonitor | null {
  const w = wanted.trim().toLowerCase();
  if (!w) return null;
  return monitors.find((m) => m.id === w) ?? monitors.find((m) => m.name.toLowerCase() === w) ?? null;
}

/**
 * The whole page: DOWN when every checked monitor is down, DEGRADED when some are, else UP.
 * Paused monitors do not count. raw_status names the ones that are down.
 */
export function UptimeRobotPageStatus(monitors: UptimeRobotMonitor[]): { status: string; raw: string } | null {
  const checked = monitors.filter((m) => !IsPausedUptimeRobotMonitor(m));
  if (checked.length === 0) return null;
  const down = checked.filter((m) => MapUptimeRobotStatus(m.statusClass) === GC.DOWN);
  const degraded = checked.filter((m) => MapUptimeRobotStatus(m.statusClass) === GC.DEGRADED);
  if (down.length === 0 && degraded.length === 0) return { status: GC.UP, raw: `all ${checked.length} up` };
  const names = [...down, ...degraded].map((m) => m.name);
  const status = down.length === checked.length ? GC.DOWN : GC.DEGRADED;
  return { status, raw: `${names.length} of ${checked.length} not up (${names.join(", ")})` };
}
