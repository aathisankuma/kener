// The visitor's choice of services on the current status page, shared by the "Choose services"
// menu in the top bar and the page's service list. Kept in the browser per page; see
// $lib/serviceSelection for the rules.
import { ParseHidden, SelectionKey } from "$lib/serviceSelection";

export const serviceChoice = $state<{ pagePath: string | null; hidden: string[] }>({ pagePath: null, hidden: [] });

/** Reads the stored choice of a page; call it when that page is shown. */
export function LoadServiceChoice(pagePath: string): void {
  let hidden: string[] = [];
  try {
    hidden = ParseHidden(localStorage.getItem(SelectionKey(pagePath)));
  } catch {
    hidden = [];
  }
  serviceChoice.pagePath = pagePath;
  serviceChoice.hidden = hidden;
}

/** Changes and stores the hidden services of the current page. */
export function SetHiddenServices(next: string[]): void {
  serviceChoice.hidden = next;
  if (serviceChoice.pagePath === null) return;
  try {
    const key = SelectionKey(serviceChoice.pagePath);
    if (next.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* private window or storage blocked: the choice lasts until the page is left */
  }
}
