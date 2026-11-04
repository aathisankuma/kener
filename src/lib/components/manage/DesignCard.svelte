<script lang="ts">
  // Customizations → Design: pick a look for the status page with one click, then fine-tune it.
  // Each preview is a small drawing of the page in that look.
  import { tm } from "$lib/uiLocale.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import CheckIcon from "@lucide/svelte/icons/check";
  import DesignPreview from "$lib/components/DesignPreview.svelte";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import {
    DEFAULT_DESIGN,
    DESIGN_PRESETS,
    DESIGN_PRESET_OPTIONS,
    NormalizeDesign,
    PresetOf,
    type DesignSettings
  } from "$lib/design.js";

  let { canWrite = true }: { canWrite?: boolean } = $props();

  let design = $state<DesignSettings>({ ...DEFAULT_DESIGN });
  let loading = $state(true);
  let saving = $state(false);

  const PRESET_TEXT: Record<(typeof DESIGN_PRESETS)[number], { name: () => string; hint: () => string }> = {
    standard: { name: () => tm("Standard"), hint: () => tm("Kener's own look: floating menu, light boxes.") },
    classic: { name: () => tm("Classic"), hint: () => tm("Coloured header bar and a filled status banner.") },
    cards: { name: () => tm("Cards"), hint: () => tm("Every service on its own card.") },
    compact: {
      name: () => tm("Compact"),
      hint: () => tm("Narrow rows and straight corners: many services at a glance.")
    },
    bold: { name: () => tm("Bold"), hint: () => tm("Brand colour, filled status and cards, large headings.") },
    portal: {
      name: () => tm("Portal"),
      hint: () => tm("Hero in the brand colour, services as app cards with status badges.")
    }
  };

  type Choice<K extends keyof DesignSettings> = {
    key: K;
    label: () => string;
    options: Array<{ value: DesignSettings[K]; label: () => string }>;
  };
  const CHOICES: Array<
    | Choice<"layout">
    | Choice<"header">
    | Choice<"banner">
    | Choice<"corners">
    | Choice<"monitors">
    | Choice<"density">
    | Choice<"columns">
  > = [
    {
      key: "layout",
      label: () => tm("Layout"),
      options: [
        { value: "kener", label: () => tm("Kener") },
        { value: "portal", label: () => tm("Portal") }
      ]
    },
    {
      key: "header",
      label: () => tm("Menu bar"),
      options: [
        { value: "floating", label: () => tm("Floating") },
        { value: "band", label: () => tm("Brand-colour bar") }
      ]
    },
    {
      key: "banner",
      label: () => tm("Overall status"),
      options: [
        { value: "outline", label: () => tm("Outlined") },
        { value: "filled", label: () => tm("Filled with status colour") }
      ]
    },
    {
      key: "monitors",
      label: () => tm("Services"),
      options: [
        { value: "joined", label: () => tm("In one box") },
        { value: "cards", label: () => tm("As cards") }
      ]
    },
    {
      key: "corners",
      label: () => tm("Corners"),
      options: [
        { value: "round", label: () => tm("Round") },
        { value: "soft", label: () => tm("Slightly round") },
        { value: "square", label: () => tm("Straight") }
      ]
    },
    {
      key: "density",
      label: () => tm("Spacing"),
      options: [
        { value: "normal", label: () => tm("Normal") },
        { value: "compact", label: () => tm("Compact") }
      ]
    },
    {
      key: "columns",
      label: () => tm("Services per row"),
      options: [
        { value: "auto", label: () => tm("Automatic") },
        { value: "1", label: () => "1" },
        { value: "2", label: () => "2" },
        { value: "3", label: () => "3" },
        { value: "4", label: () => "4" }
      ]
    }
  ];

  function choosePreset(preset: (typeof DESIGN_PRESETS)[number]) {
    design = { ...design, ...DESIGN_PRESET_OPTIONS[preset], preset };
  }

  function setOption(key: keyof DesignSettings, value: string) {
    const next = { ...design, [key]: value } as DesignSettings;
    next.preset = PresetOf(next);
    design = next;
  }

  async function call(action: string, data: unknown) {
    const response = await fetch(clientResolver(resolve, "/manage/api"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data })
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || tm("Request failed"));
    return result;
  }

  async function save() {
    saving = true;
    try {
      const { preset: _preset, ...stored } = design;
      await call("storeSiteData", { designSettings: JSON.stringify(stored) });
      toast.success(tm("Design saved. Reload the status page to see it."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not save"));
    } finally {
      saving = false;
    }
  }

  onMount(async () => {
    try {
      const all = await call("getAllSiteData", undefined);
      design = NormalizeDesign(all.designSettings);
    } catch {
      /* keep the default */
    } finally {
      loading = false;
    }
  });

  const brand = $derived(design.brandColor || "var(--accent-foreground)");
</script>

<Card.Root>
  <Card.Header class="border-b">
    <Card.Title>{tm("Design")}</Card.Title>
    <Card.Description>
      {tm("Choose how the status page looks. A design sets all options below at once; you can then change each one.")}
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-6 pt-6">
    {#if loading}
      <div class="flex justify-center py-6"><Spinner class="size-5" /></div>
    {:else}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" role="radiogroup" aria-label={tm("Design")}>
        {#each DESIGN_PRESETS as preset (preset)}
          {@const active = design.preset === preset}
          <button
            type="button"
            role="radio"
            aria-checked={active}
            data-testid="design-{preset}"
            disabled={!canWrite}
            onclick={() => choosePreset(preset)}
            class="hover:border-foreground/40 relative flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left transition disabled:cursor-default {active
              ? 'border-primary ring-primary/30 ring-2'
              : ''}"
          >
            <DesignPreview options={DESIGN_PRESET_OPTIONS[preset]} {brand} />
            <span class="flex items-center gap-1 text-sm font-medium">
              {PRESET_TEXT[preset].name()}
              {#if active}<CheckIcon class="text-primary size-4" />{/if}
            </span>
            <span class="text-muted-foreground text-xs leading-snug">{PRESET_TEXT[preset].hint()}</span>
          </button>
        {/each}
      </div>
      {#if design.preset === "custom"}
        <p class="text-muted-foreground text-xs">{tm("Your own combination of the options below.")}</p>
      {/if}

      <div class="grid gap-4 sm:grid-cols-2">
        {#each CHOICES as choice (choice.key)}
          <div class="space-y-1.5">
            <Label>{choice.label()}</Label>
            <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label={choice.label()}>
              {#each choice.options as option (option.value)}
                <Button
                  size="sm"
                  variant={design[choice.key] === option.value ? "default" : "outline"}
                  disabled={!canWrite}
                  aria-pressed={design[choice.key] === option.value}
                  onclick={() => setOption(choice.key, option.value)}
                >
                  {option.label()}
                </Button>
              {/each}
            </div>
            {#if choice.key === "columns"}
              <p class="text-muted-foreground text-xs">
                {tm(
                  "Cards on grid pages, columns on list pages. Phones show one service per row, tablets at most two."
                )}
              </p>
            {/if}
          </div>
        {/each}
        <div class="space-y-1.5">
          <Label for="design-brand">{tm("Brand colour")}</Label>
          <div class="flex items-center gap-2">
            <input
              id="design-brand"
              type="color"
              class="h-8 w-10 cursor-pointer rounded border bg-transparent"
              value={design.brandColor || "#0057b8"}
              disabled={!canWrite}
              oninput={(e) => (design = { ...design, brandColor: e.currentTarget.value })}
            />
            <Input
              class="h-8 w-28 font-mono text-xs"
              value={design.brandColor}
              placeholder={tm("Accent colour")}
              readonly
            />
            {#if design.brandColor}
              <Button
                size="sm"
                variant="ghost"
                disabled={!canWrite}
                onclick={() => (design = { ...design, brandColor: "" })}
              >
                {tm("Reset")}
              </Button>
            {/if}
          </div>
          <p class="text-muted-foreground text-xs">
            {tm("Used for the menu bar. Without a colour, the accent colour under Status Colors is used.")}
          </p>
        </div>
      </div>
    {/if}
  </Card.Content>
  <Card.Footer class="flex justify-between gap-2 border-t pt-6">
    <Button variant="ghost" href={clientResolver(resolve, "/")} target="_blank">
      <ExternalLinkIcon class="size-4" />
      {tm("Open status page")}
    </Button>
    {#if canWrite}
      <Button onclick={save} disabled={saving || loading}>
        {#if saving}<Spinner class="size-4" />{/if}
        {tm("Save Design")}
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>
