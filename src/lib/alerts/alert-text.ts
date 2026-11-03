import GC from "$lib/global-constants";
import { tm, tmStatus } from "$lib/uiLocale.svelte";

type AlertTextKind = "label" | "help" | "description";

interface AlertTextInput {
  kind: AlertTextKind;
  alert_for: string;
  alert_value?: string | number;
  failure_threshold?: number;
  success_threshold?: number;
}

export function getAlertText({
  kind,
  alert_for,
  alert_value,
  failure_threshold,
  success_threshold,
}: AlertTextInput): string {
  if (kind === "label") {
    switch (alert_for) {
      case GC.STATUS:
        return tm("Status Value");
      case GC.LATENCY:
        return tm("Latency Threshold (ms)");
      case GC.UPTIME:
        return tm("Uptime Threshold (%)");
      default:
        return tm("Value");
    }
  }

  if (kind === "help") {
    switch (alert_for) {
      case GC.STATUS:
        return tm("Alert when monitor status equals this value");
      case GC.LATENCY:
        return tm("Alert when latency exceeds this value (in milliseconds)");
      case GC.UPTIME:
        return tm("Alert when uptime falls below this percentage");
      default:
        return "";
    }
  }

  const thresholdValue = failure_threshold ?? 0;
  const resolveThreshold = success_threshold ?? 0;
  const value = alert_value ?? "";

  if (alert_for === GC.STATUS) {
    return tm("Alert when %n consecutive checks result in %value. Resolve after %r successful check(s).", {
      n: thresholdValue,
      value: tmStatus(String(value)),
      r: resolveThreshold,
    });
  }

  if (alert_for === GC.LATENCY) {
    return tm(
      "Alert when latency exceeds %value ms for %n consecutive checks. Resolve after %r check(s) below threshold.",
      {
        value,
        n: thresholdValue,
        r: resolveThreshold,
      },
    );
  }

  if (alert_for === GC.UPTIME) {
    return tm("Alert when uptime falls below %value% for %n checks. Resolve after %r check(s) above threshold.", {
      value,
      n: thresholdValue,
      r: resolveThreshold,
    });
  }

  return "";
}
