import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    getSubscribersForEvent: vi.fn(),
    getMonitorTagsForMethods: vi.fn(),
    getMonitors: vi.fn(),
  },
}));
vi.mock("$lib/server/db/db.js", () => ({ default: db }));

import { GetActiveEmailsForEventType, GetSubscribableMonitors } from "./userSubscriptionsController.js";

const subscriber = (methodId: number, email: string, methodType = "email") => ({
  user: { id: methodId, email },
  method: { id: methodId, method_type: methodType, method_value: email },
  subscription: { id: methodId, event_type: "incidents" },
});

describe("GetActiveEmailsForEventType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getSubscribersForEvent.mockResolvedValue([
      subscriber(1, "everything@example.com"),
      subscriber(2, "printing@example.com"),
      subscriber(3, "confluence@example.com"),
      subscriber(4, "webhook", "webhook"),
    ]);
    db.getMonitorTagsForMethods.mockResolvedValue(
      new Map([
        [2, ["printer"]],
        [3, ["confluence"]],
      ]),
    );
    db.getMonitors.mockResolvedValue([
      { tag: "confluence", type_data: JSON.stringify({ monitors: [{ tag: "confluence-search" }] }) },
    ]);
  });

  it("emails every email subscriber when the event has no monitors", async () => {
    expect(await GetActiveEmailsForEventType("incidents")).toEqual([
      "everything@example.com",
      "printing@example.com",
      "confluence@example.com",
    ]);
    expect(db.getMonitorTagsForMethods).not.toHaveBeenCalled();
  });

  it("emails only subscribers who chose an affected monitor, plus those who chose none", async () => {
    expect(await GetActiveEmailsForEventType("incidents", ["printer"])).toEqual([
      "everything@example.com",
      "printing@example.com",
    ]);
  });

  it("counts a member of a chosen group monitor as chosen", async () => {
    expect(await GetActiveEmailsForEventType("incidents", ["confluence-search"])).toEqual([
      "everything@example.com",
      "confluence@example.com",
    ]);
  });
});

describe("GetSubscribableMonitors", () => {
  it("lists active, visible monitors by name", async () => {
    db.getMonitors.mockResolvedValue([
      { tag: "printer", name: "Windows Print Server", image: "" },
      { tag: "abacus", name: "Abacus produktiv", image: "/a.png" },
    ]);
    expect(await GetSubscribableMonitors()).toEqual([
      { tag: "abacus", name: "Abacus produktiv", image: "/a.png" },
      { tag: "printer", name: "Windows Print Server", image: null },
    ]);
    expect(db.getMonitors).toHaveBeenCalledWith({ status: "ACTIVE", is_hidden: "NO" });
  });
});
