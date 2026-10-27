// What a service manager may do: set the status, post incidents and plan maintenance for the
// monitors assigned to them (users_monitors), and nothing else. Every action checks the
// assignment, so the dashboard API can grant the actions with one permission.
import db from "../db/db.js";
import GC from "../../global-constants.js";
import { GetMinuteStartNowTimestampUTC, GetNowTimestampUTC } from "../tool.js";
import { UpdateMonitoringData } from "./monitorsController.js";
import {
  AddIncidentComment,
  AddIncidentMonitor,
  CreateIncident,
  GetIncidentActiveComments,
} from "./incidentController.js";
import { CreateMaintenance, UpdateMaintenanceEventStatus } from "./maintenanceController.js";

export const SERVICE_STATUSES = [GC.UP, GC.DEGRADED, GC.DOWN, GC.MAINTENANCE] as const;
export const INCIDENT_IMPACTS = [GC.DEGRADED, GC.DOWN] as const;
export const INCIDENT_STATES = [GC.INVESTIGATING, GC.IDENTIFIED, GC.MONITORING, GC.RESOLVED] as const;

/** How far ahead the page lists planned maintenance. */
const MAINTENANCE_LOOKAHEAD_S = 90 * 24 * 60 * 60;

export interface MyServiceIncident {
  id: number;
  title: string;
  state: string;
  impact: string | null;
  startedAt: number;
  updates: Array<{ id: number; text: string; state: string; at: number }>;
}

export interface MyServiceMaintenance {
  eventId: number;
  maintenanceId: number;
  title: string;
  description: string | null;
  startsAt: number;
  endsAt: number;
  status: string;
  /** Only maintenance that concerns this person's services alone can be cancelled here. */
  canCancel: boolean;
}

export interface MyService {
  tag: string;
  name: string;
  image: string | null;
  /** Current status from the latest check or report, "NO_DATA" before the first. */
  status: string;
  statusSince: number | null;
  /** True when Kener does not check the service itself (type None): its status is set by hand. */
  manualStatus: boolean;
  openIncidents: MyServiceIncident[];
  maintenances: MyServiceMaintenance[];
}

/** The monitor tags a user manages; throws when the given one is not among them. */
async function assertAssigned(userId: number, monitorTag: string): Promise<string[]> {
  const tags = await db.getMonitorTagsForUser(userId);
  if (!monitorTag || !tags.includes(monitorTag)) {
    throw new Error("This service is not assigned to you");
  }
  return tags;
}

function parseTypeData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export const GetMyServices = async (userId: number): Promise<MyService[]> => {
  const tags = await db.getMonitorTagsForUser(userId);
  const now = GetNowTimestampUTC();
  const services: MyService[] = [];
  for (const tag of tags) {
    const monitor = await db.getMonitorByTag(tag);
    if (!monitor) continue;
    const latest = await db.getLatestMonitoringData(tag);

    const incidents = (await db.getIncidentsByMonitorTag(tag, 0, now)).filter(
      (i) => i.state !== GC.RESOLVED && i.incident_type === GC.INCIDENT,
    );
    const openIncidents: MyServiceIncident[] = [];
    for (const incident of incidents.sort((a, b) => b.start_date_time - a.start_date_time)) {
      const comments = await GetIncidentActiveComments(incident.id);
      openIncidents.push({
        id: incident.id,
        title: incident.title,
        state: incident.state,
        impact: incident.monitor_impact,
        startedAt: incident.start_date_time,
        updates: comments
          .map((c) => ({ id: c.id, text: c.comment, state: c.state, at: c.commented_at }))
          .sort((a, b) => b.at - a.at),
      });
    }

    const events = await db.getMaintenanceEventsForMonitor(tag, now, now + MAINTENANCE_LOOKAHEAD_S);
    const maintenances: MyServiceMaintenance[] = [];
    for (const event of events.filter((e) => e.status !== GC.CANCELLED && e.status !== GC.COMPLETED)) {
      const maintenance = await db.getMaintenanceById(event.maintenance_id);
      if (!maintenance || maintenance.status !== "ACTIVE") continue;
      const affected = (await db.getMaintenanceMonitors(event.maintenance_id)).map((m) => m.monitor_tag);
      maintenances.push({
        eventId: event.id,
        maintenanceId: event.maintenance_id,
        title: maintenance.title,
        description: maintenance.description ?? null,
        startsAt: event.start_date_time,
        endsAt: event.end_date_time,
        status: event.status,
        canCancel: maintenance.is_global !== "YES" && affected.length > 0 && affected.every((t) => tags.includes(t)),
      });
    }
    maintenances.sort((a, b) => a.startsAt - b.startsAt);

    services.push({
      tag,
      name: monitor.name,
      image: monitor.image || null,
      status: latest?.status || GC.NO_DATA,
      statusSince: latest?.timestamp ?? null,
      manualStatus: monitor.monitor_type === "NONE",
      openIncidents,
      maintenances,
    });
  }
  return services;
};

/**
 * Sets the status of a service that Kener does not check itself (type None). The monitor then
 * keeps the status until the next change; without that option the default status would replace
 * it within a minute.
 */
export const SetMyServiceStatus = async (userId: number, monitorTag: string, status: string): Promise<void> => {
  await assertAssigned(userId, monitorTag);
  if (!(SERVICE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Status must be one of ${SERVICE_STATUSES.join(", ")}`);
  }
  const monitor = await db.getMonitorByTag(monitorTag);
  if (!monitor) throw new Error("Service not found");
  if (monitor.monitor_type !== "NONE") {
    throw new Error("Kener checks this service itself. Report a problem as an incident instead.");
  }
  const typeData = parseTypeData(monitor.type_data);
  if (!typeData.overrideWithLastKnownStatus) {
    await db.updateMonitor({
      ...monitor,
      type_data: JSON.stringify({ ...typeData, overrideWithLastKnownStatus: true }),
    });
  }
  const minute = GetMinuteStartNowTimestampUTC();
  await UpdateMonitoringData({
    monitor_tag: monitorTag,
    start: minute,
    end: minute,
    newStatus: status,
    type: GC.MANUAL,
  });
};

export const CreateMyServiceIncident = async (
  userId: number,
  data: { monitor_tag: string; title: string; message: string; impact: string },
): Promise<{ incident_id: number }> => {
  await assertAssigned(userId, data.monitor_tag);
  const title = String(data.title || "").trim();
  const message = String(data.message || "").trim() || title;
  if (!title) throw new Error("Please enter a title");
  if (!(INCIDENT_IMPACTS as readonly string[]).includes(data.impact)) {
    throw new Error(`Impact must be one of ${INCIDENT_IMPACTS.join(", ")}`);
  }
  const now = GetNowTimestampUTC();
  // Not global: the incident belongs to this service. The monitor goes on before the first
  // update, because that update's subscriber mail is sent to the service's subscribers.
  const { incident_id } = await CreateIncident({
    title,
    start_date_time: now,
    state: GC.INVESTIGATING,
    is_global: "NO",
  });
  await AddIncidentMonitor(incident_id, data.monitor_tag, data.impact);
  await AddIncidentComment(incident_id, message, GC.INVESTIGATING, now);
  return { incident_id };
};

export const AddMyServiceIncidentUpdate = async (
  userId: number,
  data: { incident_id: number; message: string; state: string },
): Promise<void> => {
  const incidentId = Number(data.incident_id);
  const tags = await db.getMonitorTagsForUser(userId);
  const linked = (await db.getMonitorsByIncidentId(incidentId)).map((m) => m.monitor_tag);
  if (!linked.some((t) => tags.includes(t))) {
    throw new Error("This incident does not concern your services");
  }
  if (!(INCIDENT_STATES as readonly string[]).includes(data.state)) {
    throw new Error(`State must be one of ${INCIDENT_STATES.join(", ")}`);
  }
  const message = String(data.message || "").trim();
  if (!message) throw new Error("Please write what happened");
  await AddIncidentComment(incidentId, message, data.state, GetNowTimestampUTC());
};

export const CreateMyServiceMaintenance = async (
  userId: number,
  data: { monitor_tag: string; title: string; description?: string; start: number; duration_minutes: number },
): Promise<{ maintenance_id: number }> => {
  await assertAssigned(userId, data.monitor_tag);
  const title = String(data.title || "").trim();
  if (!title) throw new Error("Please enter a title");
  const start = Math.floor(Number(data.start));
  const minutes = Math.floor(Number(data.duration_minutes));
  if (!Number.isFinite(start) || start <= 0) throw new Error("Please choose a start time");
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 7 * 24 * 60) {
    throw new Error("Duration must be between 1 minute and 7 days");
  }
  if (start + minutes * 60 <= GetNowTimestampUTC()) throw new Error("The maintenance would already be over");
  return await CreateMaintenance({
    title,
    description: String(data.description || "").trim() || null,
    start_date_time: start,
    rrule: "FREQ=MINUTELY;COUNT=1",
    duration_seconds: minutes * 60,
    is_global: "NO",
    monitors: [{ monitor_tag: data.monitor_tag, monitor_impact: "MAINTENANCE" }],
  });
};

export const CancelMyServiceMaintenance = async (userId: number, eventId: number): Promise<void> => {
  const event = await db.getMaintenanceEventById(Number(eventId));
  if (!event) throw new Error("Maintenance not found");
  const maintenance = await db.getMaintenanceById(event.maintenance_id);
  const tags = await db.getMonitorTagsForUser(userId);
  const affected = (await db.getMaintenanceMonitors(event.maintenance_id)).map((m) => m.monitor_tag);
  if (
    !maintenance ||
    maintenance.is_global === "YES" ||
    affected.length === 0 ||
    !affected.every((t) => tags.includes(t))
  ) {
    throw new Error("Only maintenance of your own services can be cancelled here");
  }
  await UpdateMaintenanceEventStatus(event.id, GC.CANCELLED);
};

/** Sets the services a user manages; unknown monitor tags are refused. */
export const SetUserServices = async (userId: number, monitorTags: unknown): Promise<string[]> => {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) throw new Error("User is required");
  if (!Array.isArray(monitorTags) || monitorTags.some((t) => typeof t !== "string")) {
    throw new Error("monitor_tags must be a list of monitor tags");
  }
  const user = await db.getUserById(Number(userId));
  if (!user) throw new Error("User not found");
  const tags = [...new Set(monitorTags as string[])];
  for (const tag of tags) {
    if (!(await db.getMonitorByTag(tag))) throw new Error(`Monitor "${tag}" does not exist`);
  }
  await db.setMonitorTagsForUser(Number(userId), tags);
  return await db.getMonitorTagsForUser(Number(userId));
};
