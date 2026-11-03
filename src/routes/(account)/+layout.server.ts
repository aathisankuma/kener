import type { LayoutServerLoad } from "./$types";
import { GetLayoutServerData } from "$lib/server/controllers/layoutController";
import { UiLocaleFor } from "$lib/server/uiLocale.js";

export const load: LayoutServerLoad = async ({ cookies, request }) => {
  const data = await GetLayoutServerData(cookies, request);
  return { ...data, uiLocale: UiLocaleFor(cookies, data.languageSetting?.defaultLocale) };
};
