// The roles of the signed-in user as id and name, for "Signed in as …" on the status page and in
// the admin area. Built-in roles are translated in the browser by id; custom roles keep their name.
import db from "./db/db.js";

export interface RoleLabel {
  id: string;
  name: string;
}

/** Role ids in the user's order, named from the roles table; unknown ids keep the id as name. */
export function RoleLabelsFor(roleIds: string[], roles: Array<{ id: string; role_name: string }>): RoleLabel[] {
  const names = new Map(roles.map((r) => [r.id, r.role_name]));
  return roleIds.map((id) => ({ id, name: names.get(id) || id }));
}

export async function GetRoleLabels(roleIds: string[] | undefined): Promise<RoleLabel[]> {
  if (!roleIds || roleIds.length === 0) return [];
  return RoleLabelsFor(roleIds, await db.getAllRoles());
}
