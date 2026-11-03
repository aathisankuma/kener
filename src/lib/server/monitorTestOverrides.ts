// "Test Monitor" checks what the form shows, even before it is saved. The form sends its current
// monitor type and type settings; anything that is not a usable value falls back to the saved one.

export interface MonitorTestOverrides {
  monitor_type?: string;
  type_data?: Record<string, unknown>;
}

export function TestOverrides(data: Record<string, unknown> | null | undefined): MonitorTestOverrides {
  const result: MonitorTestOverrides = {};
  const type = data?.monitor_type;
  if (typeof type === "string" && /^[A-Z][A-Z_]*$/.test(type)) result.monitor_type = type;
  const typeData = data?.type_data;
  if (typeData && typeof typeData === "object" && !Array.isArray(typeData)) {
    result.type_data = typeData as Record<string, unknown>;
  }
  return result;
}
