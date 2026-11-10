import { describe, expect, it } from "vitest";
import { SectionByTag, SectionTitleOf, SplitIntoSections } from "./pageSections";

describe("sections on a status page", () => {
  it("reads the title stored with a service", () => {
    expect(SectionTitleOf('{"sectionTitle":" IT "}')).toBe("IT");
    expect(SectionTitleOf({ sectionTitle: "Atlassian" })).toBe("Atlassian");
    expect(SectionTitleOf(null)).toBe("");
    expect(SectionTitleOf("not json")).toBe("");
  });

  it("gives every service the section started at or before it, hidden ones included", () => {
    const byTag = SectionByTag([
      { tag: "csm", title: "" },
      { tag: "hidden", title: "IT" },
      { tag: "jira", title: "" },
      { tag: "confluence", title: "Atlassian" },
    ]);
    expect(byTag).toEqual({ csm: "", hidden: "IT", jira: "IT", confluence: "Atlassian" });
    // The service with the title is hidden: its section still starts.
    expect(SplitIntoSections(["csm", "jira", "confluence"], byTag)).toEqual([
      { title: "", tags: ["csm"] },
      { title: "IT", tags: ["jira"] },
      { title: "Atlassian", tags: ["confluence"] },
    ]);
  });

  it("leaves out sections with nothing shown and works without titles", () => {
    expect(SplitIntoSections(["a", "b"], { a: "IT", b: "IT" })).toEqual([{ title: "IT", tags: ["a", "b"] }]);
    expect(SplitIntoSections(["a", "b"], undefined)).toEqual([{ title: "", tags: ["a", "b"] }]);
    expect(SplitIntoSections([], {})).toEqual([]);
  });
});
