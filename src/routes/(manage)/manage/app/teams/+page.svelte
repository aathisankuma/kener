<script lang="ts">
  // Microsoft Teams: paste the webhook URL from a Teams "Workflows" flow and choose what is sent.
  // The URL works like a password, so it is never shown again after saving.
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import MessagesSquareIcon from "@lucide/svelte/icons/messages-square";
  import CheckIcon from "@lucide/svelte/icons/check";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import type { TeamsSettingsView } from "$lib/server/controllers/teamsController.js";

  let { data }: { data: { userPermissions: string[] } } = $props();
  const canWrite = $derived((data.userPermissions ?? []).includes("settings.write"));

  let loading = $state(true);
  let busy = $state<string | null>(null);
  let saved = $state<TeamsSettingsView | null>(null);
  let webhookUrl = $state("");
  let alerts = $state(true);
  let incidents = $state(true);
  let problemReports = $state(true);

  async function call(action: string, payload: Record<string, unknown> = {}) {
    const response = await fetch(clientResolver(resolve, "/manage/api"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data: payload })
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "Request failed");
    return result;
  }

  function apply(view: TeamsSettingsView) {
    saved = view;
    alerts = view.alerts;
    incidents = view.incidents;
    problemReports = view.problemReports;
    webhookUrl = "";
  }

  async function save(extra: Record<string, unknown> = {}, done = "Saved") {
    busy = extra.removeWebhook ? "remove" : "save";
    try {
      apply(await call("saveTeamsSettings", { webhookUrl, alerts, incidents, problemReports, ...extra }));
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      busy = null;
    }
  }

  async function test() {
    busy = "test";
    try {
      // A URL just pasted is saved first, so the test uses it.
      if (webhookUrl.trim()) apply(await call("saveTeamsSettings", { webhookUrl, alerts, incidents, problemReports }));
      await call("sendTeamsTest");
      toast.success("Test message sent. Check the Teams chat.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The test message failed");
    } finally {
      busy = null;
    }
  }

  onMount(async () => {
    try {
      apply(await call("getTeamsSettings"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the settings");
    } finally {
      loading = false;
    }
  });
</script>

<div class="container mx-auto max-w-3xl space-y-6 py-6">
  <div>
    <h1 class="flex items-center gap-2 text-2xl font-semibold">
      <MessagesSquareIcon class="size-6" /> Microsoft Teams
    </h1>
    <p class="text-muted-foreground text-sm">
      Send alerts, incident updates and "not working" reports to a Teams chat or channel.
    </p>
  </div>

  {#if loading}
    <div class="flex justify-center py-10"><Spinner class="size-6" /></div>
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>1. Create the webhook in Teams</Card.Title>
      </Card.Header>
      <Card.Content>
        <ol class="list-decimal space-y-1 pl-5 text-sm">
          <li>In Teams, open the app <b>Workflows</b>.</li>
          <li>
            Create a workflow from the template <b>Send webhook alerts to a chat</b> (German:
            <i>Webhook-Benachrichtigungen an einen Chat senden</i>), or <b>… to a channel</b>.
          </li>
          <li>Choose the chat or channel, for example <b>Monitoring</b>, and finish.</li>
          <li>Copy the URL that Teams shows at the end and paste it below.</li>
        </ol>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>2. Paste it and choose what to send</Card.Title>
      </Card.Header>
      <Card.Content class="space-y-6">
        <div class="space-y-2">
          <Label for="webhook-url">Webhook URL</Label>
          {#if saved?.hasWebhook}
            <p class="text-up flex items-center gap-1 text-sm">
              <CheckIcon class="size-4" /> A webhook is saved ({saved.webhookHost}).
            </p>
          {/if}
          <Input
            id="webhook-url"
            type="password"
            autocomplete="off"
            placeholder={saved?.hasWebhook ? "Paste a new URL to replace it" : "https://…"}
            bind:value={webhookUrl}
            disabled={!canWrite}
          />
          <p class="text-muted-foreground text-xs">
            Anyone with this URL can post into the chat, so it is not shown again after saving.
          </p>
        </div>

        <div class="space-y-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <Label for="send-alerts">Monitoring alerts</Label>
              <p class="text-muted-foreground text-xs">
                Red when an alert fires, green when it is resolved. Every alert from Alerts, besides its own triggers.
              </p>
            </div>
            <Switch id="send-alerts" bind:checked={alerts} disabled={!canWrite} />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div>
              <Label for="send-incidents">Incident updates</Label>
              <p class="text-muted-foreground text-xs">
                Each update posted on an incident, also those from Jira Service Management tickets.
              </p>
            </div>
            <Switch id="send-incidents" bind:checked={incidents} disabled={!canWrite} />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div>
              <Label for="send-reports">"Not working" reports</Label>
              <p class="text-muted-foreground text-xs">When enough people report a service, as set under Reports.</p>
            </div>
            <Switch id="send-reports" bind:checked={problemReports} disabled={!canWrite} />
          </div>
        </div>
      </Card.Content>
      {#if canWrite}
        <Card.Footer class="flex flex-wrap justify-between gap-2">
          <div>
            {#if saved?.hasWebhook}
              <Button
                variant="ghost"
                disabled={busy !== null}
                onclick={() => {
                  if (confirm("Remove the webhook? Nothing is sent to Teams until you paste a new one.")) {
                    save({ removeWebhook: true, webhookUrl: "" }, "Webhook removed");
                  }
                }}
              >
                {#if busy === "remove"}<Spinner class="size-4" />{/if} Remove webhook
              </Button>
            {/if}
          </div>
          <div class="flex gap-2">
            <Button
              variant="outline"
              disabled={busy !== null || (!saved?.hasWebhook && !webhookUrl.trim())}
              onclick={test}
            >
              {#if busy === "test"}<Spinner class="size-4" />{/if} Send test message
            </Button>
            <Button disabled={busy !== null} onclick={() => save()}>
              {#if busy === "save"}<Spinner class="size-4" />{/if} Save
            </Button>
          </div>
        </Card.Footer>
      {/if}
    </Card.Root>
  {/if}
</div>
