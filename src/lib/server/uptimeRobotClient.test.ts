import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import {
  ClearUptimeRobotCache,
  FetchUptimeRobotPage,
  MapUptimeRobotStatus,
  ParseUptimeRobotMonitors,
  UptimeRobotPageIdFromHtml,
  UptimeRobotPageStatus,
} from "./uptimeRobotClient";
import CloudServiceCall from "./services/cloudServiceCall";
import { ClearCloudDetailsCache, GetCloudServiceDetails } from "./cloudServiceDetails";
import { ListCloudComponents } from "./cloudComponents";
import { SWISS21_HTML, SWISS21_LIST } from "./uptimeRobotFixture";
import type { CloudServiceMonitor } from "./types/monitor";

vi.mock("axios", () => ({ default: vi.fn() }));
const mockedAxios = vi.mocked(axios);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reply = (status: number, data: unknown) => ({ status, data }) as any;

/** status.swiss21.org: the page, then its monitor list (with optional status overrides). */
function swiss21(overrides: Record<string, string> = {}) {
  mockedAxios.mockImplementation(async (url) => {
    const u = String(url);
    if (u === "https://status.swiss21.org") return reply(200, SWISS21_HTML);
    if (u.startsWith("https://status.swiss21.org/api/getMonitorList/9DxKOsmRzV?page=1")) {
      return reply(200, SWISS21_LIST(overrides));
    }
    return reply(404, "not found");
  });
}

const check = (type_data: Partial<CloudServiceMonitor["type_data"]>) =>
  new CloudServiceCall({ tag: "swiss21", type_data: { provider: "swiss21", ...type_data } }).execute();

beforeEach(() => {
  mockedAxios.mockReset();
  ClearUptimeRobotCache();
  ClearCloudDetailsCache();
});

describe("reading an UptimeRobot page", () => {
  it("finds the page id in the page", () => {
    expect(UptimeRobotPageIdFromHtml(SWISS21_HTML)).toBe("9DxKOsmRzV");
    expect(UptimeRobotPageIdFromHtml('<input id="pspi" type="hidden" value="Ab_c-1">')).toBe("Ab_c-1");
    expect(UptimeRobotPageIdFromHtml("<html>no id</html>")).toBeNull();
  });

  it("reads monitors with their status and latest outage in UTC", () => {
    const { monitors, total } = ParseUptimeRobotMonitors(SWISS21_LIST());
    expect(total).toBe(4);
    expect(monitors.map((m) => [m.name, m.statusClass])).toEqual([
      ["AbaNinja", "success"],
      ["AbaNinja - WebAPI", "success"],
      ["Portal", "success"],
      ["Shop - Testshop", "black"],
    ]);
    expect(monitors[1].lastDowntime).toEqual({
      at: Date.UTC(2026, 9, 21, 11, 7, 55) / 1000,
      durationSeconds: 15620,
      reason: "Incident detected",
    });
    expect(() => ParseUptimeRobotMonitors({ status: "fail" })).toThrow("Not an UptimeRobot status page answer");
  });

  it("maps UptimeRobot classes to Kener statuses", () => {
    expect(MapUptimeRobotStatus("success")).toBe("UP");
    expect(MapUptimeRobotStatus("danger")).toBe("DOWN");
    expect(MapUptimeRobotStatus("warning")).toBe("DEGRADED");
    expect(MapUptimeRobotStatus("black")).toBeNull();
  });

  it("rates the whole page without paused monitors", () => {
    const all = ParseUptimeRobotMonitors(SWISS21_LIST()).monitors;
    expect(UptimeRobotPageStatus(all)).toEqual({ status: "UP", raw: "all 3 up" });
    const some = ParseUptimeRobotMonitors(SWISS21_LIST({ Portal: "danger" })).monitors;
    expect(UptimeRobotPageStatus(some)).toEqual({ status: "DEGRADED", raw: "1 of 3 not up (Portal)" });
    const none = ParseUptimeRobotMonitors(
      SWISS21_LIST({ AbaNinja: "danger", "AbaNinja - WebAPI": "danger", Portal: "danger" }),
    ).monitors;
    expect(UptimeRobotPageStatus(none)?.status).toBe("DOWN");
  });

  it("reads every page of a long list and remembers the page id", async () => {
    const first = SWISS21_LIST();
    first.psp.totalMonitors = 5;
    const second = {
      ...SWISS21_LIST(),
      psp: { ...SWISS21_LIST().psp, monitors: [{ ...first.psp.monitors[0], monitorId: 9, name: "Website" }] },
    };
    mockedAxios.mockImplementation(async (url) => {
      const u = String(url);
      if (u === "https://status.swiss21.org") return reply(200, SWISS21_HTML);
      if (u.includes("page=1")) return reply(200, first);
      if (u.includes("page=2")) return reply(200, second);
      return reply(404, "");
    });
    const page = await FetchUptimeRobotPage("https://status.swiss21.org", 5000);
    expect(page.monitors.map((m) => m.name)).toContain("Website");
    expect(page.monitors).toHaveLength(5);
    await FetchUptimeRobotPage("https://status.swiss21.org", 5000);
    const htmlReads = mockedAxios.mock.calls.filter(([u]) => String(u) === "https://status.swiss21.org");
    expect(htmlReads).toHaveLength(1);
  });

  it("takes the page id from a stats.uptimerobot.com address", async () => {
    mockedAxios.mockImplementation(async (url) =>
      String(url) === "https://stats.uptimerobot.com/api/getMonitorList/9DxKOsmRzV?page=1"
        ? reply(200, SWISS21_LIST())
        : reply(404, ""),
    );
    const page = await FetchUptimeRobotPage("https://stats.uptimerobot.com/9DxKOsmRzV", 5000);
    expect(page.monitors).toHaveLength(4);
  });

  it("says so when a page is not an UptimeRobot page", async () => {
    mockedAxios.mockResolvedValue(reply(200, "<html>Statuspage</html>"));
    await expect(FetchUptimeRobotPage("https://status.example.test", 5000)).rejects.toThrow(
      "Not an UptimeRobot status page",
    );
  });
});

describe("the Swiss21 Cloud Service monitor", () => {
  it("follows the whole Swiss21 page", async () => {
    swiss21({ Portal: "danger" });
    expect(await check({})).toMatchObject({ status: "DEGRADED", raw_status: "1 of 3 not up (Portal)" });
  });

  it("follows chosen Swiss21 services and takes the worst", async () => {
    swiss21({ Portal: "danger" });
    expect(await check({ components: ["AbaNinja"] })).toMatchObject({ status: "UP" });
    expect(await check({ components: ["abaninja", "Portal"] })).toMatchObject({
      status: "DOWN",
      raw_status: "danger (Portal)",
    });
  });

  it("follows the whole page for a monitor saved with the old Abacus component", async () => {
    swiss21();
    expect(await check({ component: "Swiss21 Services" })).toMatchObject({ status: "UP", raw_status: "all 3 up" });
  });

  it("names unknown and paused services", async () => {
    swiss21();
    const missing = await check({ components: ["DeepPay"] });
    expect(missing).toMatchObject({ status: "DEGRADED", type: "ERROR" });
    expect(missing.error_message).toContain('"DeepPay" not found. Available: AbaNinja, AbaNinja - WebAPI');
    const paused = await check({ components: ["Shop - Testshop"] });
    expect(paused.error_message).toBe("Not checked by the provider right now (paused): Shop - Testshop");
  });

  it("lists the Swiss21 services for the component picker", async () => {
    swiss21();
    expect(await ListCloudComponents({ provider: "swiss21" } as never)).toEqual([
      "AbaNinja",
      "AbaNinja - WebAPI",
      "Portal",
      "Shop - Testshop",
    ]);
  });

  it("shows the services and recent outages on the service page", async () => {
    swiss21();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T06:00:00Z"));
    try {
      const details = await GetCloudServiceDetails("swiss21-test", { provider: "swiss21" } as never);
      expect(details.provider).toEqual({
        label: "Swiss21",
        kind: "uptimerobot",
        pageUrl: "https://status.swiss21.org",
      });
      expect(details.components.map((c) => [c.name, c.status])).toEqual([
        ["AbaNinja", "UP"],
        ["AbaNinja - WebAPI", "UP"],
        ["Portal", "UP"],
        ["Shop - Testshop", "UP"],
      ]);
      expect(details.components[3].description).toBe("Paused by the provider");
      expect(details.incidents).toEqual([
        expect.objectContaining({
          title: "AbaNinja - WebAPI: Incident detected",
          resolved: true,
          startedAt: Date.UTC(2026, 9, 21, 11, 7, 55) / 1000,
          resolvedAt: Date.UTC(2026, 9, 21, 11, 7, 55) / 1000 + 15620,
          affected: ["AbaNinja - WebAPI"],
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
