<script lang="ts">
  // Language menu of the admin area and the sign-in pages.
  import LanguagesIcon from "@lucide/svelte/icons/languages";
  import { UI_LOCALES, setUiLocale, tm, uiLocale } from "$lib/uiLocale.svelte";

  let { class: className = "" }: { class?: string } = $props();
</script>

<label class="relative inline-flex items-center {className}">
  <span class="sr-only">{tm("Language")}</span>
  <LanguagesIcon class="text-muted-foreground pointer-events-none absolute left-2 size-4" />
  <select
    class="border-input bg-background h-8 appearance-none rounded-md border py-0 pr-3 pl-8 text-sm"
    value={uiLocale()}
    onchange={(e) => setUiLocale(e.currentTarget.value)}
    data-testid="ui-language"
  >
    {#each UI_LOCALES as locale (locale.code)}
      <option value={locale.code}>{locale.name}</option>
    {/each}
  </select>
</label>
