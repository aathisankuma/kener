import { describe, expect, it } from "vitest";
import { RoleLabelsFor } from "./userRoles";

describe("roles of the signed-in user", () => {
  const roles = [
    { id: "admin", role_name: "Administrator" },
    { id: "service_manager", role_name: "Service Manager" },
    { id: "it_support", role_name: "IT Support" },
  ];

  it("names each role from the roles table, in the user's order", () => {
    expect(RoleLabelsFor(["it_support", "admin"], roles)).toEqual([
      { id: "it_support", name: "IT Support" },
      { id: "admin", name: "Administrator" },
    ]);
  });

  it("keeps the id when a role no longer exists", () => {
    expect(RoleLabelsFor(["gone"], roles)).toEqual([{ id: "gone", name: "gone" }]);
    expect(RoleLabelsFor([], roles)).toEqual([]);
  });
});
