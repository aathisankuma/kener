// Visitors choose which services they see on a status page; the choice stays in their browser.
// Services an administrator marks "always shown" (monitor_settings_json.always_shown) can never be
// hidden. Kener stores the hidden services, so a service added later appears for everyone.

/** The services to show, in the page's order. */
export function VisibleTags(all: string[], hidden: string[], alwaysShown: string[]): string[] {
  const hide = new Set(hidden);
  const keep = new Set(alwaysShown);
  return all.filter((tag) => keep.has(tag) || !hide.has(tag));
}

/** Tags of monitors whose settings say "always shown". */
export function AlwaysShownTagsOf(monitors: Array<{ tag: string; monitor_settings_json?: unknown }>): string[] {
  return monitors
    .filter((m) => {
      const s = m.monitor_settings_json;
      const settings = typeof s === "string" ? safeParse(s) : (s as Record<string, unknown> | null | undefined);
      return settings?.always_shown === true;
    })
    .map((m) => m.tag);
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** The browser storage key of a page's choice ("" is the home page). */
export function SelectionKey(pagePath: string): string {
  return `kener-hidden-services:${pagePath || "/"}`;
}

/** The stored hidden tags, ignoring anything that is not a list of strings. */
export function ParseHidden(stored: string | null): string[] {
  if (!stored) return [];
  const value = safeParse(stored);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
