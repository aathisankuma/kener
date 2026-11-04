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
    case "STATUS":
      return tm("STATUS");
    case "LATENCY":
      return tm("LATENCY");
    case "UPTIME":
      return tm("UPTIME");
    default:
      return code ?? "";
  }
}

/**
 * A known message from the sign-in pages' server, e.g. "User does not exist", in the chosen
 * language. Unknown messages come back as they are.
 */
export function tmMessage(text: string | null | undefined): string {
  switch (text ?? "") {
    case "The identity provider returned an error. Please try again.":
      return tm("The identity provider returned an error. Please try again.");
    case "Your account has been deactivated. Please contact an administrator.":
      return tm("Your account has been deactivated. Please contact an administrator.");
    case "Your account has no active roles assigned. Please contact an administrator.":
      return tm("Your account has no active roles assigned. Please contact an administrator.");
    case "Your account is not provisioned in this system. Please contact an administrator.":
      return tm("Your account is not provisioned in this system. Please contact an administrator.");
    case "An account with this email already exists. OIDC and local accounts are kept separate. Please contact an administrator.":
      return tm(
        "An account with this email already exists. OIDC and local accounts are kept separate. Please contact an administrator.",
      );
    case "Authentication failed. Please try again or contact an administrator.":
      return tm("Authentication failed. Please try again or contact an administrator.");
    case "Email and password are required":
      return tm("Email and password are required");
    case "Set up not done yet. Create a user first.":
      return tm("Set up not done yet. Create a user first.");
    case "Local login is disabled. Please use SSO.":
      return tm("Local login is disabled. Please use SSO.");
    case "User does not exist":
      return tm("User does not exist");
    case "This account uses SSO authentication. Please use the SSO login button.":
      return tm("This account uses SSO authentication. Please use the SSO login button.");
    case "Invalid password or Email":
      return tm("Invalid password or Email");
    case "Email, password, and name are required":
      return tm("Email, password, and name are required");
    case "Set up already done. Please login with the email and password you have set up.":
      return tm("Set up already done. Please login with the email and password you have set up.");
    case "An error occurred during signup":
      return tm("An error occurred during signup");
    case "Failed to create user":
      return tm("Failed to create user");
    case "Invalid or missing verification link.":
      return tm("Invalid or missing verification link.");
    case "Invalid or expired verification link.":
      return tm("Invalid or expired verification link.");
    case "Invalid verification link.":
      return tm("Invalid verification link.");
    case "This verification link has expired. Please request a new one.":
      return tm("This verification link has expired. Please request a new one.");
    case "No user found for this verification link.":
      return tm("No user found for this verification link.");
    case "Invalid or missing invitation link.":
      return tm("Invalid or missing invitation link.");
    case "Invalid or expired invitation link.":
      return tm("Invalid or expired invitation link.");
    case "Invalid invitation link.":
      return tm("Invalid invitation link.");
    case "This invitation link has expired. Please ask your administrator to send a new one.":
      return tm("This invitation link has expired. Please ask your administrator to send a new one.");
    case "No invitation found for this email address.":
      return tm("No invitation found for this email address.");
    case "This invitation has already been accepted. Please sign in instead.":
      return tm("This invitation has already been accepted. Please sign in instead.");
    case "Email is required":
      return tm("Email is required");
    case "Email template not found":
      return tm("Email template not found");
    case "Failed to send password reset email":
      return tm("Failed to send password reset email");
    case "Token is required":
      return tm("Token is required");
    case "Invalid or expired token":
      return tm("Invalid or expired token");
    case "Invalid token data":
      return tm("Invalid token data");
    case "Token has expired":
      return tm("Token has expired");
    case "Password must contain at least 8 characters, one uppercase letter, one lowercase letter and one number":
      return tm(
        "Password must contain at least 8 characters, one uppercase letter, one lowercase letter and one number",
      );
    case "Password is required":
      return tm("Password is required");
    case "Invalid or expired invitation link":
      return tm("Invalid or expired invitation link");
    case "This invitation link has expired":
      return tm("This invitation link has expired");
    case "This invitation has already been accepted":
      return tm("This invitation has already been accepted");
    case "The Tenant ID looks wrong. Use the Directory (tenant) ID, e.g. 3f2a9c71-8b4d-4e2a-9f10-6c5d7e8a1b2c, or your domain.":
      return tm(
        "The Tenant ID looks wrong. Use the Directory (tenant) ID, e.g. 3f2a9c71-8b4d-4e2a-9f10-6c5d7e8a1b2c, or your domain.",
      );
    case "The Client ID looks wrong. Use the Application (client) ID, e.g. a7c41e09-2f3b-4d8a-b615-0e9f2c7d4a3b.":
      return tm(
        "The Client ID looks wrong. Use the Application (client) ID, e.g. a7c41e09-2f3b-4d8a-b615-0e9f2c7d4a3b.",
      );
    case "This looks like the Secret ID. Paste the secret's Value from Certificates & secrets (it usually contains a ~).":
      return tm(
        "This looks like the Secret ID. Paste the secret's Value from Certificates & secrets (it usually contains a ~).",
      );
    case "Microsoft 365 connection is missing: Tenant ID, Client ID, Client secret. Enter it under Manage → Microsoft 365, or in the monitor's fields.":
      return tm(
        "Microsoft 365 connection is missing: Tenant ID, Client ID, Client secret. Enter it under Manage → Microsoft 365, or in the monitor's fields.",
      );
    default:
      return text ?? "";
  }
}

/** A role's name in the chosen language: built-in roles by id, custom roles as they are named. */
export function tmRole(role: { id: string; name: string }): string {
  switch (role.id) {
    case "admin":
      return tm("Administrator");
    case "editor":
      return tm("Editor");
    case "member":
      return tm("Member");
    case "service_manager":
      return tm("Service Manager");
    case "viewer":
      return tm("Viewer");
    default:
      return role.name;
  }
}
