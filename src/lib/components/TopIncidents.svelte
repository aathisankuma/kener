<script lang="ts">
  // Incidents that affect everyone, in a box each at the top of the status page: the title in a
  // coloured bar and the latest update below. A resolved one turns green and stays for 24 hours.
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { SveltePurify } from "@humanspeak/svelte-purify";
  import { formatDistanceToNow } from "date-fns";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import mdToHTML from "$lib/marked";
  import { t } from "$lib/stores/i18n";
  import { formatDate, dateFnsLocale } from "$lib/stores/datetime";
  import type { TopIncident } from "$lib/server/controllers/dashboardController";

  let { incidents = [] }: { incidents?: TopIncident[] } = $props();

  /** Boxes shown before "Show N more". */
  const FIRST = 3;
  let showAll = $state(false);
  const shown = $derived(showAll ? incidents : incidents.slice(0, FIRST));

  const isResolved = (incident: TopIncident) => incident.state === "RESOLVED";
  const barStyle = (incident: TopIncident) => {
    if (isResolved(incident)) return "background: var(--up); color: #fff";
    if (incident.top_impact === "DEGRADED") return "background: var(--degraded); color: #1f2328";
    return "background: var(--down); color: #fff";
  };
  const ago = (seconds: number) =>
    formatDistanceToNow(new Date(seconds * 1000), { addSuffix: true, locale: $dateFnsLocale });
</script>

{#if incidents.length > 0}
  <section class="flex flex-col gap-3" aria-label={$t("Incidents")}>
    {#each shown as incident (incident.id)}
      {@const when = incident.latest?.commented_at ?? incident.start_date_time}
      <a
        href={clientResolver(resolve, incident.href)}
        class="group bg-background block overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md"
        data-testid="top-incident"
      >
        <div class="flex items-center justify-between gap-3 px-4 py-2.5" style={barStyle(incident)}>
          <span class="min-w-0 font-semibold wrap-break-word">{incident.title}</span>
          <span class="flex shrink-0 items-center gap-1 text-xs font-semibold tracking-wide uppercase">
            {isResolved(incident) ? $t("Resolved") : $t(incident.state)}
            <ChevronRight class="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
        <div class="px-4 py-3 text-sm">
          {#if incident.latest}
            <div class="prose prose-sm dark:prose-invert line-clamp-3 max-w-none [&_p]:my-0">
              <SveltePurify html={mdToHTML(incident.latest.comment)} />
            </div>
          {/if}
          <div class="text-muted-foreground mt-1.5 flex flex-wrap gap-x-2 text-xs">
            <span title={$formatDate(when, page.data.dateAndTimeFormat.datePlusTime)}>{ago(when)}</span>
            {#if incident.monitorNames.length > 0}
              <span aria-hidden="true">·</span>
              <span>{incident.monitorNames.join(", ")}</span>
            {/if}
          </div>
        </div>
      </a>
    {/each}
    {#if incidents.length > FIRST}
      <button
        type="button"
        class="text-muted-foreground self-start text-sm hover:underline"
        onclick={() => (showAll = !showAll)}
      >
        {showAll ? $t("Show less") : $t("Show %count more", { count: String(incidents.length - FIRST) })}
      </button>
    {/if}
  </section>
{/if}
