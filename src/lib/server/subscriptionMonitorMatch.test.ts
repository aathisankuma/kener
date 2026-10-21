import { describe, expect, it } from "vitest";
import { ExpandWithGroupMembers, SubscriberWantsEvent, type GroupMembers } from "./subscriptionMonitorMatch";

const groups: GroupMembers = new Map([
  ["confluence", ["confluence-web", "confluence-search"]],
  ["office", ["printer", "confluence"]],
]);

describe("ExpandWithGroupMembers", () => {
  it("adds the members of nested groups", () => {
    expect([...ExpandWithGroupMembers(["office"], groups)].sort()).toEqual([
      "confluence",
      "confluence-search",
      "confluence-web",
      "office",
      "printer",
    ]);
  });

  it("stops on a group that contains itself", () => {
    const loop: GroupMembers = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);
    expect([...ExpandWithGroupMembers(["a"], loop)].sort()).toEqual(["a", "b"]);
  });
});

describe("SubscriberWantsEvent", () => {
  it("sends every event to a subscriber who chose no monitors", () => {
    expect(SubscriberWantsEvent([], ["printer"], groups)).toBe(true);
    expect(SubscriberWantsEvent(undefined, ["printer"], groups)).toBe(true);
  });

  it("sends an event with no monitors to every subscriber", () => {
    expect(SubscriberWantsEvent(["printer"], [], groups)).toBe(true);
    expect(SubscriberWantsEvent(["printer"], null, groups)).toBe(true);
  });

  it("sends an event on a chosen monitor", () => {
    expect(SubscriberWantsEvent(["printer"], ["printer"], groups)).toBe(true);
  });

  it("skips an event on a monitor that was not chosen", () => {
    expect(SubscriberWantsEvent(["printer"], ["confluence-web"], groups)).toBe(false);
  });

  it("sends an event on a member of a chosen group", () => {
    expect(SubscriberWantsEvent(["confluence"], ["confluence-search"], groups)).toBe(true);
  });

  it("sends an event on a group to the subscribers of its members", () => {
    expect(SubscriberWantsEvent(["confluence-web"], ["confluence"], groups)).toBe(true);
  });

  it("skips an event on a sibling member of the same group", () => {
    expect(SubscriberWantsEvent(["confluence-web"], ["confluence-search"], groups)).toBe(false);
  });
});
