<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import SaveIcon from "@lucide/svelte/icons/save";
  import Loader from "@lucide/svelte/icons/loader";
  import PlayIcon from "@lucide/svelte/icons/play";
  import ImageIcon from "@lucide/svelte/icons/image";
  import type { MonitorRecord } from "$lib/server/types/db.js";
  import type { GroupMonitorTypeData, MonitoringResult } from "$lib/server/types/monitor.js";
  import type { DockerConnectionDefaults } from "$lib/types/docker.js";
  import { MONITOR_TYPES, type MonitorType } from "$lib/types/monitor.js";
  import { toast } from "svelte-sonner";
  import {
    ValidateIpAddress,
    IsValidHost,
    IsValidNameServer,
    IsValidDnsResolver,
    IsValidURL,
    IsValidPort
  } from "$lib/clientTools";
  import {
    GAMEDIG_SOCKET_TIMEOUT,
    DOCKER_CONNECTION_TYPES,
    DOCKER_CHECK_TYPES,
    IsValidProxyURL,
    IsValidHeartbeatSecret
  } from "$lib/anywhere";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  // Type-specific components
  import {
    MonitorApi,
    MonitorPing,
    MonitorTcp,
    MonitorDns,
    MonitorSsl,
    MonitorSql,
    MonitorHeartbeat,
    MonitorGroup,
    MonitorGamedig,
    MonitorNone,
    MonitorGrpc,
    MonitorPrometheus,
    MonitorDocker,
    MonitorCloud
  } from "../types/index.js";
  import {
    GetCloudProvider,
    CLOUD_CUSTOM_INSTATUS,
    CLOUD_CUSTOM_M365,
    CLOUD_CUSTOM_STATUSPAGE
  } from "$lib/cloudServices.js";

  interface Props {
    monitor: MonitorRecord;
    // Dynamic per-monitor-type payload (parsed JSON). Keep as any so it can be bound into
    // the various strongly-typed type editors (API/PING/HEARTBEAT/etc.) without TS errors.
    typeData: any;
    availableMonitors: MonitorRecord[];
    dockerDefaults: DockerConnectionDefaults;
    /** On the new-monitor page: no test or save here; "Create Monitor" saves everything. */
    isNew?: boolean;
    /** Shown inside General Settings: its "Save Monitor" button saves this card too. */
    combined?: boolean;
    typeSettingsValid?: boolean;
  }

  let {
    monitor = $bindable(),
    typeData = $bindable(),
    availableMonitors,
    dockerDefaults,
    isNew = false,
    combined = false,
    typeSettingsValid = $bindable(true)
  }: Props = $props();

  const GROUP_MIN_MONITORS = 2;
  const GROUP_MIN_TIMEOUT_MS = 1000;
  const GROUP_LATENCY_CALCULATION_OPTIONS = ["AVG", "MAX", "MIN"] as const;
  type GroupLatencyCalculation = (typeof GROUP_LATENCY_CALCULATION_OPTIONS)[number];

  function isGroupLatencyCalculation(value: unknown): value is GroupLatencyCalculation {
    return typeof value === "string" && GROUP_LATENCY_CALCULATION_OPTIONS.includes(value as GroupLatencyCalculation);
  }

  function createDefaultGroupTypeData(): GroupMonitorTypeData {
    return {
      monitors: [],
      executionDelay: GROUP_MIN_TIMEOUT_MS,
      latencyCalculation: "AVG"
    };
  }

  function normalizeGroupTypeData(raw: unknown): GroupMonitorTypeData {
    const candidate = (raw ?? {}) as Record<string, unknown>;
    const monitors = Array.isArray(candidate.monitors)
      ? (candidate.monitors as Array<{ tag?: string; weight?: number }>).reduce<Array<{ tag: string; weight: number }>>(
          (acc, monitor) => {
            if (monitor && typeof monitor.tag === "string" && monitor.tag.trim().length > 0) {
              const weight = typeof monitor.weight === "number" && Number.isFinite(monitor.weight) ? monitor.weight : 0;
              acc.push({ tag: monitor.tag, weight });
            }
            return acc;
          },
          []
        )
      : [];

    const latencyCalculation = isGroupLatencyCalculation(candidate.latencyCalculation)
      ? candidate.latencyCalculation
      : "AVG";

    const executionDelay =
      typeof candidate.executionDelay === "number" &&
      Number.isFinite(candidate.executionDelay) &&
      candidate.executionDelay >= GROUP_MIN_TIMEOUT_MS
        ? candidate.executionDelay
        : GROUP_MIN_TIMEOUT_MS;

    return {
      monitors,
      latencyCalculation,
      executionDelay
    };
  }

  if (monitor.monitor_type === "GROUP") {
    typeData = normalizeGroupTypeData(typeData);
  }

  const storedHeartbeatSecret = typeData?.secretString;

  let savingType = $state(false);
  let testingMonitor = $state(false);
  let testResult = $state<MonitoringResult | null>(null);

  const monitorTypeLabels: Record<MonitorType, string> = {
    API: "HTTP/API",
    PING: "Ping",
    TCP: "TCP Port",
    DNS: "DNS",
    NONE: "Manual",
    GROUP: "Group",
    SSL: "SSL Certificate",
    SQL: "Database",
    HEARTBEAT: "Heartbeat",
    GAMEDIG: "Game Server",
    GRPC: "gRPC Health",
    PROMETHEUS: "Prometheus",
    DOCKER: "Docker Container",
    CLOUD: "Cloud Service (Atlassian, Microsoft 365, Abacus, …)"
  };

  // Validation for each monitor type
  const isTypeSettingsValid = $derived.by(() => {
    if (!monitor.monitor_type || monitor.monitor_type === "NONE") return true;

    switch (monitor.monitor_type) {
      case "API": {
        const data = typeData as any;
        if (!data.url) return false;
        if (!IsValidURL(data.url)) return false;
        if (!data.timeout || data.timeout < 1) return false;
        if (data.proxy && !IsValidProxyURL(data.proxy)) return false;
        return true;
      }

      case "PING": {
        const data = typeData as any;
        if (!data.hosts || !Array.isArray(data.hosts) || data.hosts.length === 0) return false;
        for (const host of data.hosts) {
          if (!host.host) return false;
          if (ValidateIpAddress(host.host) !== host.type) return false;
          if (!host.timeout || host.timeout < 1) return false;
          if (!host.count || host.count < 1) return false;
        }
        return true;
      }

      case "TCP": {
        const data = typeData as any;
        if (!data.hosts || !Array.isArray(data.hosts) || data.hosts.length === 0) return false;
        for (const host of data.hosts) {
          if (!host.host) return false;
          if (ValidateIpAddress(host.host) !== host.type) return false;
          if (!host.timeout || host.timeout < 1) return false;
          if (!IsValidPort(host.port)) return false;
        }
        return true;
      }

      case "DNS": {
        const data = typeData as any;
        if (!data.host || !IsValidHost(data.host)) return false;
        const nameServer = (data.nameServer || "").trim();
        const transport = data.transport || "UDP";
        if (transport === "TLS") {
          if (!nameServer || !IsValidDnsResolver(nameServer)) return false;
          const tlsPort = Number(data.tlsPort ?? 853);
          if (!IsValidPort(String(tlsPort))) return false;
          const tlsServername = (data.tlsServername || "").trim();
          if (tlsServername && !IsValidHost(tlsServername)) return false;
        } else if (nameServer && !IsValidNameServer(nameServer)) {
          return false;
        }
        if (!data.lookupRecord) return false;
        if (!data.values || !Array.isArray(data.values) || data.values.length === 0) return false;
        const hasNonEmptyValue = data.values.some((val: string) => val && val.trim() !== "");
        if (!hasNonEmptyValue) return false;
        return true;
      }

      case "GROUP": {
        const data = typeData as Partial<GroupMonitorTypeData>;
        if (!data.monitors || !Array.isArray(data.monitors) || data.monitors.length < GROUP_MIN_MONITORS) return false;
        if (typeof data.executionDelay !== "number" || data.executionDelay < GROUP_MIN_TIMEOUT_MS) return false;
        if (!isGroupLatencyCalculation((data as GroupMonitorTypeData).latencyCalculation)) return false;
        // Weights must sum to 1
        const totalWeight = data.monitors.reduce((sum, m) => sum + (m.weight ?? 0), 0);
        if (Math.abs(totalWeight - 1) >= 0.01) return false;
        return true;
      }

      case "SSL": {
        const data = typeData as any;
        if (!data.host || ValidateIpAddress(String(data.host).trim()) === "Invalid") return false;
        if (!IsValidPort(data.port)) return false;
        const degraded = Number(data.degradedRemainingHours ?? NaN);
        const down = Number(data.downRemainingHours ?? NaN);
        if (!Number.isFinite(degraded) || degraded < 0) return false;
        if (!Number.isFinite(down) || down < 0) return false;
        if (degraded <= down) return false;
        if (
          data.timeout !== undefined &&
          (typeof data.timeout !== "number" || !Number.isFinite(data.timeout) || data.timeout < 1)
        )
          return false;
        const sslServername = (data.tlsServername || "").trim();
        if (sslServername && !IsValidHost(sslServername)) return false;
        return true;
      }

      case "SQL": {
        const data = typeData as any;
        if (!data.connectionString) return false;
        if (!data.connectionString.startsWith("postgresql://") && !data.connectionString.startsWith("mysql://"))
          return false;
        if (!data.timeout || data.timeout < 1) return false;
        if (!data.query) return false;
        return true;
      }

      case "HEARTBEAT": {
        const data = typeData as any;
        if (!data.degradedRemainingMinutes || data.degradedRemainingMinutes < 1) return false;
        if (!data.downRemainingMinutes || data.downRemainingMinutes <= data.degradedRemainingMinutes) return false;
        if (data.secretString !== storedHeartbeatSecret && !IsValidHeartbeatSecret(data.secretString)) return false;
        return true;
      }

      case "GAMEDIG": {
        const data = typeData as any;
        if (!data.host || ValidateIpAddress(data.host) === "Invalid") return false;
        if (!IsValidPort(data.port)) return false;
        if (!data.gameId) return false;
        if (!data.timeout || data.timeout < GAMEDIG_SOCKET_TIMEOUT) return false;
        return true;
      }

      case "GRPC": {
        const data = typeData as any;
        if (!data.host) return false;
        if (!data.port || data.port < 1 || data.port > 65535) return false;
        if (!data.timeout || data.timeout < 1) return false;
        return true;
      }

      case "PROMETHEUS": {
        const data = typeData as any;
        if (!data.url || !IsValidURL(data.url)) return false;
        if (data.proxy && !IsValidProxyURL(data.proxy)) return false;
        if (!data.query || !data.query.trim()) return false;
        for (const key of ["down", "degraded"] as const) {
          const t = data[key];
          if (t !== undefined && t !== null) {
            const validOp = [">", ">=", "<", "<=", "==", "!="].includes(t.operator);
            if (!validOp || typeof t.value !== "number" || !Number.isFinite(t.value)) return false;
          }
        }
        if (
          data.timeout !== undefined &&
          (typeof data.timeout !== "number" || !Number.isFinite(data.timeout) || data.timeout < 1)
        )
          return false;
        return true;
      }

      case "DOCKER": {
        const data = typeData as any;
        const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        if (!DOCKER_CONNECTION_TYPES.includes(data.connectionType)) return false;
        if (!DOCKER_CHECK_TYPES.includes(data.checkType)) return false;
        if (!text(data.daemon)) return false;
        for (const key of ["tlsCa", "tlsCert", "tlsKey"]) {
          if (data[key] != null && typeof data[key] !== "string") return false;
        }
        // Client certificate and key are a matched pair: both or neither.
        if (!!text(data.tlsCert) !== !!text(data.tlsKey)) return false;
        if (data.checkType === "container" && !text(data.containerName)) return false;
        if (typeof data.timeout !== "number" || !Number.isFinite(data.timeout) || data.timeout < 1) return false;
        return true;
      }

      case "CLOUD": {
        const data = typeData as any;
        const provider = GetCloudProvider(data.provider);
        if (!provider) return false;
        if (
          (data.provider === CLOUD_CUSTOM_STATUSPAGE || data.provider === CLOUD_CUSTOM_INSTATUS) &&
          !IsValidURL(data.statuspageUrl || "")
        )
          return false;
        // Microsoft 365 credentials may stay empty: the check then uses M365_TENANT_ID,
        // M365_CLIENT_ID and M365_CLIENT_SECRET from the environment.
        if (provider.kind === "m365" && data.provider === CLOUD_CUSTOM_M365 && !(data.m365Service || "").trim())
          return false;
        if (
          data.timeout !== undefined &&
          (typeof data.timeout !== "number" || !Number.isFinite(data.timeout) || data.timeout < 1)
        )
          return false;
        return true;
      }

      default:
        return true;
    }
  });

  // The new-monitor page creates the monitor with "Create Monitor" and needs to know this is valid.
  $effect(() => {
    typeSettingsValid = isTypeSettingsValid;
  });

  let fetchingIcon = $state(false);

  /** Downloads the provider's own icon into Kener's images and puts it in the monitor's image. */
  async function useProviderIcon(): Promise<boolean> {
    fetchingIcon = true;
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetchCloudServiceIcon", data: { typeData } })
      });
      const result = await response.json();
      if (result.error || !result.url) {
        toast.info(result.error || "No icon found. Upload an image under General Settings.");
        return false;
      }
      monitor.image = result.url;
      return true;
    } catch {
      toast.info("No icon found. Upload an image under General Settings.");
      return false;
    } finally {
      fetchingIcon = false;
    }
  }

  async function refreshProviderIcon() {
    // A new monitor keeps the icon until "Create Monitor" saves everything.
    if ((await useProviderIcon()) && !isNew) await saveTypeSettings();
  }

  async function saveTypeSettings() {
    savingType = true;

    try {
      // A Cloud Service monitor without an image gets the provider's own icon. An image someone
      // uploaded is never replaced here; "Use provider's icon" replaces it on request.
      if (monitor.monitor_type === "CLOUD" && !monitor.image) {
        await useProviderIcon();
      }
      const payload = {
        ...monitor,
        type_data: JSON.stringify(typeData)
      };

      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "storeMonitorData", data: payload })
      });

      const result = await response.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Monitor type settings saved successfully");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save monitor type settings";
      toast.error(message);
    } finally {
      savingType = false;
    }
  }

  async function testMonitor() {
    if (!monitor.id || monitor.monitor_type === "NONE") return;

    testingMonitor = true;
    testResult = null;
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "testMonitor",
          data: { monitor_id: monitor.id }
        })
      });

      const result = await response.json();
      testResult = result;
    } catch (e) {
      testResult = { error_message: "Failed to test monitor", status: "NO_DATA", latency: 0, type: "error" };
    } finally {
      testingMonitor = false;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Monitor Type Configuration</Card.Title>
    <Card.Description>
      {#if isNew}
        Choose what this monitor checks. The list shows every type, e.g. Cloud Service for Atlassian, Microsoft 365 and
        Abacus.
      {:else}
        Configure how this monitor checks your service
      {/if}
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <div class="flex flex-col gap-2">
      <Label for="monitor-type">Monitor Type</Label>
      <Select.Root
        type="single"
        value={monitor.monitor_type}
        onValueChange={(v) => {
          if (v) {
            monitor.monitor_type = v as MonitorType;
            typeData = v === "GROUP" ? createDefaultGroupTypeData() : {};
          }
        }}
      >
        <Select.Trigger id="monitor-type" class="w-full">
          {monitorTypeLabels[monitor.monitor_type as MonitorType]}
        </Select.Trigger>
        <Select.Content>
          {#each MONITOR_TYPES as type (type)}
            <Select.Item value={type}>{monitorTypeLabels[type]}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <div class="border-t pt-4">
      {#if monitor.monitor_type === "API"}
        <MonitorApi bind:data={typeData} />
      {:else if monitor.monitor_type === "PING"}
        <MonitorPing bind:data={typeData} />
      {:else if monitor.monitor_type === "TCP"}
        <MonitorTcp bind:data={typeData} />
      {:else if monitor.monitor_type === "DNS"}
        <MonitorDns bind:data={typeData} />
      {:else if monitor.monitor_type === "SSL"}
        <MonitorSsl bind:data={typeData} />
      {:else if monitor.monitor_type === "SQL"}
        <MonitorSql bind:data={typeData} />
      {:else if monitor.monitor_type === "HEARTBEAT"}
        <MonitorHeartbeat bind:data={typeData} tag={monitor.tag} />
      {:else if monitor.monitor_type === "GROUP"}
        <MonitorGroup bind:data={typeData} {availableMonitors} tag={monitor.tag} />
      {:else if monitor.monitor_type === "GAMEDIG"}
        <MonitorGamedig bind:data={typeData} />
      {:else if monitor.monitor_type === "GRPC"}
        <MonitorGrpc bind:data={typeData} />
      {:else if monitor.monitor_type === "PROMETHEUS"}
        <MonitorPrometheus bind:data={typeData} />
      {:else if monitor.monitor_type === "DOCKER"}
        <MonitorDocker bind:data={typeData} defaults={dockerDefaults} />
      {:else if monitor.monitor_type === "CLOUD"}
        <MonitorCloud bind:data={typeData} />
      {:else if monitor.monitor_type === "NONE"}
        <MonitorNone bind:data={typeData} />
      {/if}
    </div>
  </Card.Content>
  <Card.Footer class=" flex justify-between gap-2">
    {#if isNew}
      <p class="text-muted-foreground text-xs">
        {#if monitor.monitor_type && !isTypeSettingsValid}
          Fill in the required fields above.
        {:else}
          Saved together with the general settings when you click <strong>Create Monitor</strong>. Test it after
          creating.
        {/if}
      </p>
    {:else}
      <Dialog.Root
        onOpenChange={(e) => {
          if (e) testMonitor();
        }}
      >
        <Dialog.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="secondary">
              <PlayIcon class="size-4" />
              Test Monitor
            </Button>
          {/snippet}
        </Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              {#if testingMonitor}
                Running Test
              {:else if testResult}
                Test Result
              {:else}
                Test Monitor
              {/if}
            </Dialog.Title>
          </Dialog.Header>
          <div class="kener-manage flex flex-col justify-center gap-2">
            {#if testingMonitor}
              <div class="flex flex-col items-center gap-2 py-8">
                <Loader class="size-8 animate-spin" />
                <p class="text-muted-foreground mt-4 text-center">Please wait while the test is being performed...</p>
              </div>
            {:else if testResult}
              <div class="mt-4 flex flex-col gap-4">
                {#if testResult.error_message}
                  <div class="bg-destructive/10 text-destructive rounded-md p-3 text-sm font-medium">
                    {testResult.error_message}
                  </div>
                {/if}
                <div class="grid grid-cols-2 gap-4">
                  <div class="rounded-lg border p-4 text-center">
                    <div class="text-muted-foreground text-xs uppercase">Status</div>
                    <div class="mt-1 text-2xl font-bold text-{testResult.status.toLowerCase()}">
                      {testResult.status}
                    </div>
                  </div>
                  <div class="rounded-lg border p-4 text-center">
                    <div class="text-muted-foreground text-xs uppercase">Latency (milliseconds)</div>
                    <div class="mt-1 truncate text-2xl font-bold">
                      {testResult.latency}
                    </div>
                  </div>
                </div>
                {#if monitor.monitor_type === "SSL" && testResult.expiry_at}
                  <div class="rounded-lg border p-4 text-center">
                    <div class="text-muted-foreground text-xs uppercase">Expires At</div>
                    <div class="mt-1 text-sm font-semibold break-all">
                      {new Date(testResult.expiry_at).toLocaleString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                      })}
                    </div>
                  </div>
                {/if}
                {#if monitor.monitor_type === "SSL" && (testResult.issuer_cn || testResult.issuer_o)}
                  <div class="grid grid-cols-2 gap-4">
                    <div class="rounded-lg border p-4 text-center">
                      <div class="text-muted-foreground text-xs uppercase">Issued By (CN)</div>
                      <div class="mt-1 text-sm font-semibold break-all">
                        {testResult.issuer_cn || "—"}
                      </div>
                    </div>
                    <div class="rounded-lg border p-4 text-center">
                      <div class="text-muted-foreground text-xs uppercase">Issued By (O)</div>
                      <div class="mt-1 text-sm font-semibold break-all">
                        {testResult.issuer_o || "—"}
                      </div>
                    </div>
                  </div>
                {/if}
                <div class="flex justify-end">
                  <Button variant="outline" size="sm" onclick={testMonitor} disabled={testingMonitor}>
                    <PlayIcon class="size-3" />
                    Run Test Again
                  </Button>
                </div>
              </div>
            {/if}
          </div>
        </Dialog.Content>
      </Dialog.Root>
    {/if}
    {#if combined}
      <p class="text-muted-foreground mr-auto self-center text-xs">
        <strong>Save Monitor</strong> below saves these settings. Test Monitor checks the saved settings.
      </p>
    {/if}

    <div class="flex flex-wrap justify-end gap-2">
      {#if monitor.monitor_type === "CLOUD"}
        <Button
          variant="outline"
          onclick={refreshProviderIcon}
          disabled={fetchingIcon || savingType || !isTypeSettingsValid}
          title="Download the service's official icon and use it as this monitor's image"
        >
          {#if fetchingIcon}
            <Loader class="size-4 animate-spin" />
          {:else}
            <ImageIcon class="size-4" />
          {/if}
          Use provider's icon
        </Button>
      {/if}
      {#if !isNew && !combined}
        <Button onclick={saveTypeSettings} disabled={savingType || !isTypeSettingsValid}>
          {#if savingType}
            <Loader class="size-4 animate-spin" />
          {:else}
            <SaveIcon class="size-4" />
          {/if}
          Save Monitor Type Settings
        </Button>
      {/if}
    </div>
  </Card.Footer>
</Card.Root>
