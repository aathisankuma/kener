<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import Loader from "@lucide/svelte/icons/loader";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import {
    CLOUD_PROVIDERS,
    CLOUD_CUSTOM_INSTATUS,
    CLOUD_CUSTOM_M365,
    CLOUD_CUSTOM_STATUSPAGE,
    GetCloudProvider,
    CloudServicesInUse,
    ChosenComponents,
    CLOUD_CUSTOM_AZURE,
    IsAzureResourceId,
    IsMicrosoftKind,
    IsStatusPageKind
  } from "$lib/cloudServices.js";
  import CheckIcon from "@lucide/svelte/icons/circle-check";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let {
    data = $bindable(),
    otherMonitors = []
  }: {
    data: any;
    /** The other monitors, to mark services they already follow. */
    otherMonitors?: Array<{ name: string; monitor_type: string; type_data?: string | null }>;
  } = $props();

  const STATUS_OPTIONS = ["DEGRADED", "DOWN", "UP"] as const;
  const GROUPS = ["Atlassian", "Microsoft 365", "Microsoft Azure", "Abacus", "Other"] as const;
  const WHOLE_PAGE = "__whole_page__";

  if (!data.provider) data.provider = "jira";
  if (!data.errorStatus) data.errorStatus = "DEGRADED";
  if (!data.timeout) data.timeout = 10000;
  // New monitors ignore minor issues: a provider's page reports small problems anywhere in the world.
  if (data.ignoreMinor === undefined) data.ignoreMinor = true;
  // Several components; a monitor saved with the older single `component` keeps it as the first.
  if (!Array.isArray(data.components)) data.components = ChosenComponents(data);
  data.component = "";

  let provider = $derived(GetCloudProvider(data.provider));
  const inUse = $derived(CloudServicesInUse(otherMonitors));
  const usedHere = $derived(inUse.get(data.provider) ?? []);
  // Same service and same component (or both the whole page): this monitor would be a copy.
  const setKey = (names: string[]) =>
    names
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join("|");
  const duplicate = $derived(
    usedHere.find((u) => setKey(u.component ? u.component.split(", ") : []) === setKey(ChosenComponents(data)))
  );
  let isCustomPage = $derived(data.provider === CLOUD_CUSTOM_STATUSPAGE || data.provider === CLOUD_CUSTOM_INSTATUS);
  let statuspageBase = $derived(
    (provider?.url || (isCustomPage ? data.statuspageUrl : "") || "").trim().replace(/\/+$/, "")
  );

  // Components are read by Kener's server: it applies the proxy settings and no CORS rules.
  let components = $state<string[]>([]);
  let loadingComponents = $state(false);
  let componentsError = $state("");

  async function loadComponents() {
    if (!statuspageBase) return;
    loadingComponents = true;
    componentsError = "";
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listCloudComponents", data: { typeData: data } })
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      components = Array.isArray(result.components) ? result.components : [];
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
    const preset = GetCloudProvider(id)?.defaultComponent;
    data.components = preset ? [preset] : [];
    data.component = "";
    components = [];
    componentsError = "";
  }

  const secretIsLiteral = $derived(
    IsMicrosoftKind(provider?.kind) && !!data.clientSecret && !/^\$\w+$/.test(String(data.clientSecret).trim())
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
              {@const users = inUse.get(p.id) ?? []}
              <Select.Item value={p.id} label={p.label}>
                <span class="flex w-full items-center justify-between gap-3">
                  <span>{p.label}</span>
                  {#if users.length > 0}
                    <span
                      class="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
                      title={`Already monitored by: ${users.map((u) => u.name).join(", ")}`}
                    >
                      <CheckIcon class="size-3.5" />
                      {users.length === 1 ? users[0].name : `${users.length} monitors`}
                    </span>
                  {/if}
                </span>
              </Select.Item>
            {/each}
            {#if group === "Microsoft Azure"}
              <Select.Item value={CLOUD_CUSTOM_AZURE}>Other Azure resource…</Select.Item>
            {/if}
            {#if group === "Microsoft 365"}
              <Select.Item value={CLOUD_CUSTOM_M365}>Other Microsoft 365 service…</Select.Item>
            {/if}
            {#if group === "Other"}
              <Select.Item value={CLOUD_CUSTOM_STATUSPAGE}>Other Statuspage (URL)…</Select.Item>
              <Select.Item value={CLOUD_CUSTOM_INSTATUS}>Other Instatus page (URL)…</Select.Item>
            {/if}
          </Select.Group>
        {/each}
      </Select.Content>
    </Select.Root>
    <p class="text-muted-foreground text-xs">
      {#if provider?.kind === "m365"}
        Reads this service's health for your Microsoft 365 tenant from Microsoft Graph.
      {:else if provider?.kind === "azure"}
        Reads the health of your own Azure resource from Azure Resource Health.
      {:else}
        Reads the provider's official status page{statuspageBase ? ` (${statuspageBase})` : ""}. No login needed.
      {/if}
    </p>
    {#if duplicate}
      <p class="text-xs text-amber-600 dark:text-amber-400">
        "{duplicate.name}" already follows this service{duplicate.component ? ` (${duplicate.component})` : ""}. A
        second monitor would show the same status twice.
      </p>
    {:else if usedHere.length > 0}
      <p class="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <CheckIcon class="size-3.5" />
        Already monitored by {usedHere.map((u) => (u.component ? `${u.name} (${u.component})` : u.name)).join(", ")}.
        Pick another component to follow a different part.
      </p>
    {/if}
  </div>

  {#if IsStatusPageKind(provider?.kind)}
    {#if isCustomPage}
      <div class="flex flex-col gap-2">
        <Label for="cloud-url">Status page URL <span class="text-destructive">*</span></Label>
        <Input id="cloud-url" bind:value={data.statuspageUrl} placeholder="https://status.example.com" />
        <p class="text-muted-foreground text-xs">
          {#if provider?.kind === "instatus"}
            Any page run on Instatus ("Powered by Instatus" in its footer): it answers at <code>/v3/summary.json</code>.
          {:else}
            Any page run on Atlassian Statuspage: it answers at <code>/api/v2/status.json</code>.
          {/if}
        </p>
      </div>
    {/if}

    <div class="flex flex-col gap-2">
      <Label for="cloud-component">Component (optional)</Label>
      <div class="flex gap-2">
        {#if components.length > 0}
          <Select.Root
            type="multiple"
            value={data.components.length > 0 ? data.components : [WHOLE_PAGE]}
            onValueChange={(v) => {
              // "Whole page" clears the choice; picking a part while "Whole page" is ticked replaces it.
              const before: string[] = data.components;
              const picked = v.filter((x) => x !== WHOLE_PAGE);
              data.components = v.includes(WHOLE_PAGE) && before.length > 0 ? [] : picked;
            }}
          >
            <Select.Trigger id="cloud-component" class="w-full">
              <span class="truncate">
                {#if data.components.length === 0}
                  Whole page
                {:else if data.components.length <= 2}
                  {data.components.join(", ")}
                {:else}
                  {data.components.length} components: {data.components.join(", ")}
                {/if}
              </span>
            </Select.Trigger>
            <Select.Content class="max-h-80">
              <Select.Item value={WHOLE_PAGE}>Whole page</Select.Item>
              {#each components as name (name)}
                <Select.Item value={name}>{name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        {:else}
          <Input
            id="cloud-component"
            value={data.components.join(", ")}
            oninput={(e) =>
              (data.components = e.currentTarget.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean))}
            placeholder="Whole page"
            class="flex-1"
          />
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
          Empty follows the whole page. Tick one or more parts, e.g. "Search" and "Notifications", to follow only those:
          the card shows the worst of them. Without the list, separate names with commas.
        </p>
      {/if}
    </div>

    <div class="flex items-start gap-2">
      <Switch id="cloud-ignore-minor" bind:checked={data.ignoreMinor} />
      <div>
        <Label for="cloud-ignore-minor">Ignore minor issues</Label>
        <p class="text-muted-foreground text-xs">
          Minor incidents and degraded performance count as UP, so small problems elsewhere in the world do not turn the
          card yellow. On for new monitors; turn it off to see every minor issue.
        </p>
      </div>
    </div>
  {:else if IsMicrosoftKind(provider?.kind)}
    {#if provider?.kind === "azure"}
      <div class="flex flex-col gap-2">
        <Label for="cloud-azure-resource">Resource ID <span class="text-destructive">*</span></Label>
        <Input
          id="cloud-azure-resource"
          bind:value={data.azureResourceId}
          placeholder="/subscriptions/…/resourceGroups/…/providers/Microsoft.CognitiveServices/accounts/…"
        />
        {#if data.azureResourceId && !IsAzureResourceId(data.azureResourceId)}
          <p class="text-xs text-amber-600 dark:text-amber-400">
            This does not look like a resource ID. It starts with <code>/subscriptions/</code>.
          </p>
        {:else}
          <p class="text-muted-foreground text-xs">
            In the Azure portal, open the resource, then <b>Settings → Properties → Resource ID</b>, or
            <b>JSON View</b> on its Overview page.
          </p>
        {/if}
      </div>
    {/if}
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
      <p class="font-medium">Microsoft connection</p>
      <p class="text-muted-foreground mt-1">
        Leave these fields empty to use the shared connection from Kener's environment:
        <code>M365_TENANT_ID</code>, <code>M365_CLIENT_ID</code> and <code>M365_CLIENT_SECRET</code>. One app
        registration with the application permission <code>ServiceHealth.Read.All</code> (admin consent) serves every Microsoft
        365 monitor. Fill a field only to use a different app for this monitor.
      </p>
      {#if provider?.kind === "azure"}
        <p class="text-muted-foreground mt-1">
          For Azure, give the same app the <b>Reader</b> role on this resource (or its resource group) under
          <b>Access control (IAM)</b>.
        </p>
      {/if}
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
