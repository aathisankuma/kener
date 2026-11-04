import { describe, expect, it } from "vitest";
import { AlwaysShownTagsOf, ParseHidden, SelectionKey, VisibleTags } from "./serviceSelection";

describe("which services a visitor sees", () => {
  const all = ["teams", "exchange", "sharepoint", "jira"];

  it("hides what the visitor hid, in the page's order", () => {
    expect(VisibleTags(all, ["exchange", "jira"], [])).toEqual(["teams", "sharepoint"]);
    expect(VisibleTags(all, [], [])).toEqual(all);
  });

  it("never hides a service the administrator marked always shown", () => {
    expect(VisibleTags(all, ["teams", "jira"], ["teams"])).toEqual(["teams", "exchange", "sharepoint"]);
  });

  it("shows services added later, because only hidden ones are stored", () => {
    expect(VisibleTags([...all, "zoom"], ["jira"], [])).toContain("zoom");
  });

  it("reads the always-shown flag from parsed or stored monitor settings", () => {
    expect(
      AlwaysShownTagsOf([
        { tag: "teams", monitor_settings_json: { always_shown: true } },
        { tag: "jira", monitor_settings_json: JSON.stringify({ always_shown: true, problem_button: true }) },
        { tag: "zoom", monitor_settings_json: { always_shown: "yes" } },
        { tag: "x", monitor_settings_json: "{broken" },
        { tag: "y" },
      ]),
    ).toEqual(["teams", "jira"]);
  });

  it("keeps one choice per page and survives broken storage", () => {
    expect(SelectionKey("")).toBe("kener-hidden-services:/");
    expect(SelectionKey("it")).toBe("kener-hidden-services:it");
    expect(ParseHidden('["a", 3, "b"]')).toEqual(["a", "b"]);
    expect(ParseHidden("{")).toEqual([]);
    expect(ParseHidden(null)).toEqual([]);
  });
});
