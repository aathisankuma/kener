// Providers a CLOUD monitor can follow. Safe to import from both server and client.
//
// - "statuspage" providers publish an Atlassian Statuspage, whose public JSON API needs no login.
// - "m365" providers are Microsoft 365 services, read from the tenant's Service Health in Microsoft
//   Graph (needs an app registration with the ServiceHealth.Read.All application permission).

export type CloudProviderKind = "statuspage" | "m365";

export interface CloudProvider {
  id: string;
  label: string;
  group: "Atlassian" | "Microsoft 365" | "Other";
  kind: CloudProviderKind;
  /** Statuspage base URL, without a trailing slash. */
  url?: string;
  /** Microsoft Graph service ids and names that identify this service (matched ignoring case). */
  m365Match?: string[];
}

/** Provider id for any other Atlassian Statuspage, entered by URL. */
export const CLOUD_CUSTOM_STATUSPAGE = "statuspage-custom";
/** Provider id for any other Microsoft 365 service, entered by its Graph name or id. */
export const CLOUD_CUSTOM_M365 = "m365-custom";

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
  },
  {
    id: "m365-exchange",
    label: "Exchange Online (Outlook)",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["Exchange", "Exchange Online"],
  },
  {
    id: "m365-teams",
    label: "Microsoft Teams",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["microsoftteams", "Microsoft Teams"],
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
  },
  {
    id: "m365-apps",
    label: "Microsoft 365 Apps (Office)",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["O365Client", "Microsoft 365 Apps", "Microsoft 365 apps"],
  },
  {
    id: "m365-entra",
    label: "Microsoft Entra (sign-in)",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["OrgLiveID", "Microsoft Entra", "Identity Service"],
  },
  {
    id: "m365-intune",
    label: "Microsoft Intune",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["Intune", "Microsoft Intune"],
  },
  { id: "m365-planner", label: "Planner", group: "Microsoft 365", kind: "m365", m365Match: ["Planner"] },
  {
    id: "m365-forms",
    label: "Microsoft Forms",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["Forms", "Microsoft Forms"],
  },
  {
    id: "m365-powerbi",
    label: "Power BI",
    group: "Microsoft 365",
    kind: "m365",
    m365Match: ["PowerBIcom", "Power BI"],
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
  if (id === CLOUD_CUSTOM_M365) {
    return { id, label: "Other Microsoft 365 service", group: "Microsoft 365", kind: "m365" };
  }
  return CLOUD_PROVIDERS.find((p) => p.id === id);
}
