import { describe, expect, it } from "vitest";
import { PlanScopedSubscription, type ScopedSubscriptionInput } from "./subscribeScope";

const base: ScopedSubscriptionInput = {
  scopeTags: ["print"],
  availableTags: ["print", "vpn", "jira"],
  chosenTags: [],
  incidentsEnabled: false,
  maintenancesEnabled: false,
  availableSubscriptions: { incidents: true, maintenances: true },
};

describe("PlanScopedSubscription", () => {
  it("subscribes a new visitor to this service only and switches updates on", () => {
    expect(PlanScopedSubscription(base)).toEqual({
      result: "only",
      monitorTags: ["print"],
      enable: { incidents: true, maintenances: true },
    });
  });

  it("switches on only the update types the site offers", () => {
    const plan = PlanScopedSubscription({ ...base, availableSubscriptions: { incidents: true, maintenances: false } });
    expect(plan.enable).toEqual({ incidents: true });
  });

  it("adds the service to an existing choice", () => {
    expect(PlanScopedSubscription({ ...base, chosenTags: ["vpn"], incidentsEnabled: true })).toEqual({
      result: "added",
      monitorTags: ["vpn", "print"],
      enable: null,
    });
  });

  it("leaves a visitor who gets every service as they are", () => {
    expect(PlanScopedSubscription({ ...base, incidentsEnabled: true })).toEqual({
      result: "already",
      monitorTags: null,
      enable: null,
    });
  });

  it("reports a service that is already chosen", () => {
    const plan = PlanScopedSubscription({ ...base, chosenTags: ["print"], maintenancesEnabled: true });
    expect(plan).toEqual({ result: "already", monitorTags: null, enable: null });
  });

  it("switches updates back on for a chosen service whose updates were off", () => {
    const plan = PlanScopedSubscription({ ...base, chosenTags: ["print"] });
    expect(plan.result).toBe("added");
    expect(plan.enable).toEqual({ incidents: true, maintenances: true });
  });

  it("ignores monitors a visitor cannot choose and keeps a page's order without duplicates", () => {
    expect(PlanScopedSubscription({ ...base, scopeTags: ["hidden"] }).result).toBe("none");
    expect(PlanScopedSubscription({ ...base, scopeTags: ["jira", "hidden", "print", "jira"] }).monitorTags).toEqual([
      "jira",
      "print",
    ]);
  });
});
