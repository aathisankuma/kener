<script lang="ts">
  import { tm } from "$lib/uiLocale.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import UiLanguageSwitch from "$lib/components/UiLanguageSwitch.svelte";

  let { title = "" }: { title?: string } = $props();
</script>

<header
  class="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)"
>
  <div class="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
    <Sidebar.Trigger class="-ms-1" />
    <Separator orientation="vertical" class="mx-2 data-[orientation=vertical]:h-4" />
    <h1 class="text-base font-medium">{title}</h1>
    <div class="ms-auto flex items-center gap-2">
      <UiLanguageSwitch />
      <Button
        href={clientResolver(resolve, "/")}
        variant="secondary"
        size="sm"
        target="_blank"
        rel="noopener noreferrer"
      >
        {tm("Status Page")}
      </Button>
      <Button href="https://kener.ing/docs" variant="secondary" size="sm" target="_blank" rel="noopener noreferrer">
        {tm("Documentation")}
      </Button>
    </div>
  </div>
</header>
