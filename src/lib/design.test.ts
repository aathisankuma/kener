import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN,
  DESIGN_PRESET_OPTIONS,
  EffectiveDesign,
  IsValidDesign,
  NormalizeDesign,
  PresetOf,
} from "./design";

describe("status page design", () => {
  it("is Kener's own look when nothing is stored", () => {
    expect(NormalizeDesign(undefined)).toEqual(DEFAULT_DESIGN);
    expect(NormalizeDesign("not json")).toEqual(DEFAULT_DESIGN);
    expect(DEFAULT_DESIGN.preset).toBe("standard");
  });

  it("recognises a preset from its options, and calls changed options custom", () => {
    expect(NormalizeDesign({ ...DESIGN_PRESET_OPTIONS.classic }).preset).toBe("classic");
    expect(NormalizeDesign(JSON.stringify(DESIGN_PRESET_OPTIONS.cards)).preset).toBe("cards");
    expect(PresetOf({ ...DESIGN_PRESET_OPTIONS.classic, corners: "square" })).toBe("custom");
  });

  it("has the portal layout as its own design", () => {
    expect(NormalizeDesign({ ...DESIGN_PRESET_OPTIONS.portal }).preset).toBe("portal");
    expect(NormalizeDesign({}).layout).toBe("kener");
    expect(IsValidDesign(JSON.stringify({ layout: "magazine" }))).toBe(false);
  });

  it("drops unknown values and colours that are not #rrggbb", () => {
    const d = NormalizeDesign({ header: "band", banner: "rainbow", brandColor: "red; background:url(x)" });
    expect(d.header).toBe("band");
    expect(d.banner).toBe("outline");
    expect(d.brandColor).toBe("");
    expect(NormalizeDesign({ brandColor: "#0057B8" }).brandColor).toBe("#0057B8");
  });

  it("refuses to store unknown options or colours", () => {
    expect(IsValidDesign(JSON.stringify({ ...DESIGN_PRESET_OPTIONS.bold, brandColor: "#123abc" }))).toBe(true);
    expect(IsValidDesign(JSON.stringify({ header: "sideways" }))).toBe(false);
    expect(IsValidDesign(JSON.stringify({ brandColor: "blue" }))).toBe(false);
    expect(IsValidDesign("[]")).toBe(false);
    expect(IsValidDesign("{")).toBe(false);
  });

  it("uses a signed-in person's own design, keeping the site's brand colour", () => {
    const site = NormalizeDesign({ ...DESIGN_PRESET_OPTIONS.classic, brandColor: "#0052cc" });
    expect(EffectiveDesign(site, "portal", true)).toEqual({
      preset: "portal",
      ...DESIGN_PRESET_OPTIONS.portal,
      brandColor: "#0052cc",
    });
    expect(EffectiveDesign(site, "portal", false)).toBe(site);
    expect(EffectiveDesign(site, "", true)).toBe(site);
    expect(EffectiveDesign(site, "<script>", true)).toBe(site);
  });
});
