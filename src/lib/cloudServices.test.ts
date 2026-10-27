import { describe, expect, it } from "vitest";
import { CloudMonitorName, SuggestMonitorTag } from "./cloudServices";

describe("names for new Cloud Service monitors", () => {
  it("names a monitor after the service without the explanation in brackets", () => {
    expect(CloudMonitorName("swiss21")).toBe("Swiss21");
    expect(CloudMonitorName("deepcloud")).toBe("DeepCloud");
    expect(CloudMonitorName("m365-teams")).toBe("Microsoft Teams");
    expect(CloudMonitorName("statuspage-custom")).toBe("");
    expect(CloudMonitorName(undefined)).toBe("");
  });

  it("makes a valid tag from a name", () => {
    expect(SuggestMonitorTag("Exchange Online")).toBe("exchange-online");
    expect(SuggestMonitorTag("Ökosystem / Kundenportal ")).toBe("oekosystem-kundenportal");
    expect(SuggestMonitorTag("Café 2")).toBe("cafe-2");
  });
});
