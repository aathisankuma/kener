import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import serverResolve from "$lib/server/resolver.js";
import { GetUserPermissions } from "$lib/server/controllers/userController.js";
import { GetMyServices } from "$lib/server/controllers/serviceManagerController.js";

// The page of a service manager: their services, nothing else.
export const load: PageServerLoad = async ({ parent }) => {
  const { loggedInUser } = await parent();
  if (!loggedInUser) {
    throw redirect(302, serverResolve("/account/signin"));
  }
  const permissions = await GetUserPermissions(loggedInUser.id);
  if (!permissions.has("services.manage_assigned")) {
    throw error(403, "Forbidden");
  }
  return {
    userName: loggedInUser.name,
    services: await GetMyServices(loggedInUser.id),
    canOpenDashboard: permissions.has("settings.read"),
  };
};
