// Providers a CLOUD monitor can follow. Safe to import from both server and client.
//
// - "statuspage" providers publish an Atlassian Statuspage, whose public JSON API needs no login.
// - "instatus" providers publish an Instatus page, whose public JSON API (/v3/summary.json,
//   /v3/components.json) needs no login either.
// - "m365" providers are Microsoft 365 services, read from the tenant's Service Health in Microsoft
//   Graph (needs an app registration with the ServiceHealth.Read.All application permission).

export type CloudProviderKind = "statuspage" | "instatus" | "m365";

export interface CloudProvider {
  id: string;
  label: string;
  group: "Atlassian" | "Microsoft 365" | "Abacus" | "Other";
  kind: CloudProviderKind;
  /** Status page base URL (Statuspage or Instatus), without a trailing slash. */
  url?: string;
  /** Component picked when this service is chosen, for a service listed on another page. */
  defaultComponent?: string;
  /** Microsoft Graph service ids and names that identify this service (matched ignoring case). */
  m365Match?: string[];
  /** Web page whose icon is the service's icon. Statuspage providers use their status page. */
  iconSite?: string;
}

/** Provider id for any other Atlassian Statuspage, entered by URL. */
export const CLOUD_CUSTOM_STATUSPAGE = "statuspage-custom";
/** Provider id for any other Instatus page, entered by URL. */
export const CLOUD_CUSTOM_INSTATUS = "instatus-custom";
/** Provider id for any other Microsoft 365 service, entered by its Graph name or id. */
export const CLOUD_CUSTOM_M365 = "m365-custom";

/** Provider kinds whose status comes from a public page, so a URL and a component apply. */
export function IsStatusPageKind(kind: CloudProviderKind | undefined): kind is "statuspage" | "instatus" {
  return kind === "statuspage" || kind === "instatus";
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  // Atlassian
  {
    id: "jira",
    label: "Jira",
    group: "Atlassian",
    kind: "statuspage",
    url: "https://jira-software.status.atlassian.com",
  },
  {
    id: "jira-service-management",
    label: "Jira Service Management",
    group: "Atlassian",
    kind: "statuspage",
    url: "https://jira-service-management.status.atlassian.com",
  },
  {
    id: "jira-work-management",
    label: "Jira Work Management",
    group: "Atlassian",
    kind: "statuspage",
    url: "https://jira-work-management.status.atlassian.com",
  },
  {
    id: "jira-product-discovery",
    label: "Jira Product Discovery",
    group: "Atlassian",
    kind: "statuspage",
    url: "https://jira-product-discovery.status.atlassian.com",
  },
  {
    id: "confluence",
    label: "Confluence",
    group: "Atlassian",
    kind: "statuspage",
    url: "https://confluence.status.atlassian.com",
  },
  {
    id: "jira-align",
    label: "Jira Align",
    group: "Atlassian",
    kind: "statuspage",
    url: "https://jira-align.status.atlassian.com",
  },
  { id: "trello", label: "Trello", group: "Atlassian", kind: "statuspage", url: "https://www.trellostatus.com" },
  { id: "bitbucket", label: "Bitbucket", group: "Atlassian", kind: "statuspage", url: "https://status.bitbucket.org" },
  { id: "opsgenie", label: "Opsgenie", group: "Atlassian", kind: "statuspage", url: "https://status.opsgenie.com" },
  { id: "loom", label: "Loom", group: "Atlassian", kind: "statuspage", url: "https://loom.status.atlassian.com" },
  { id: "rovo", label: "Rovo", group: "Atlassian", kind: "statuspage", url: "https://rovo.status.atlassian.com" },
  {
    id: "atlassian-guard",
    label: "Atlassian Guard",
    group: "Atlassian",
    kind: "statuspage",
    url: "https://guard.status.atlassian.com",
  },
  {
    id: "atlassian-admin",
    label: "Atlassian Administration",
    group: "Atlassian",
    kind: "statuspage",
    url: "https://admin.status.atlassian.com",
  },

  // Microsoft 365
  {
    id: "m365-suite",
    label: "Microsoft 365 suite",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["OSDPPlatform", "Microsoft 365 suite"],
    iconSite: "https://www.microsoft365.com",
  },
  {
    id: "m365-exchange",
    label: "Exchange Online (Outlook)",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["Exchange", "Exchange Online"],
    iconSite: "https://outlook.office.com",
  },
  {
    id: "m365-teams",
    label: "Microsoft Teams",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["microsoftteams", "Microsoft Teams"],
    iconSite: "https://teams.microsoft.com",
  },
  {
    id: "m365-sharepoint",
    label: "SharePoint Online",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["SharePoint", "SharePoint Online"],
  },
  {
    id: "m365-onedrive",
    label: "OneDrive for Business",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["OneDriveForBusiness", "OneDrive for Business"],
    iconSite: "https://onedrive.live.com",
  },
  {
    id: "m365-apps",
    label: "Microsoft 365 Apps (Office)",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["O365Client", "Microsoft 365 Apps", "Microsoft 365 apps"],
    iconSite: "https://www.office.com",
  },
  {
    id: "m365-entra",
    label: "Microsoft Entra (sign-in)",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["OrgLiveID", "Microsoft Entra", "Identity Service"],
    iconSite: "https://entra.microsoft.com",
  },
  {
    id: "m365-intune",
    label: "Microsoft Intune",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["Intune", "Microsoft Intune"],
    iconSite: "https://intune.microsoft.com",
  },
  {
    id: "m365-planner",
    label: "Planner",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["Planner"],
    iconSite: "https://planner.cloud.microsoft",
  },
  {
    id: "m365-forms",
    label: "Microsoft Forms",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["Forms", "Microsoft Forms"],
    iconSite: "https://forms.office.com",
  },
  {
    id: "m365-powerbi",
    label: "Power BI",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["PowerBIcom", "Power BI"],
    iconSite: "https://app.powerbi.com",
  },

  // Abacus and its ecosystem (Instatus pages)
  {
    id: "abacus-cloud",
    label: "Abacus Cloud Services",
    group: "Abacus",
    kind: "instatus",
    url: "https://status.abaservices.ch",
  },
  {
    id: "deepcloud",
    label: "DeepCloud (DeepBox, DeepSign, …)",
    group: "Abacus",
    kind: "instatus",
    url: "https://status.deepcloud.swiss",
  },
  {
    // status.swiss21.org runs on UptimeRobot, which has no public status API; the Abacus page
    // lists Swiss21 as one of its components.
    id: "swiss21",
    label: "Swiss21 (via Abacus status page)",
    group: "Abacus",
    kind: "instatus",
    url: "https://status.abaservices.ch",
    defaultComponent: "Swiss21 Services",
    iconSite: "https://swiss21.org",
  },

  // Other services that publish a Statuspage
  { id: "github", label: "GitHub", group: "Other", kind: "statuspage", url: "https://www.githubstatus.com" },
  {
    id: "cloudflare",
    label: "Cloudflare",
    group: "Other",
    kind: "statuspage",
    url: "https://www.cloudflarestatus.com",
  },
  { id: "zoom", label: "Zoom", group: "Other", kind: "statuspage", url: "https://status.zoom.us" },
];

export function GetCloudProvider(id: string | undefined): CloudProvider | undefined {
  if (id === CLOUD_CUSTOM_STATUSPAGE) {
    return { id, label: "Other Statuspage (URL)", group: "Other", kind: "statuspage" };
  }
  if (id === CLOUD_CUSTOM_INSTATUS) {
    return { id, label: "Other Instatus page (URL)", group: "Other", kind: "instatus" };
  }
  if (id === CLOUD_CUSTOM_M365) {
    return { id, label: "Other Microsoft 365 service", group: "Microsoft 365", kind: "m365" };
  }
  return CLOUD_PROVIDERS.find((p) => p.id === id);
}

// ---------------------------------------------------------------- Detail view

/** Kener status of a provider component or issue. */
export type CloudStatus = "UP" | "DEGRADED" | "DOWN" | "MAINTENANCE";

export interface CloudComponent {
  id: string;
  name: string;
  description: string | null;
  status: CloudStatus;
  /** Name of the group this component belongs to on the provider's page, if any. */
  group: string | null;
}

export interface CloudUpdate {
  /** Provider's step, e.g. "investigating", "resolved"; "" when the provider gives none. */
  status: string;
  /** Text of the update. HTML when `isHtml` (Microsoft), plain text otherwise (Statuspage). */
  body: string;
  isHtml: boolean;
  /** UTC seconds. */
  at: number;
}

export interface CloudIncident {
  id: string;
  title: string;
  /** Worst impact while it lasted. */
  impact: CloudStatus;
  /** Provider's current step, e.g. "resolved", "serviceRestored". */
  status: string;
  resolved: boolean;
  /** UTC seconds. */
  startedAt: number;
  resolvedAt: number | null;
  url: string | null;
  /** Component, feature or service names the provider lists as affected. */
  affected: string[];
  /** Newest first. */
  updates: CloudUpdate[];
}

export interface CloudMaintenance extends CloudIncident {
  /** UTC seconds. */
  scheduledFor: number | null;
  scheduledUntil: number | null;
}

export interface CloudDetails {
  provider: { label: string; kind: CloudProviderKind; pageUrl: string | null };
  /**
   * Set when the monitor follows one component but the provider does not say which components an
   * incident affects (Instatus): the name of the page whose incidents are listed.
   */
  incidentsFromPage?: string | null;
  components: CloudComponent[];
  incidents: CloudIncident[];
  maintenances: CloudMaintenance[];
  /** UTC seconds. */
  fetchedAt: number;
}
