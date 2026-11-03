// Texts of the admin area and the sign-in pages in the person's language. The English text is the
// key; src/lib/locales/manage/{de,fr,it}.json hold the translations. A text missing there shows in
// English. Placeholders use %name, as on the public status page.
import { page } from "$app/state";
import { de, enGB, fr, it, type Locale } from "date-fns/locale";
import { UI_LOCALE_CODES, UI_LOCALE_COOKIE } from "./uiLocaleCodes.js";

const modules = import.meta.glob("/src/lib/locales/manage/*.json", { eager: true, import: "default" }) as Record<
  string,
  { name: string; mappings: Record<string, string> }
>;

const DICTIONARIES: Record<string, Record<string, string>> = {};
const NAMES: Record<string, string> = { en: "English" };
for (const [path, mod] of Object.entries(modules)) {
  const code = path
    .split("/")
    .pop()!
    .replace(/\.json$/, "");
  DICTIONARIES[code] = mod.mappings;
  NAMES[code] = mod.name;
}

/** The languages to choose from, by their own name. */
export const UI_LOCALES = UI_LOCALE_CODES.map((code) => ({ code, name: NAMES[code] ?? code }));

/** The language of the current page. */
export function uiLocale(): string {
  return (page.data as { uiLocale?: string })?.uiLocale ?? "en";
}

/** A text in the person's language. */
export function tm(key: string, args?: Record<string, string | number | null | undefined>): string {
  let text = DICTIONARIES[uiLocale()]?.[key] ?? key;
  if (args) {
    text = text.replace(/%(\w+)/g, (match, name) =>
      args[name] !== undefined && args[name] !== null ? String(args[name]) : match,
    );
  }
  return text;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A text with **bold** and `code` parts, as HTML for {@html}. Everything is escaped first, the
 * placeholders included, so only <b> and <code> come out as markup.
 */
export function tmh(key: string, args?: Record<string, string | number | null | undefined>): string {
  return escapeHtml(tm(key, args))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

/** Switches the language. The page reloads, so texts set up once on load change as well. */
export function setUiLocale(code: string): void {
  if (!UI_LOCALE_CODES.includes(code)) return;
  document.cookie = `${UI_LOCALE_COOKIE}=${code}; path=/; max-age=${365 * 86400}; samesite=lax`;
  location.reload();
}

const DATE_LOCALES: Record<string, Locale> = { de, en: enGB, fr, it };

/** The date-fns locale of the person's language, for formatDistanceToNow and format. */
export function dateLocale(): Locale {
  return DATE_LOCALES[uiLocale()] ?? enGB;
}

const LOCALE_TAGS: Record<string, string> = { de: "de-CH", en: "en-GB", fr: "fr-CH", it: "it-CH" };

/** The BCP 47 tag of the person's language, for toLocaleString and Intl. */
export function localeTag(): string {
  return LOCALE_TAGS[uiLocale()] ?? "en-GB";
}

/** A status code of Kener (incident state, monitor status, impact, …) in the person's language. */
export function tmStatus(code: string | null | undefined): string {
  switch (code) {
    case "INVESTIGATING":
      return tm("INVESTIGATING");
    case "IDENTIFIED":
      return tm("IDENTIFIED");
    case "MONITORING":
      return tm("MONITORING");
    case "RESOLVED":
      return tm("RESOLVED");
    case "UP":
      return tm("UP");
    case "DOWN":
      return tm("DOWN");
    case "DEGRADED":
      return tm("DEGRADED");
    case "MAINTENANCE":
      return tm("MAINTENANCE");
    case "NO_DATA":
      return tm("NO_DATA");
    case "SCHEDULED":
      return tm("SCHEDULED");
    case "READY":
      return tm("READY");
    case "ONGOING":
      return tm("ONGOING");
    case "COMPLETED":
      return tm("COMPLETED");
    case "CANCELLED":
      return tm("CANCELLED");
    case "TRIGGERED":
      return tm("TRIGGERED");
    case "CRITICAL":
      return tm("CRITICAL");
    case "WARNING":
      return tm("WARNING");
    case "ACTIVE":
      return tm("ACTIVE");
    case "INACTIVE":
      return tm("INACTIVE");
    default:
      return code ?? "";
  }
}
