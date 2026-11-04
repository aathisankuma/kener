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
    bold: { name: () => tm("Bold"), hint: () => tm("Brand colour, filled status and cards, large headings.") }
  };

  type Choice<K extends keyof DesignSettings> = {
    key: K;
    label: () => string;
    options: Array<{ value: DesignSettings[K]; label: () => string }>;
  };
  const CHOICES: Array<
    Choice<"header"> | Choice<"banner"> | Choice<"corners"> | Choice<"monitors"> | Choice<"density">
  > = [
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

  const radius = (corners: DesignSettings["corners"]) =>
    corners === "round" ? "9px" : corners === "soft" ? "4px" : "1px";
  const brand = $derived(design.brandColor || "var(--accent-foreground)");
</script>

{#snippet preview(o: Omit<DesignSettings, "preset" | "brandColor">)}
  <!-- A tiny drawing of the status page in this look. -->
  <div class="bg-muted/40 flex h-28 w-full flex-col gap-1.5 overflow-hidden rounded-md border p-1.5" aria-hidden="true">
    {#if o.header === "band"}
      <div class="-mx-1.5 -mt-1.5 flex h-4 items-center gap-1 px-1.5" style="background:{brand}">
        <span class="h-1.5 w-6 rounded-sm bg-white/90"></span><span class="ml-auto h-1 w-3 rounded-sm bg-white/70"
        ></span>
      </div>
    {:else}
      <div class="bg-background flex h-4 items-center gap-1 border px-1.5" style="border-radius:{radius(o.corners)}">
        <span class="bg-foreground/60 h-1.5 w-6 rounded-sm"></span><span
          class="bg-foreground/30 ml-auto h-1 w-3 rounded-sm"
        ></span>
      </div>
    {/if}
    <span class="bg-foreground/50 h-1.5 w-12 rounded-sm" class:h-2={o.density === "normal"}></span>
    <div
      class="flex items-center gap-1 px-1.5 {o.banner === 'filled' ? 'bg-up' : 'bg-background border'}"
      style="border-radius:{radius(o.corners)}; height:{o.density === 'compact' ? '0.75rem' : '1rem'}"
    >
      <span class="size-1.5 rounded-full {o.banner === 'filled' ? 'bg-white' : 'bg-up'}"></span>
      <span class="h-1 w-8 rounded-sm {o.banner === 'filled' ? 'bg-white/80' : 'bg-foreground/40'}"></span>
    </div>
    {#if o.monitors === "cards"}
      <div class="grid grid-cols-2 gap-1">
        {#each [0, 1, 2, 3] as i (i)}
          <div
            class="bg-background flex h-4 items-center gap-1 border px-1 shadow-xs"
            style="border-radius:{radius(o.corners)}"
          >
            <span class="bg-up size-1 rounded-full"></span><span class="bg-foreground/30 h-1 w-5 rounded-sm"></span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="bg-background flex flex-col border" style="border-radius:{radius(o.corners)}">
        {#each [0, 1, 2] as i (i)}
          <div
            class="flex items-center gap-1 px-1 {i < 2 ? 'border-b' : ''}"
            style="height:{o.density === 'compact' ? '0.45rem' : '0.6rem'}"
          >
            <span class="bg-up size-1 rounded-full"></span><span class="bg-foreground/30 h-0.5 w-6 rounded-sm"></span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

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
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label={tm("Design")}>
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
            {@render preview(DESIGN_PRESET_OPTIONS[preset])}
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
