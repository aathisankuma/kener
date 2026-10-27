<script lang="ts">
  import MyServiceCard from "$lib/components/MyServiceCard.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import { t } from "$lib/stores/i18n";
  import LogOut from "@lucide/svelte/icons/log-out";
  import type { MyService } from "$lib/server/controllers/serviceManagerController.js";

  let { data } = $props();
  // Follows the page data, and is replaced by the fresh list after each change.
  let services = $derived<MyService[]>(data.services);

  async function refresh() {
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getMyServices", data: {} })
      });
      const result = await response.json();
      if (response.ok && Array.isArray(result.services)) services = result.services;
    } catch {
      /* the page keeps what it shows; the next change reloads */
    }
  }
</script>

<svelte:head>
  <title>{$t("My services")}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="flex flex-col gap-6 pt-16 pb-10 sm:pt-4">
  <div class="flex flex-wrap items-end justify-between gap-3 px-1">
    <div>
      <h1 class="text-3xl font-semibold">{$t("My services")}</h1>
      <p class="text-muted-foreground">{$t("Signed in as %name", { name: data.userName })}</p>
    </div>
    <div class="flex gap-2">
      {#if data.canOpenDashboard}
        <Button variant="outline" href={clientResolver(resolve, "/manage/app/site-configurations")}>
          {$t("Manage Site")}
        </Button>
      {/if}
      <form method="POST" action={clientResolver(resolve, "/account/logout")}>
        <Button type="submit" variant="outline">
          <LogOut class="size-4" />
          {$t("Sign out")}
        </Button>
      </form>
    </div>
  </div>

  {#if services.length === 0}
    <p class="bg-background rounded-3xl border p-6">
      {$t("No services are assigned to you yet. Please ask IT to assign your services.")}
    </p>
  {:else}
    {#each services as service (service.tag)}
      <MyServiceCard {service} {refresh} />
    {/each}
  {/if}
</div>
