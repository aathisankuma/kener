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

describe("how much a provider's report counts", () => {
  it("keeps the status, lowers degraded, or turns everything into a note", async () => {
    const { ApplyProviderImpact } = await import("./cloudServices");
    expect(ApplyProviderImpact("DEGRADED", "all")).toEqual({ status: "DEGRADED", notice: null });
    expect(ApplyProviderImpact("DEGRADED", "outages")).toEqual({ status: "UP", notice: "DEGRADED" });
    expect(ApplyProviderImpact("DOWN", "outages")).toEqual({ status: "DOWN", notice: null });
    expect(ApplyProviderImpact("DOWN", "info")).toEqual({ status: "UP", notice: "DOWN" });
    expect(ApplyProviderImpact("MAINTENANCE", "info")).toEqual({ status: "UP", notice: "MAINTENANCE" });
    expect(ApplyProviderImpact("UP", "info")).toEqual({ status: "UP", notice: null });
  });

  it("makes Microsoft's open incidents outages and keeps advisories as a note", async () => {
    const { ApplyProviderImpact } = await import("./cloudServices");
    // An incident counts as an outage even when Microsoft calls it degradation.
    expect(ApplyProviderImpact("DEGRADED", "incidents", true)).toEqual({ status: "DOWN", notice: null });
    expect(ApplyProviderImpact("DOWN", "incidents", false)).toEqual({ status: "UP", notice: "DOWN" });
    expect(ApplyProviderImpact("DEGRADED", "incidents", false)).toEqual({ status: "UP", notice: "DEGRADED" });
    expect(ApplyProviderImpact("UP", "incidents", false)).toEqual({ status: "UP", notice: null });
    // No classification (Azure, or the issue list could not be read): as "outages".
    expect(ApplyProviderImpact("DEGRADED", "incidents")).toEqual({ status: "UP", notice: "DEGRADED" });
    expect(ApplyProviderImpact("DOWN", "incidents")).toEqual({ status: "DOWN", notice: null });
  });
});

describe("allestörungen.ch links", () => {
  it("links Microsoft 365 services to their page, in the page's language", async () => {
    const { OutageReportsSlug, OutageReportsUrl } = await import("./cloudServices");
    expect(OutageReportsSlug("m365-teams")).toBe("teams");
    expect(OutageReportsSlug("m365-exchange")).toBe("outlook");
    expect(OutageReportsSlug("m365-onedrive")).toBe("microsoftonedrive");
    // Without a page of its own: Microsoft 365.
    expect(OutageReportsSlug("m365-intune")).toBe("microsoft-365");
    expect(OutageReportsSlug("m365-sharepoint")).toBe("microsoft-365");
    expect(OutageReportsSlug("m365-custom")).toBe("microsoft-365");
    // Only Microsoft 365 for now.
    expect(OutageReportsSlug("jira")).toBeNull();
    expect(OutageReportsSlug("azure-openai")).toBeNull();
    expect(OutageReportsSlug(undefined)).toBeNull();

    expect(OutageReportsUrl("teams", "de")).toBe("https://xn--allestrungen-9ib.ch/stoerung/teams/");
    expect(OutageReportsUrl("teams", "fr")).toBe("https://xn--allestrungen-9ib.ch/fr/statut/teams/");
    expect(OutageReportsUrl("teams", "it")).toBe("https://xn--allestrungen-9ib.ch/it/problemi/teams/");
    expect(OutageReportsUrl("teams", "en")).toBe("https://xn--allestrungen-9ib.ch/en/status/teams/");
    expect(OutageReportsUrl("teams", "pt-BR")).toBe("https://xn--allestrungen-9ib.ch/stoerung/teams/");
    expect(OutageReportsUrl("../x", "de")).toBeNull();
  });
});
