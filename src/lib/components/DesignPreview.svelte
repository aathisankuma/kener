<script lang="ts">
  // A tiny drawing of the status page in one design, for the design pickers.
  import type { DesignSettings } from "$lib/design.js";

  let {
    options,
    brand = "var(--accent-foreground)",
    class: className = "h-28"
  }: { options: Omit<DesignSettings, "preset" | "brandColor">; brand?: string; class?: string } = $props();

  const radius = (corners: DesignSettings["corners"]) =>
    corners === "round" ? "9px" : corners === "soft" ? "4px" : "1px";
  const o = $derived(options);
</script>

<div
  class="bg-muted/40 flex w-full flex-col gap-1.5 overflow-hidden rounded-md border p-1.5 {className}"
  aria-hidden="true"
>
  {#if o.layout === "portal"}
    <!-- brand-colour bar and hero with a picture, then app cards with icon and status badge -->
    <div class="-mx-1.5 -mt-1.5 flex flex-col gap-1 px-1.5 pt-1 pb-2" style="background:{brand}">
      <div class="flex items-center gap-1">
        <span class="h-1.5 w-6 rounded-sm bg-white/90"></span><span class="ml-auto h-1 w-3 rounded-sm bg-white/70"
        ></span>
      </div>
      <div class="flex items-end justify-between">
        <div class="flex flex-col gap-0.5">
          <span class="h-1.5 w-12 rounded-sm bg-white"></span>
          <span class="h-1 w-9 rounded-sm bg-white/70"></span>
        </div>
        <span class="h-4 w-6 rounded-sm bg-white/30"></span>
      </div>
    </div>
    <div class="bg-up h-2.5" style="border-radius:1px"></div>
    <div class="grid grid-cols-2 gap-1">
      {#each [0, 1, 2, 3] as i (i)}
        <div class="bg-background flex h-4 items-center gap-1 px-1 shadow-xs" style="border-radius:1px">
          <span class="size-2 rounded-[2px]" style="background:{brand}"></span>
          <span class="flex flex-col gap-0.5">
            <span class="bg-foreground/40 h-0.5 w-5 rounded-sm"></span>
            <span class="bg-up h-0.5 w-3 rounded-sm"></span>
          </span>
        </div>
      {/each}
    </div>
  {:else}
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
  {/if}
</div>
