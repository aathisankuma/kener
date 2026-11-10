// Sections on a status page: an administrator can start a section at a service ("IT", "Atlassian");
// the page shows its title above a fine line, then the section's services in their own box.

/** The section title stored with a service on a page (pages_monitors.monitor_settings_json). */
export function SectionTitleOf(monitorSettingsJson: unknown): string {
  let raw: unknown = monitorSettingsJson;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return "";
    }
  }
  const title = (raw as { sectionTitle?: unknown } | null)?.sectionTitle;
  return typeof title === "string" ? title.trim() : "";
}

/**
 * The section of each service, from all of the page's services in order (hidden ones included, so
 * a title on a hidden service still starts its section). "" before the first title.
 */
export function SectionByTag(ordered: Array<{ tag: string; title: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  let current = "";
  for (const { tag, title } of ordered) {
    if (title) current = title;
    out[tag] = current;
  }
  return out;
}

export interface PageSection {
  title: string;
  tags: string[];
}

/** The services shown, split where the section changes; a section with nothing shown is left out. */
export function SplitIntoSections(
  shownTags: string[],
  sectionByTag: Record<string, string> | undefined,
): PageSection[] {
  const sections: PageSection[] = [];
  for (const tag of shownTags) {
    const title = sectionByTag?.[tag] ?? "";
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.tags.push(tag);
    else sections.push({ title, tags: [tag] });
  }
  return sections;
}
