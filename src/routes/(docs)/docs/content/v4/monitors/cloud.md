---
title: Cloud Service Monitor
description: Follow the official status of Atlassian, Microsoft 365, Abacus and other cloud services by picking them from a list
---

Cloud Service monitors follow a provider's own status instead of probing your network. Pick the service from a dropdown: Kener reads the provider's status and records **UP**, **DEGRADED**, **DOWN** or **MAINTENANCE**.

To also check that _your_ users can reach the service, add an [API monitor](/docs/v4/monitors/api) on your own address and combine both in a [group monitor](/docs/v4/monitors/group).

## Atlassian and other Statuspage services {#statuspage}

1. Set **Monitor Type** to **Cloud Service**.
2. Pick the service, e.g. **Confluence** or **Jira Service Management**. For any other page run on Atlassian Statuspage, pick **Other Statuspage (URL)** and enter its address.
3. Optional: click **Load list** and pick one **Component**, e.g. `Search`. Empty follows the whole page.
4. Save, then run **Test Monitor**.

No login is needed. Kener reads the public `/api/v2/status.json`, or `/api/v2/components.json` when a component is set.

| Provider reports                     | Kener records |
| ------------------------------------ | ------------- |
| `none` / `operational`               | UP            |
| `minor` / `degraded_performance`     | DEGRADED      |
| `partial_outage`                     | DEGRADED      |
| `major`, `critical` / `major_outage` | DOWN          |
| `maintenance` / `under_maintenance`  | MAINTENANCE   |

**Ignore minor issues** records minor incidents and degraded performance as UP. A provider's page reports problems in every region, so small issues elsewhere would otherwise mark the monitor DEGRADED. It is on for monitors created in the dashboard; turn it off to record every minor issue. Monitors created through the API without `ignoreMinor` record minor issues.

## Abacus and other Instatus pages {#instatus}

Abacus Cloud Services (`status.abaservices.ch`) and DeepCloud (`status.deepcloud.swiss`) publish their status with Instatus. Pick them under **Abacus**; for any other Instatus page (its footer reads "Powered by Instatus") pick **Other Instatus page (URL)**. No login is needed: Kener reads the public `/v3/summary.json`, or `/v3/components.json` when a component is set.

**Swiss21** runs its page on UptimeRobot, which offers no public status API. **Swiss21 (via Abacus status page)** follows the component `Swiss21 Services` of the Abacus page instead.

**Load list** shows the page's components. A name that appears in two groups, like `Kundenportal`, is listed as `Group / Name`.

| Instatus reports         | Kener records                                |
| ------------------------ | -------------------------------------------- |
| `UP` / `OPERATIONAL`     | UP                                           |
| `DEGRADEDPERFORMANCE`    | DEGRADED, or UP with **Ignore minor issues** |
| `PARTIALOUTAGE`          | DEGRADED                                     |
| `MAJOROUTAGE`            | DOWN                                         |
| `UNDERMAINTENANCE`       | MAINTENANCE                                  |
| `HASISSUES` (whole page) | the worst active incident or component       |

## Microsoft 365 {#microsoft-365}

Microsoft 365 monitors read your tenant's [service health](https://learn.microsoft.com/en-us/graph/api/serviceannouncement-list-healthoverviews) from Microsoft Graph, so they show problems that affect your organization.

1. In Microsoft Entra ID, register an app. Under **API permissions**, add the **application** permission `ServiceHealth.Read.All` for Microsoft Graph and grant admin consent.
2. Create a client secret for the app.
3. Set the shared connection in Kener's environment and restart Kener:

    ```bash
    M365_TENANT_ID=<directory (tenant) id>
    M365_CLIENT_ID=<application (client) id>
    M365_CLIENT_SECRET=<client secret>
    ```

4. Create a Cloud Service monitor, pick the service (e.g. **Microsoft Teams**), leave the connection fields empty and save.
5. Run **Test Monitor**.

One app registration serves every Microsoft 365 monitor. Fill the **Tenant ID**, **Client ID** or **Client secret** of a monitor only to use a different app for it; a field can name another environment variable as `$NAME`.

| Microsoft reports                                                       | Kener records |
| ----------------------------------------------------------------------- | ------------- |
| `serviceOperational`, `serviceRestored`, `resolved`, `falsePositive`, … | UP            |
| `serviceDegradation`, `investigating`, `restoringService`, …            | DEGRADED      |
| `serviceInterruption`                                                   | DOWN          |

For a service that is not in the list, pick **Other Microsoft 365 service** and enter its name or ID. If the name does not match, **Test Monitor** lists the services of your tenant.

Monitors that share an app registration share one sign-in and one Graph read per minute.

> [!TIP]
> Keep the secret in `M365_CLIENT_SECRET`. A secret typed into the monitor's field is stored in Kener's database as is.

## Icon {#icon}

When you save a Cloud Service monitor that has no image, Kener downloads the service's own icon and uses it as the monitor's image: for a Statuspage service the icon of its status page, for Microsoft 365 the icon of the service's web app (e.g. `teams.microsoft.com`). The icon is stored like an uploaded image, at most 128 × 128 px; SVG and ICO icons are converted to PNG.

- An image you uploaded is never replaced on save. **Use provider's icon** replaces it on request.
- If no icon is found, the monitor keeps no image and shows its initials. Upload one under **General Settings**.
- Kener's server needs access to the provider's website, through `HTTP_PROXY` / `HTTPS_PROXY` when set.

## Detail page {#detail-page}

A visitor who opens a Cloud Service monitor on the status page sees what the provider itself shows, read live and refreshed at most once a minute:

- **Scheduled maintenance** that is planned or in progress
- **Active incidents** with their latest updates
- The provider's **components** with their status; a `?` shows the provider's description
- **Past incidents** of the last 15 days, by day, with every update and the affected components

For a Statuspage, the list follows the monitor's component when one is set. Instatus does not say which components an incident affects: a monitor that follows one component lists the incidents of the whole page and says so. Instatus shows only the latest update of an active incident and the incidents resolved in the last days. Microsoft 365 lists no fixed components: the page shows the service and each feature group with an open issue, and Microsoft's issues for the service as incidents.

> [!NOTE]
> The texts come from the provider as they are, usually in English. Microsoft's issues concern your tenant: anyone who can open the status page can read them.

## When the provider cannot be read {#errors}

A timeout, an HTTP error or an unexpected answer records **If the provider cannot be read** (default **DEGRADED**) and keeps the reason in the monitor's log. Common messages:

| Message                                     | Fix                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `Component "…" not found. Available: …`     | Pick a component from **Load list**.                                         |
| `Environment variable … is not set`         | Add the variable to Kener's environment and restart.                         |
| `Microsoft sign-in failed: AADSTS…`         | Check tenant ID, client ID and secret. Secrets expire.                       |
| `Microsoft Graph refused access (HTTP 403)` | Grant `ServiceHealth.Read.All` as application permission with admin consent. |

Kener reaches the providers through the proxy in `HTTP_PROXY` / `HTTPS_PROXY` when set.
