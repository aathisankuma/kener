---
title: "Reports"
description: "Let staff report a service that is not working, and email a monthly uptime report."
---

Two features under **Reports** in the admin sidebar: a **"not working" button** that staff press on a service, and a **monthly uptime report** by email. Both send email, so [set up email](/docs/v4/setup/email-setup) first.

## "Not working" button {#not-working-button}

Staff press **Not working** on a service. Kener counts each browser once per service. When enough different people report the same service within a short time, Kener emails the addresses you chose, once per period.

1. Open **Monitors**, pick the service, and open **"Not working" Button**. Turn on **Show the button on the status page** and save. The button is off for every service until you turn it on.
2. Open **Reports** and fill in the **"Not working" button** card:

| Setting                               | Default | Meaning                                                                     |
| :------------------------------------ | :------ | :-------------------------------------------------------------------------- |
| Email these addresses                 | none    | One per line. Without addresses, reports are counted but nobody is emailed. |
| When … people report within … minutes | 3, 15   | Different browsers that must report the service within that time.           |
| Show staff how many reported          | on      | Shows "3 reports in the last minutes" next to the button.                   |
| Link for personal help                | none    | Shown after reporting, for example your service desk portal.                |

The button appears on the status page and on the service's page. It never appears for a [hidden](/docs/v4/monitors/visibility) service.

Kener recognises a browser by an anonymous random id in a cookie, not by its address, because everyone in an office shares one address. Kener stores only a hash of that id. Reports older than 180 days are deleted.

## Monthly uptime report {#monthly-uptime-report}

On the 1st of each month from 07:00, Kener emails a table with each active service's uptime, incidents and estimated downtime for the month before, compared with the month before that.

1. Open **Reports** and fill in the **Monthly uptime report** card: the addresses to send to and the time zone in which months start and end.
2. Turn on **Send the report every month** and save. The first report goes out on the next 1st.
3. To see a report now, click **Send … now**. It sends last month's report to the addresses in the card.

Hidden services are included and marked as hidden, because the report goes only to the addresses you entered. Downtime is estimated from the failed checks multiplied by the time between checks.

## Troubleshooting {#troubleshooting}

| Problem                          | Fix                                                                                                                         |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| No email after enough reports    | Check the addresses under **Reports** and the [email setup](/docs/v4/setup/email-setup). An email goes out once per period. |
| The button does not appear       | Turn it on for the service, and check that the service is active and not hidden.                                            |
| "Last attempt failed" in Reports | The monthly report could not be sent. Kener tries again every 5 minutes until it works.                                     |
