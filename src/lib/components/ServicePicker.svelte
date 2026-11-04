<script lang="ts">
  // "Choose services": a visitor ticks the services they want to see on this page. The choice is
  // kept in their browser. Services the administrator marked "always shown" stay ticked.
  import { onMount } from "svelte";
  import { t } from "$lib/stores/i18n";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import Lock from "@lucide/svelte/icons/lock";
  import { ParseHidden, SelectionKey } from "$lib/serviceSelection";
  import trackEvent from "$lib/beacon";

  interface Props {
    tags: string[];
    names: Record<string, string>;
    alwaysShown: string[];
    pagePath: string;
    hidden: string[];
  }

  let { tags, names, alwaysShown, pagePath, hidden = $bindable([]) }: Props = $props();

  let open = $state(false);
  const locked = $derived(new Set(alwaysShown));
  const hiddenCount = $derived(tags.filter((t) => hidden.includes(t) && !locked.has(t)).length);

  function store(next: string[]) {
    hidden = next;
    try {
      if (next.length === 0) localStorage.removeItem(SelectionKey(pagePath));
      else localStorage.setItem(SelectionKey(pagePath), JSON.stringify(next));
    } catch {
      /* private window or storage blocked: the choice lasts until the page is left */
    }
  }

  function toggle(tag: string, shown: boolean) {
    store(shown ? hidden.filter((t) => t !== tag) : [...new Set([...hidden, tag])]);
    trackEvent("services_chosen", { shown: tags.length - hiddenCount });
  }

  onMount(() => {
    try {
      hidden = ParseHidden(localStorage.getItem(SelectionKey(pagePath)));
    } catch {
      hidden = [];
    }
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        size="sm"
        data-testid="choose-services"
        class="bg-background/80 dark:bg-background/70 border-foreground/10 rounded-full text-xs shadow-none"
      >
        <SlidersHorizontal class="size-3.5" />
        {$t("Choose services")}
        {#if hiddenCount > 0}
          <span class="bg-muted text-muted-foreground rounded-full px-1.5 text-[10px] font-semibold"
            >−{hiddenCount}</span
          >
        {/if}
      </Button>
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
