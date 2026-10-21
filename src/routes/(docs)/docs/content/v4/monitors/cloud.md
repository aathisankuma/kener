---
title: Cloud Service Monitor
description: Follow the official status of Atlassian, Microsoft 365 and other cloud services by picking them from a list
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

Turn on **Ignore minor issues** to record minor incidents and degraded performance as UP. A provider's page reports problems in every region, so small issues elsewhere can otherwise mark the monitor DEGRADED.

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

## When the provider cannot be read {#errors}

A timeout, an HTTP error or an unexpected answer records **If the provider cannot be read** (default **DEGRADED**) and keeps the reason in the monitor's log. Common messages:

| Message                                     | Fix                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `Component "…" not found. Available: …`     | Pick a component from **Load list**.                                         |
| `Environment variable … is not set`         | Add the variable to Kener's environment and restart.                         |
| `Microsoft sign-in failed: AADSTS…`         | Check tenant ID, client ID and secret. Secrets expire.                       |
| `Microsoft Graph refused access (HTTP 403)` | Grant `ServiceHealth.Read.All` as application permission with admin consent. |

Kener reaches the providers through the proxy in `HTTP_PROXY` / `HTTPS_PROXY` when set.
