<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import Loader from "@lucide/svelte/icons/loader";
  import { CLOUD_PROVIDERS, CLOUD_CUSTOM_M365, CLOUD_CUSTOM_STATUSPAGE, GetCloudProvider } from "$lib/cloudServices.js";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data = $bindable() }: { data: any } = $props();

  const STATUS_OPTIONS = ["DEGRADED", "DOWN", "UP"] as const;
  const GROUPS = ["Atlassian", "Microsoft 365", "Other"] as const;
  const WHOLE_PAGE = "__whole_page__";

  if (!data.provider) data.provider = "jira";
  if (!data.errorStatus) data.errorStatus = "DEGRADED";
  if (!data.timeout) data.timeout = 10000;
  if (data.ignoreMinor === undefined) data.ignoreMinor = false;
  if (data.component === undefined) data.component = "";

  let provider = $derived(GetCloudProvider(data.provider));
  let statuspageBase = $derived(
    (provider?.url || (data.provider === CLOUD_CUSTOM_STATUSPAGE ? data.statuspageUrl : "") || "")
      .trim()
      .replace(/\/+$/, "")
  );

  // Components are read straight from the public Statuspage API, which allows browser requests.
  let components = $state<Array<{ id: string; name: string }>>([]);
  let loadingComponents = $state(false);
  let componentsError = $state("");

  async function loadComponents() {
    if (!statuspageBase) return;
    loadingComponents = true;
    componentsError = "";
    try {
      const response = await fetch(`${statuspageBase}/api/v2/components.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      components = (Array.isArray(body?.components) ? body.components : [])
        .filter((c: { name?: string; group?: boolean }) => c.name && !c.group)
        .map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));
      if (components.length === 0) componentsError = "This page lists no components.";
    } catch (e) {
      components = [];
      componentsError = `Could not load the list (${e instanceof Error ? e.message : "error"}). Type the component name instead.`;
    } finally {
      loadingComponents = false;
    }
  }

  function selectProvider(id: string) {
    data.provider = id;
    data.component = "";
    components = [];
    componentsError = "";
  }

  const secretIsLiteral = $derived(
    provider?.kind === "m365" && !!data.clientSecret && !/^\$\w+$/.test(String(data.clientSecret).trim())
  );
</script>

<div class="space-y-4">
  <div class="flex flex-col gap-2">
    <Label for="cloud-provider">Service <span class="text-destructive">*</span></Label>
    <Select.Root type="single" value={data.provider} onValueChange={(v) => v && selectProvider(v)}>
      <Select.Trigger id="cloud-provider" class="w-full">
        {provider ? `${provider.label}` : "Choose a service"}
      </Select.Trigger>
      <Select.Content class="max-h-80">
        {#each GROUPS as group (group)}
          <Select.Group>
            <Select.GroupHeading>{group}</Select.GroupHeading>
            {#each CLOUD_PROVIDERS.filter((p) => p.group === group) as p (p.id)}
              <Select.Item value={p.id}>{p.label}</Select.Item>
            {/each}
            {#if group === "Microsoft 365"}
              <Select.Item value={CLOUD_CUSTOM_M365}>Other Microsoft 365 service…</Select.Item>
            {/if}
            {#if group === "Other"}
              <Select.Item value={CLOUD_CUSTOM_STATUSPAGE}>Other Statuspage (URL)…</Select.Item>
            {/if}
          </Select.Group>
        {/each}
      </Select.Content>
    </Select.Root>
    <p class="text-muted-foreground text-xs">
      {#if provider?.kind === "m365"}
        Reads this service's health for your Microsoft 365 tenant from Microsoft Graph.
      {:else}
        Reads the provider's official status page{statuspageBase ? ` (${statuspageBase})` : ""}. No login needed.
      {/if}
    </p>
  </div>

  {#if provider?.kind === "statuspage"}
    {#if data.provider === CLOUD_CUSTOM_STATUSPAGE}
      <div class="flex flex-col gap-2">
        <Label for="cloud-url">Statuspage URL <span class="text-destructive">*</span></Label>
        <Input id="cloud-url" bind:value={data.statuspageUrl} placeholder="https://status.example.com" />
        <p class="text-muted-foreground text-xs">
          Any page run on Atlassian Statuspage: it answers at <code>/api/v2/status.json</code>.
        </p>
      </div>
    {/if}

    <div class="flex flex-col gap-2">
      <Label for="cloud-component">Component (optional)</Label>
      <div class="flex gap-2">
        {#if components.length > 0}
          <Select.Root
            type="single"
            value={data.component || WHOLE_PAGE}
            onValueChange={(v) => (data.component = v === WHOLE_PAGE ? "" : v)}
          >
            <Select.Trigger id="cloud-component" class="w-full">
              {data.component || "Whole page"}
            </Select.Trigger>
            <Select.Content class="max-h-80">
              <Select.Item value={WHOLE_PAGE}>Whole page</Select.Item>
              {#each components as c (c.id)}
                <Select.Item value={c.name}>{c.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        {:else}
          <Input id="cloud-component" bind:value={data.component} placeholder="Whole page" class="flex-1" />
        {/if}
        <Button variant="outline" onclick={loadComponents} disabled={!statuspageBase || loadingComponents}>
          {#if loadingComponents}<Loader class="size-4 animate-spin" />{/if}
          Load list
        </Button>
      </div>
      {#if componentsError}
        <p class="text-xs text-amber-600 dark:text-amber-400">{componentsError}</p>
      {:else}
        <p class="text-muted-foreground text-xs">
          Empty follows the whole page. Pick one part, e.g. "Search", to follow only that part.
        </p>
      {/if}
    </div>

    <div class="flex items-start gap-2">
      <Switch id="cloud-ignore-minor" bind:checked={data.ignoreMinor} />
      <div>
        <Label for="cloud-ignore-minor">Ignore minor issues</Label>
        <p class="text-muted-foreground text-xs">
          Minor incidents and degraded performance count as UP. Useful when small problems elsewhere in the world turn
          the card yellow too often.
        </p>
      </div>
    </div>
  {:else if provider?.kind === "m365"}
    {#if data.provider === CLOUD_CUSTOM_M365}
      <div class="flex flex-col gap-2">
        <Label for="cloud-m365-service">Service name or ID <span class="text-destructive">*</span></Label>
        <Input id="cloud-m365-service" bind:value={data.m365Service} placeholder="Microsoft Bookings" />
        <p class="text-muted-foreground text-xs">
          As Microsoft names it. If unsure, run <b>Test Monitor</b>: it lists the services of your tenant.
        </p>
      </div>
    {/if}

    <div class="bg-muted/40 rounded-md border p-3 text-xs">
      <p class="font-medium">Microsoft 365 connection</p>
      <p class="text-muted-foreground mt-1">
        Leave these fields empty to use the shared connection from Kener's environment:
        <code>M365_TENANT_ID</code>, <code>M365_CLIENT_ID</code> and <code>M365_CLIENT_SECRET</code>. One app
        registration with the application permission <code>ServiceHealth.Read.All</code> (admin consent) serves every Microsoft
        365 monitor. Fill a field only to use a different app for this monitor.
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="flex flex-col gap-2">
        <Label for="cloud-tenant">Tenant ID</Label>
        <Input id="cloud-tenant" bind:value={data.tenantId} placeholder="from M365_TENANT_ID" />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="cloud-client">Client ID</Label>
        <Input id="cloud-client" bind:value={data.clientId} placeholder="from M365_CLIENT_ID" />
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <Label for="cloud-secret">Client secret</Label>
      <Input id="cloud-secret" bind:value={data.clientSecret} placeholder="from M365_CLIENT_SECRET" />
      {#if secretIsLiteral}
        <p class="text-xs text-amber-600 dark:text-amber-400">
          The secret is stored in Kener's database as typed. Leave it empty to use <code>M365_CLIENT_SECRET</code>, or
          enter the name of another environment variable, e.g. <code>$OTHER_SECRET</code>.
        </p>
      {/if}
    </div>
  {/if}

  <div class="grid gap-4 sm:grid-cols-2">
    <div class="flex flex-col gap-2">
      <Label for="cloud-error">If the provider cannot be read</Label>
      <Select.Root type="single" value={data.errorStatus} onValueChange={(v) => v && (data.errorStatus = v)}>
        <Select.Trigger id="cloud-error" class="w-full">{data.errorStatus}</Select.Trigger>
        <Select.Content>
          {#each STATUS_OPTIONS as opt (opt)}
            <Select.Item value={opt}>{opt}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex flex-col gap-2">
      <Label for="cloud-timeout">Timeout (ms)</Label>
      <Input id="cloud-timeout" type="number" bind:value={data.timeout} placeholder="10000" />
    </div>
  </div>
</div>
