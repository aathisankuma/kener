import { describe, expect, it } from "vitest";
import { IsSignInLink } from "./navLinks";

describe("menu links that lead to signing in", () => {
  const host = "status.band.ch";

  it("recognises the sign-in page and the admin area, also with a base path or full address", () => {
    expect(IsSignInLink("/account/signin", host)).toBe(true);
    expect(IsSignInLink("/account/signin/", host)).toBe(true);
    expect(IsSignInLink("/status/account/signin", host)).toBe(true);
    expect(IsSignInLink("https://status.band.ch/account/signin?x=1", host)).toBe(true);
    expect(IsSignInLink("/manage", host)).toBe(true);
    expect(IsSignInLink("/manage/app/monitors", host)).toBe(true);
  });

  it("keeps every other link", () => {
    expect(IsSignInLink("https://support.band.ch/portal", host)).toBe(false);
    expect(IsSignInLink("https://other.example.com/account/signin", host)).toBe(false);
    expect(IsSignInLink("/docs/manage-users", host)).toBe(false);
    expect(IsSignInLink("/account/forgot", host)).toBe(false);
    expect(IsSignInLink("", host)).toBe(false);
  });
});
