---
title: Basic Setup
description: Learn how to set up Kener with a simple configuration
---

Once you have Kener running, you should now have a basic status page up and running. However, you may want to customize it further to fit your needs. In this section, we will go through some of the basic setup options available in Kener.

Most of the default settings are designed to work out of the box, but you can customize them by using the dashboard.

## Customize {#customize}

### Site Configuration {#site-configuration}

- **Site Name**: The name of your status page. This will be displayed in the header and title of the page.
- **Site URL**: The URL of your status page. This is used for sharing and linking to your status page.

> [!IMPORTANT]
> Setting up the Site URL correctly is very important for Kener to function properly.

## Add your first monitor (website) {#add-your-first-monitor-website}

Use this flow to add a simple HTTP/website monitor.

### Step 1: Create a new monitor {#create-new-monitor}

1. Open **Manage → Monitors**.
2. Click **New Monitor**. The page shows **Monitor Type Configuration** first, then **General Settings**.
3. Pick the **Monitor Type**, e.g. **API** for a website, and fill in its fields, e.g. the target URL:

    ```text
    https://example.com
    ```

    For a [Cloud Service monitor](/docs/v4/monitors/cloud), the name and tag follow the chosen service until you type your own.

4. In **General Settings**, set at least the **Name** (display name) and the **Tag** (unique id, e.g. `homepage`).
5. Click **Create Monitor**. It saves the type and the general settings together.

### Step 2: Test the check {#configure-website-check}

In **General Settings**, click **Test Monitor**. It checks the saved settings: after a change, click **Save Monitor** first. Change the check interval in **General Settings → Cron Schedule**.

### Step 3: Make it visible on status page {#make-monitor-visible}

Open **Page Visibility** and add the monitor to at least one page.

> [!IMPORTANT]
> A monitor not added to any page will not appear on the public status page.

### Step 4: Verify {#verify-monitor}

1. Save the monitor.
2. Open **View** from the monitor page.
3. Confirm it appears and starts collecting checks.

For all API/website monitor options, see [API Monitors](/docs/v4/monitors/api).
