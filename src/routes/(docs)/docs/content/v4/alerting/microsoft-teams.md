---
title: "Microsoft Teams"
description: 'Send alerts, incident updates and "not working" reports to a Teams chat or channel through a Teams Workflows webhook.'
---

Kener posts to a Microsoft Teams chat or channel through a **Workflows** webhook. You paste the webhook URL once; Kener builds each message as an Adaptive Card. No trigger, template or JSON is needed.

## Create the webhook in Teams {#create-the-webhook}

1. In Teams, sign in with the account that should own the workflow, for example a shared IT account, and open the app **Workflows**.
2. Create a workflow from the template **Send webhook alerts to a chat** (German: _Webhook-Benachrichtigungen an einen Chat senden_), or **Send webhook alerts to a channel**.
3. Choose the chat or channel, for example **Monitoring**, and finish.
4. Copy the URL that Teams shows at the end.

> [!WARNING]
> Anyone with this URL can post into the chat. Do not put it in a repository or a ticket. Kener does not show it again after saving.

## Connect Kener {#connect-kener}

1. Open **Microsoft Teams** in the admin sidebar.
2. Paste the URL and choose what to send:

| Switch                | Sends                                                                                                                                       |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| Monitoring alerts     | Every alert from [Alerts](/docs/v4/alerting/overview): red when it fires, green when it is resolved. Sent besides the alert's own triggers. |
| Incident updates      | Each update posted on an incident, including those from [Jira Service Management](/docs/v4/incidents/jira-service-management).              |
| "Not working" reports | When enough people report a service with the [button](/docs/v4/reports#not-working-button).                                                 |

3. Click **Save**, then **Send test message**. A green message appears in the chat.

To replace the webhook, paste a new URL and save. **Remove webhook** stops all messages.

Times in a message show in each reader's own time zone. The messages are in German.

## Troubleshooting {#troubleshooting}

| Message                              | Fix                                                                                                   |
| :----------------------------------- | :---------------------------------------------------------------------------------------------------- |
| Kener could not reach Teams          | Check the URL and that the Kener server can reach the internet.                                       |
| Teams refused the message (HTTP 4xx) | The workflow was deleted or turned off, or its owner lost access. Create a new one and paste its URL. |
| Nothing arrives after an alert       | Check that **Monitoring alerts** is on and that the alert is active under **Alerts**.                 |
