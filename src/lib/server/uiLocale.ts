// Language of the admin area and the sign-in pages, chosen by each person and kept in a cookie.
// Until someone picks one, the site's default language is used when the admin area has it.
import type { Cookies } from "@sveltejs/kit";
import { UI_LOCALE_CODES, UI_LOCALE_COOKIE } from "../uiLocaleCodes.js";

export function UiLocaleFor(cookies: Cookies, siteDefault?: string | null): string {
  const chosen = cookies.get(UI_LOCALE_COOKIE);
  if (chosen && UI_LOCALE_CODES.includes(chosen)) return chosen;
  if (siteDefault && UI_LOCALE_CODES.includes(siteDefault)) return siteDefault;
  return "en";
}
