<script lang="ts">
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { SveltePurify } from "@humanspeak/svelte-purify";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import clientResolver from "$lib/client/resolver.js";
  import { t } from "$lib/stores/i18n";
  import { formatDate } from "$lib/stores/datetime";
  import type { CloudDetails, CloudIncident, CloudStatus } from "$lib/cloudServices.js";

  interface Props {
    tag: string;
    /** How many days of past incidents to list, today included. */
    days?: number;
  }

  let { tag, days = 15 }: Props = $props();

  let details = $state<CloudDetails | null>(null);
  let loading = $state(true);
  let errorMessage = $state("");

  onMount(async () => {
    try {
      const response = await fetch(
        clientResolver(resolve, "/dashboard-apis/cloud-details") + `?tag=${encodeURIComponent(tag)}`
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${response.status}`);
      }
      details = await response.json();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });

  const STATUS_LABEL: Record<CloudStatus, string> = {
    UP: "Operational",
    DEGRADED: "Degraded Performance",
    DOWN: "Major Outage",
    MAINTENANCE: "Under Maintenance"
  };
  const STATUS_CLASS: Record<CloudStatus, string> = {
    UP: "text-up",
    DEGRADED: "text-degraded",
    DOWN: "text-down",
    MAINTENANCE: "text-maintenance"
  };
  // Provider steps Kener has a translation for (Statuspage uses the same words as Kener).
  const KNOWN_STEPS = new Set([
    "INVESTIGATING",
    "IDENTIFIED",
    "MONITORING",
    "RESOLVED",
    "SCHEDULED",
    "IN_PROGRESS",
    "VERIFYING",
    "COMPLETED",
    "POSTMORTEM"
  ]);
  function stepLabel(step: string): string {
    const key = step.toUpperCase();
    if (KNOWN_STEPS.has(key)) return $t(key);
    return step ? step.charAt(0).toUpperCase() + step.slice(1).replace(/_/g, " ") : "";
  }

  const dateFormat = $derived(page.data.dateAndTimeFormat?.datePlusTime || "PPp");
  const dayKey = (seconds: number) => $formatDate(seconds * 1000, "yyyy-MM-dd");

  let openIncidents = $derived(details ? details.incidents.filter((i) => !i.resolved) : []);
  let activeMaintenances = $derived(
    details ? details.maintenances.filter((m) => !["completed", "resolved"].includes(m.status.toLowerCase())) : []
  );

  // Past incidents grouped by day, like the provider's page: one heading per day, newest first.
  let pastDays = $derived.by(() => {
    if (!details) return [];
    const byDay = new Map<string, CloudIncident[]>();
    for (const incident of details.incidents) {
      const key = dayKey(incident.startedAt);
      byDay.set(key, [...(byDay.get(key) ?? []), incident]);
    }
    const now = Date.now();
    return Array.from({ length: days }, (_, i) => {
      const at = now - i * 24 * 60 * 60 * 1000;
      const key = $formatDate(at, "yyyy-MM-dd");
      return { key, label: $formatDate(at, "PPP"), isToday: i === 0, incidents: byDay.get(key) ?? [] };
    });
  });
</script>

{#snippet updateList(incident: CloudIncident)}
  <div class="flex flex-col gap-2">
    {#each incident.updates as update, i (i)}
      <div class="text-sm">
        {#if update.status}
          <span class="font-semibold">{stepLabel(update.status)}</span>
          <span class="text-muted-foreground">–</span>
        {/if}
        {#if update.isHtml}
          <span class="cloud-update-html inline"><SveltePurify html={update.body} /></span>
        {:else}
          <span class="whitespace-pre-line">{update.body}</span>
        {/if}
        <div class="text-muted-foreground text-xs">{$formatDate(update.at * 1000, dateFormat)}</div>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet incidentBlock(incident: CloudIncident)}
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {#if incident.url}
        <a
          href={incident.url}
          target="_blank"
          rel="noopener noreferrer"
          class="font-semibold hover:underline {STATUS_CLASS[incident.impact]}"
        >
          {incident.title}
        </a>
      {:else}
        <span class="font-semibold {STATUS_CLASS[incident.impact]}">{incident.title}</span>
      {/if}
      {#if incident.affected.length > 0}
        <span class="text-muted-foreground text-xs">{$t("Affects")}: {incident.affected.join(", ")}</span>
      {/if}
    </div>
    {@render updateList(incident)}
  </div>
{/snippet}

<div class="cloud-details flex flex-col gap-3">
  {#if loading}
    <div class="rounded-3xl border p-4">
      <Skeleton class="mb-3 h-5 w-48" />
      <Skeleton class="mb-2 h-4 w-full" />
      <Skeleton class="mb-2 h-4 w-full" />
      <Skeleton class="h-4 w-2/3" />
    </div>
  {:else if errorMessage || !details}
    <div class="text-muted-foreground rounded-3xl border p-4 text-sm">
      {$t("Could not load the provider's details")}: {errorMessage}
    </div>
  {:else}
    {#each activeMaintenances as maintenance (maintenance.id)}
      <div class="border-maintenance cloud-maintenance flex flex-col gap-2 rounded-3xl border p-4">
        <div class="text-maintenance text-xs font-semibold uppercase">{$t("Scheduled Maintenance")}</div>
        {#if maintenance.scheduledFor}
          <div class="text-muted-foreground text-xs">
            {$formatDate(maintenance.scheduledFor * 1000, dateFormat)}
            {#if maintenance.scheduledUntil}– {$formatDate(maintenance.scheduledUntil * 1000, dateFormat)}{/if}
          </div>
        {/if}
        {@render incidentBlock(maintenance)}
      </div>
    {/each}

    {#each openIncidents as incident (incident.id)}
      <div class="cloud-open-incident flex flex-col gap-2 rounded-3xl border p-4">
        <div class="text-xs font-semibold uppercase {STATUS_CLASS[incident.impact]}">{$t("Active Incident")}</div>
        {@render incidentBlock(incident)}
      </div>
    {/each}

    {#if details.components.length > 0}
      <div class="cloud-components overflow-hidden rounded-3xl border">
        {#each details.components as component, i (component.id)}
          {#if component.group && component.group !== details.components[i - 1]?.group}
            <div class="text-muted-foreground bg-muted/40 border-b px-4 py-2 text-xs font-semibold uppercase">
              {component.group}
            </div>
          {/if}
          <div class="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate text-sm font-medium">{component.name}</span>
              {#if component.description}
                <Tooltip.Root>
                  <Tooltip.Trigger
                    class="text-muted-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold"
                    aria-label={component.description}
                  >
                    ?
                  </Tooltip.Trigger>
                  <Tooltip.Content class="max-w-xs">{component.description}</Tooltip.Content>
                </Tooltip.Root>
              {/if}
            </div>
            <span class="shrink-0 text-sm {STATUS_CLASS[component.status]}">{$t(STATUS_LABEL[component.status])}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="cloud-past flex flex-col gap-4 rounded-3xl border p-4">
      <h2 class="text-lg font-semibold">{$t("Past Incidents")}</h2>
      {#each pastDays as day (day.key)}
        <div class="flex flex-col gap-3">
          <h3 class="border-b pb-1 text-sm font-semibold">{day.label}</h3>
          {#if day.incidents.length === 0}
            <p class="text-muted-foreground text-sm">
              {day.isToday ? $t("No incidents reported today.") : $t("No incidents reported.")}
            </p>
          {:else}
            {#each day.incidents as incident (incident.id)}
              {@render incidentBlock(incident)}
            {/each}
          {/if}
        </div>
      {/each}
    </div>

    <div class="text-muted-foreground flex flex-wrap items-center justify-between gap-2 px-2 text-xs">
      <span>
        {$t("Source")}: {details.provider.label}
        ({details.provider.kind === "m365"
          ? "Microsoft 365 Service Health"
          : details.provider.kind === "instatus"
            ? "Instatus"
            : details.provider.kind === "azure"
              ? "Azure Resource Health"
              : "Statuspage"}) · {$formatDate(details.fetchedAt * 1000, dateFormat)}
        {#if details.incidentsFromPage}
          · {$t("Incidents and maintenance of the whole %name page.", { name: details.incidentsFromPage })}
        {/if}
      </span>
      {#if details.provider.pageUrl}
        <a
          href={details.provider.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 hover:underline"
        >
          {$t("Open the provider's status page")}
          <ArrowUpRight class="size-3" />
        </a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cloud-update-html :global(p) {
    display: inline;
    margin: 0;
  }
  .cloud-update-html :global(a) {
    text-decoration: underline;
  }
  .border-maintenance {
    border-color: var(--maintenance);
  }
</style>
