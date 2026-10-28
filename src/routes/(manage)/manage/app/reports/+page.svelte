<script lang="ts">
  // Settings for the "not working" button and the monthly uptime report, and the services
  // reported in the last days.
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import MegaphoneIcon from "@lucide/svelte/icons/megaphone";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import { formatDistanceToNow } from "date-fns";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import type { ProblemReportSettings, UptimeReportSettings } from "$lib/server/controllers/reportsController.js";

  let { data }: { data: { userPermissions: string[] } } = $props();
  const canWrite = $derived((data.userPermissions ?? []).includes("settings.write"));

  type Overview = {
    days: number;
    services: Array<{ monitor_tag: string; name: string; reporters: number; last_at: number; alerts: number }>;
    enabled: Array<{ tag: string; name: string }>;
  };

  let loading = $state(true);
  let busy = $state<string | null>(null);
  let overview = $state<Overview | null>(null);

  // "Not working" button
  let problemRecipients = $state("");
  let threshold = $state(3);
  let windowMinutes = $state(15);
  let showCount = $state(true);
  let helpUrl = $state("");

  // Monthly report
  let reportEnabled = $state(false);
  let reportRecipients = $state("");
  let timezone = $state("UTC");
  let lastError = $state<string | null>(null);

  const timezones: string[] = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  })();

  async function call(action: string, payload: Record<string, unknown> = {}) {
    const response = await fetch(clientResolver(resolve, "/manage/api"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data: payload })
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "Request failed");
    return result;
  }

  function apply(problem: ProblemReportSettings, uptime: UptimeReportSettings) {
    problemRecipients = problem.recipients.join("\n");
    threshold = problem.threshold;
    windowMinutes = problem.windowMinutes;
    showCount = problem.showCount;
    helpUrl = problem.helpUrl;
    reportEnabled = uptime.enabled;
    reportRecipients = uptime.recipients.join("\n");
    // Never saved: suggest the browser's time zone.
    timezone =
      uptime.timezone === "UTC" && !uptime.enabled && uptime.recipients.length === 0
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        : uptime.timezone;
    lastError = uptime.lastError;
  }

  async function load() {
    loading = true;
    try {
      const result = await call("getReportSettings");
      apply(result.problem, result.uptime);
      overview = result.overview;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the settings");
    } finally {
      loading = false;
    }
  }

  async function run(key: string, action: string, payload: Record<string, unknown>, done: (r: any) => string) {
    busy = key;
    try {
      const result = await call(action, payload);
      toast.success(done(result));
      if (action !== "sendUptimeReportNow") await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      busy = null;
    }
  }

  const ago = (s: number) => formatDistanceToNow(new Date(s * 1000), { addSuffix: true });
  const nextReportLabel = $derived.by(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return `1 ${d.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}, 07:00`;
  });
  const lastMonthLabel = $derived.by(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  });

  onMount(load);
</script>

<div class="container mx-auto space-y-6 py-6">
  <div>
    <h1 class="flex items-center gap-2 text-2xl font-semibold"><MegaphoneIcon class="size-6" /> Reports</h1>
    <p class="text-muted-foreground max-w-3xl text-sm">
      The "not working" button that staff press on a service, and the uptime report emailed each month.
    </p>
  </div>

  {#if loading && !overview}
    <div class="flex justify-center py-10"><Spinner class="size-6" /></div>
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>"Not working" button</Card.Title>
        <Card.Description>
          Staff report with one click that a service is not working. Each browser counts once per service. When enough
          different people report the same service within the time below, the addresses here are emailed, once per
          period. Turn the button on per service under Monitors → the service → "Not working" Button.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-5">
        <div class="grid gap-5 md:grid-cols-2">
          <div class="space-y-2">
            <Label for="problem-recipients">Email these addresses</Label>
            <textarea
              id="problem-recipients"
              class="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
              placeholder={"it@example.com\nhelpdesk@example.com"}
              bind:value={problemRecipients}
              disabled={!canWrite}
            ></textarea>
            <p class="text-muted-foreground text-xs">One per line. Empty: reports are counted, nobody is emailed.</p>
          </div>
          <div class="space-y-4">
            <div class="flex flex-wrap items-end gap-2 text-sm">
              <div class="space-y-2">
                <Label for="threshold">When</Label>
                <Input
                  id="threshold"
                  type="number"
                  min="1"
                  max="50"
                  class="w-20"
                  bind:value={threshold}
                  disabled={!canWrite}
                />
              </div>
              <span class="pb-2">people report within</span>
              <div class="space-y-2">
                <Label for="window">Minutes</Label>
                <Input
                  id="window"
                  type="number"
                  min="5"
                  max="1440"
                  class="w-24"
                  bind:value={windowMinutes}
                  disabled={!canWrite}
                />
              </div>
              <span class="pb-2">minutes</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <div>
                <Label for="show-count">Show staff how many reported</Label>
                <p class="text-muted-foreground text-xs">"3 reports in the last minutes" next to the button.</p>
              </div>
              <Switch id="show-count" bind:checked={showCount} disabled={!canWrite} />
            </div>
            <div class="space-y-2">
              <Label for="help-url">Link for personal help (optional)</Label>
              <Input
                id="help-url"
                placeholder="https://yourcompany.atlassian.net/servicedesk/customer/portal/1"
                bind:value={helpUrl}
                disabled={!canWrite}
              />
              <p class="text-muted-foreground text-xs">Shown after reporting, e.g. your service desk portal.</p>
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <Label>Services with the button</Label>
          {#if overview && overview.enabled.length > 0}
            <div class="flex flex-wrap gap-2">
              {#each overview.enabled as service (service.tag)}
                <a href={clientResolver(resolve, `/manage/app/monitors/${service.tag}`)}>
                  <Badge variant="outline">{service.name}</Badge>
                </a>
              {/each}
            </div>
          {:else}
            <p class="text-muted-foreground text-sm">None yet.</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label>Reported in the last {overview?.days ?? 7} days</Label>
          {#if overview && overview.services.length > 0}
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Service</Table.Head>
                  <Table.Head>People</Table.Head>
                  <Table.Head>Last report</Table.Head>
                  <Table.Head>Emails sent</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each overview.services as row (row.monitor_tag)}
                  <Table.Row>
                    <Table.Cell>{row.name}</Table.Cell>
                    <Table.Cell>{row.reporters}</Table.Cell>
                    <Table.Cell>{ago(row.last_at)}</Table.Cell>
                    <Table.Cell>{row.alerts}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {:else}
            <p class="text-muted-foreground text-sm">No reports.</p>
          {/if}
        </div>
      </Card.Content>
      {#if canWrite}
        <Card.Footer class="flex justify-end">
          <Button
            disabled={busy !== null}
            onclick={() =>
              run(
                "problem",
                "saveProblemReportSettings",
                { recipients: problemRecipients, threshold, windowMinutes, showCount, helpUrl },
                () => "Saved"
              )}
          >
            {#if busy === "problem"}<Spinner class="size-4" />{/if} Save
          </Button>
        </Card.Footer>
      {/if}
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Monthly uptime report</Card.Title>
        <Card.Description>
          On the 1st of each month from 07:00, an email with uptime, incidents and estimated downtime per service for
          the month before, compared with the month before that.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-5">
        <div class="flex items-center justify-between gap-3">
          <Label for="report-enabled">Send the report every month</Label>
          <Switch id="report-enabled" bind:checked={reportEnabled} disabled={!canWrite} />
        </div>
        <div class="grid gap-5 md:grid-cols-2">
          <div class="space-y-2">
            <Label for="report-recipients">Send to</Label>
            <textarea
              id="report-recipients"
              class="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
              placeholder={"management@example.com\nit@example.com"}
              bind:value={reportRecipients}
              disabled={!canWrite}
            ></textarea>
            <p class="text-muted-foreground text-xs">One per line.</p>
          </div>
          <div class="space-y-2">
            <Label for="timezone">Time zone</Label>
            <Input id="timezone" list="timezones" bind:value={timezone} disabled={!canWrite} />
            <datalist id="timezones">
              {#each timezones as tz (tz)}<option value={tz}></option>{/each}
            </datalist>
            <p class="text-muted-foreground text-xs">Months start and end at midnight here.</p>
            <p class="text-muted-foreground text-xs">
              {#if reportEnabled}Next report: {nextReportLabel}{:else}Not sent automatically.{/if}{#if lastError}<span
                  class="text-destructive"
                >
                  · Last attempt failed: {lastError}</span
                >{/if}
            </p>
          </div>
        </div>
      </Card.Content>
      {#if canWrite}
        <Card.Footer class="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy !== null || !reportRecipients.trim()}
            onclick={() =>
              run(
                "send",
                "sendUptimeReportNow",
                { recipients: reportRecipients },
                (r) => `Report for ${r.month} sent to ${r.recipients} address(es)`
              )}
          >
            {#if busy === "send"}<Spinner class="size-4" />{/if} Send {lastMonthLabel} now
          </Button>
          <Button
            disabled={busy !== null}
            onclick={() =>
              run(
                "uptime",
                "saveUptimeReportSettings",
                { enabled: reportEnabled, recipients: reportRecipients, timezone },
                () => "Saved"
              )}
          >
            {#if busy === "uptime"}<Spinner class="size-4" />{/if} Save
          </Button>
        </Card.Footer>
      {/if}
    </Card.Root>
  {/if}
</div>
