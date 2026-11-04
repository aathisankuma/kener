<script lang="ts">
  // "Choose services": a visitor ticks the services they want to see on this page. The choice is
  // kept in their browser. Services the administrator marked "always shown" stay ticked.
  import { t } from "$lib/stores/i18n";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import Lock from "@lucide/svelte/icons/lock";
  import trackEvent from "$lib/beacon";

  import { page } from "$app/state";
  import { navigationMenuTriggerStyle } from "$lib/components/ui/navigation-menu/navigation-menu-trigger.svelte";
  import { serviceChoice, SetHiddenServices } from "$lib/client/serviceChoice.svelte";

  // Shown on status pages with more than one service: the page's data has the services.
  const tags = $derived((page.data?.monitorTags ?? []) as string[]);
  const names = $derived((page.data?.monitorNames ?? {}) as Record<string, string>);
  const alwaysShown = $derived((page.data?.alwaysShownTags ?? []) as string[]);
  const available = $derived(tags.length > 1 && !!page.data?.monitorNames);
  const hidden = $derived(serviceChoice.hidden);

  let open = $state(false);
  const locked = $derived(new Set(alwaysShown));
  const hiddenCount = $derived(tags.filter((t) => hidden.includes(t) && !locked.has(t)).length);

  function store(next: string[]) {
    SetHiddenServices(next);
  }

  function toggle(tag: string, shown: boolean) {
    store(shown ? hidden.filter((t) => t !== tag) : [...new Set([...hidden, tag])]);
    trackEvent("services_chosen", { shown: tags.length - hiddenCount });
  }
</script>

{#if available}
  <Dialog.Root bind:open>
    <Dialog.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          data-testid="choose-services"
          title={$t("Choose services")}
          class="{navigationMenuTriggerStyle()} hover:border-border gap-1.5 border border-transparent bg-transparent text-xs hover:bg-transparent focus:bg-current/10 focus:text-current data-[state=open]:bg-current/10 data-[state=open]:text-current"
          style="border-radius: var(--radius-3xl)"
        >
          <SlidersHorizontal class="size-3.5" />
          <span class="hidden sm:inline">{$t("Choose services")}</span>
          {#if hiddenCount > 0}
            <span class="rounded-full bg-current/15 px-1.5 text-[10px] font-semibold">−{hiddenCount}</span>
          {/if}
        </button>
      {/snippet}
    </Dialog.Trigger>
    <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title>{$t("Choose services")}</Dialog.Title>
        <Dialog.Description>
          {$t("Tick the services you want to see. Your choice is saved in this browser.")}
        </Dialog.Description>
      </Dialog.Header>
      <ul class="flex flex-col gap-1 py-2">
        {#each tags as tag (tag)}
          {@const isLocked = locked.has(tag)}
          {@const shown = isLocked || !hidden.includes(tag)}
          <li>
            <label
              class="hover:bg-muted/60 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm {isLocked
                ? 'cursor-default opacity-80'
                : ''}"
            >
              <Checkbox
                checked={shown}
                disabled={isLocked}
                onCheckedChange={(v) => toggle(tag, v === true)}
                aria-label={names[tag] || tag}
              />
              <span class="min-w-0 flex-1 truncate">{names[tag] || tag}</span>
              {#if isLocked}
                <span class="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                  <Lock class="size-3" />
                  {$t("Always shown")}
                </span>
              {/if}
            </label>
          </li>
        {/each}
      </ul>
      <Dialog.Footer class="gap-2">
        <Button variant="ghost" disabled={hiddenCount === 0} onclick={() => store([])}>{$t("Show all")}</Button>
        <Button onclick={() => (open = false)}>{$t("Done")}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
