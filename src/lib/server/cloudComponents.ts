// The components a Cloud Service monitor can follow, for the "Load list" button of the monitor form.
// Read on the server, so the provider's CORS rules and Kener's proxy settings do not matter.
import axios from "axios";
import { GetCloudProvider } from "../cloudServices.js";
import type { CloudServiceMonitorTypeData } from "./types/monitor.js";
import { CloudHttpOptions, StatuspageBase } from "./cloudProviderClient.js";
import { FetchInstatusComponents, InstatusComponentLabel } from "./instatusClient.js";

/** Component names to choose from, in the provider's order. Throws with a reason to show. */
export async function ListCloudComponents(data: CloudServiceMonitorTypeData): Promise<string[]> {
  const provider = GetCloudProvider(data?.provider);
  if (!provider || provider.kind === "m365") {
    throw new Error("This service has no components to choose from");
  }
  const base = StatuspageBase(provider, data);
  if (!base) throw new Error("Status page URL is missing or not http(s)");
  const timeout = Math.min(data.timeout || 10000, 15000);

  if (provider.kind === "instatus") {
    const components = await FetchInstatusComponents(base, timeout);
    return components.map((c) => InstatusComponentLabel(c, components));
  }

  const response = await axios(`${base}/api/v2/components.json`, CloudHttpOptions(timeout));
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Statuspage answered HTTP ${response.status}`);
  }
  const components: Array<{ name?: string; group?: boolean; position?: number }> = Array.isArray(
    response.data?.components,
  )
    ? response.data.components
    : [];
  return components
    .filter((c) => c.name && !c.group)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c) => String(c.name));
}
