import db from "../db/db.js";
import { GetMinuteStartNowTimestampUTC, BeginningOfMinute, BeginningOfDay } from "../tool.js";
import { GetPageByPathWithMonitors, GetLatestMonitoringDataAllActive } from "./controller.js";
import { GetMonitorsParsed } from "./monitorsController.js";
import { GetStatusSummary, GetStatusBgColor } from "../../clientTools";

import type {
  IncidentRecord,
  IncidentCommentRecord,
  IncidentForMonitorListWithComments,
  MaintenanceEventsMonitorList,
  PageRecordTyped,
  TimestampStatusCount,
  PageSettingsType,
  IncidentMonitorDetailRecord,
} from "../types/db.js";
import type { GroupMonitorTypeData } from "../types/monitor.js";
import GC from "../../global-constants.js";
import type { LayoutServerData } from "./layoutController.js";
import type { NotificationEvent } from "../../types/notifications.js";
import { GetProblemButtonData, type ProblemButtonData } from "./reportsController.js";

export type { NotificationEvent };

// Default page settings
const defaultPageSettings: PageSettingsType = {
  monitor_status_history_days: {
    desktop: GC.DEFAULT_STATUS_HISTORY_DAYS_DESKTOP,
    mobile: GC.DEFAULT_STATUS_HISTORY_DAYS_MOBILE,
  },
  monitor_layout_style: GC.DEFAULT_MONITOR_LAYOUT_STYLE,
};

export interface NotificationPayload {
  notifications: NotificationEvent[];
}

// Type for incident with comments
export type IncidentWithComments = IncidentRecord & {
  comments: IncidentCommentRecord[];
};

//ongoing maintenance function using maintenance tables
const GetOngoingMaintenances = async (
  monitor_tags: string[],
  nowTs: number,
): Promise<MaintenanceEventsMonitorList[]> => {
  const ongoingMaintenances = await db.getOngoingMaintenanceEventsForMonitorList(nowTs, monitor_tags);
  return ongoingMaintenances;
};

//given array of monitor tags, get ongoing incidents for dashboard
export const GetOngoingIncidentsForMonitorList = async (
  monitor_tags: string[],
): Promise<IncidentForMonitorListWithComments[]> => {
  const now = GetMinuteStartNowTimestampUTC();
  const ongoingIncidents = await db.getOngoingIncidentsForMonitorListWithComments(now, monitor_tags);
  return ongoingIncidents;
};

//given array of monitor tags, get recently resolved incidents for dashboard
export const GetResolvedIncidentsForMonitorList = async (
  monitor_tags: string[],
  limit: number = 5,
  daysInPast: number = 7,
): Promise<IncidentForMonitorListWithComments[]> => {
  const now = GetMinuteStartNowTimestampUTC();
  return await db.getResolvedIncidentsForMonitorListWithComments(now, monitor_tags, limit, daysInPast);
};

// ============ Maintenance Events for Monitor List ============

/**
 * Get ongoing maintenance events for a list of monitors
 * Returns maintenance events that are currently in progress
 */
export const GetOngoingMaintenanceEventsForMonitorList = async (
  monitor_tags: string[],
): Promise<MaintenanceEventsMonitorList[]> => {
  const now = GetMinuteStartNowTimestampUTC();
  const ongoingMaintenances = await db.getOngoingMaintenanceEventsForMonitorList(now, monitor_tags);
  return ongoingMaintenances;
};

/**
 * Get past/completed maintenance events for a list of monitors
 * Returns maintenance events that ended within the specified days
 */
export const GetPastMaintenanceEventsForMonitorList = async (
  monitor_tags: string[],
  limit: number = 5,
  daysInPast: number = 7,
): Promise<MaintenanceEventsMonitorList[]> => {
  const now = GetMinuteStartNowTimestampUTC();
  const pastMaintenances = await db.getPastMaintenanceEventsForMonitorList(now, monitor_tags, limit, daysInPast);
  return pastMaintenances;
};

/**
 * Get upcoming maintenance events for a list of monitors
 * Returns scheduled maintenance events within the specified days
 */
export const GetUpcomingMaintenanceEventsForMonitorList = async (
  monitor_tags: string[],
  limit: number = 5,
  daysInFuture: number = 7,
): Promise<MaintenanceEventsMonitorList[]> => {
  const now = GetMinuteStartNowTimestampUTC();
  const upcomingMaintenances = await db.getUpcomingMaintenanceEventsForMonitorList(
    now,
    monitor_tags,
    limit,
    daysInFuture,
  );
  return upcomingMaintenances;
};

// ============ Incident Detail Functions ============

/**
 * Get incident by ID
 */
export const GetIncidentById = async (id: number): Promise<Omit<IncidentRecord, "incident_source"> | undefined> => {
  return await db.getIncidentById(id);
};

/**
 * Get incident comments by incident ID
 */
export const GetIncidentCommentsByIncidentId = async (incident_id: number): Promise<IncidentCommentRecord[]> => {
  return await db.getActiveIncidentComments(incident_id);
};

/**
 * Get affected monitors by incident ID
 */
export const GetAffectedMonitorsByIncidentId = async (
  incident_id: number,
  includeHidden = false,
): Promise<Array<IncidentMonitorDetailRecord>> => {
  return await db.getMonitorsByIncidentId(incident_id, includeHidden);
};

// ============ Page Dashboard Data ============

export interface PageNavItem {
  page_title: string;
  page_path: string;
  page_header: string;
  page_logo: string | null;
}

/** How long a resolved incident stays in the box at the top of the page. */
export const TOP_RESOLVED_KEEP_S = 24 * 60 * 60;
/** How far back the list of past Jira Service Management incidents reaches. */
export const JSM_HISTORY_DAYS = 90;
export const JSM_HISTORY_LIMIT = 50;

/** An incident in the box at the top of a status page. */
export interface TopIncident {
  id: number;
  title: string;
  state: string;
  top_impact: string;
  start_date_time: number;
  end_date_time: number | null;
  /** Where the box leads: the service's page when the incident has exactly one, else the incident's page. */
  href: string;
  monitorNames: string[];
  latest: { comment: string; state: string; commented_at: number } | null;
}

/** A resolved incident in the list of past incidents at the bottom of a status page. */
export interface PastIncident {
  id: number;
  title: string;
  start_date_time: number;
  end_date_time: number;
  monitorNames: string[];
}

const ToTopIncident = (incident: IncidentForMonitorListWithComments): TopIncident => {
  const latest = incident.comments[0];
  return {
    id: incident.id,
    title: incident.title,
    state: incident.state,
    top_impact: incident.top_impact || GC.DOWN,
    start_date_time: incident.start_date_time,
    end_date_time: incident.end_date_time,
    href:
      incident.monitors.length === 1 ? `/monitors/${incident.monitors[0].monitor_tag}` : `/incidents/${incident.id}`,
    monitorNames: incident.monitors.map((m) => m.monitor_name),
    latest: latest ? { comment: latest.comment, state: latest.state, commented_at: latest.commented_at } : null,
  };
};

/**
 * The incidents for the top of a status page (open, or resolved within the last 24 hours) and
 * the Jira Service Management incidents of the last 3 months that the page shows. An incident
 * still at the top is left out of the past list.
 */
export const GetTopAndPastIncidents = async (
  monitorTags: string[],
  nowTs: number,
): Promise<{ topIncidents: TopIncident[]; pastJsmIncidents: PastIncident[] }> => {
  const [top, past] = await Promise.all([
    db.getTopIncidents(nowTs, nowTs - TOP_RESOLVED_KEEP_S),
    db.getResolvedIncidentsBySource("JSM", monitorTags, nowTs - JSM_HISTORY_DAYS * 86400, nowTs, JSM_HISTORY_LIMIT),
  ]);
  const topIds = new Set(top.map((i) => i.id));
  return {
    topIncidents: top.map(ToTopIncident),
    pastJsmIncidents: past
      .filter((i) => !topIds.has(i.id))
      .map((i) => ({
        id: i.id,
        title: i.title,
        start_date_time: i.start_date_time,
        end_date_time: i.end_date_time ?? i.start_date_time,
        monitorNames: i.monitors.map((m) => m.monitor_name),
      })),
  };
};

export interface PageDashboardData {
  pageStatus: { statusSummary: string; statusClass: string };
  topIncidents: TopIncident[];
  pastJsmIncidents: PastIncident[];
  /** The "not working" button: services that have it, with their report counts. */
  problemButton: ProblemButtonData | null;
  ongoingIncidents: IncidentForMonitorListWithComments[];
  ongoingMaintenances: MaintenanceEventsMonitorList[];
  upcomingMaintenances: MaintenanceEventsMonitorList[];
  monitorTags: string[];
  monitorGroupMembersByTag: Record<string, string[]>;
  pageDetails: PageRecordTyped;
  socialPagePreviewImage?: string;
  metaPageTitle?: string;
  metaPageDescription?: string;
}

const BuildPageStatus = (latestData: Array<{ status?: string | null; latency?: number | null }>, nowTs: number) => {
  let upsInLatestData = 0;
  let downsInLatestData = 0;
  let degradedsInLatestData = 0;
  let maintenancesInLatestData = 0;
  let latencySum = 0;
  let maxLatency = 0;
  let minLatency = Infinity;

  for (const data of latestData) {
    if (data.status === GC.UP) {
      upsInLatestData++;
    } else if (data.status === GC.DOWN) {
      downsInLatestData++;
    } else if (data.status === GC.DEGRADED) {
      degradedsInLatestData++;
    } else if (data.status === GC.MAINTENANCE) {
      maintenancesInLatestData++;
    }

    const latency = data.latency || 0;
    latencySum += latency;
    if (latency > maxLatency) {
      maxLatency = latency;
    }
    if (latency < minLatency) {
      minLatency = latency;
    }
  }

  const item: TimestampStatusCount = {
    ts: nowTs,
    countOfUp: upsInLatestData,
    countOfDown: downsInLatestData,
    countOfDegraded: degradedsInLatestData,
    countOfMaintenance: maintenancesInLatestData,
    avgLatency: latencySum / (latestData.length || 1),
    maxLatency,
    minLatency: minLatency === Infinity ? 0 : minLatency,
  };

  return {
    statusSummary: GetStatusSummary(item),
    statusClass: GetStatusBgColor(item),
  };
};

export const BuildNotificationPayload = (
  ongoingIncidents: IncidentForMonitorListWithComments[],
  ongoingMaintenances: MaintenanceEventsMonitorList[],
  pastResolvedIncidents: IncidentForMonitorListWithComments[],
  upcomingMaintenances: MaintenanceEventsMonitorList[],
  pastMaintenances: MaintenanceEventsMonitorList[],
  nowTs: number,
): NotificationPayload => {
  const notifications: Array<NotificationEvent & { sortTs: number }> = [];

  for (const incident of ongoingIncidents) {
    const ts = incident.start_date_time;
    notifications.push({
      sortTs: ts,
      eventURL: `/incidents/${incident.id}`,
      eventTitle: incident.title,
      eventDate: new Date(ts * 1000).toISOString(),
      eventType: "incident",
      eventStartDateTime: incident.start_date_time,
      eventEndDateTime: incident.end_date_time,
      eventStatus: incident.state,
    });
  }

  for (const incident of pastResolvedIncidents) {
    const ts = incident.end_date_time ?? incident.start_date_time;
    notifications.push({
      sortTs: ts,
      eventURL: `/incidents/${incident.id}`,
      eventTitle: incident.title,
      eventDate: new Date(ts * 1000).toISOString(),
      eventType: "incident",
      eventStartDateTime: incident.start_date_time,
      eventEndDateTime: incident.end_date_time,
      eventStatus: incident.state,
    });
  }

  for (const maintenance of ongoingMaintenances) {
    const ts = maintenance.start_date_time;
    notifications.push({
      sortTs: ts,
      eventURL: `/maintenances/${maintenance.id}`,
      eventTitle: maintenance.title,
      eventDate: new Date(ts * 1000).toISOString(),
      eventType: "maintenance",
      eventStartDateTime: maintenance.start_date_time,
      eventEndDateTime: maintenance.end_date_time,
      eventStatus: GC.ONGOING,
    });
  }

  for (const maintenance of upcomingMaintenances) {
    const ts = maintenance.start_date_time;
    notifications.push({
      sortTs: ts,
      eventURL: `/maintenances/${maintenance.id}`,
      eventTitle: maintenance.title,
      eventDate: new Date(ts * 1000).toISOString(),
      eventType: "maintenance",
      eventStartDateTime: maintenance.start_date_time,
      eventEndDateTime: maintenance.end_date_time,
      eventStatus: GC.SCHEDULED,
    });
  }

  for (const maintenance of pastMaintenances) {
    const ts = maintenance.end_date_time;
    notifications.push({
      sortTs: ts,
      eventURL: `/maintenances/${maintenance.id}`,
      eventTitle: maintenance.title,
      eventDate: new Date(ts * 1000).toISOString(),
      eventType: "maintenance",
      eventStartDateTime: maintenance.start_date_time,
      eventEndDateTime: maintenance.end_date_time,
      eventStatus: GC.COMPLETED,
    });
  }

  return {
    notifications: notifications.sort((a, b) => a.sortTs - b.sortTs).map(({ sortTs, ...item }) => item),
  };
};

/**
 * Get all dashboard data for a status page
 * @param pagePath - The URL path of the page (e.g., "/" or "/api")
 * @returns Dashboard data or null if page not found
 */
export const GetPageDashboardData = async (
  pagePath: string,
  layoutData: LayoutServerData,
): Promise<PageDashboardData | null> => {
  const pageData = await GetPageByPathWithMonitors(pagePath, layoutData.canSeeHiddenMonitors);
  if (!pageData) {
    return null;
  }

  const { page: pageDetails, monitors: pageMonitors } = pageData;
  const monitorTags = pageMonitors.map((pm) => pm.monitor_tag);

  // Parse page settings with defaults
  let settings: PageSettingsType = defaultPageSettings;
  if (pageDetails.page_settings_json) {
    try {
      const parsed =
        typeof pageDetails.page_settings_json === "string"
          ? JSON.parse(pageDetails.page_settings_json)
          : pageDetails.page_settings_json;
      settings = { ...defaultPageSettings, ...parsed };
    } catch {
      settings = defaultPageSettings;
    }
  }
  const nowTs = GetMinuteStartNowTimestampUTC();

  // Convert to PageRecordTyped with parsed settings
  const pageDetailsTyped: PageRecordTyped = {
    id: pageDetails.id,
    page_path: pageDetails.page_path,
    page_title: pageDetails.page_title,
    page_header: pageDetails.page_header,
    page_subheader: pageDetails.page_subheader,
    page_logo: pageDetails.page_logo,
    page_settings: settings,
    created_at: pageDetails.created_at,
    updated_at: pageDetails.updated_at,
  };

  let socialPagePreviewImage: string | undefined = layoutData.socialPreviewImage;
  let metaPageTitle: string | undefined = layoutData.metaSiteTitle;
  let metaPageDescription: string | undefined = layoutData.metaSiteDescription;
  if (!!pageDetails.page_settings_json) {
    try {
      const pageSettings = JSON.parse(pageDetails.page_settings_json);
      if (pageSettings) {
        socialPagePreviewImage = pageSettings.socialPagePreviewImage || layoutData.socialPreviewImage;
        metaPageTitle = pageSettings.metaPageTitle || layoutData.metaSiteTitle;
        metaPageDescription = pageSettings.metaPageDescription || layoutData.metaSiteDescription;
      }
    } catch (e) {
      // Ignore JSON parsing errors and fallback to layout data or defaults
    }
  }

  const { topIncidents, pastJsmIncidents } = await GetTopAndPastIncidents(monitorTags, nowTs);

  if (monitorTags.length === 0) {
    return {
      pageStatus: BuildPageStatus([], nowTs),
      topIncidents,
      pastJsmIncidents,
      problemButton: null,
      ongoingIncidents: [],
      ongoingMaintenances: [],
      upcomingMaintenances: [],
      monitorTags,
      monitorGroupMembersByTag: {},
      pageDetails: pageDetailsTyped,
      socialPagePreviewImage,
      metaPageTitle,
      metaPageDescription,
    };
  }
  const eventSettings = layoutData.eventDisplaySettings;
  const showInlineEvents = eventSettings.showInlineEvents === true;
  // Fetch all dashboard data in parallel (respecting feature toggles)
  const [latestData, parsedMonitors, ongoingIncidents, ongoingMaintenances, upcomingMaintenances] = await Promise.all([
    GetLatestMonitoringDataAllActive(monitorTags),
    GetMonitorsParsed({
      tags: monitorTags,
      status: "ACTIVE",
      is_hidden: layoutData.canSeeHiddenMonitors ? undefined : "NO",
    }),
    showInlineEvents && eventSettings.incidents.enabled && eventSettings.incidents.ongoing.show
      ? GetOngoingIncidentsForMonitorList(monitorTags)
      : Promise.resolve([] as IncidentForMonitorListWithComments[]),
    showInlineEvents && eventSettings.maintenances.enabled && eventSettings.maintenances.ongoing.show
      ? GetOngoingMaintenances(monitorTags, nowTs)
      : Promise.resolve([] as MaintenanceEventsMonitorList[]),
    showInlineEvents && eventSettings.maintenances.enabled && eventSettings.maintenances.upcoming.show
      ? GetUpcomingMaintenanceEventsForMonitorList(
          monitorTags,
          eventSettings.maintenances.upcoming.maxCount,
          eventSettings.maintenances.upcoming.daysInFuture,
        )
      : Promise.resolve([] as MaintenanceEventsMonitorList[]),
  ]);

  const pageStatus = BuildPageStatus(latestData, nowTs);
  const monitorGroupMembersByTag: Record<string, string[]> = {};

  for (const monitor of parsedMonitors) {
    if (monitor.monitor_type !== "GROUP") continue;

    const groupData = monitor.type_data as GroupMonitorTypeData;
    if (!groupData?.monitors || !Array.isArray(groupData.monitors)) continue;

    monitorGroupMembersByTag[monitor.tag] = groupData.monitors.map((member) => member.tag);
  }

  // An incident at the top is shown there only.
  const topIds = new Set(topIncidents.map((i) => i.id));
  const problemButton = await GetProblemButtonData(
    parsedMonitors
      .filter((m) => m.is_hidden !== "YES" && m.monitor_settings_json?.problem_button === true)
      .map((m) => m.tag),
    layoutData.loggedInUser,
  );

  return {
    pageStatus,
    topIncidents,
    pastJsmIncidents,
    problemButton,
    ongoingIncidents: ongoingIncidents.filter((i) => !topIds.has(i.id)),
    ongoingMaintenances,
    upcomingMaintenances,
    monitorTags,
    monitorGroupMembersByTag,
    pageDetails: pageDetailsTyped,
    socialPagePreviewImage,
    metaPageTitle,
    metaPageDescription,
  };
};
