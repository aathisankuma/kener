import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import {
  FetchInstatusComponents,
  FetchInstatusSummary,
  FindInstatusComponent,
  FlattenInstatusComponents,
  InstatusComponentLabel,
  InstatusPageStatus,
  MapInstatusStatus,
  type InstatusSummary,
} from "./instatusClient";
import { ABACUS_COMPONENTS, ABACUS_SUMMARY } from "./instatusFixture";

vi.mock("axios", () => ({ default: vi.fn() }));
const mockedAxios = vi.mocked(axios);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reply = (status: number, data: unknown) => ({ status, data }) as any;

beforeEach(() => mockedAxios.mockReset());

describe("MapInstatusStatus", () => {
  it("maps component states and incident impacts", () => {
    expect(MapInstatusStatus("OPERATIONAL")).toBe("UP");
    expect(MapInstatusStatus("DEGRADEDPERFORMANCE")).toBe("DEGRADED");
    expect(MapInstatusStatus("degradedperformance", true)).toBe("UP");
    expect(MapInstatusStatus("PARTIALOUTAGE", true)).toBe("DEGRADED");
    expect(MapInstatusStatus("MAJOROUTAGE")).toBe("DOWN");
    expect(MapInstatusStatus("UNDERMAINTENANCE")).toBe("MAINTENANCE");
    expect(MapInstatusStatus("bogus")).toBeNull();
  });
});

describe("components", () => {
  const all = FlattenInstatusComponents(ABACUS_COMPONENTS);

  it("lists the parts of each group with the group's name, and ungrouped components", () => {
    expect(all.map((c) => [c.group, c.name])).toEqual([
      ["Zentrale Services", "Abacus IDP"],
      ["Zentrale Services", "AbaClock"],
      ["Ökosystem-Services", "Deep Cloud Services"],
      ["Ökosystem-Services", "Swiss21 Services"],
      ["AbaBridge", "Kundenportal"],
      ["Service Management (SVM)", "Kundenportal"],
      [null, "Abacus City"],
    ]);
    expect(all[0].description).toBeNull();
    expect(FlattenInstatusComponents({ components: ABACUS_COMPONENTS })).toEqual(all);
    expect(FlattenInstatusComponents("nonsense")).toEqual([]);
  });

  it("finds a component by name, id or 'Group / Name' when the name repeats", () => {
    expect(FindInstatusComponent(all, "swiss21 services")?.id).toBe("c-swiss21");
    expect(FindInstatusComponent(all, "c-city")?.name).toBe("Abacus City");
    expect(FindInstatusComponent(all, "Service Management (SVM)/Kundenportal")?.id).toBe("c-kp2");
    expect(FindInstatusComponent(all, "Nope")).toBeNull();
  });

  it("names repeated components with their group", () => {
    expect(all.map((c) => InstatusComponentLabel(c, all))).toContain("AbaBridge / Kundenportal");
    expect(all.map((c) => InstatusComponentLabel(c, all))).toContain("Swiss21 Services");
  });
});

describe("InstatusPageStatus", () => {
  const page = (status: string, extra: Partial<InstatusSummary> = {}): InstatusSummary => ({
    page: { status },
    activeIncidents: [],
    activeMaintenances: [],
    recentlyResolvedIncidents: [],
    ...extra,
  });
  const components = FlattenInstatusComponents(ABACUS_COMPONENTS);

  it("reads UP and maintenance directly", () => {
    expect(InstatusPageStatus(page("UP"), null)).toBe("UP");
    expect(InstatusPageStatus(page("UNDERMAINTENANCE"), null)).toBe("MAINTENANCE");
    expect(InstatusPageStatus(page("WHATEVER"), null)).toBeNull();
  });

  it("takes the worst incident or component when the page has issues", () => {
    expect(InstatusPageStatus(page("HASISSUES"), components)).toBe("DOWN");
    const minor = page("HASISSUES", { activeIncidents: [{ impact: "DEGRADEDPERFORMANCE" }] });
    expect(InstatusPageStatus(minor, [])).toBe("DEGRADED");
    expect(InstatusPageStatus(minor, [], true)).toBe("UP");
    expect(InstatusPageStatus(page("HASISSUES"), null)).toBe("DEGRADED");
  });
});

describe("fetching", () => {
  it("reads /v3 first and falls back to the older paths", async () => {
    mockedAxios.mockImplementation(async (url) => {
      if (url === "https://status.test/v3/summary.json") return reply(404, "not found");
      if (url === "https://status.test/summary.json") return reply(200, ABACUS_SUMMARY);
      if (url === "https://status.test/v3/components.json") return reply(200, "<html>");
      if (url === "https://status.test/v2/components.json") return reply(200, { components: ABACUS_COMPONENTS });
      return reply(404, null);
    });
    const summary = await FetchInstatusSummary("https://status.test", 5000);
    expect(summary.page.name).toBe("Abacus Cloud Services");
    expect(summary.activeMaintenances).toHaveLength(1);
    expect(await FetchInstatusComponents("https://status.test", 5000)).toHaveLength(7);
  });

  it("explains what is wrong when no path answers", async () => {
    mockedAxios.mockResolvedValue(reply(503, null));
    await expect(FetchInstatusSummary("https://status.test", 5000)).rejects.toThrow("Instatus answered HTTP 503");
    mockedAxios.mockResolvedValue(reply(200, { status: { indicator: "none" } }));
    await expect(FetchInstatusSummary("https://status.test", 5000)).rejects.toThrow(
      "Not an Instatus status page response",
    );
  });
});
