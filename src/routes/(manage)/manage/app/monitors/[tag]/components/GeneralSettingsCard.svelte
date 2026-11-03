<script lang="ts">
  import { tm, tmStatus } from "$lib/uiLocale.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import SaveIcon from "@lucide/svelte/icons/save";
  import Loader from "@lucide/svelte/icons/loader";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import XIcon from "@lucide/svelte/icons/x";
  import ImageIcon from "@lucide/svelte/icons/image";
  import type { MonitorRecord } from "$lib/server/types/db.js";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import GC from "$lib/global-constants.js";

  interface Props {
    monitor: MonitorRecord;
    typeData: Record<string, unknown>;
    isNew: boolean;
    /** False while the monitor type's required fields are missing (new monitors only). */
    typeSettingsValid?: boolean;
    /** Tags already in use (new monitors only). */
    existingTags?: string[];
  }

  let { monitor = $bindable(), typeData, isNew, typeSettingsValid = true, existingTags = [] }: Props = $props();
  const tagTaken = $derived(isNew && !!monitor.tag && existingTags.includes(monitor.tag.trim()));
  const blockedByType = $derived(!!monitor.monitor_type && !typeSettingsValid);

  let savingGeneral = $state(false);
  let uploadingImage = $state(false);

  async function handleImageUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error(tm("Invalid file type. Allowed: PNG, JPG, SVG, WebP"));
      return;
    }

    if (file.size > GC.MAX_UPLOAD_BYTES) {
      toast.error(`File too large. Maximum size is ${GC.MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
      return;
    }

    uploadingImage = true;

    try {
      const base64 = await fileToBase64(file);

      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "uploadImage",
          data: {
            base64,
            mimeType: file.type,
            fileName: file.name,
            maxWidth: 128,
            maxHeight: 128
          }
        })
      });

      const result = await response.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        monitor.image = result.url;
        toast.success(tm("Image uploaded successfully"));
      }
    } catch (e) {
      toast.error(tm("Failed to upload image"));
    } finally {
      uploadingImage = false;
      input.value = "";
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  }

  function clearImage() {
    monitor.image = "";
  }

  async function saveGeneralSettings() {
    savingGeneral = true;

    try {
      const payload: Record<string, unknown> = {
        ...monitor,
        type_data: JSON.stringify(typeData)
      };

      // A Cloud Service monitor without an image gets the provider's own icon. An uploaded image is
      // never replaced here; "Use provider's icon" replaces it on request.
      if (monitor.monitor_type === "CLOUD" && !monitor.image) {
        try {
          const icon = await fetch(clientResolver(resolve, "/manage/api"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "fetchCloudServiceIcon", data: { typeData } })
          }).then((r) => r.json());
          if (icon?.url) {
            monitor.image = icon.url;
            payload.image = icon.url;
          }
        } catch {
          /* no icon: the monitor shows its initials */
        }
      }

      // Include default uptime settings when creating a new monitor
      if (isNew) {
        payload.monitor_settings_json = JSON.stringify({
          uptime_formula_numerator: "up + maintenance",
          uptime_formula_denominator: "up + maintenance + down + degraded"
        });
      }

      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "storeMonitorData", data: payload })
      });

      const result = await response.json();
      if (result.error) {
        toast.error(result.error);
      } else if (isNew) {
        toast.success(tm("Monitor created successfully"));
        goto(clientResolver(resolve, `/manage/app/monitors/${monitor.tag}`));
      } else {
        toast.success(tm("Monitor saved successfully"));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : tm("Failed to save general settings");
      toast.error(message);
    } finally {
      savingGeneral = false;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{tm("General Settings")}</Card.Title>
    <Card.Description>{tm("Basic information about this monitor")}</Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-2">
        <Label for="monitor-name">{tm("Name")} <span class="text-destructive">*</span></Label>
        <Input id="monitor-name" bind:value={monitor.name} placeholder={tm("My API Monitor")} />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="monitor-tag">{tm("Tag")} <span class="text-destructive">*</span></Label>
        <Input
          id="monitor-tag"
          bind:value={monitor.tag}
          placeholder="my-api-monitor"
          disabled={!isNew}
          aria-invalid={tagTaken}
        />
        {#if tagTaken}
          <p class="text-destructive text-xs">{tm("Another monitor already uses this tag. Choose a different one.")}</p>
        {/if}
        <p class="text-muted-foreground mt-1 text-xs">{tm("Unique identifier (cannot be changed after creation)")}</p>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <Label for="monitor-description">{tm("Description")}</Label>
      <Textarea
        id="monitor-description"
        bind:value={monitor.description}
        placeholder={tm("A brief description of what this monitor checks")}
        rows={3}
      />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="monitor-external_url">{tm("Service URL")}</Label>
      <Input id="monitor-external_url" bind:value={monitor.external_url} placeholder="https://example.com/api/health" />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-2">
        <Label>{tm("Monitor Image")}</Label>
        <div class="flex items-center gap-3">
          <div class="bg-muted flex h-12 w-12 items-center justify-center rounded-md border">
            {#if monitor.image}
              <img
                src={clientResolver(resolve, monitor.image)}
                alt={tm("Monitor")}
                class="max-h-10 max-w-10 object-contain"
              />
            {:else}
              <ImageIcon class="text-muted-foreground h-5 w-5" />
            {/if}
          </div>
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={uploadingImage}
              onclick={() => document.getElementById("monitor-image-input")?.click()}
            >
              {#if uploadingImage}
                <Loader class="h-4 w-4 animate-spin" />
                {tm("Uploading...")}
              {:else}
                <UploadIcon class="h-4 w-4" />
                {tm("Upload")}
              {/if}
            </Button>
            <input
              id="monitor-image-input"
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp,image/heic,image/heif"
              class="hidden"
              onchange={handleImageUpload}
              disabled={uploadingImage}
            />
            {#if monitor.image}
              <Button variant="ghost" size="icon" onclick={clearImage}>
                <XIcon class="h-4 w-4" />
              </Button>
            {/if}
          </div>
        </div>
        <p class="text-muted-foreground text-xs">{tm("Max 128x128px, PNG/JPG/SVG/WebP")}</p>
      </div>
      <div class="flex flex-col gap-2">
        <Label for="monitor-cron">{tm("Cron Schedule")}</Label>
        <Input id="monitor-cron" bind:value={monitor.cron} placeholder="* * * * *" />
        <p class="text-muted-foreground mt-1 text-xs">{tm("How often to check (cron format)")}</p>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-2">
        <Label for="monitor-default-status">{tm("Default Status")}</Label>
        <Select.Root
          type="single"
          value={monitor.default_status}
          onValueChange={(v) => {
            if (v) monitor.default_status = v;
          }}
        >
          <Select.Trigger id="monitor-default-status" class="w-full">
            {tmStatus(monitor.default_status)}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="UP">{tmStatus("UP")}</Select.Item>
            <Select.Item value="DOWN">{tmStatus("DOWN")}</Select.Item>
            <Select.Item value="DEGRADED">{tmStatus("DEGRADED")}</Select.Item>
            <Select.Item value="MAINTENANCE">{tmStatus("MAINTENANCE")}</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
      <div class="flex flex-col gap-2">
        <Label for="hidden-switch">{tm("Hidden in Status Page")}</Label>
        <div class="flex items-center gap-2">
          <Switch
            id="hidden-switch"
            checked={monitor.is_hidden === "YES"}
            onCheckedChange={(checked) => (monitor.is_hidden = checked ? "YES" : "NO")}
          />
          <span class="text-muted-foreground text-xs">
            {monitor.is_hidden === "YES" ? tm("Hidden") : tm("Visible")}
          </span>
        </div>
        <p class="text-muted-foreground text-xs">
          {tm(
            "Hidden monitors don't appear on status pages, except to signed-in users whose role has monitors.read. Monitoring, alerting, and all other features keep working."
          )}
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <Label for="monitor-confirmation-threshold">{tm("Grace period")}</Label>
        <Input
          id="monitor-confirmation-threshold"
          type="number"
          min="1"
          max="60"
          step="1"
          value={monitor.confirmation_threshold ?? 1}
          oninput={(e) => {
            const v = parseInt((e.currentTarget as HTMLInputElement).value, 10);
            monitor.confirmation_threshold = Number.isNaN(v) ? 1 : Math.min(60, Math.max(1, v));
          }}
        />
        <p class="text-muted-foreground text-xs">
          {tm(
            "Require this many consecutive checks before a status change is recorded. 1 = off (record every check immediately)."
          )}
        </p>
      </div>
    </div>
  </Card.Content>
  <Card.Footer class="flex justify-end">
    {#if blockedByType}
      <p class="text-muted-foreground mr-auto self-center text-xs">
        {tm("Fill in the monitor type's required fields first.")}
      </p>
    {/if}
    <Button onclick={saveGeneralSettings} disabled={savingGeneral || blockedByType || tagTaken}>
      {#if savingGeneral}
        <Loader class="size-4 animate-spin" />
      {:else}
        <SaveIcon class="size-4" />
      {/if}
      {isNew ? tm("Create Monitor") : tm("Save Monitor")}
    </Button>
  </Card.Footer>
</Card.Root>
