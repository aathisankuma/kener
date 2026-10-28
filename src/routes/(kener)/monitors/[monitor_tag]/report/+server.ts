// The "not working" button on a service: one report per browser and service within the window.
// The browser is recognised by an anonymous random id in a cookie, not by its address, because
// everyone in an office shares one address.
import { json } from "@sveltejs/kit";
import crypto from "node:crypto";
import type { RequestHandler } from "./$types";
import { ProblemReportError, ReportProblem } from "$lib/server/controllers/reportsController.js";
import { GetLoggedInSession } from "$lib/server/controllers/userController.js";

const COOKIE = "kener-reporter";

export const POST: RequestHandler = async ({ params, cookies, getClientAddress }) => {
  let browserId = cookies.get(COOKIE);
  if (!browserId || !/^[0-9a-f-]{36}$/.test(browserId)) {
    browserId = crypto.randomUUID();
    cookies.set(COOKIE, browserId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 365 * 86400 });
  }
  let ip = "unknown";
  try {
    ip = getClientAddress();
  } catch {
    /* no address behind some proxies */
  }
  try {
    const user = await GetLoggedInSession(cookies);
    const result = await ReportProblem({ monitorTag: params.monitor_tag, browserId, ip, user });
    return json({ count: result.count, alreadyReported: result.alreadyReported });
  } catch (e) {
    if (e instanceof ProblemReportError) return json({ error: e.message }, { status: e.status });
    console.error("Problem report failed:", e);
    return json({ error: "Could not send the report" }, { status: 500 });
  }
};
