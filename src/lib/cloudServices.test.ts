import { describe, expect, it } from "vitest";
import { ChosenComponents, CloudMonitorName, CloudServicesInUse, SuggestMonitorTag } from "./cloudServices";

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

describe("CloudServicesInUse", () => {
  it("lists the monitors that follow each listed service", () => {
    const used = CloudServicesInUse([
      { name: "Jira", monitor_type: "CLOUD", type_data: '{"provider":"jira"}' },
      { name: "Jira Suche", monitor_type: "CLOUD", type_data: '{"provider":"jira","component":" Search "}' },
      { name: "Jira Teile", monitor_type: "CLOUD", type_data: '{"provider":"jira","components":["Search","Mobile"]}' },
      { name: "Swiss21", monitor_type: "CLOUD", type_data: '{"provider":"swiss21","component":"Swiss21 Services"}' },
      { name: "Eigene Seite", monitor_type: "CLOUD", type_data: '{"provider":"statuspage-custom"}' },
      { name: "Website", monitor_type: "API", type_data: '{"provider":"jira"}' },
      { name: "Kaputt", monitor_type: "CLOUD", type_data: "{not json" },
      { name: "OpenAI prod", monitor_type: "CLOUD", type_data: '{"provider":"azure-openai","azureResourceId":"/x"}' },
    ]);
    expect(Object.fromEntries(used)).toEqual({
      jira: [
        { name: "Jira", component: "" },
        { name: "Jira Suche", component: "Search" },
        { name: "Jira Teile", component: "Search, Mobile" },
      ],
      swiss21: [{ name: "Swiss21", component: "Swiss21 Services" }],
    });
  });
});

describe("ChosenComponents", () => {
  it("reads the list, falls back to the older single component, and drops blanks and repeats", () => {
    expect(ChosenComponents({ components: [" Search ", "search", "", "Mobile"] })).toEqual(["Search", "Mobile"]);
    expect(ChosenComponents({ component: "Search" })).toEqual(["Search"]);
    expect(ChosenComponents({ components: [], component: "Search" })).toEqual(["Search"]);
    expect(ChosenComponents({ component: "" })).toEqual([]);
    expect(ChosenComponents(undefined)).toEqual([]);
  });
});
