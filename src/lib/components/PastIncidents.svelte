<script lang="ts">
  // Closed Jira Service Management incidents of the last 3 months, at the bottom of the status
  // page: one line each, newest first. Each leads to the incident with all its updates.
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import { t } from "$lib/stores/i18n";
  import { formatDate, formatDuration } from "$lib/stores/datetime";
  import type { PastIncident } from "$lib/server/controllers/dashboardController";

  let { incidents = [] }: { incidents?: PastIncident[] } = $props();

  /** Lines shown before "Show N more". */
  const FIRST = 5;
  let showAll = $state(false);
  const shown = $derived(showAll ? incidents : incidents.slice(0, FIRST));
</script>

{#if incidents.length > 0}
  <section class="overflow-hidden rounded-3xl border" data-testid="past-incidents">
    <div class="flex items-baseline justify-between gap-3 border-b px-4 py-3">
      <h2 class="font-semibold">{$t("Past Incidents")}</h2>
      <span class="text-muted-foreground text-xs">{$t("Last 3 months")}</span>
    </div>
    <ul>
      {#each shown as incident (incident.id)}
        <li class="border-b last:border-b-0">
          <a
            href={clientResolver(resolve, `/incidents/${incident.id}`)}
            class="hover:bg-muted/50 flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <span class="min-w-0 text-sm font-medium wrap-break-word">
              <span class="mr-1.5 inline-block size-2 rounded-full" style="background: var(--up)"></span>
              {incident.title}
            </span>
            <span class="text-muted-foreground shrink-0 text-xs">
              {$formatDate(incident.start_date_time, page.data.dateAndTimeFormat.dateOnly)}
              · {$formatDuration(incident.start_date_time, incident.end_date_time)}
              {#if incident.monitorNames.length > 0}· {incident.monitorNames.join(", ")}{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
    {#if incidents.length > FIRST}
      <button
        type="button"
        class="text-muted-foreground w-full border-t px-4 py-2 text-left text-sm hover:underline"
        onclick={() => (showAll = !showAll)}
      >
        {showAll ? $t("Show less") : $t("Show %count more", { count: String(incidents.length - FIRST) })}
      </button>
    {/if}
  </section>
{/if}
