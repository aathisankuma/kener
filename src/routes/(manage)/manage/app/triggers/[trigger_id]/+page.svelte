<script lang="ts">
  import { tm, tmh } from "$lib/uiLocale.svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import * as Alert from "$lib/components/ui/alert/index.js";

  import { Button } from "$lib/components/ui/button/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SaveIcon from "@lucide/svelte/icons/save";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import XIcon from "@lucide/svelte/icons/x";
  import AlertCircleIcon from "@lucide/svelte/icons/octagon-alert";
  import Loader from "@lucide/svelte/icons/loader";
  import CheckIcon from "@lucide/svelte/icons/check";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import { mode } from "mode-watcher";
  import { IsValidURL } from "$lib/clientTools";
  import CodeMirror from "svelte-codemirror-editor";
  import { html } from "@codemirror/lang-html";
  import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
  import type { TriggerMeta } from "$lib/server/types/db";

  let { data } = page;
  // Types

  // State
  let loading = $state(true);
  let saving = $state(false);
  let testing = $state<"idle" | "loading" | "success" | "error">("idle");
  let invalidFormMessage = $state("");
  let deleteDialogOpen = $state(false);
  let deleteConfirmName = $state("");
  let isDeleting = $state(false);

  // Get trigger ID from URL params
  const triggerId = $derived(data.trigger_id);
  const isNew = $derived(triggerId === "new");

  // Form state
  let trigger = $state<{
    id: number;
    name: string;
    trigger_type: string;
    trigger_desc: string;
    trigger_status: string;
    trigger_meta: TriggerMeta;
  }>({
    id: 0,
    name: "",
    trigger_type: "webhook",
    trigger_desc: "",
    trigger_status: "ACTIVE",
    trigger_meta: {
      url: "",
      headers: [],
      to: "",
      from: "",
      webhook_body: data.webhook_template.webhook_body,
      discord_body: data.discord_template.discord_body,
      slack_body: data.slack_template.slack_body,
      email_body: data.email_template.email_body,
      email_subject: data.email_template.email_subject
    }
  });

  async function fetchTrigger() {
    if (isNew) {
      loading = false;
      return;
    }

    loading = true;
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getTriggers",
          data: {}
        })
      });
      const result = await response.json();
      const foundTrigger = result.find((t: { id: number }) => t.id === parseInt(triggerId || "0"));
      if (foundTrigger) {
        const meta = JSON.parse(foundTrigger.trigger_meta) as TriggerMeta;
        trigger = {
          id: foundTrigger.id,
          name: foundTrigger.name,
          trigger_type: foundTrigger.trigger_type,
          trigger_desc: foundTrigger.trigger_desc || "",
          trigger_status: foundTrigger.trigger_status || "ACTIVE",
          trigger_meta: {
            url: meta.url || "",
            headers: meta.headers || [],
            to: meta.to || "",
            from: meta.from || "",
            webhook_body: meta.webhook_body || data.webhook_template.webhook_body,
            discord_body: meta.discord_body || data.discord_template.discord_body,
            slack_body: meta.slack_body || data.slack_template.slack_body,
            email_body: meta.email_body || data.email_template.email_body,
            email_subject: meta.email_subject || data.email_template.email_subject
          }
        };
      } else {
        toast.error(tm("Trigger not found"));
        goto(clientResolver(resolve, "/manage/app/triggers"));
      }
    } catch (error) {
      console.error("Error fetching trigger:", error);
      toast.error(tm("Failed to load trigger"));
    } finally {
      loading = false;
    }
  }

  // Validation
  function validateNameEmailPattern(input: string): { isValid: boolean; name: string | null; email: string | null } {
    const pattern = /^([\w\s]+)\s*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>$/;
    const match = input.match(pattern);
    if (match) {
      return { isValid: true, name: match[1].trim(), email: match[2] };
    }
    return { isValid: false, name: null, email: null };
  }

  async function saveTrigger() {
    invalidFormMessage = "";

    // Validation
    if (!trigger.name.trim()) {
      invalidFormMessage = tm("Trigger Name is required");
      return;
    }

    if (!trigger.trigger_type) {
      invalidFormMessage = tm("Trigger Type is required");
      return;
    }

    if (trigger.trigger_type === "email") {
      if (!trigger.trigger_meta.to.trim()) {
        invalidFormMessage = tm("To Email Address is required");
        return;
      }
      if (!validateNameEmailPattern(trigger.trigger_meta.from).isValid) {
        invalidFormMessage = tm("Invalid Sender. Format: Name <email@example.com>");
        return;
      }
    } else {
      // URL validation for non-email triggers
      if (!trigger.trigger_meta.url.trim()) {
        invalidFormMessage = tm("Trigger URL is required");
        return;
      }
      if (!IsValidURL(trigger.trigger_meta.url)) {
        invalidFormMessage = tm("Invalid URL");
        return;
      }
    }

    saving = true;
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createUpdateTrigger",
          data: {
            id: trigger.id || undefined,
            name: trigger.name,
            trigger_type: trigger.trigger_type,
            trigger_status: trigger.trigger_status,
            trigger_desc: trigger.trigger_desc,
            trigger_meta: JSON.stringify(trigger.trigger_meta)
          }
        })
      });
      const result = await response.json();
      if (result.error) {
        invalidFormMessage = result.error;
      } else {
        toast.success(trigger.id ? tm("Trigger updated successfully") : tm("Trigger created successfully"));
        if (isNew) {
          goto(clientResolver(resolve, "/manage/app/triggers"));
        }
      }
    } catch (error) {
      invalidFormMessage = tm("Failed to save trigger");
    } finally {
      saving = false;
    }
  }

  async function testTrigger() {
    if (!trigger.id) {
      toast.error(tm("Please save the trigger first"));
      return;
    }

    testing = "loading";
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "testTrigger",
          data: { trigger_id: trigger.id, status: "TRIGGERED" }
        })
      });
      const result = await response.json();
      if (result.error) {
        testing = "error";
        toast.error(result.error);
      } else {
        testing = "success";
        toast.success(tm("Test trigger sent successfully"));
      }
    } catch (error) {
      testing = "error";
      toast.error(tm("Failed to test trigger"));
    } finally {
      setTimeout(() => {
        testing = "idle";
      }, 3000);
    }
  }

  function addHeader() {
    trigger.trigger_meta.headers = [...trigger.trigger_meta.headers, { key: "", value: "" }];
  }

  function removeHeader(index: number) {
    trigger.trigger_meta.headers = trigger.trigger_meta.headers.filter((_, i) => i !== index);
  }

  async function deleteTrigger() {
    if (!trigger.id || deleteConfirmName !== trigger.name) return;

    isDeleting = true;
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteTrigger",
          data: { trigger_id: trigger.id }
        })
      });
      const result = await response.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(tm("Trigger deleted successfully"));
        goto(clientResolver(resolve, "/manage/app/triggers"));
      }
    } catch (error) {
      toast.error(tm("Failed to delete trigger"));
    } finally {
      isDeleting = false;
      deleteDialogOpen = false;
      deleteConfirmName = "";
    }
  }

  onMount(() => {
    fetchTrigger();
  });
</script>

<div class="container space-y-6 py-6">
  <!-- Breadcrumb -->
  <Breadcrumb.Root>
    <Breadcrumb.List>
      <Breadcrumb.Item>
        <Breadcrumb.Link href={clientResolver(resolve, "/manage/app/triggers")}>{tm("Triggers")}</Breadcrumb.Link>
      </Breadcrumb.Item>
      <Breadcrumb.Separator />
      <Breadcrumb.Item>
        <Breadcrumb.Page>{isNew ? tm("New Trigger") : trigger.name || tm("Edit Trigger")}</Breadcrumb.Page>
      </Breadcrumb.Item>
    </Breadcrumb.List>
  </Breadcrumb.Root>

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <Spinner class="size-8" />
    </div>
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>{isNew ? tm("New Trigger") : tm("Edit Trigger")}</Card.Title>
        <Card.Description>{tm("Configure notification triggers for your monitors")}</Card.Description>
      </Card.Header>
      <Card.Content class="space-y-6">
        <!-- Error Message -->
        {#if invalidFormMessage}
          <div class="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{invalidFormMessage}</div>
        {/if}

        <!-- Trigger Type Selection -->
        <div class="space-y-3">
          <Label>{tm("Trigger Type")}</Label>
          <p class="text-muted-foreground text-sm">{tm("Select the type of notification to send")}</p>
          <Select.Root
            type="single"
            value={trigger.trigger_type}
            onValueChange={(value) => {
              if (value) trigger.trigger_type = value;
            }}
          >
            <Select.Trigger class="w-full max-w-sm capitalize">{trigger.trigger_type}</Select.Trigger>
            <Select.Content>
              <Select.Item value="webhook">Webhook</Select.Item>
              <Select.Item value="discord">Discord</Select.Item>
              <Select.Item value="slack">Slack</Select.Item>
              <Select.Item value="email">{tm("Email")}</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>

        <!-- Status Toggle -->
        <div class="flex items-center justify-between rounded-lg border p-4">
          <div>
            <Label>{tm("Status")}</Label>
            <p class="text-muted-foreground text-sm">{tm("Enable or disable this trigger")}</p>
          </div>
          <Switch
            checked={trigger.trigger_status === "ACTIVE"}
            onCheckedChange={(checked) => (trigger.trigger_status = checked ? "ACTIVE" : "INACTIVE")}
          />
        </div>

        <!-- Name -->
        <div class="space-y-2">
          <Label for="trigger-name">
            {tm("Name")} <span class="text-destructive">*</span>
          </Label>
          <Input id="trigger-name" bind:value={trigger.name} placeholder={tm("My Trigger")} />
        </div>

        <!-- Description -->
        <div class="space-y-2">
          <Label for="trigger-desc">{tm("Description")}</Label>
          <Input id="trigger-desc" bind:value={trigger.trigger_desc} placeholder={tm("Optional description")} />
        </div>

        <!-- URL (for non-email) -->
        {#if trigger.trigger_type !== "email"}
          <div class="space-y-2">
            <Label for="trigger-url">
              URL <span class="text-destructive">*</span>
            </Label>
            <Input id="trigger-url" bind:value={trigger.trigger_meta.url} placeholder="https://example.com/webhook" />
            <p class="text-muted-foreground text-xs">{tm("The URL to send notifications to")}</p>
          </div>
        {/if}

        <!-- Webhook Specific -->
        {#if trigger.trigger_type === "webhook"}
          <!-- Headers -->
          <div class="space-y-3">
            <Label>{tm("Headers")}</Label>
            <div class="space-y-2">
              {#each trigger.trigger_meta.headers as header, index}
                <div class="flex gap-2">
                  <Input bind:value={header.key} placeholder={tm("Header Key")} class="flex-1" />
                  <Input bind:value={header.value} placeholder={tm("Header Value")} class="flex-1" />
                  <Button variant="ghost" size="icon" onclick={() => removeHeader(index)}>
                    <XIcon class="size-4" />
                  </Button>
                </div>
              {/each}
            </div>
            <Button variant="outline" size="sm" onclick={addHeader}>
              <PlusIcon class="size-4" />
              {tm("Add Header")}
            </Button>
          </div>

          <!-- Custom Body -->
          <div class="space-y-3">
            <div>
              <Label>{tm("Custom Webhook Body")}</Label>
              <p class="text-muted-foreground text-sm">{tm("Override the default JSON payload")}</p>
            </div>
            <p class="text-muted-foreground text-xs">
              <span>{@html tmh("Use Mustache variables like `{{variable}}`. Available:")}</span>
              alert_id, alert_name, alert_for, alert_value, alert_status, alert_severity, alert_message, alert_source, alert_timestamp,
              alert_cta_url, alert_cta_text, alert_incident_id, alert_incident_url, alert_failure_threshold, alert_success_threshold,
              is_resolved, is_triggered, site_url, site_name, site_logo_url, colors_up, colors_down, colors_degraded, colors_maintenance
            </p>
            <div class="overflow-hidden rounded-md border">
              <Textarea bind:value={trigger.trigger_meta.webhook_body} />
            </div>
          </div>
        {/if}

        <!-- Discord Specific -->
        {#if trigger.trigger_type === "discord"}
          <div class="space-y-3">
            <div>
              <Label>{tm("Custom Discord Payload")}</Label>
              <p class="text-muted-foreground text-sm">{tm("Override the default Discord message")}</p>
            </div>
            <p class="text-muted-foreground text-xs">
              {tm("Use Mustache variables. Available:")} alert_id, alert_name, alert_for, alert_value, alert_status, alert_severity,
              alert_message, alert_source, alert_timestamp, alert_cta_url, alert_cta_text, alert_incident_id, alert_incident_url,
              alert_failure_threshold, alert_success_threshold, is_resolved, is_triggered, site_url, site_name, site_logo_url,
              colors_up, colors_down, colors_degraded, colors_maintenance
            </p>
            <div class="overflow-hidden rounded-md border">
              <Textarea bind:value={trigger.trigger_meta.discord_body} />
            </div>
          </div>
        {/if}

        <!-- Slack Specific -->
        {#if trigger.trigger_type === "slack"}
          <div class="space-y-3">
            <div>
              <Label>{tm("Custom Slack Payload")}</Label>
              <p class="text-muted-foreground text-sm">{tm("Override the default Slack message")}</p>
            </div>
            <p class="text-muted-foreground text-xs">
              {tm("Use Mustache variables. Available:")} alert_id, alert_name, alert_for, alert_value, alert_status, alert_severity,
              alert_message, alert_source, alert_timestamp, alert_cta_url, alert_cta_text, alert_incident_id, alert_incident_url,
              alert_failure_threshold, alert_success_threshold, is_resolved, is_triggered, site_url, site_name, site_logo_url,
              colors_up, colors_down, colors_degraded, colors_maintenance
            </p>
            <div class="overflow-hidden rounded-md border">
              <Textarea bind:value={trigger.trigger_meta.slack_body} />
            </div>
          </div>
        {/if}

        <!-- Email Specific -->
        {#if trigger.trigger_type === "email"}
          <!-- Email Recipients -->
          {#if page.data.canSendEmail === false}
            <Alert.Root variant="destructive">
              <AlertCircleIcon />
              <Alert.Title>{tm("Email is not setup")}</Alert.Title>
              <Alert.Description>
                <p>
                  {tm("Please visit the email set up documentation:")}
                  <a class="underline" href={clientResolver(resolve, "https://kener.ing/docs/v4/setup/email-setup")}
                    >{tm("Email setup")}</a
                  >
                </p>
              </Alert.Description>
            </Alert.Root>
          {/if}
          <div class="space-y-2">
            <Label for="email-to">
              {tm("To (comma separated)")} <span class="text-destructive">*</span>
            </Label>
            <Input
              id="email-to"
              bind:value={trigger.trigger_meta.to}
              placeholder="john@example.com, jane@example.com"
            />
          </div>
          <div class="space-y-2">
            <Label for="email-from">
              {tm("From")} <span class="text-destructive">*</span>
            </Label>
            <Input id="email-from" bind:value={trigger.trigger_meta.from} placeholder="Alerts <alert@example.com>" />
            <p class="text-muted-foreground text-xs">{tm("Format: Name <email@example.com>")}</p>
          </div>

          <!-- Custom Email Template -->
          <div class="space-y-3">
            <div>
              <Label>{tm("Custom HTML Template")}</Label>
              <p class="text-muted-foreground text-sm">{tm("Create your own email design")}</p>
            </div>
            <p class="text-muted-foreground text-xs">
              {tm("Use Mustache variables. Available:")} alert_id, alert_name, alert_for, alert_value, alert_status, alert_severity,
              alert_message, alert_source, alert_timestamp, alert_cta_url, alert_cta_text, alert_incident_id, alert_incident_url,
              alert_failure_threshold, alert_success_threshold, is_resolved, is_triggered, site_url, site_name, site_logo_url,
              colors_up, colors_down, colors_degraded, colors_maintenance
            </p>
            <div class="overflow-hidden rounded-md border">
              <CodeMirror
                bind:value={trigger.trigger_meta.email_body}
                lang={html()}
                theme={mode.current === "dark" ? githubDark : githubLight}
                styles={{ "&": { width: "100%", height: "400px" } }}
              />
            </div>
          </div>
        {/if}
      </Card.Content>
      <Card.Footer class="flex justify-end gap-2">
        {#if !isNew}
          <Button variant="outline" onclick={testTrigger} disabled={testing === "loading"}>
            {#if testing === "loading"}
              <Loader class="size-4 animate-spin" />
            {:else if testing === "success"}
              <CheckIcon class="size-4 text-green-500" />
            {:else if testing === "error"}
              <XIcon class="size-4 text-red-500" />
            {/if}
            {tm("Test Trigger")}
          </Button>
        {/if}
        <Button onclick={saveTrigger} disabled={saving}>
          {#if saving}
            <Loader class="size-4 animate-spin" />
          {:else}
            <SaveIcon class="size-4" />
          {/if}
          {isNew ? tm("Create Trigger") : tm("Save Trigger")}
        </Button>
      </Card.Footer>
    </Card.Root>

    <!-- Delete Trigger Card -->
    {#if !isNew}
      <Card.Root class="border-destructive">
        <Card.Header>
          <Card.Title class="text-destructive">{tm("Danger Zone")}</Card.Title>
          <Card.Description>{tm("Permanently delete this trigger. This action cannot be undone.")}</Card.Description>
        </Card.Header>
        <Card.Content>
          <p class="text-muted-foreground text-sm">
            {tm("Deleting this trigger will also remove it from all alert configurations that use it.")}
          </p>
        </Card.Content>
        <Card.Footer class="flex justify-end">
          <Button variant="destructive" onclick={() => (deleteDialogOpen = true)}>
            <Trash2Icon class="size-4" />
            {tm("Delete Trigger")}
          </Button>
        </Card.Footer>
      </Card.Root>
    {/if}
  {/if}
</div>

<!-- Delete Confirmation Dialog -->
<AlertDialog.Root bind:open={deleteDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{tm("Delete Trigger")}</AlertDialog.Title>
      <AlertDialog.Description>
        {tm(
          "This action cannot be undone. This will permanently delete the trigger and remove it from all alert configurations."
        )}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <div class="space-y-4 py-4">
      <p class="text-sm">
        <span>{@html tmh("To confirm, type **%name** below:", { name: trigger.name })}</span>
      </p>
      <Input bind:value={deleteConfirmName} placeholder={tm("Type trigger name to confirm")} />
    </div>
    <AlertDialog.Footer>
      <AlertDialog.Cancel
        disabled={isDeleting}
        onclick={() => {
          deleteConfirmName = "";
        }}>{tm("Cancel")}</AlertDialog.Cancel
      >
      <Button variant="destructive" onclick={deleteTrigger} disabled={isDeleting || deleteConfirmName !== trigger.name}>
        {#if isDeleting}
          <Loader class="size-4 animate-spin" />
        {:else}
          <Trash2Icon class="size-4" />
        {/if}
        {tm("Delete Trigger")}
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
