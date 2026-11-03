<script lang="ts">
  import { tm, tmh } from "$lib/uiLocale.svelte";
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
    CLOUD_CUSTOM_UPTIMEROBOT,
    IsCustomStatusPage,
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
  // Components of an earlier version of the service (e.g. Swiss21 read from the Abacus page) no
  // longer exist on its page: drop them, so the monitor follows the whole page until one is picked.
  {
    const legacy = (GetCloudProvider(data.provider)?.legacyComponents ?? []).map((c) => c.toLowerCase());
    if (legacy.length > 0) data.components = data.components.filter((c: string) => !legacy.includes(c.toLowerCase()));
  }

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
  let isCustomPage = $derived(IsCustomStatusPage(data.provider));
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
      if (components.length === 0) componentsError = tm("This page lists no components.");
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
    <Label for="cloud-provider">{tm("Service")} <span class="text-destructive">*</span></Label>
    <Select.Root type="single" value={data.provider} onValueChange={(v) => v && selectProvider(v)}>
      <Select.Trigger id="cloud-provider" class="w-full">
        {provider ? `${provider.label}` : tm("Choose a service")}
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
              <Select.Item value={CLOUD_CUSTOM_AZURE}>{tm("Other Azure resource…")}</Select.Item>
            {/if}
            {#if group === "Microsoft 365"}
              <Select.Item value={CLOUD_CUSTOM_M365}>{tm("Other Microsoft 365 service…")}</Select.Item>
            {/if}
            {#if group === "Other"}
              <Select.Item value={CLOUD_CUSTOM_STATUSPAGE}>{tm("Other Statuspage (URL)…")}</Select.Item>
              <Select.Item value={CLOUD_CUSTOM_INSTATUS}>{tm("Other Instatus page (URL)…")}</Select.Item>
              <Select.Item value={CLOUD_CUSTOM_UPTIMEROBOT}>{tm("Other UptimeRobot page (URL)…")}</Select.Item>
            {/if}
          </Select.Group>
        {/each}
      </Select.Content>
    </Select.Root>
    <p class="text-muted-foreground text-xs">
      {#if provider?.kind === "m365"}
        {tm("Reads this service's health for your Microsoft 365 tenant from Microsoft Graph.")}
      {:else if provider?.kind === "azure"}
        {tm("Reads the health of your own Azure resource from Azure Resource Health.")}
      {:else}
        {statuspageBase
          ? tm("Reads the provider's official status page (%url). No login needed.", { url: statuspageBase })
          : tm("Reads the provider's official status page. No login needed.")}
      {/if}
    </p>
    {#if duplicate}
      <p class="text-xs text-amber-600 dark:text-amber-400">
        {tm('"%name" already follows this service. A second monitor would show the same status twice.', {
          name: duplicate.component ? `${duplicate.name} (${duplicate.component})` : duplicate.name
        })}
      </p>
    {:else if usedHere.length > 0}
      <p class="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <CheckIcon class="size-3.5" />
        {tm("Already monitored by %names. Pick another component to follow a different part.", {
          names: usedHere.map((u) => (u.component ? `${u.name} (${u.component})` : u.name)).join(", ")
        })}
      </p>
    {/if}
  </div>

  {#if IsStatusPageKind(provider?.kind)}
    {#if isCustomPage}
      <div class="flex flex-col gap-2">
        <Label for="cloud-url">{tm("Status page URL")} <span class="text-destructive">*</span></Label>
        <Input id="cloud-url" bind:value={data.statuspageUrl} placeholder="https://status.example.com" />
        <p class="text-muted-foreground text-xs">
          {#if provider?.kind === "instatus"}
            <span
              >{@html tmh(
                'Any page run on Instatus ("Powered by Instatus" in its footer): it answers at `/v3/summary.json`.'
              )}</span
            >
          {:else if provider?.kind === "uptimerobot"}
            <span
              >{@html tmh(
                "Any public status page run on UptimeRobot (its footer links to uptimerobot.com), with its own address or at `stats.uptimerobot.com/…`. Each of its monitors can be picked as a component."
              )}</span
            >
          {:else}
            <span>{@html tmh("Any page run on Atlassian Statuspage: it answers at `/api/v2/status.json`.")}</span>
          {/if}
        </p>
      </div>
    {/if}

    <div class="flex flex-col gap-2">
      <Label for="cloud-component">{tm("Component (optional)")}</Label>
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
                  {tm("Whole page")}
                {:else if data.components.length <= 2}
                  {data.components.join(", ")}
                {:else}
                  {data.components.length} components: {data.components.join(", ")}
                {/if}
              </span>
            </Select.Trigger>
            <Select.Content class="max-h-80">
              <Select.Item value={WHOLE_PAGE}>{tm("Whole page")}</Select.Item>
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
            placeholder={tm("Whole page")}
            class="flex-1"
          />
        {/if}
        <Button variant="outline" onclick={loadComponents} disabled={!statuspageBase || loadingComponents}>
          {#if loadingComponents}<Loader class="size-4 animate-spin" />{/if}
          {tm("Load list")}
        </Button>
      </div>
      {#if componentsError}
        <p class="text-xs text-amber-600 dark:text-amber-400">{componentsError}</p>
      {:else}
        <p class="text-muted-foreground text-xs">
          {tm(
            'Empty follows the whole page. Tick one or more parts, e.g. "Search" and "Notifications", to follow only those: the card shows the worst of them. Without the list, separate names with commas.'
          )}
        </p>
      {/if}
    </div>

    {#if provider?.kind !== "uptimerobot"}
      <div class="flex items-start gap-2">
        <Switch id="cloud-ignore-minor" bind:checked={data.ignoreMinor} />
        <div>
          <Label for="cloud-ignore-minor">{tm("Ignore minor issues")}</Label>
          <p class="text-muted-foreground text-xs">
            {tm(
              "Minor incidents and degraded performance count as UP, so small problems elsewhere in the world do not turn the card yellow. On for new monitors; turn it off to see every minor issue."
            )}
          </p>
        </div>
      </div>
    {/if}
  {:else if IsMicrosoftKind(provider?.kind)}
    {#if provider?.kind === "azure"}
      <div class="flex flex-col gap-2">
        <Label for="cloud-azure-resource">{tm("Resource ID")} <span class="text-destructive">*</span></Label>
        <Input
          id="cloud-azure-resource"
          bind:value={data.azureResourceId}
          placeholder="/subscriptions/…/resourceGroups/…/providers/Microsoft.CognitiveServices/accounts/…"
        />
        {#if data.azureResourceId && !IsAzureResourceId(data.azureResourceId)}
          <p class="text-xs text-amber-600 dark:text-amber-400">
            <span>{@html tmh("This does not look like a resource ID. It starts with `/subscriptions/`.")}</span>
          </p>
        {:else}
          <p class="text-muted-foreground text-xs">
            <span
              >{@html tmh(
                "In the Azure portal, open the resource, then **Settings → Properties → Resource ID**, or **JSON View** on its Overview page."
              )}</span
            >
          </p>
        {/if}
      </div>
    {/if}
    {#if data.provider === CLOUD_CUSTOM_M365}
      <div class="flex flex-col gap-2">
        <Label for="cloud-m365-service">{tm("Service name or ID")} <span class="text-destructive">*</span></Label>
        <Input id="cloud-m365-service" bind:value={data.m365Service} placeholder="Microsoft Bookings" />
        <p class="text-muted-foreground text-xs">
          <span
            >{@html tmh(
              "As Microsoft names it. If unsure, run **Test Monitor**: it lists the services of your tenant."
            )}</span
          >
        </p>
      </div>
    {/if}

    <div class="bg-muted/40 rounded-md border p-3 text-xs">
      <p class="font-medium">{tm("Microsoft connection")}</p>
      <p class="text-muted-foreground mt-1">
        <span
          >{@html tmh(
            "Leave these fields empty to use the shared connection from Kener's environment: `M365_TENANT_ID`, `M365_CLIENT_ID` and `M365_CLIENT_SECRET`. One app registration with the application permission `ServiceHealth.Read.All` (admin consent) serves every Microsoft 365 monitor. Fill a field only to use a different app for this monitor."
          )}</span
        >
      </p>
      <p class="text-muted-foreground mt-1">
        <span
          >{@html tmh(
            "In the Azure portal under **App registrations**: Tenant ID = **Directory (tenant) ID**, Client ID = **Application (client) ID**, Client secret = the secret's **Value** from Certificates & secrets (not the Secret ID)."
          )}</span
        >
      </p>
      {#if provider?.kind === "azure"}
        <p class="text-muted-foreground mt-1">
          <span
            >{@html tmh(
              "For Azure, give the same app the **Reader** role on this resource (or its resource group) under **Access control (IAM)**."
            )}</span
          >
        </p>
      {/if}
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="flex flex-col gap-2">
        <Label for="cloud-tenant">{tm("Tenant ID")}</Label>
        <Input id="cloud-tenant" bind:value={data.tenantId} placeholder="from M365_TENANT_ID" />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="cloud-client">{tm("Client ID")}</Label>
        <Input id="cloud-client" bind:value={data.clientId} placeholder="from M365_CLIENT_ID" />
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <Label for="cloud-secret">{tm("Client secret")}</Label>
      <Input
        id="cloud-secret"
        type="password"
        autocomplete="off"
        bind:value={data.clientSecret}
        placeholder="from M365_CLIENT_SECRET"
      />
      {#if secretIsLiteral}
        <p class="text-xs text-amber-600 dark:text-amber-400">
          <span
            >{@html tmh(
              "The secret is stored in Kener's database as typed. Leave it empty to use `M365_CLIENT_SECRET`, or enter the name of another environment variable, e.g. `$OTHER_SECRET`."
            )}</span
          >
        </p>
      {/if}
    </div>
  {/if}

  <div class="grid gap-4 sm:grid-cols-2">
    <div class="flex flex-col gap-2">
      <Label for="cloud-error">{tm("If the provider cannot be read")}</Label>
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
      <Label for="cloud-timeout">{tm("Timeout (ms)")}</Label>
      <Input id="cloud-timeout" type="number" bind:value={data.timeout} placeholder="10000" />
    </div>
  </div>
</div>
