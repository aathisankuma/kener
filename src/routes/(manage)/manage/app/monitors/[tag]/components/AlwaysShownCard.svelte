<script lang="ts">
  import { tm } from "$lib/uiLocale.svelte";
  // "Always shown": visitors who choose their own services on the status page cannot hide this one.
  // Saved in monitor_settings_json.always_shown, next to the other monitor settings.
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SaveIcon from "@lucide/svelte/icons/save";
  import Loader from "@lucide/svelte/icons/loader";
  import type { MonitorRecord } from "$lib/server/types/db.js";
  import { toast } from "svelte-sonner";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";

  interface Props {
    monitor: MonitorRecord;
    typeData: Record<string, unknown>;
  }

  let { monitor = $bindable(), typeData }: Props = $props();

  function readSettings(json: string | null): Record<string, unknown> {
    try {
      return json ? JSON.parse(json) : {};
    } catch {
      return {};
    }
  }

  let enabled = $state(readSettings(monitor.monitor_settings_json).always_shown === true);
  let saving = $state(false);

  async function save() {
    saving = true;
    try {
      const merged = { ...readSettings(monitor.monitor_settings_json), always_shown: enabled };
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "storeMonitorData",
          data: { ...monitor, type_data: JSON.stringify(typeData), monitor_settings_json: JSON.stringify(merged) }
        })
      });
      const result = await response.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        monitor.monitor_settings_json = JSON.stringify(merged);
        toast.success(enabled ? tm("This service is always shown") : tm("Visitors can now hide this service"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tm("Could not save"));
    } finally {
      saving = false;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{tm("Always shown")}</Card.Title>
    <Card.Description>
      {tm(
        "Visitors can choose which services they see on the status page. Turn this on for services everyone must always see, e.g. the network or Microsoft 365."
      )}
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <div class="flex items-center justify-between gap-3">
      <Label for="always-shown">{tm("Visitors cannot hide this service")}</Label>
      <Switch id="always-shown" bind:checked={enabled} />
    </div>
  </Card.Content>
  <Card.Footer class="flex justify-end">
    <Button onclick={save} disabled={saving}>
      {#if saving}<Loader class="size-4 animate-spin" />{:else}<SaveIcon class="size-4" />{/if}
      {tm("Save")}
    </Button>
  </Card.Footer>
</Card.Root>
