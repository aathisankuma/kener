<script lang="ts">
  import { tm, tmh, tmMessage } from "$lib/uiLocale.svelte";
  // UniFi: the Site Manager API key, and which access points Kener follows. Each followed access
  // point becomes a monitor with the name given here; access points of one location are joined in a
  // group monitor named after it, which visitors pick under "Choose services" and when subscribing.
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import WifiIcon from "@lucide/svelte/icons/wifi";
  import CheckIcon from "@lucide/svelte/icons/check";
  import RefreshIcon from "@lucide/svelte/icons/refresh-cw";
  import MapPinIcon from "@lucide/svelte/icons/map-pin";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import type { UnifiDeviceRow, UnifiSettingsView } from "$lib/server/controllers/unifiSettingsController.js";

  let { data }: { data: { userPermissions: string[] } } = $props();
  const canWrite = $derived((data.userPermissions ?? []).includes("settings.write"));
  const canManageMonitors = $derived((data.userPermissions ?? []).includes("monitors.write"));

  let loading = $state(true);
  let busy = $state<string | null>(null);
  let saved = $state<UnifiSettingsView | null>(null);
  let apiKey = $state("");
  let testResult = $state<{ devices: number; accessPoints: number; consoles: string[] } | null>(null);
  let testError = $state("");

  type Row = UnifiDeviceRow & { follow: boolean };
  let rows = $state<Row[]>([]);
  let loaded = $state(false);
  let showAll = $state(false);
  let search = $state("");
  let pages = $state<Array<{ id: number; page_title: string; page_path: string }>>([]);
  let pageId = $state("");
  let alertOn = $state(true);
  let alertMinutes = $state(5);

  const shown = $derived(
    rows.filter((r) => {
      if (!showAll && !r.isAccessPoint && !r.followed) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [r.name, r.unifiName, r.location, r.model, r.hostName].some((v) => v.toLowerCase().includes(q));
    })
  );
  const locations = $derived([...new Set(rows.map((r) => r.location.trim()).filter(Boolean))].sort());
  const followedCount = $derived(rows.filter((r) => r.follow).length);
  const followedLocations = $derived(new Set(rows.filter((r) => r.follow).map((r) => r.location.trim())).size);

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

  async function saveKey(extra: Record<string, unknown> = {}) {
    busy = extra.removeApiKey ? "remove" : "save";
    try {
      saved = await call("saveUnifiSettings", { apiKey, ...extra });
      apiKey = "";
      toast.success(extra.removeApiKey ? tm("API key removed") : tm("Saved"));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not save"));
      return false;
    } finally {
      busy = null;
    }
  }

  async function test() {
    if (apiKey.trim() && !(await saveKey())) return;
    busy = "test";
    testResult = null;
    testError = "";
    try {
      testResult = await call("testUnifiSettings");
    } catch (e) {
      testError = e instanceof Error ? e.message : tm("The connection test failed");
    } finally {
      busy = null;
    }
  }

  async function loadDevices() {
    busy = "load";
    try {
      const result = await call("listUnifiDevices");
      rows = (result.devices as UnifiDeviceRow[]).map((d) => ({ ...d, follow: d.followed }));
      loaded = true;
      // First time: suggest following every access point.
      if (!rows.some((r) => r.followed)) for (const r of rows) r.follow = r.isAccessPoint;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not load the devices"));
    } finally {
      busy = null;
    }
  }

  async function sync() {
    busy = "sync";
    try {
      const result = await call("syncUnifiAccessPoints", {
        items: rows.map((r) => ({ id: r.id, name: r.name, location: r.location, follow: r.follow })),
        pageId: pageId ? Number(pageId) : null,
        alertMinutes: alertOn ? alertMinutes : 0
      });
      toast.success(
        tm("%count access points in %locations locations are followed.", {
          count: result.accessPoints,
          locations: result.locations.length
        })
      );
      await loadDevices();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not save"));
    } finally {
      busy = null;
    }
  }

  function statusClass(status: string) {
    if (status === "UP") return "bg-up";
    if (status === "DOWN") return "bg-down";
    if (status === "MAINTENANCE") return "bg-maintenance";
    return "bg-degraded";
  }

  onMount(async () => {
    try {
      const view = await call("getUnifiSettings");
      saved = view;
      if (view.alertMinutes > 0) alertMinutes = view.alertMinutes;
      try {
        pages = await call("getPages");
      } catch {
        pages = [];
      }
      if (canManageMonitors && (view.hasApiKey || view.fromEnvironment)) await loadDevices();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not load the settings"));
    } finally {
      loading = false;
    }
  });
</script>

<div class="container mx-auto max-w-5xl space-y-6 py-6">
  <div>
    <h1 class="flex items-center gap-2 text-2xl font-semibold">
      <WifiIcon class="size-6" />
      {tm("UniFi")}
    </h1>
    <p class="text-muted-foreground text-sm">
      {tm(
        "Follow your UniFi access points on the status page. Each location becomes a service that people choose and subscribe to."
      )}
    </p>
  </div>

  {#if loading}
    <div class="flex justify-center py-10"><Spinner class="size-6" /></div>
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>{tm("Connection")}</Card.Title>
        <Card.Description>
          <span
            >{@html tmh(
              "An API key from **unifi.ui.com** → **API** (UniFi Site Manager). It reads the state of every device of your consoles; nothing can be changed with it."
            )}</span
          >
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div class="space-y-2">
          <Label for="unifi-key">{tm("API key")}</Label>
          {#if saved?.hasApiKey}
            <p class="text-up flex items-center gap-1 text-sm">
              <CheckIcon class="size-4" />
              {tm("An API key is saved.")}
            </p>
          {:else if saved?.fromEnvironment}
            <p class="text-muted-foreground text-sm">
              <span>{@html tmh("Kener's environment sets `UNIFI_API_KEY`; it is used.")}</span>
            </p>
          {/if}
          <Input
            id="unifi-key"
            type="password"
            autocomplete="off"
            bind:value={apiKey}
            placeholder={saved?.hasApiKey ? tm("Paste a new key to replace it") : ""}
            disabled={!canWrite}
          />
          <p class="text-muted-foreground text-xs">{tm("It is not shown again after saving.")}</p>
        </div>
        {#if testResult}
          <div class="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">
            <p class="font-medium">
              {tm("Connected: %devices devices, %aps of them access points.", {
                devices: testResult.devices,
                aps: testResult.accessPoints
              })}
            </p>
            {#if testResult.consoles.length > 0}
              <p class="text-muted-foreground mt-1 text-xs">{testResult.consoles.join(", ")}</p>
            {/if}
          </div>
        {:else if testError}
          <div class="bg-destructive/10 text-destructive rounded-md p-3 text-sm font-medium">{testError}</div>
        {/if}
      </Card.Content>
      {#if canWrite}
        <Card.Footer class="flex flex-wrap justify-between gap-2">
          <div>
            {#if saved?.hasApiKey}
              <Button
                variant="ghost"
                disabled={busy !== null}
                onclick={() => {
                  if (confirm(tm("Remove the saved API key? The access points then show no status."))) {
                    saveKey({ removeApiKey: true, apiKey: "" });
                  }
                }}
              >
                {#if busy === "remove"}<Spinner class="size-4" />{/if}
                {tm("Remove API key")}
              </Button>
            {/if}
          </div>
          <div class="flex gap-2">
            <Button variant="outline" disabled={busy !== null} onclick={test}>
              {#if busy === "test"}<Spinner class="size-4" />{/if}
              {tm("Test connection")}
            </Button>
            <Button disabled={busy !== null || !apiKey.trim()} onclick={() => saveKey()}>
              {#if busy === "save"}<Spinner class="size-4" />{/if}
              {tm("Save")}
            </Button>
          </div>
        </Card.Footer>
      {/if}
    </Card.Root>

    {#if canManageMonitors && (saved?.hasApiKey || saved?.fromEnvironment)}
      <Card.Root>
        <Card.Header class="flex flex-row flex-wrap items-start justify-between gap-3">
          <div class="space-y-1.5">
            <Card.Title>{tm("Access points")}</Card.Title>
            <Card.Description>
              {tm(
                "Give each access point a name and a location people understand. Access points with the same location are shown together."
              )}
            </Card.Description>
          </div>
          <Button variant="outline" size="sm" disabled={busy !== null} onclick={loadDevices}>
            {#if busy === "load"}<Spinner class="size-4" />{:else}<RefreshIcon class="size-4" />{/if}
            {loaded ? tm("Reload") : tm("Load access points")}
          </Button>
        </Card.Header>
        {#if loaded}
          <Card.Content class="space-y-4">
            <div class="flex flex-wrap items-center gap-3">
              <Input class="h-8 max-w-64 text-sm" type="search" placeholder={tm("Search")} bind:value={search} />
              <label class="flex items-center gap-2 text-sm">
                <Switch bind:checked={showAll} />
                {tm("Show all devices")}
              </label>
              <span class="text-muted-foreground ml-auto text-xs">
                {tm("%count followed in %locations locations", {
                  count: followedCount,
                  locations: followedLocations
                })}
              </span>
            </div>

            <datalist id="unifi-locations">
              {#each locations as location (location)}<option value={location}></option>{/each}
            </datalist>

            <div class="overflow-x-auto rounded-lg border">
              <table class="w-full text-sm">
                <thead class="bg-muted/50 text-muted-foreground text-left text-xs">
                  <tr>
                    <th class="w-10 px-3 py-2"><span class="sr-only">{tm("Follow")}</span></th>
                    <th class="px-3 py-2 font-medium">{tm("In UniFi")}</th>
                    <th class="px-3 py-2 font-medium">{tm("Name on the status page")}</th>
                    <th class="px-3 py-2 font-medium">{tm("Location")}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each shown as row (row.id)}
                    <tr class="border-t align-middle {row.follow ? '' : 'opacity-60'}">
                      <td class="px-3 py-2">
                        <Checkbox
                          checked={row.follow}
                          aria-label={tm("Follow %name", { name: row.unifiName })}
                          onCheckedChange={(v) => (row.follow = v === true)}
                        />
                      </td>
                      <td class="px-3 py-2">
                        <div class="flex items-center gap-2">
                          <span class="size-2 shrink-0 rounded-full {statusClass(row.kenerStatus)}" title={row.status}
                          ></span>
                          <span class="font-medium">{row.unifiName}</span>
                        </div>
                        <div class="text-muted-foreground mt-0.5 pl-4 text-xs">
                          {[row.model, row.hostName, row.ip].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td class="px-3 py-2">
                        <Input class="h-8 min-w-44 text-sm" bind:value={row.name} disabled={!row.follow} />
                      </td>
                      <td class="px-3 py-2">
                        <div class="relative">
                          <MapPinIcon
                            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
                          />
                          <Input
                            class="h-8 min-w-44 pl-7 text-sm"
                            list="unifi-locations"
                            bind:value={row.location}
                            disabled={!row.follow}
                          />
                        </div>
                      </td>
                    </tr>
                  {:else}
                    <tr>
                      <td colspan="4" class="text-muted-foreground px-3 py-6 text-center">
                        {showAll ? tm("No devices found") : tm("No access points found. Turn on Show all devices.")}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1.5">
                <Label>{tm("Show the locations on")}</Label>
                <Select.Root type="single" bind:value={pageId}>
                  <Select.Trigger class="w-full">
                    {pages.find((p) => String(p.id) === pageId)?.page_title || tm("Do not add to a page")}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="">{tm("Do not add to a page")}</Select.Item>
                    {#each pages as p (p.id)}
                      <Select.Item value={String(p.id)}>{p.page_title}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <p class="text-muted-foreground text-xs">
                  {tm("New locations are added to this page. Locations already on a page stay where they are.")}
                </p>
              </div>
              <div class="space-y-1.5">
                <Label for="unifi-alert">{tm("Report an outage")}</Label>
                <div class="flex items-center gap-2 text-sm">
                  <Switch id="unifi-alert" bind:checked={alertOn} />
                  <span>{tm("Open an incident when an access point is offline for")}</span>
                  <Input
                    type="number"
                    min="1"
                    max="120"
                    class="h-8 w-16 text-sm"
                    bind:value={alertMinutes}
                    disabled={!alertOn}
                  />
                  <span>{tm("min")}</span>
                </div>
                <p class="text-muted-foreground text-xs">
                  {tm(
                    "Subscribers of that location get an email, and another one when it is back. The incident closes by itself."
                  )}
                </p>
              </div>
            </div>
          </Card.Content>
          <Card.Footer class="flex justify-end">
            <Button disabled={busy !== null} onclick={sync}>
              {#if busy === "sync"}<Spinner class="size-4" />{/if}
              {tm("Save access points")}
            </Button>
          </Card.Footer>
        {/if}
      </Card.Root>
    {/if}
  {/if}
</div>
