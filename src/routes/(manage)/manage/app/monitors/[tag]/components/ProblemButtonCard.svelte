<script lang="ts">
  // Turns the "not working" button on or off for this monitor. It is saved in
  // monitor_settings_json.problem_button, next to the other monitor settings.
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

  let enabled = $state(readSettings(monitor.monitor_settings_json).problem_button === true);
  let saving = $state(false);

  async function save() {
    saving = true;
    try {
      const merged = { ...readSettings(monitor.monitor_settings_json), problem_button: enabled };
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
        toast.success(enabled ? "The button is shown for this service" : "The button is hidden for this service");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      saving = false;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>"Not working" button</Card.Title>
    <Card.Description>
      Lets staff report with one click that this service is not working. When enough people report it within a short
      time, the addresses under <a class="underline" href={clientResolver(resolve, "/manage/app/reports")}>Reports</a>
      are emailed.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <div class="flex items-center justify-between gap-3">
      <div class="space-y-0.5">
        <Label for="problem-button">Show the button on the status page</Label>
        <p class="text-muted-foreground text-xs">Not shown for hidden services.</p>
      </div>
      <Switch id="problem-button" bind:checked={enabled} />
    </div>
  </Card.Content>
  <Card.Footer class="flex justify-end">
    <Button onclick={save} disabled={saving}>
      {#if saving}
        <Loader class="size-4 animate-spin" />
      {:else}
        <SaveIcon class="size-4" />
      {/if}
      Save
    </Button>
  </Card.Footer>
</Card.Root>
