import { describe, expect, it } from "vitest";
import { AfterSignInPath, HomePathFor } from "./allPerms";

describe("where a signed-in person starts", () => {
  it("sends admins to the dashboard, service managers to their services, viewers to the status page", () => {
    expect(HomePathFor(["settings.read", "monitors.read"])).toBe("/manage/app/site-configurations");
    expect(HomePathFor(["services.manage_assigned"])).toBe("/my-services");
    expect(HomePathFor([])).toBe("/");
  });

  it("returns to the status page the person came from", () => {
    expect(AfterSignInPath("/atlassian", "/")).toBe("/atlassian");
    expect(AfterSignInPath("/monitors/jira?x=1", "/")).toBe("/monitors/jira?x=1");
    expect(AfterSignInPath(null, "/my-services")).toBe("/my-services");
  });

  it("never follows a link to another site or into the admin area", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "evil",
      "/manage/app/users",
      "/account/signin",
      "/api/v4/x",
    ]) {
      expect(AfterSignInPath(next, "/")).toBe("/");
    }
  });
});
