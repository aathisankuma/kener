import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, GetCloudServiceDetails } = vi.hoisted(() => ({
  db: { getMonitors: vi.fn() },
  GetCloudServiceDetails: vi.fn(),
}));
vi.mock("$lib/server/db/db", () => ({ default: db }));
vi.mock("$lib/server/cloudServiceDetails", () => ({ GetCloudServiceDetails }));

import get from "./get";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const request = (tag?: string) => ({ query: new URLSearchParams(tag ? { tag } : {}) }) as any;

describe("GET /dashboard-apis/cloud-details", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a tag", async () => {
    await expect(get(request())).rejects.toMatchObject({ status: 400 });
  });

  it("serves only active, visible Cloud Service monitors", async () => {
    db.getMonitors.mockResolvedValue([{ tag: "printer", monitor_type: "PING", type_data: "{}" }]);
    await expect(get(request("printer"))).rejects.toMatchObject({ status: 404 });
    expect(db.getMonitors).toHaveBeenCalledWith({ tag: "printer", status: "ACTIVE", is_hidden: "NO" });
  });

  it("returns the provider's details", async () => {
    db.getMonitors.mockResolvedValue([
      { tag: "jira", monitor_type: "CLOUD", type_data: JSON.stringify({ provider: "jira" }) },
    ]);
    GetCloudServiceDetails.mockResolvedValue({ components: [], incidents: [], maintenances: [] });

    const response = await get(request("jira"));

    expect(response.status).toBe(200);
    expect(GetCloudServiceDetails).toHaveBeenCalledWith("jira", { provider: "jira" });
  });

  it("answers 502 with the reason when the provider fails", async () => {
    db.getMonitors.mockResolvedValue([{ tag: "jira", monitor_type: "CLOUD", type_data: "{}" }]);
    GetCloudServiceDetails.mockRejectedValue(new Error("Statuspage answered HTTP 503"));
    await expect(get(request("jira"))).rejects.toMatchObject({
      status: 502,
      body: { message: "Statuspage answered HTTP 503" },
    });
  });
});
