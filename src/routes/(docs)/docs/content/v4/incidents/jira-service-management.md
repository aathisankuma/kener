---
title: "Jira Service Management"
description: "Show selected Jira Service Management tickets as incidents that follow the ticket's replies and status."
---

Kener can turn a Jira Service Management (JSM) ticket into an incident and keep it up to date from the ticket. Kener only reads Jira: it signs in as an ordinary customer account and sees only the tickets that account was added to.

## How it works {#how-it-works}

1. In Jira, add Kener's account (for example `status@yourcompany.com`) as **request participant** (German: _Anfrageteilnehmer_) on a ticket that affects everyone.
2. In Kener, open **JSM Tickets** in the admin sidebar. The ticket appears under **New tickets**.
3. Pick the affected service and the impact (**Down** or **Degraded**), then click **Link**. Kener creates an incident on that service, titled with the ticket's summary.
4. Every 2 minutes Kener reads the linked tickets and posts each new **reply to customers** as an incident update. Internal comments are never read.

The ticket's status sets the incident state:

| Status category in Jira | Incident state |
| :---------------------- | :------------- |
| To do                   | Investigating  |
| In progress             | Identified     |
| Done                    | Resolved       |

When a ticket is reopened, the incident reopens. Kener keeps reading a ticket for 7 days after it is done.

> [!IMPORTANT]
> Every reply to customers written after linking is shown on the status page. Link a separate outage ticket that you write for the public, not a customer's own support ticket. Replies written before linking are not copied.

## Setup {#setup}

1. Create a customer account in your service project, for example `status@yourcompany.com`. Do not give it agent or admin rights.
2. Sign in as that account and create an API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). On Data Center, create a personal access token instead.
3. Set the [JSM environment variables](/docs/v4/setup/environment-variables#jira-service-management-connection) and restart Kener. Keep the token in your hosting platform's secrets, not in the repository.

| Variable        | Value                                                     |
| :-------------- | :-------------------------------------------------------- |
| `JSM_BASE_URL`  | `https://yourcompany.atlassian.net`                       |
| `JSM_EMAIL`     | The customer account's email (leave empty on Data Center) |
| `JSM_API_TOKEN` | The API token or personal access token                    |

Users need `incidents.read` to see the page and `incidents.write` to link, move, unlink or ignore tickets.

## Manage linked tickets {#manage}

- **Move**: change the service or impact of a linked ticket. The incident moves to the new service.
- **Unlink**: stop updating the incident. The incident and its updates stay.
- **Ignore**: hide a shared ticket from **New tickets**. **Restore** brings it back.
- **Sync now**: read all linked tickets at once instead of waiting.

Deleting the incident also removes its link.

## Troubleshooting {#troubleshooting}

| Message                                     | Fix                                                                |
| :------------------------------------------ | :----------------------------------------------------------------- |
| refused the sign-in (HTTP 401)              | Check `JSM_EMAIL` and `JSM_API_TOKEN`; the token may have expired. |
| Kener cannot see this ticket (HTTP 403/404) | Add Kener's account as request participant on the ticket again.    |
| Page says JSM is not connected              | Set `JSM_BASE_URL` and `JSM_API_TOKEN`, then restart Kener.        |
