import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("axios", () => ({ default: { get } }));

import {
  ClearUnifiCache,
  FetchUnifiDevices,
  IsUnifiAccessPoint,
  LocationFromName,
  MapUnifiStatus,
  ParseUnifiDevices,
} from "./unifiClient";

const page = (devices: Record<string, unknown>[], nextToken?: string, hostName = "UDM Bern") => ({
  data: [{ hostId: "h1", hostName, devices }],
  httpStatusCode: 200,
  ...(nextToken ? { nextToken } : {}),
});

describe("UniFi devices", () => {
  beforeEach(() => {
    ClearUnifiCache();
    get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("flattens the devices of every console", () => {
    const devices = ParseUnifiDevices({
      data: [
        {
          hostId: "h1",
          hostName: "Bern",
          devices: [{ id: "A1", mac: "aa", name: "Bern-AP1", model: "U6 Pro", status: "online" }],
        },
        { hostId: "h2", hostName: "Thun", devices: [{ mac: "bb", model: "U7 Pro", status: "OFFLINE" }] },
      ],
    });
    expect(devices).toMatchObject([
      { id: "A1", name: "Bern-AP1", hostName: "Bern", status: "online" },
      { id: "bb", name: "U7 Pro", hostName: "Thun", status: "offline" },
    ]);
    expect(ParseUnifiDevices({})).toEqual([]);
  });

  it("tells access points from consoles, switches and gateways", () => {
    const ap = (model: string, shortname = "", isConsole = false) =>
      IsUnifiAccessPoint({ model, shortname, isConsole });
    for (const model of ["U6 Pro", "U6-Lite", "U7 Pro Max", "UAP-AC-Pro", "AC Lite AP", "E7", "UAP nanoHD"]) {
      expect(ap(model), model).toBe(true);
    }
    for (const model of ["USW Pro 24", "UDM Pro", "UXG Lite", "UCG Ultra", "USG"]) {
      expect(ap(model), model).toBe(false);
    }
    expect(ap("U6 Pro", "", true)).toBe(false);
  });

  it("maps the device state", () => {
    expect(MapUnifiStatus("online")).toBe("UP");
    expect(MapUnifiStatus("offline")).toBe("DOWN");
    expect(MapUnifiStatus("updating")).toBe("MAINTENANCE");
    expect(MapUnifiStatus("pending")).toBe("DEGRADED");
  });

  it("guesses the location from the name", () => {
    expect(LocationFromName("Bern-HausA-2OG-AP1")).toBe("Bern HausA 2OG");
    expect(LocationFromName("Thun_Lager_3")).toBe("Thun Lager");
    expect(LocationFromName("Empfang")).toBe("Empfang");
    expect(LocationFromName("AP-07")).toBe("");
  });

  it("follows the pages and shares one list between monitors for a minute", async () => {
    get
      .mockResolvedValueOnce({ data: page([{ id: "1", name: "a", status: "online" }], "next") })
      .mockResolvedValueOnce({ data: page([{ id: "2", name: "b", status: "offline" }]) });

    const first = await FetchUnifiDevices("key");
    const again = await FetchUnifiDevices("key");

    expect(first.map((d) => d.id)).toEqual(["1", "2"]);
    expect(again).toBe(first);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][0]).toBe("https://api.ui.com/v1/devices");
    expect(get.mock.calls[0][1].headers["X-API-Key"]).toBe("key");
    expect(get.mock.calls[1][1].params.nextToken).toBe("next");
  });

  it("falls back to the early-access path, and says when the key is refused", async () => {
    get
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ data: page([{ id: "1", status: "online" }]) });
    expect(await FetchUnifiDevices("ea-key")).toHaveLength(1);
    expect(get.mock.calls[1][0]).toBe("https://api.ui.com/ea/devices");

    get.mockRejectedValueOnce({ response: { status: 401 } });
    await expect(FetchUnifiDevices("bad")).rejects.toThrow("UniFi did not accept the API key");
    // A failure is not kept: the next check asks again.
    get.mockResolvedValueOnce({ data: page([]) });
    expect(await FetchUnifiDevices("bad")).toEqual([]);
  });
});
