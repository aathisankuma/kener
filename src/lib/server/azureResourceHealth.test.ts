import { describe, expect, it } from "vitest";
import { AzureComponent, AzureHealthUrl, AzureIncidents, MapAzureAvailability } from "./azureResourceHealth";
import { IsAzureResourceId } from "../cloudServices";

const RESOURCE = "/subscriptions/1111/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/band-openai";

describe("Azure Resource Health", () => {
  it("recognizes resource IDs", () => {
    expect(IsAzureResourceId(RESOURCE)).toBe(true);
    expect(IsAzureResourceId(` ${RESOURCE} `)).toBe(true);
    expect(IsAzureResourceId("/subscriptions/1111/resourceGroups/rg")).toBe(false);
    expect(IsAzureResourceId("https://band-openai.openai.azure.com")).toBe(false);
  });

  it("builds the Resource Health URLs", () => {
    expect(AzureHealthUrl(`${RESOURCE}/`, true)).toBe(
      `https://management.azure.com${RESOURCE}/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2022-10-01`,
    );
    expect(AzureHealthUrl(RESOURCE, false)).toContain("/availabilityStatuses?api-version=");
  });

  it("maps availability, with planned unavailability as maintenance", () => {
    expect(MapAzureAvailability({ availabilityState: "Available" })).toBe("UP");
    expect(MapAzureAvailability({ availabilityState: "Degraded" })).toBe("DEGRADED");
    expect(MapAzureAvailability({ availabilityState: "Unavailable", reasonType: "Unplanned" })).toBe("DOWN");
    expect(MapAzureAvailability({ availabilityState: "Unavailable", category: "Planned" })).toBe("MAINTENANCE");
    expect(MapAzureAvailability({ availabilityState: "Unknown" })).toBeNull();
  });

  it("shows the resource as a component with Azure's explanation", () => {
    const c = AzureComponent(RESOURCE, {
      properties: { availabilityState: "Degraded", summary: "Quota reached.", detailedStatus: "Retry later." },
    });
    expect(c).toEqual({
      id: RESOURCE,
      name: "band-openai",
      description: "Quota reached. Retry later.",
      status: "DEGRADED",
      group: null,
    });
  });

  it("turns the history into incidents that end when the next state begins", () => {
    const incidents = AzureIncidents([
      { id: "a", properties: { availabilityState: "Available", occuredTime: "2026-10-26T10:00:00Z" } },
      {
        id: "b",
        properties: {
          availabilityState: "Unavailable",
          title: "Unavailable",
          summary: "The service is down in Switzerland North.",
          occuredTime: "2026-10-26T09:00:00Z",
        },
      },
      { id: "c", properties: { availabilityState: "Available", occuredTime: "2026-10-20T08:00:00Z" } },
    ]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      id: "b",
      impact: "DOWN",
      resolved: true,
      startedAt: 1793005200,
      resolvedAt: 1793008800,
    });
    expect(incidents[0].updates[0].body).toBe("The service is down in Switzerland North.");

    const ongoing = AzureIncidents([{ id: "now", properties: { availabilityState: "Degraded" } }]);
    expect(ongoing[0]).toMatchObject({ resolved: false, resolvedAt: null, impact: "DEGRADED" });
  });
});
