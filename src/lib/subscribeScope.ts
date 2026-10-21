// Decides what "Subscribe to this service" does with a visitor's subscription. Safe to import
// from both server and client.

export interface ScopedSubscriptionInput {
  /** Monitors of the page the visitor came from. */
  scopeTags: string[];
  /** Monitors a visitor may choose. */
  availableTags: string[];
  /** Monitors the visitor has chosen; empty means every monitor. */
  chosenTags: string[];
  incidentsEnabled: boolean;
  maintenancesEnabled: boolean;
  availableSubscriptions: { incidents: boolean; maintenances: boolean };
}

export interface ScopedSubscriptionPlan {
  /**
   * - "none": the page has no monitor the visitor can choose.
   * - "only": the visitor got no updates yet and now gets them only for these monitors.
   * - "added": the monitors were added to the visitor's choice.
   * - "already": the visitor already gets updates for these monitors.
   */
  result: "none" | "only" | "added" | "already";
  /** Monitor choice to save, or null when it stays as it is. */
  monitorTags: string[] | null;
  /** Update types to switch on, or null when they stay as they are. */
  enable: { incidents?: boolean; maintenances?: boolean } | null;
}

export function PlanScopedSubscription(input: ScopedSubscriptionInput): ScopedSubscriptionPlan {
  const available = new Set(input.availableTags);
  const scope = [...new Set(input.scopeTags)].filter((tag) => available.has(tag));
  if (scope.length === 0) return { result: "none", monitorTags: null, enable: null };

  const getsNothing = !input.incidentsEnabled && !input.maintenancesEnabled;
  const enable = getsNothing
    ? {
        ...(input.availableSubscriptions.incidents ? { incidents: true } : {}),
        ...(input.availableSubscriptions.maintenances ? { maintenances: true } : {}),
      }
    : null;

  if (input.chosenTags.length === 0) {
    // Someone who gets updates for every monitor keeps them: narrowing them down silently would
    // stop updates they asked for.
    if (!getsNothing) return { result: "already", monitorTags: null, enable: null };
    return { result: "only", monitorTags: scope, enable };
  }

  const missing = scope.filter((tag) => !input.chosenTags.includes(tag));
  if (missing.length === 0) {
    return { result: enable ? "added" : "already", monitorTags: null, enable };
  }
  return { result: "added", monitorTags: [...input.chosenTags, ...missing], enable };
}
