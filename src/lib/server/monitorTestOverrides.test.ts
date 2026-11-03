import { describe, expect, it } from "vitest";
import { TestOverrides } from "./monitorTestOverrides";

describe("Test Monitor with unsaved settings", () => {
  it("takes the monitor type and settings the form sends", () => {
    const typeData = { provider: "m365-entra", tenantId: "t", clientId: "c", clientSecret: "s" };
    expect(TestOverrides({ monitor_id: 1, monitor_type: "CLOUD", type_data: typeData })).toEqual({
      monitor_type: "CLOUD",
      type_data: typeData,
    });
  });

  it("keeps the saved values when the form sends nothing usable", () => {
    expect(TestOverrides({ monitor_id: 1 })).toEqual({});
    expect(TestOverrides({ monitor_type: "cloud; drop", type_data: "x" })).toEqual({});
    expect(TestOverrides({ type_data: [1, 2] })).toEqual({});
    expect(TestOverrides(null)).toEqual({});
  });
});
