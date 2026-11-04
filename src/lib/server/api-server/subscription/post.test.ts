import { afterEach, describe, expect, it, vi } from "vitest";

const { VerifyCaptchaToken, GetSiteDataByKey, SubscriberLogin, SubscriberTokenForAccount, GetLoggedInSession } =
  vi.hoisted(() => ({
    VerifyCaptchaToken: vi.fn(),
    GetSiteDataByKey: vi.fn(),
    SubscriberLogin: vi.fn(),
    SubscriberTokenForAccount: vi.fn(),
    GetLoggedInSession: vi.fn(),
  }));

vi.mock("$lib/server/controllers/captchaController", () => ({ VerifyCaptchaToken }));
vi.mock("$lib/server/controllers/siteDataController", () => ({ GetSiteDataByKey }));
vi.mock("$lib/server/controllers/userSubscriptionsController", () => ({
  SubscriberLogin,
  VerifySubscriberOTP: vi.fn(),
  VerifySubscriberToken: vi.fn(),
  UpdateSubscriberPreferences: vi.fn(),
  GetSubscribableMonitors: vi.fn(),
  SubscriberTokenForAccount,
}));
vi.mock("$lib/server/controllers/userController", () => ({ GetLoggedInSession }));

import post from "./post";

const enabledConfig = { enable: true, methods: { emails: { incidents: true, maintenances: false } } };

describe("POST /dashboard-apis/subscription — login action", () => {
  afterEach(() => {
    VerifyCaptchaToken.mockReset();
    GetSiteDataByKey.mockReset();
    SubscriberLogin.mockReset();
  });

  it("rejects and never calls SubscriberLogin when captcha verification fails", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifyCaptchaToken.mockResolvedValue({ success: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      post({ body: { action: "login", email: "a@b.com", captchaToken: "bad" } } as any),
    ).rejects.toMatchObject({ status: 400 });
    expect(SubscriberLogin).not.toHaveBeenCalled();
  });

  it("proceeds to SubscriberLogin when captcha verification passes", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifyCaptchaToken.mockResolvedValue({ success: true });
    SubscriberLogin.mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "login", email: "a@b.com", captchaToken: "good" } } as any);

    expect(response.status).toBe(200);
    expect(VerifyCaptchaToken).toHaveBeenCalledWith("good");
    expect(SubscriberLogin).toHaveBeenCalledWith("a@b.com");
  });

  it("proceeds when no captchaToken is sent and no provider is configured (verify no-ops to success)", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifyCaptchaToken.mockResolvedValue({ success: true });
    SubscriberLogin.mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "login", email: "a@b.com" } } as any);

    expect(response.status).toBe(200);
    expect(VerifyCaptchaToken).toHaveBeenCalledWith(undefined);
  });

  it("passes an explicit JSON null captchaToken through unchanged (not coerced to undefined)", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifyCaptchaToken.mockResolvedValue({ success: true });
    SubscriberLogin.mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "login", email: "a@b.com", captchaToken: null } } as any);

    expect(response.status).toBe(200);
    expect(VerifyCaptchaToken).toHaveBeenCalledWith(null);
  });
});

describe("POST /dashboard-apis/subscription — signed-in people", () => {
  afterEach(() => {
    GetSiteDataByKey.mockReset();
    SubscriberLogin.mockReset();
    SubscriberTokenForAccount.mockReset();
    GetLoggedInSession.mockReset();
  });

  it("subscribes a signed-in person with their account's email, without a code", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    GetLoggedInSession.mockResolvedValue({ id: 7, email: "anna@band.ch" });
    SubscriberTokenForAccount.mockResolvedValue({ success: true, token: "tok" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "account" }, cookies: {} } as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, token: "tok" });
    expect(SubscriberTokenForAccount).toHaveBeenCalledWith("anna@band.ch");
  });

  it("refuses the account way when nobody is signed in", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    GetLoggedInSession.mockResolvedValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(post({ body: { action: "account" }, cookies: {} } as any)).rejects.toMatchObject({ status: 401 });
    expect(SubscriberTokenForAccount).not.toHaveBeenCalled();
  });

  it("closes the email-and-code way when only signed-in people may subscribe", async () => {
    GetSiteDataByKey.mockResolvedValue({ ...enabledConfig, requireSignIn: true });

    for (const body of [
      { action: "login", email: "a@b.com" },
      { action: "verify", email: "a@b.com", code: "123456" },
    ]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(post({ body } as any)).rejects.toMatchObject({ status: 403 });
    }
    expect(SubscriberLogin).not.toHaveBeenCalled();
  });
});
