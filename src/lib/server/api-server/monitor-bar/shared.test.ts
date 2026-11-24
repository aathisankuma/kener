import { describe, expect, it, vi } from "vitest";

const { GetCloudNotice } = vi.hoisted(() => ({ GetCloudNotice: vi.fn() }));
vi.mock("$lib/server/cloudNotice", () => ({ GetCloudNotice }));
vi.mock("$lib/server/db/db", () => ({ default: {} }));
vi.mock("$lib/server/controllers/monitorsController", () => ({ AttachSslCacheFields: vi.fn() }));

import { AttachProviderNotice } from "./shared";
import type { MonitorRecord } from "$lib/server/types/db";
import type { MonitorBarResponse } from "./get";

const response = { name: "Teams" } as unknown as MonitorBarResponse;
const monitor = (monitor_type: string, type_data: unknown) =>
  ({ tag: "teams", monitor_type, type_data: JSON.stringify(type_data) }) as unknown as MonitorRecord;

describe("AttachProviderNotice", () => {
  it("adds the provider's note and the allestörungen.ch page of Microsoft 365 services", async () => {
    GetCloudNotice.mockResolvedValue({ status: "DEGRADED", provider: "Microsoft 365" });
    expect(await AttachProviderNotice(monitor("CLOUD", { provider: "m365-teams" }), response)).toEqual({
      name: "Teams",
      providerNotice: { status: "DEGRADED", provider: "Microsoft 365" },
      outageReports: "teams",
    });

    GetCloudNotice.mockResolvedValue(null);
    expect(await AttachProviderNotice(monitor("CLOUD", { provider: "jira" }), response)).toEqual({ name: "Teams" });
    expect(await AttachProviderNotice(monitor("API", { provider: "m365-teams" }), response)).toBe(response);
    const broken = { tag: "x", monitor_type: "CLOUD", type_data: "{not json" } as unknown as MonitorRecord;
    expect(await AttachProviderNotice(broken, response)).toEqual({ name: "Teams" });
  });
});
