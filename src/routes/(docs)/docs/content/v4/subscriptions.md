---
title: User Subscriptions
description: Let users subscribe to incident and maintenance email updates
---

Use subscriptions to let users receive email updates for **incidents** and **maintenances**.

## How subscriptions work {#how-subscriptions-work}

1. Admin enables subscriptions in dashboard settings.
2. Email must be configured (SMTP/Resend) so verification and update emails can be sent.
3. User subscribes from the public status page using email + OTP verification.
4. User enables incidents and/or maintenances preferences.
5. When events are triggered, Kener sends emails to active subscribers for that event type.

## Prerequisites {#prerequisites}

Before users can subscribe:

- Subscriptions must be enabled in **Manage → Subscriptions**.
- At least one email subscription type must be enabled (`incidents` and/or `maintenances`).
- Email setup must be valid.

> [!IMPORTANT]
> The subscribe UI is shown only when subscriptions are enabled **and** email sending is available.

See [Email Setup](/docs/v4/setup/email-setup).

## Enable subscriptions (admin) {#enable-subscriptions-admin}

Go to **Manage → Subscriptions**:

1. Turn on **Enable Subscriptions**.
2. Enable one or both:
    - **Incident Updates**
    - **Maintenance Updates**
3. Save.

This writes the `subscriptionsSettings` site configuration used by the subscription API.

## How users subscribe (public flow) {#how-users-subscribe-public-flow}

From the status page, user clicks **Subscribe**:

1. Enter email. If a [Captcha provider](/docs/v4/captcha) is enabled, solve the challenge first.
2. Kener sends a 6-digit verification code.
3. User enters OTP to verify.
4. Kener stores a subscriber session token in browser storage.
5. User toggles preferences for incidents and/or maintenances.
6. Optional: user turns on **Only selected services** and ticks the monitors they care about. See [Choose services](#choose-services).

If token is invalid/expired, user is asked to verify again.

## Choose services {#choose-services}

By default a subscriber hears of every incident and maintenance. With **Only selected services** on, they hear only of events that affect a monitor they ticked.

- The list shows active monitors that are not hidden.
- Choosing a [group monitor](/docs/v4/monitors/group) also covers its member monitors. An event on a group reaches the subscribers of its members.
- An incident or maintenance with no monitors reaches every subscriber.
- With nothing ticked, the subscriber still hears of every service. The choice is saved once at least one service is ticked.

The choice applies to both incident and maintenance emails.

### Subscribe from a monitor or page {#subscribe-to-this-service}

On a monitor's page and on every status page except the home page, the subscribe button reads **Subscribe to this service**. After signing in, Kener applies that page's monitors:

| Subscriber before                           | After                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| New, or incidents and maintenances both off | Gets updates only for this page's monitors; incidents and maintenances on  |
| Already chose some services                 | This page's monitors are added to the choice                               |
| Gets updates for every service              | Unchanged: they already hear of this service. They can narrow it down here |

The dialog says which case applied. Monitors that are hidden or not active are left out.

## Add subscriber from backend (admin) {#add-subscriber-from-backend-admin}

You can add subscribers manually from **Manage → Subscriptions**:

1. Click **Add Subscriber**.
2. Enter email.
3. Select event types (incidents, maintenances).
4. Save.

Admins can also:

- Toggle incident/maintenance subscription per subscriber
- Delete subscribers

## When notifications are triggered {#when-notifications-are-triggered}

Kener emails subscribers about an incident or maintenance only when it is global (`is_global = YES`), is [shown at the top](/docs/v4/incidents/creating-managing#show-at-top), or affects at least one monitor that is not hidden. An incident shown at the top is emailed to every incident subscriber, whatever services they chose. See [Monitor visibility](/docs/v4/monitors/visibility#where-each-rule-applies).

### Incident notifications {#incident-notifications}

Kener queues an incident subscription email for each update posted on an incident, from any source:

- An update added in the dashboard
- An update added through the API (`POST /api/v4/incidents/{incident_id}/comments`)
- The update an alert adds when it creates the incident, and when it resolves it

Updates on legacy incidents of type `MAINTENANCE` (from before v4 maintenances) do not queue this email.

### Maintenance notifications {#maintenance-notifications}

Maintenance subscription emails are queued on maintenance event status transitions:

- `READY` (starting soon)
- `ONGOING`
- `COMPLETED`

## How emails are delivered {#how-emails-are-delivered}

When an event is queued:

1. Kener selects active subscribers for that `event_type`, keeping only those whose [chosen services](#choose-services) include an affected monitor.
2. Kener renders the `subscription_update` email template with event/site variables.
3. Kener enqueues **one email per recipient** (privacy-safe fan-out).
4. Email sender queue sends the final emails.

## Verify your setup {#verify-your-setup}

- Enable subscriptions in dashboard.
- Confirm email setup works.
- Subscribe with a test email from public status page.
- Enable incident and/or maintenance preferences.
- Trigger a test incident or wait for maintenance state transition.
- Confirm email arrives.
