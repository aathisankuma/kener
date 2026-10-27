import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { ClearCloudDetailsCache, GetCloudServiceDetails } from "./cloudServiceDetails";
import { ClearCloudProviderCache } from "./cloudProviderClient";
import { ABACUS_COMPONENTS, ABACUS_SUMMARY } from "./instatusFixture";

vi.mock("axios", () => ({ default: vi.fn() }));
const mockedAxios = vi.mocked(axios);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reply = (status: number, data: unknown) => ({ status, data }) as any;

beforeEach(() => {
  mockedAxios.mockReset();
  ClearCloudDetailsCache();
  ClearCloudProviderCache();
});
afterEach(() => {
  delete process.env.M365_TENANT_ID;
  delete process.env.M365_CLIENT_ID;
  delete process.env.M365_CLIENT_SECRET;
});

const summary = {
  components: [
    { id: "g1", name: "Core", status: "operational", group: true, position: 1 },
    {
      id: "c1",
      name: "Viewing content",
      description: "Viewing issues and boards",
      status: "operational",
      position: 2,
      group_id: "g1",
    },
    { id: "c2", name: "Search", description: null, status: "major_outage", position: 3 },
    { id: "c3", name: "Marketplace", status: "operational", position: 4, only_show_if_degraded: true },
  ],
  scheduled_maintenances: [
    {
      id: "m1",
      name: "Database upgrade",
      status: "scheduled",
      impact: "maintenance",
      scheduled_for: "2026-10-25T02:00:00Z",
      scheduled_until: "2026-10-25T04:00:00Z",
      components: [{ id: "c1", name: "Viewing content" }],
      incident_updates: [{ status: "scheduled", body: "We will upgrade.", created_at: "2026-10-20T10:00:00Z" }],
    },
  ],
};
const incidents = {
  incidents: [
    {
      id: "i1",
      name: "Search is failing",
      status: "investigating",
      impact: "major",
      created_at: "2026-10-21T08:00:00Z",
      shortlink: "https://stspg.io/abc",
      components: [{ id: "c2", name: "Search" }],
      incident_updates: [
        { status: "identified", body: "Fix in progress.", created_at: "2026-10-21T08:30:00Z" },
        { status: "investigating", body: "Looking into it.", created_at: "2026-10-21T08:00:00Z" },
      ],
    },
    {
      id: "i2",
      name: "Slow boards",
      status: "resolved",
      impact: "minor",
      created_at: "2026-10-18T08:00:00Z",
      resolved_at: "2026-10-18T09:00:00Z",
      components: [{ id: "c1", name: "Viewing content" }],
      incident_updates: [{ status: "resolved", body: "Fixed.", created_at: "2026-10-18T09:00:00Z" }],
    },
  ],
};

describe("GetCloudServiceDetails: Statuspage", () => {
  it("lists components, incidents and maintenances like the provider's page", async () => {
    mockedAxios.mockImplementation(async (url) =>
      String(url).endsWith("summary.json") ? reply(200, summary) : reply(200, incidents),
    );

    const details = await GetCloudServiceDetails("jira", { provider: "jira" });

    expect(details.provider).toEqual({
      label: "Jira",
      kind: "statuspage",
      pageUrl: "https://jira-software.status.atlassian.com",
    });
    expect(details.components).toEqual([
      { id: "c1", name: "Viewing content", description: "Viewing issues and boards", status: "UP", group: "Core" },
      { id: "c2", name: "Search", description: null, status: "DOWN", group: null },
    ]);
    expect(details.incidents[0]).toMatchObject({
      id: "i1",
      title: "Search is failing",
      impact: "DOWN",
      resolved: false,
      url: "https://stspg.io/abc",
      affected: ["Search"],
    });
    expect(details.incidents[0].updates.map((u) => u.status)).toEqual(["identified", "investigating"]);
    expect(details.incidents[1]).toMatchObject({ resolved: true, impact: "DEGRADED", resolvedAt: 1792314000 });
    expect(details.maintenances[0]).toMatchObject({
      title: "Database upgrade",
      impact: "MAINTENANCE",
      scheduledFor: 1792893600,
    });
  });

  it("narrows everything to the monitor's component", async () => {
    mockedAxios.mockImplementation(async (url) =>
      String(url).endsWith("summary.json") ? reply(200, summary) : reply(200, incidents),
    );

    const details = await GetCloudServiceDetails("jira-search", { provider: "jira", component: "Search" });

    expect(details.components.map((c) => c.name)).toEqual(["Search"]);
    expect(details.incidents.map((i) => i.id)).toEqual(["i1"]);
    expect(details.maintenances).toEqual([]);
  });

  it("names a custom Statuspage by its own page name", async () => {
    mockedAxios.mockImplementation(async (url) =>
      String(url).endsWith("summary.json")
        ? reply(200, { ...summary, page: { name: "Acme Cloud" } })
        : reply(200, incidents),
    );
    const details = await GetCloudServiceDetails("acme", {
      provider: "statuspage-custom",
      statuspageUrl: "https://status.acme.test",
    });
    expect(details.provider.label).toBe("Acme Cloud");
  });

  it("asks the provider at most once a minute per monitor", async () => {
    mockedAxios.mockImplementation(async (url) =>
      String(url).endsWith("summary.json") ? reply(200, summary) : reply(200, incidents),
    );
    await GetCloudServiceDetails("jira", { provider: "jira" });
    await GetCloudServiceDetails("jira", { provider: "jira" });
    expect(mockedAxios).toHaveBeenCalledTimes(2);
  });

  it("fails with the HTTP status when the page cannot be read", async () => {
    mockedAxios.mockResolvedValue(reply(503, "down"));
    await expect(GetCloudServiceDetails("jira", { provider: "jira" })).rejects.toThrow("Statuspage answered HTTP 503");
  });
});

describe("GetCloudServiceDetails: Microsoft 365", () => {
  it("shows the service, its affected feature groups and Microsoft's issues", async () => {
    process.env.M365_TENANT_ID = "t";
    process.env.M365_CLIENT_ID = "c";
    process.env.M365_CLIENT_SECRET = "s";
    mockedAxios.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/oauth2/v2.0/token")) return reply(200, { access_token: "tok", expires_in: 3600 });
      if (u.includes("healthOverviews?$select"))
        return reply(200, {
          value: [{ id: "microsoftteams", service: "Microsoft Teams", status: "serviceDegradation" }],
        });
      if (u.includes("healthOverviews/Microsoft%20Teams?$expand=issues"))
        return reply(200, {
          id: "microsoftteams",
          service: "Microsoft Teams",
          status: "serviceDegradation",
          issues: [
            {
              id: "TM123",
              title: "Users can't join meetings",
              classification: "Incident",
              status: "serviceDegradation",
              startDateTime: "2026-10-21T07:00:00Z",
              isResolved: false,
              featureGroup: "Teams Components",
              feature: "Meetings",
              posts: [
                {
                  createdDateTime: "2026-10-21T07:30:00Z",
                  description: { contentType: "Html", content: "<p>We're investigating.</p>" },
                },
              ],
            },
            {
              id: "TM100",
              title: "Chat delays",
              classification: "Advisory",
              status: "serviceRestored",
              startDateTime: "2026-10-15T07:00:00Z",
              endDateTime: "2026-10-15T09:00:00Z",
              isResolved: true,
              featureGroup: "Teams Components",
              feature: "Chat",
            },
          ],
        });
      return reply(404, {});
    });

    const details = await GetCloudServiceDetails("teams", { provider: "m365-teams" });

    expect(details.components).toEqual([
      { id: "microsoftteams", name: "Microsoft Teams", description: null, status: "DEGRADED", group: null },
      {
        id: "microsoftteams:Teams Components",
        name: "Teams Components",
        description: null,
        status: "DEGRADED",
        group: "Microsoft Teams",
      },
    ]);
    expect(details.incidents[0]).toMatchObject({
      id: "TM123",
      title: "Users can't join meetings",
      resolved: false,
      affected: ["Teams Components › Meetings"],
    });
    expect(details.incidents[0].updates[0]).toMatchObject({ body: "<p>We're investigating.</p>", isHtml: true });
    expect(details.incidents[1]).toMatchObject({ id: "TM100", resolved: true, impact: "DEGRADED" });
  });
});

describe("GetCloudServiceDetails: Instatus", () => {
  const abacus = () =>
    mockedAxios.mockImplementation(async (url) => {
      if (url === "https://status.abaservices.ch/v3/summary.json") return reply(200, ABACUS_SUMMARY);
      if (url === "https://status.abaservices.ch/v3/components.json") return reply(200, ABACUS_COMPONENTS);
      return reply(404, null);
    });

  it("shows the Abacus page's components, incidents and planned maintenance", async () => {
    abacus();
    const details = await GetCloudServiceDetails("abacus", { provider: "abacus-cloud" });

    expect(details.provider).toEqual({
      label: "Abacus Cloud Services",
      kind: "instatus",
      pageUrl: "https://status.abaservices.ch",
    });
    expect(details.incidentsFromPage).toBeNull();
    expect(details.components).toHaveLength(7);
    expect(details.components[3]).toEqual({
      id: "c-swiss21",
      name: "Swiss21 Services",
      description: "Swiss21 cloud apps",
      status: "DEGRADED",
      group: "Ökosystem-Services",
    });
    expect(details.incidents.map((i) => [i.title, i.resolved, i.impact])).toEqual([
      ["Swiss21 teilweise nicht erreichbar", false, "DEGRADED"],
      ["AbaClock langsam", true, "DEGRADED"],
    ]);
    expect(details.incidents[0].updates).toEqual([
      { status: "IDENTIFIED", body: "Die Ursache ist bekannt.", isHtml: false, at: 1793003400 },
    ]);
    expect(details.incidents[1].resolvedAt).toBe(1792486800);
    expect(details.maintenances[0]).toMatchObject({
      title: "Monatliches Release",
      scheduledFor: 1793271600,
      scheduledUntil: 1793275200,
    });
  });

  it("shows only Swiss21 for the Swiss21 monitor and says whose incidents are listed", async () => {
    abacus();
    const details = await GetCloudServiceDetails("swiss21", {
      provider: "swiss21",
      component: "Swiss21 Services",
    });
    expect(details.provider.label).toBe("Swiss21 (via Abacus status page)");
    expect(details.components.map((c) => c.name)).toEqual(["Swiss21 Services"]);
    expect(details.incidentsFromPage).toBe("Abacus Cloud Services");
  });
});
