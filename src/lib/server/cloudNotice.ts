// What a provider reported when the monitor's impact rule kept the status page green ("Microsoft
// reports: Degraded Performance"). Kept in the cache for a few check intervals; the status page
// shows it next to the service.
import { deleteCache, getCache, setCache } from "./cache/cache.js";

export interface CloudNotice {
  /** The provider's status in Kener's terms: DEGRADED, DOWN or MAINTENANCE. */
  status: string;
  /** e.g. "Microsoft 365" */
  provider: string;
}

const key = (tag: string) => `cloud-notice:${tag}`;
/** A notice disappears by itself when checks stop. */
const TTL_SECONDS = 15 * 60;

// Tags this process wrote a note for: clearing is only needed for those, so a normal check (no
// note) costs no cache call. A note left by an earlier process expires with its TTL.
const written = new Set<string>();

export async function SetCloudNotice(tag: string, notice: CloudNotice | null): Promise<void> {
  if (!tag) return;
  if (!notice && !written.has(tag)) return;
  try {
    if (notice) {
      await setCache(key(tag), notice, TTL_SECONDS);
      written.add(tag);
    } else {
      await deleteCache(key(tag));
      written.delete(tag);
    }
  } catch {
    // The note is extra information: a cache problem must not fail the check.
  }
}

export async function GetCloudNotice(tag: string): Promise<CloudNotice | null> {
  try {
    return await getCache<CloudNotice>(key(tag));
  } catch {
    return null;
  }
}
