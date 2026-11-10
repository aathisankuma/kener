<script lang="ts">
  import { tm, tmh, tmMessage } from "$lib/uiLocale.svelte";
  // Microsoft 365: one app registration for every Microsoft 365 and Azure Cloud Service monitor.
  // The secret works like a password, so it is never shown again after saving.
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import CheckIcon from "@lucide/svelte/icons/check";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import type { M365SettingsView } from "$lib/server/controllers/m365SettingsController.js";

  let { data }: { data: { userPermissions: string[] } } = $props();
  const canWrite = $derived((data.userPermissions ?? []).includes("settings.write"));

  let loading = $state(true);
  let busy = $state<string | null>(null);
  let saved = $state<M365SettingsView | null>(null);
  let tenantId = $state("");
  let clientId = $state("");
  let clientSecret = $state("");
  let services = $state<string[] | null>(null);
  let testError = $state("");

  async function call(action: string, payload: Record<string, unknown> = {}) {
    const response = await fetch(clientResolver(resolve, "/manage/api"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data: payload })
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error ? tmMessage(result.error) : tm("Request failed"));
    return result;
  }

  function apply(view: M365SettingsView) {
    saved = view;
    tenantId = view.tenantId;
    clientId = view.clientId;
    clientSecret = "";
  }

  async function save(extra: Record<string, unknown> = {}) {
    busy = extra.removeSecret ? "remove" : "save";
    try {
      apply(await call("saveM365Settings", { tenantId, clientId, clientSecret, ...extra }));
      toast.success(extra.removeSecret ? tm("Secret removed") : tm("Saved"));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not save"));
      return false;
    } finally {
      busy = null;
    }
  }

  // How much Microsoft's reports count; saved as soon as one is picked.
  const IMPACTS = [
    {
      value: "all",
      label: () => tm("Use Microsoft's status"),
      hint: () => tm("Degraded performance and outages at Microsoft show on the status page as reported.")
    },
    {
      value: "outages",
      label: () => tm("Only outages"),
      hint: () =>
        tm(
          "Degraded performance and advisories stay Operational and appear as a note. Outages still turn the service red."
        )
    },
    {
      value: "info",
      label: () => tm("Only as information"),
      hint: () =>
        tm("Microsoft never changes the status here. Whatever Microsoft reports appears as a note next to the service.")
    }
  ] as const;

  async function chooseImpact(impact: string) {
    if (!saved || saved.impact === impact || busy) return;
    busy = "impact";
    try {
      saved = await call("saveM365Settings", { tenantId: saved.tenantId, clientId: saved.clientId, impact });
      toast.success(tm("Saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not save"));
    } finally {
      busy = null;
    }
  }

  async function test() {
    // What is typed is saved first, so the test uses it.
    if (canWrite && !(await save())) return;
    busy = "test";
    services = null;
    testError = "";
    try {
      services = (await call("testM365Settings")).services;
    } catch (e) {
      testError = e instanceof Error ? e.message : tm("The connection test failed");
    } finally {
      busy = null;
    }
  }

  onMount(async () => {
    try {
      apply(await call("getM365Settings"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not load the settings"));
    } finally {
      loading = false;
    }
  });
</script>

<div class="container mx-auto max-w-3xl space-y-6 py-6">
  <div>
    <h1 class="flex items-center gap-2 text-2xl font-semibold">
      <KeyRoundIcon class="size-6" />
      {tm("Microsoft 365")}
    </h1>
    <p class="text-muted-foreground text-sm">
      {tm(
        "One connection for every Microsoft 365 and Azure monitor. Monitors whose Tenant ID, Client ID and Client secret fields are empty use it."
      )}
    </p>
  </div>

  {#if loading}
    <div class="flex justify-center py-10"><Spinner class="size-6" /></div>
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>{tm("App registration")}</Card.Title>
        <Card.Description>
          <span
            >{@html tmh(
              "From the Azure portal under **App registrations** → your app. The app needs the Application permission `ServiceHealth.Read.All` (Microsoft Graph) with admin consent; for Azure resources also the Reader role."
            )}</span
          >
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-5">
        <div class="space-y-2">
          <Label for="m365-tenant">{tm("Tenant ID")}</Label>
          <Input
            id="m365-tenant"
            bind:value={tenantId}
            placeholder="3f2a9c71-8b4d-4e2a-9f10-6c5d7e8a1b2c"
            autocomplete="off"
            disabled={!canWrite}
          />
          <p class="text-muted-foreground text-xs">
            <span>{@html tmh("**Directory (tenant) ID** on the app's Overview page, or your domain.")}</span>
          </p>
        </div>
        <div class="space-y-2">
          <Label for="m365-client">{tm("Client ID")}</Label>
          <Input
            id="m365-client"
            bind:value={clientId}
            placeholder="a7c41e09-2f3b-4d8a-b615-0e9f2c7d4a3b"
            autocomplete="off"
            disabled={!canWrite}
          />
          <p class="text-muted-foreground text-xs">
            <span>{@html tmh("**Application (client) ID** on the Overview page, not the Object ID.")}</span>
          </p>
        </div>
        <div class="space-y-2">
          <Label for="m365-secret">{tm("Client secret")}</Label>
          {#if saved?.hasSecret}
            <p class="text-up flex items-center gap-1 text-sm">
              <CheckIcon class="size-4" />
              {tm("A secret is saved.")}
            </p>
          {/if}
          <Input
            id="m365-secret"
            type="password"
            autocomplete="off"
            bind:value={clientSecret}
            placeholder={saved?.hasSecret ? tm("Paste a new secret to replace it") : "kP28Q~…"}
            disabled={!canWrite}
          />
          <p class="text-muted-foreground text-xs">
            <span
              >{@html tmh(
                "The secret's **Value** under Certificates & secrets (shown only once when it is created), not the Secret ID. It is not shown again after saving."
              )}</span
            >
          </p>
        </div>
        {#if saved && (saved.fromEnvironment.tenantId || saved.fromEnvironment.clientId || saved.fromEnvironment.clientSecret)}
          <p class="text-muted-foreground text-xs">
            <span
              >{@html tmh(
                "Kener's environment also sets `M365_*` values. They are used only for fields left empty here."
              )}</span
            >
          </p>
        {/if}
        {#if services}
          <div class="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">
            <p class="font-medium">{tm("Connected. Kener can read %count services:", { count: services.length })}</p>
            <p class="text-muted-foreground mt-1 text-xs">{services.join(", ")}</p>
          </div>
        {:else if testError}
          <div class="bg-destructive/10 text-destructive rounded-md p-3 text-sm font-medium">{testError}</div>
        {/if}
      </Card.Content>
      {#if canWrite}
        <Card.Footer class="flex flex-wrap justify-between gap-2">
          <div>
            {#if saved?.hasSecret}
              <Button
                variant="ghost"
                disabled={busy !== null}
                onclick={() => {
                  if (
                    confirm(tm("Remove the saved secret? Microsoft monitors without their own secret stop working."))
                  ) {
                    save({ removeSecret: true, clientSecret: "" });
                  }
                }}
              >
                {#if busy === "remove"}<Spinner class="size-4" />{/if}
                {tm("Remove secret")}
              </Button>
            {/if}
          </div>
          <div class="flex gap-2">
            <Button variant="outline" disabled={busy !== null} onclick={test}>
              {#if busy === "test"}<Spinner class="size-4" />{/if}
              {tm("Test connection")}
            </Button>
            <Button disabled={busy !== null} onclick={() => save()}>
              {#if busy === "save"}<Spinner class="size-4" />{/if}
              {tm("Save")}
            </Button>
          </div>
        </Card.Footer>
      {/if}
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>{tm("How Microsoft's reports count")}</Card.Title>
        <Card.Description>
          {tm(
            "For every Microsoft 365 and Azure monitor that has no rule of its own. Microsoft's current issues stay listed on each service's page."
          )}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={tm("How Microsoft's reports count")}>
          {#each IMPACTS as option (option.value)}
            {@const active = saved?.impact === option.value}
            <button
              type="button"
              role="radio"
              aria-checked={active}
              data-testid="m365-impact-{option.value}"
              disabled={!canWrite || busy !== null}
              onclick={() => chooseImpact(option.value)}
              class="hover:bg-muted/50 flex flex-col gap-1 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed {active
                ? 'border-primary ring-primary/25 ring-2'
                : ''}"
            >
              <span class="flex items-center gap-1.5 text-sm font-medium">
                {option.label()}
                {#if active}<CheckIcon class="text-primary ml-auto size-4" />{/if}
              </span>
              <span class="text-muted-foreground text-xs">{option.hint()}</span>
            </button>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
