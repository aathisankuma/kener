import { json, error } from "@sveltejs/kit";
import type { APIServerRequest } from "$lib/server/types/api-server";
import db from "$lib/server/db/db";
import GC from "$lib/global-constants";
import { GetCloudServiceDetails } from "$lib/server/cloudServiceDetails";
import type { CloudServiceMonitorTypeData } from "$lib/server/types/monitor";

/**
 * GET /dashboard-apis/cloud-details?tag=xxx
 * What the provider of a Cloud Service monitor shows: components, incidents and maintenances.
 * Only for active monitors that are not hidden, like every other monitor endpoint of the status page.
 */
export default async function get(req: APIServerRequest): Promise<Response> {
  const tag = req.query.get("tag");
  if (!tag) {
    return error(400, { message: "tag query parameter is required" });
  }
  const monitor = (await db.getMonitors({ tag, status: GC.ACTIVE, is_hidden: GC.NO }))[0];
  if (!monitor || monitor.monitor_type !== "CLOUD") {
    return error(404, { message: "Cloud Service monitor not found" });
  }

  let typeData: CloudServiceMonitorTypeData;
  try {
    typeData = JSON.parse(monitor.type_data || "{}");
  } catch {
    return error(500, { message: "Monitor settings are unreadable" });
  }

  try {
    return json(await GetCloudServiceDetails(monitor.tag, typeData));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider could not be read";
    return error(502, { message });
  }
}
