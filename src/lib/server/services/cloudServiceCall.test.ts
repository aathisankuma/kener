import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import CloudServiceCall, {
  ClearCloudServiceCache,
  MapM365Status,
  MapStatuspageComponent,
  MapStatuspageIndicator,
} from "./cloudServiceCall";
import type { CloudServiceMonitor } from "../types/monitor";
import { ABACUS_COMPONENTS, ABACUS_SUMMARY } from "../instatusFixture";

vi.mock("axios", () => ({ default: vi.fn() }));
const mockedAxios = vi.mocked(axios);

beforeEach(() => {
  mockedAxios.mockReset();
  ClearCloudServiceCache();
});
afterEach(() => {
  delete process.env.TEST_M365_SECRET;
  delete process.env.M365_TENANT_ID;
  delete process.env.M365_CLIENT_ID;
  delete process.env.M365_CLIENT_SECRET;
});

function monitor(type_data: Partial<CloudServiceMonitor["type_data"]>): CloudServiceMonitor {
  return { tag: "cloud-test", type_data: { provider: "jira", ...type_data } };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reply = (status: number, data: unknown) => ({ status, data }) as any;

describe("status mapping", () => {
  it("maps Statuspage indicators", () => {
    expect(MapStatuspageIndicator("none")).toBe("UP");
    expect(MapStatuspageIndicator("minor")).toBe("DEGRADED");
    expect(MapStatuspageIndicator("minor", true)).toBe("UP");
    expect(MapStatuspageIndicator("major")).toBe("DOWN");
    expect(MapStatuspageIndicator("critical")).toBe("DOWN");
    expect(MapStatuspageIndicator("maintenance")).toBe("MAINTENANCE");
    expect(MapStatuspageIndicator("bogus")).toBeNull();
  });

  it("maps Statuspage component states", () => {
    expect(MapStatuspageComponent("operational")).toBe("UP");
    expect(MapStatuspageComponent("degraded_performance")).toBe("DEGRADED");
    expect(MapStatuspageComponent("degraded_performance", true)).toBe("UP");
    expect(MapStatuspageComponent("partial_outage")).toBe("DEGRADED");
    expect(MapStatuspageComponent("major_outage")).toBe("DOWN");
    expect(MapStatuspageComponent("under_maintenance")).toBe("MAINTENANCE");
  });

  it("maps Microsoft 365 health in either letter case", () => {
    expect(MapM365Status("ServiceOperational")).toBe("UP");
    expect(MapM365Status("serviceRestored")).toBe("UP");
    expect(MapM365Status("serviceDegradation")).toBe("DEGRADED");
    expect(MapM365Status("investigating")).toBe("DEGRADED");
    expect(MapM365Status("ServiceInterruption")).toBe("DOWN");
    expect(MapM365Status("somethingNew")).toBe("DEGRADED");
  });
});

describe("Statuspage providers", () => {
  it("reads the page indicator of a listed provider", async () => {
    mockedAxios.mockResolvedValueOnce(reply(200, { status: { indicator: "major", description: "Major outage" } }));
    const result = await new CloudServiceCall(monitor({ provider: "confluence" })).execute();
    expect(result).toMatchObject({ status: "DOWN", type: "REALTIME", raw_status: "major" });
    expect(mockedAxios.mock.calls[0][0]).toBe("https://confluence.status.atlassian.com/api/v2/status.json");
  });

  it("follows one component by name, ignoring case", async () => {
    mockedAxios.mockResolvedValueOnce(
      reply(200, {
        components: [
          { id: "abc", name: "Viewing content", status: "operational" },
          { id: "def", name: "Search", status: "degraded_performance" },
        ],
      }),
    );
    const result = await new CloudServiceCall(monitor({ provider: "jira", component: "search" })).execute();
    expect(result).toMatchObject({ status: "DEGRADED", raw_status: "degraded_performance" });
    expect(mockedAxios.mock.calls[0][0]).toBe("https://jira-software.status.atlassian.com/api/v2/components.json");
  });

  it("names the available components when the chosen one is missing", async () => {
    mockedAxios.mockResolvedValueOnce(reply(200, { components: [{ id: "a", name: "Search", status: "operational" }] }));
    const result = await new CloudServiceCall(monitor({ component: "Mobile" })).execute();
    expect(result.status).toBe("DEGRADED");
    expect(result.error_message).toContain("Available: Search");
  });

  it("uses a custom Statuspage URL", async () => {
    mockedAxios.mockResolvedValueOnce(reply(200, { status: { indicator: "none" } }));
    const result = await new CloudServiceCall(
      monitor({ provider: "statuspage-custom", statuspageUrl: "https://status.example.com/" }),
    ).execute();
    expect(result.status).toBe("UP");
    expect(mockedAxios.mock.calls[0][0]).toBe("https://status.example.com/api/v2/status.json");
  });

  it("reads summary.json when a page has no status.json (OpenAI on incident.io)", async () => {
    mockedAxios.mockImplementation(async (url) =>
      url === "https://status.openai.com/api/v2/summary.json"
        ? reply(200, { status: { indicator: "minor" }, components: [] })
        : reply(404, "not found"),
    );
    const result = await new CloudServiceCall(monitor({ provider: "openai" })).execute();
    expect(result).toMatchObject({ status: "DEGRADED", raw_status: "minor" });
  });

  it("records the configured status with the reason when the page cannot be read", async () => {
    // status.json and the summary.json fallback both fail.
    mockedAxios.mockResolvedValue(reply(503, "unavailable"));
    expect(await new CloudServiceCall(monitor({})).execute()).toMatchObject({
      status: "DEGRADED",
      type: "ERROR",
      error_message: "Statuspage answered HTTP 503",
    });

    mockedAxios.mockRejectedValue(
      Object.assign(new Error("timeout of 10000ms exceeded"), { code: "ECONNABORTED" }),
    );
    expect(await new CloudServiceCall(monitor({ errorStatus: "DOWN" })).execute()).toMatchObject({
      status: "DOWN",
      type: "TIMEOUT",
    });
  });

  it("reports an unknown provider instead of throwing", async () => {
    const result = await new CloudServiceCall(monitor({ provider: "nope" })).execute();
    expect(result).toMatchObject({ status: "DEGRADED", type: "ERROR" });
    expect(mockedAxios).not.toHaveBeenCalled();
  });
});

describe("Instatus providers", () => {
  const routes = (map: Record<string, unknown>) =>
    mockedAxios.mockImplementation(async (url) =>
      typeof url === "string" && url in map ? reply(200, map[url]) : reply(404, null),
    );

  it("reads a whole Abacus page and rates its issues by the worst component", async () => {
    routes({
      "https://status.abaservices.ch/v3/summary.json": ABACUS_SUMMARY,
      "https://status.abaservices.ch/v3/components.json": ABACUS_COMPONENTS,
    });
    const result = await new CloudServiceCall(monitor({ provider: "abacus-cloud" })).execute();
    expect(result).toMatchObject({ status: "DOWN", type: "REALTIME", raw_status: "HASISSUES" });
  });

  it("does not read components while the page is up", async () => {
    routes({ "https://status.deepcloud.swiss/v3/summary.json": { ...ABACUS_SUMMARY, page: { status: "UP" } } });
    const result = await new CloudServiceCall(monitor({ provider: "deepcloud" })).execute();
    expect(result.status).toBe("UP");
    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });

  it("follows Swiss21 through its component on the Abacus page", async () => {
    routes({ "https://status.abaservices.ch/v3/components.json": ABACUS_COMPONENTS });
    const result = await new CloudServiceCall(
      monitor({ provider: "swiss21", component: "Swiss21 Services" }),
    ).execute();
    expect(result).toMatchObject({ status: "DEGRADED", raw_status: "PARTIALOUTAGE" });
  });

  it("tells repeated component names apart by group", async () => {
    routes({ "https://status.test/v3/components.json": ABACUS_COMPONENTS });
    const base = { provider: "instatus-custom", statuspageUrl: "https://status.test/" };
    const svm = await new CloudServiceCall(
      monitor({ ...base, component: "Service Management (SVM) / Kundenportal" }),
    ).execute();
    expect(svm.status).toBe("DOWN");
    const missing = await new CloudServiceCall(monitor({ ...base, component: "Nope" })).execute();
    expect(missing.error_message).toContain("AbaBridge / Kundenportal");
  });

  it("records the configured status when the page cannot be read", async () => {
    mockedAxios.mockResolvedValue(reply(502, null));
    const result = await new CloudServiceCall(monitor({ provider: "abacus-cloud", errorStatus: "DOWN" })).execute();
    expect(result).toMatchObject({ status: "DOWN", type: "ERROR", error_message: "Instatus answered HTTP 502" });
  });
});

describe("Microsoft 365 providers", () => {
  const m365 = (overrides: Partial<CloudServiceMonitor["type_data"]> = {}) =>
    monitor({
      provider: "m365-teams",
      tenantId: "tenant-1",
      clientId: "client-1",
      clientSecret: "$TEST_M365_SECRET",
      ...overrides,
    });
  const token = reply(200, { access_token: "tok", expires_in: 3600 });
  const health = reply(200, {
    value: [
      { id: "Exchange", service: "Exchange Online", status: "ServiceOperational" },
      { id: "microsoftteams", service: "Microsoft Teams", status: "serviceInterruption" },
    ],
  });

  it("signs in with the secret from the environment and reads the service health", async () => {
    process.env.TEST_M365_SECRET = "s3cret";
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);

    const result = await new CloudServiceCall(m365()).execute();

    expect(result).toMatchObject({ status: "DOWN", raw_status: "serviceInterruption" });
    const [tokenUrl, tokenOptions] = mockedAxios.mock.calls[0] as [string, { data: string }];
    expect(tokenUrl).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(tokenOptions.data).toContain("client_secret=s3cret");
    const [graphUrl, graphOptions] = mockedAxios.mock.calls[1] as [string, { headers: Record<string, string> }];
    expect(graphUrl).toContain("/admin/serviceAnnouncement/healthOverviews");
    expect(graphOptions.headers.Authorization).toBe("Bearer tok");
  });

  it("shares one sign-in and one health read across monitors", async () => {
    process.env.TEST_M365_SECRET = "s3cret";
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);

    const teams = await new CloudServiceCall(m365()).execute();
    const exchange = await new CloudServiceCall(m365({ provider: "m365-exchange" })).execute();

    expect(teams.status).toBe("DOWN");
    expect(exchange.status).toBe("UP");
    expect(mockedAxios).toHaveBeenCalledTimes(2);
  });

  it("finds a custom service by its Graph name", async () => {
    process.env.TEST_M365_SECRET = "s3cret";
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);
    const result = await new CloudServiceCall(
      m365({ provider: "m365-custom", m365Service: "exchange online" }),
    ).execute();
    expect(result.status).toBe("UP");
  });

  it("uses the shared connection from the environment when the fields are empty", async () => {
    process.env.M365_TENANT_ID = "shared-tenant";
    process.env.M365_CLIENT_ID = "shared-client";
    process.env.M365_CLIENT_SECRET = "shared-secret";
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);

    const result = await new CloudServiceCall(monitor({ provider: "m365-exchange" })).execute();

    expect(result.status).toBe("UP");
    const [tokenUrl, tokenOptions] = mockedAxios.mock.calls[0] as [string, { data: string }];
    expect(tokenUrl).toBe("https://login.microsoftonline.com/shared-tenant/oauth2/v2.0/token");
    expect(tokenOptions.data).toContain("client_id=shared-client");
    expect(tokenOptions.data).toContain("client_secret=shared-secret");
  });

  it("names the missing shared settings", async () => {
    const result = await new CloudServiceCall(monitor({ provider: "m365-exchange" })).execute();
    expect(result.error_message).toBe(
      "Microsoft 365 connection is missing: set M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET or fill in the fields",
    );
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it("explains a missing environment variable without calling Microsoft", async () => {
    const result = await new CloudServiceCall(m365()).execute();
    expect(result.error_message).toBe("Environment variable TEST_M365_SECRET is not set");
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it("passes on Microsoft's reason when sign-in fails", async () => {
    process.env.TEST_M365_SECRET = "wrong";
    mockedAxios.mockResolvedValueOnce(
      reply(401, {
        error: "invalid_client",
        error_description: "AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x",
      }),
    );
    const result = await new CloudServiceCall(m365()).execute();
    expect(result.error_message).toBe("Microsoft sign-in failed: AADSTS7000215: Invalid client secret provided.");
  });

  it("explains missing permission", async () => {
    process.env.TEST_M365_SECRET = "s3cret";
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(reply(403, { error: { code: "Forbidden" } }));
    const result = await new CloudServiceCall(m365()).execute();
    expect(result.error_message).toContain("ServiceHealth.Read.All");
  });

  it("lists the tenant's services when the chosen one is missing", async () => {
    process.env.TEST_M365_SECRET = "s3cret";
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);
    const result = await new CloudServiceCall(m365({ provider: "m365-planner" })).execute();
    expect(result.error_message).toContain("Available: Exchange Online, Microsoft Teams");
  });
});

describe("Service dispatch", () => {
  it("runs a CLOUD monitor with the Cloud Service check", async () => {
    const { default: Service } = await import("./service");
    const service = new Service({ tag: "cloud-test", monitor_type: "CLOUD", type_data: { provider: "jira" } });
    expect(service.service).toBeInstanceOf(CloudServiceCall);
    // Importing every monitor type takes several seconds on a cold start.
  }, 30000);
});
