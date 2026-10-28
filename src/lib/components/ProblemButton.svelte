<script lang="ts">
  // "Not working" on a service: one click reports it. IT is emailed when enough colleagues
  // report the same service within a short time. Sits above a card's stretched link.
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Check from "@lucide/svelte/icons/check";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import { t } from "$lib/stores/i18n";
  import type { ProblemButtonData } from "$lib/server/controllers/reportsController";

  let { tag, info }: { tag: string; info: ProblemButtonData } = $props();

  let status = $state<"idle" | "sending" | "sent" | "error">("idle");
  let sentCount = $state<number | null>(null);
  let errorText = $state("");
  const count = $derived(sentCount ?? info.counts[tag] ?? 0);

  async function report(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (status === "sending" || status === "sent") return;
    status = "sending";
    try {
      const response = await fetch(clientResolver(resolve, `/monitors/${encodeURIComponent(tag)}/report`), {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "");
      sentCount = typeof result.count === "number" ? result.count : null;
      status = "sent";
    } catch (e) {
      errorText = e instanceof Error && e.message ? e.message : $t("Could not send the report");
      status = "error";
    }
  }
</script>

<div
  class="problem-button relative z-10 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
  data-testid="problem-button"
>
  {#if status === "sent"}
    <span class="text-up inline-flex items-center gap-1 font-medium">
      <Check class="size-3.5" />
      {$t("Thanks, reported")}
    </span>
    {#if info.helpUrl}
      <a class="text-muted-foreground underline" href={info.helpUrl} target="_blank" rel="noreferrer">
        {$t("Need personal help? Open a ticket")}
      </a>
    {/if}
  {:else}
    <button
      type="button"
      class="text-muted-foreground hover:text-down hover:border-down inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors disabled:opacity-60"
      onclick={report}
      disabled={status === "sending"}
    >
      <CircleAlert class="size-3.5" />
      {$t("Not working")}
    </button>
    {#if status === "error"}
      <span class="text-down">{errorText}</span>
    {/if}
  {/if}
  {#if info.showCount && count > 0}
    <span class="text-muted-foreground">
      {count === 1
        ? $t("1 report in the last minutes")
        : $t("%count reports in the last minutes", { count: String(count) })}
    </span>
  {/if}
</div>
