// "Load missing icons": gives every Cloud Service monitor without an image its service's official
// icon in one go. Monitors that already have an image keep it.
import db from "../db/db.js";
import { FetchCloudServiceIcon } from "../cloudServiceIcon.js";
import type { CloudServiceMonitorTypeData } from "../types/monitor.js";

export interface MissingIconsResult {
  updated: string[];
  failed: Array<{ name: string; reason: string }>;
}

export async function FetchMissingCloudIcons(): Promise<MissingIconsResult> {
  const monitors = await db.getMonitors({ monitor_type: "CLOUD" });
  const result: MissingIconsResult = { updated: [], failed: [] };
  // One at a time: the same few icon hosts, and the admin waits for the answer anyway.
  for (const monitor of monitors) {
    if ((monitor.image || "").trim()) continue;
    let typeData: CloudServiceMonitorTypeData;
    try {
      typeData = JSON.parse(monitor.type_data || "{}");
    } catch {
      result.failed.push({ name: monitor.name, reason: "Invalid settings" });
      continue;
    }
    try {
      const image = await FetchCloudServiceIcon(typeData);
      await db.updateMonitor({ ...monitor, image });
      result.updated.push(monitor.name);
    } catch (e) {
      result.failed.push({ name: monitor.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
