<script lang="ts">
  // "Design" in the top bar, for signed-in people: each person picks their own look of the status
  // page. The choice is a cookie, so the page is drawn in it from the server, without flicker.
  // "As set for everyone" goes back to the design chosen under Customizations.
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import { t } from "$lib/stores/i18n";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { navigationMenuTriggerStyle } from "$lib/components/ui/navigation-menu/navigation-menu-trigger.svelte";
  import DesignPreview from "$lib/components/DesignPreview.svelte";
  import Palette from "@lucide/svelte/icons/palette";
  import Check from "@lucide/svelte/icons/check";
  import Settings from "@lucide/svelte/icons/settings";
  import Columns from "@lucide/svelte/icons/columns-3";
  import {
    DESIGN_PRESETS,
    DESIGN_PRESET_OPTIONS,
    PERSONAL_COLUMNS_COOKIE,
    PERSONAL_DESIGN_COOKIE,
    type DesignSettings
  } from "$lib/design.js";
  import trackEvent from "$lib/beacon";

  const NAMES: Record<string, string> = {
    standard: "Standard",
    classic: "Classic",
    cards: "Cards",
    compact: "Compact",
    bold: "Bold",
    portal: "Portal"
  };

  let open = $state(false);
  let saving = $state(false);
  const signedIn = $derived(!!page.data?.loggedInUser);
  const site = $derived(page.data?.siteDesign as DesignSettings | undefined);
  const mine = $derived((page.data?.personalDesign as string) || "");
  const myColumns = $derived((page.data?.personalColumns as string) || "");
  const COLUMN_CHOICES = ["1", "2", "3", "4"] as const;
  const brand = $derived(site?.brandColor || "var(--accent-foreground)");
  const canSetForEveryone = $derived(signedIn && page.data?.homePath !== "/my-services");

  const name = (preset: string) => {
    const key = NAMES[preset];
    return key ? $t(key) : $t("Custom");
  };

  // An empty value removes the cookie, so the design set for everyone applies again.
  async function remember(cookie: string, value: string) {
    if (saving) return;
    saving = true;
    try {
      const path = clientResolver(resolve, "/");
      document.cookie = value
        ? `${cookie}=${value}; path=${path}; max-age=31536000; samesite=lax`
        : `${cookie}=; path=${path}; max-age=0; samesite=lax`;
      await invalidateAll();
    } finally {
      saving = false;
    }
  }

  function choose(preset: string) {
    trackEvent("design_chosen", { design: preset || "site" });
    return remember(PERSONAL_DESIGN_COOKIE, preset);
  }

  function chooseColumns(columns: string) {
    trackEvent("design_columns_chosen", { columns: columns || "site" });
    return remember(PERSONAL_COLUMNS_COOKIE, columns);
  }
</script>

{#if signedIn && site}
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          data-testid="design-menu"
          title={$t("Your design")}
          class="{navigationMenuTriggerStyle()} hover:border-border gap-1.5 border border-transparent bg-transparent text-xs hover:bg-transparent focus:bg-current/10 focus:text-current data-[state=open]:bg-current/10 data-[state=open]:text-current"
          style="border-radius: var(--radius-3xl)"
        >
          <Palette class="size-3.5" />
          <span class="hidden sm:inline">{$t("Design")}</span>
        </button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="end" sideOffset={10} class="w-[min(92vw,30rem)] rounded-2xl p-0">
      <div class="border-b px-4 pt-4 pb-3">
        <p class="flex items-center gap-2 text-sm font-semibold">
          <Palette class="text-muted-foreground size-4" />
          {$t("Your design")}
        </p>
        <p class="text-muted-foreground mt-1 text-xs">{$t("Only you see it, in this browser.")}</p>
      </div>
      <div class="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3" role="radiogroup" aria-label={$t("Your design")}>
        <button
          type="button"
          role="radio"
          aria-checked={mine === ""}
          data-testid="my-design-site"
          disabled={saving}
          onclick={() => choose("")}
          class="group hover:bg-muted/50 flex cursor-pointer flex-col gap-1.5 rounded-xl border p-1.5 text-left transition {mine ===
          ''
            ? 'border-primary ring-primary/25 ring-2'
            : ''}"
        >
          <DesignPreview options={site} {brand} class="h-20" />
          <span class="flex items-center gap-1 px-0.5 text-xs font-medium">
            {$t("As set for everyone")}
            {#if mine === ""}<Check class="text-primary ml-auto size-3.5" />{/if}
          </span>
          <span class="text-muted-foreground -mt-1 px-0.5 text-[11px]">{name(site.preset)}</span>
        </button>
        {#each DESIGN_PRESETS as preset (preset)}
          {@const active = mine === preset}
          <button
            type="button"
            role="radio"
            aria-checked={active}
            data-testid="my-design-{preset}"
            disabled={saving}
            onclick={() => choose(preset)}
            class="hover:bg-muted/50 flex cursor-pointer flex-col gap-1.5 rounded-xl border p-1.5 text-left transition {active
              ? 'border-primary ring-primary/25 ring-2'
              : ''}"
          >
            <DesignPreview options={DESIGN_PRESET_OPTIONS[preset]} {brand} class="h-20" />
            <span class="flex items-center gap-1 px-0.5 text-xs font-medium">
              {name(preset)}
              {#if active}<Check class="text-primary ml-auto size-3.5" />{/if}
            </span>
          </button>
        {/each}
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        <span class="flex items-center gap-2 text-xs font-medium">
          <Columns class="text-muted-foreground size-3.5" />
          {$t("Services per row")}
        </span>
        <div
          class="bg-muted inline-flex items-center gap-0.5 rounded-full p-0.5"
          role="radiogroup"
          aria-label={$t("Services per row")}
        >
          <button
            type="button"
            role="radio"
            aria-checked={myColumns === ""}
            data-testid="my-columns-site"
            disabled={saving}
            onclick={() => chooseColumns("")}
            class="cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-medium transition {myColumns === ''
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            {$t("As set")}
          </button>
          {#each COLUMN_CHOICES as columns (columns)}
            <button
              type="button"
              role="radio"
              aria-checked={myColumns === columns}
              data-testid="my-columns-{columns}"
              disabled={saving}
              onclick={() => chooseColumns(columns)}
              class="min-w-7 cursor-pointer rounded-full px-2 py-1 text-[11px] font-medium tabular-nums transition {myColumns ===
              columns
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
            >
              {columns}
            </button>
          {/each}
        </div>
      </div>
      {#if canSetForEveryone}
        <div class="border-t px-4 py-2.5">
          <a
            href={clientResolver(resolve, "/manage/app/customizations")}
            class="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
          >
            <Settings class="size-3.5" />
            {$t("Set the design for everyone")}
          </a>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}
