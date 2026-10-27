<script lang="ts">
  // One service on the page of a service manager: its status, its open incidents and planned
  // maintenance, with plain forms to change them. Every change goes through the dashboard API,
  // which checks that the service is assigned to the person.
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { toast } from "svelte-sonner";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import clientResolver from "$lib/client/resolver.js";
  import { t } from "$lib/stores/i18n";
  import { formatDate } from "$lib/stores/datetime";
  import Loader from "@lucide/svelte/icons/loader";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Wrench from "@lucide/svelte/icons/wrench";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import type { MyService } from "$lib/server/controllers/serviceManagerController.js";

  interface Props {
    service: MyService;
    /** Reloads every service after a change. */
    refresh: () => Promise<void>;
  }
  let { service, refresh }: Props = $props();

  const STATUS_CHOICES = [
    { value: "UP", label: "Operational", css: "bg-up" },
    { value: "DEGRADED", label: "Limited", css: "bg-degraded" },
    { value: "DOWN", label: "Out of order", css: "bg-down" },
    { value: "MAINTENANCE", label: "Maintenance", css: "bg-maintenance" }
  ] as const;
  const STATE_CHOICES = [
    { value: "INVESTIGATING", label: "We are looking into it" },
    { value: "IDENTIFIED", label: "Cause found" },
    { value: "MONITORING", label: "Fixed, we are watching" },
    { value: "RESOLVED", label: "Resolved" }
  ] as const;
  const DURATIONS = [
    { minutes: 30, label: "30 minutes" },
    { minutes: 60, label: "1 hour" },
    { minutes: 120, label: "2 hours" },
    { minutes: 240, label: "4 hours" },
    { minutes: 480, label: "8 hours" },
    { minutes: 1440, label: "1 day" }
  ] as const;

  const statusLabel = (status: string) => $t(STATUS_CHOICES.find((s) => s.value === status)?.label ?? "No status yet");
  const statusCss = (status: string) => {
    const css = STATUS_CHOICES.find((s) => s.value === status)?.css;
    return css ? `${css} text-white` : "bg-muted text-muted-foreground";
  };
  const stateLabel = (state: string) => $t(STATE_CHOICES.find((s) => s.value === state)?.label ?? state);
  const when = (seconds: number) => $formatDate(seconds * 1000, page.data.dateAndTimeFormat.datePlusTime);

  let busy = $state<string | null>(null);
  let openForm = $state<"incident" | "maintenance" | null>(null);

  // New incident
  let incidentTitle = $state("");
  let incidentMessage = $state("");
  let incidentImpact = $state<"DOWN" | "DEGRADED">("DOWN");

  // Updates to open incidents, by incident id
  let updateText = $state<Record<number, string>>({});
  let updateState = $state<Record<number, string>>({});

  // New maintenance
  const nextHour = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  let maintenanceTitle = $state("");
  let maintenanceStart = $state(nextHour());
  let maintenanceMinutes = $state(60);
  let maintenanceDescription = $state("");

  async function call(action: string, data: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data })
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        toast.error(result.error || $t("Something went wrong. Please try again."));
        return false;
      }
      return true;
    } catch {
      toast.error($t("Something went wrong. Please try again."));
      return false;
    }
  }

  async function setStatus(status: string) {
    if (status === service.status) return;
    busy = `status-${status}`;
    if (await call("setMyServiceStatus", { monitor_tag: service.tag, status })) {
      toast.success($t("Status changed to %status", { status: statusLabel(status) }));
      await refresh();
    }
    busy = null;
  }

  async function reportIncident(event: SubmitEvent) {
    event.preventDefault();
    busy = "incident";
    const ok = await call("createMyServiceIncident", {
      monitor_tag: service.tag,
      title: incidentTitle,
      message: incidentMessage,
      impact: incidentImpact
    });
    if (ok) {
      toast.success($t("Problem reported. It is now on the status page."));
      incidentTitle = "";
      incidentMessage = "";
      openForm = null;
      await refresh();
    }
    busy = null;
  }

  async function addUpdate(incidentId: number, state: string) {
    busy = `update-${incidentId}-${state}`;
    const message =
      (updateText[incidentId] || "").trim() || (state === "RESOLVED" ? $t("The problem is resolved.") : "");
    const ok = await call("addMyServiceIncidentUpdate", { incident_id: incidentId, message, state });
    if (ok) {
      toast.success(state === "RESOLVED" ? $t("Marked as resolved.") : $t("Update posted."));
      updateText[incidentId] = "";
      await refresh();
    }
    busy = null;
  }

  async function planMaintenance(event: SubmitEvent) {
    event.preventDefault();
    busy = "maintenance";
    const start = Math.floor(new Date(maintenanceStart).getTime() / 1000);
    const ok = await call("createMyServiceMaintenance", {
      monitor_tag: service.tag,
      title: maintenanceTitle,
      description: maintenanceDescription,
      start,
      duration_minutes: maintenanceMinutes
    });
    if (ok) {
      toast.success($t("Maintenance planned. It is now on the status page."));
      maintenanceTitle = "";
      maintenanceDescription = "";
      maintenanceStart = nextHour();
      openForm = null;
      await refresh();
    }
    busy = null;
  }

  async function cancelMaintenance(eventId: number) {
    if (!confirm($t("Cancel this maintenance?"))) return;
    busy = `cancel-${eventId}`;
    if (await call("cancelMyServiceMaintenance", { event_id: eventId })) {
      toast.success($t("Maintenance cancelled."));
      await refresh();
    }
    busy = null;
  }
</script>

<section id={`service-${service.tag}`} class="bg-background flex flex-col gap-5 rounded-3xl border p-5 sm:p-6">
  <!-- Name and current status -->
  <div class="flex flex-wrap items-center gap-4">
    {#if service.image}
      <img src={clientResolver(resolve, service.image)} alt="" class="size-12 rounded-lg object-cover" />
    {/if}
    <div class="min-w-0 flex-1">
      <h2 class="text-2xl font-semibold">{service.name}</h2>
      <p class="text-muted-foreground text-sm">
        {#if service.statusSince}
          {$t("Since %time", { time: when(service.statusSince) })}
        {:else}
          {$t("No status yet")}
        {/if}
      </p>
    </div>
    <span class="{statusCss(service.status)} rounded-full px-4 py-1.5 text-sm font-semibold">
      {statusLabel(service.status)}
    </span>
  </div>

  <!-- Change status -->
  {#if service.manualStatus}
    <div class="flex flex-col gap-2">
      <p class="font-medium">{$t("How is it right now?")}</p>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {#each STATUS_CHOICES as choice (choice.value)}
          <button
            type="button"
            class="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-base font-semibold transition
              {service.status === choice.value
              ? `${choice.css} border-transparent text-white`
              : 'hover:bg-muted border-border'}"
            aria-pressed={service.status === choice.value}
            disabled={busy !== null}
            onclick={() => setStatus(choice.value)}
          >
            {#if busy === `status-${choice.value}`}<Loader class="size-4 animate-spin" />{/if}
            {$t(choice.label)}
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <p class="text-muted-foreground bg-muted/50 rounded-xl px-4 py-3 text-sm">
      {$t("Kener checks this service automatically. To tell people about a problem, report it below.")}
    </p>
  {/if}

  <!-- Open incidents -->
  {#each service.openIncidents as incident (incident.id)}
    <div class="border-down/40 flex flex-col gap-3 rounded-2xl border-2 p-4">
      <div class="flex items-start gap-2">
        <AlertTriangle class="text-destructive mt-0.5 size-5 shrink-0" />
        <div class="min-w-0">
          <p class="font-semibold">{incident.title}</p>
          <p class="text-muted-foreground text-sm">
            {$t("Reported %time", { time: when(incident.startedAt) })} · {stateLabel(incident.state)}
          </p>
        </div>
      </div>
      {#if incident.updates.length > 0}
        <ul class="flex flex-col gap-2 border-l-2 pl-3 text-sm">
          {#each incident.updates as update (update.id)}
            <li>
              <span class="text-muted-foreground">{when(update.at)} · {stateLabel(update.state)}</span><br />
              {update.text}
            </li>
          {/each}
        </ul>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for={`update-${incident.id}`}>{$t("Add an update")}</Label>
        <Textarea
          id={`update-${incident.id}`}
          bind:value={updateText[incident.id]}
          placeholder={$t("e.g. The technician is on site.")}
          rows={2}
        />
        <div class="flex flex-wrap gap-2">
          <select
            class="border-input bg-background h-10 rounded-md border px-3 text-sm"
            aria-label={$t("Progress")}
            bind:value={updateState[incident.id]}
          >
            {#each STATE_CHOICES.filter((s) => s.value !== "RESOLVED") as choice (choice.value)}
              <option value={choice.value}>{$t(choice.label)}</option>
            {/each}
          </select>
          <Button
            variant="outline"
            disabled={busy !== null || !(updateText[incident.id] || "").trim()}
            onclick={() => addUpdate(incident.id, updateState[incident.id] || incident.state)}
          >
            {$t("Post update")}
          </Button>
          <Button
            class="bg-up hover:bg-up/90 text-white"
            disabled={busy !== null}
            onclick={() => addUpdate(incident.id, "RESOLVED")}
          >
            {#if busy === `update-${incident.id}-RESOLVED`}<Loader class="size-4 animate-spin" />{/if}
            {$t("Problem resolved")}
          </Button>
        </div>
      </div>
    </div>
  {/each}

  <!-- Planned maintenance -->
  {#each service.maintenances as maintenance (maintenance.eventId)}
    <div class="border-maintenance/40 flex flex-wrap items-center gap-3 rounded-2xl border-2 p-4">
      <Wrench class="text-maintenance size-5 shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="font-semibold">{maintenance.title}</p>
        <p class="text-muted-foreground text-sm">{when(maintenance.startsAt)} – {when(maintenance.endsAt)}</p>
      </div>
      {#if maintenance.canCancel}
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onclick={() => cancelMaintenance(maintenance.eventId)}
        >
          {$t("Call off")}
        </Button>
      {/if}
    </div>
  {/each}

  <!-- Actions -->
  <div class="flex flex-wrap gap-2">
    <Button
      variant={openForm === "incident" ? "default" : "outline"}
      size="lg"
      onclick={() => (openForm = openForm === "incident" ? null : "incident")}
    >
      <AlertTriangle class="size-4" />
      {$t("Report a problem")}
    </Button>
    <Button
      variant={openForm === "maintenance" ? "default" : "outline"}
      size="lg"
      onclick={() => (openForm = openForm === "maintenance" ? null : "maintenance")}
    >
      <Wrench class="size-4" />
      {$t("Plan maintenance")}
    </Button>
    <Button variant="ghost" size="lg" href={clientResolver(resolve, `/monitors/${service.tag}`)}>
      <ExternalLink class="size-4" />
      {$t("View on status page")}
    </Button>
  </div>

  {#if openForm === "incident"}
    <form class="bg-muted/40 flex flex-col gap-3 rounded-2xl p-4" onsubmit={reportIncident}>
      <div class="flex flex-col gap-2">
        <Label for={`incident-title-${service.tag}`}>{$t("What is the problem?")}</Label>
        <Input
          id={`incident-title-${service.tag}`}
          bind:value={incidentTitle}
          placeholder={$t("e.g. Elevator stuck on 2nd floor")}
          required
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for={`incident-message-${service.tag}`}>{$t("More details (optional)")}</Label>
        <Textarea
          id={`incident-message-${service.tag}`}
          bind:value={incidentMessage}
          placeholder={$t("e.g. Technician is informed and arrives at 2 pm.")}
          rows={3}
        />
      </div>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-sm font-medium">{$t("How bad is it?")}</legend>
        <div class="flex flex-wrap gap-2">
          {#each [{ value: "DOWN", label: "Out of order", css: "bg-down" }, { value: "DEGRADED", label: "Limited", css: "bg-degraded" }] as const as impact (impact.value)}
            <label
              class="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-4 font-medium
                {incidentImpact === impact.value ? `${impact.css} border-transparent text-white` : 'border-border'}"
            >
              <input type="radio" class="sr-only" bind:group={incidentImpact} value={impact.value} />
              {$t(impact.label)}
            </label>
          {/each}
        </div>
      </fieldset>
      <div class="flex gap-2">
        <Button type="submit" size="lg" disabled={busy !== null || !incidentTitle.trim()}>
          {#if busy === "incident"}<Loader class="size-4 animate-spin" />{/if}
          {$t("Report problem")}
        </Button>
        <Button type="button" variant="ghost" size="lg" onclick={() => (openForm = null)}>{$t("Cancel")}</Button>
      </div>
    </form>
  {/if}

  {#if openForm === "maintenance"}
    <form class="bg-muted/40 flex flex-col gap-3 rounded-2xl p-4" onsubmit={planMaintenance}>
      <div class="flex flex-col gap-2">
        <Label for={`maintenance-title-${service.tag}`}>{$t("What will be done?")}</Label>
        <Input
          id={`maintenance-title-${service.tag}`}
          bind:value={maintenanceTitle}
          placeholder={$t("e.g. Annual elevator inspection")}
          required
        />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for={`maintenance-start-${service.tag}`}>{$t("Starts")}</Label>
          <Input id={`maintenance-start-${service.tag}`} type="datetime-local" bind:value={maintenanceStart} required />
        </div>
        <div class="flex flex-col gap-2">
          <Label for={`maintenance-duration-${service.tag}`}>{$t("How long?")}</Label>
          <select
            id={`maintenance-duration-${service.tag}`}
            class="border-input bg-background h-10 rounded-md border px-3 text-sm"
            bind:value={maintenanceMinutes}
          >
            {#each DURATIONS as duration (duration.minutes)}
              <option value={duration.minutes}>{$t(duration.label)}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <Label for={`maintenance-description-${service.tag}`}>{$t("More details (optional)")}</Label>
        <Textarea
          id={`maintenance-description-${service.tag}`}
          bind:value={maintenanceDescription}
          placeholder={$t("e.g. Please use the stairs during this time.")}
          rows={2}
        />
      </div>
      <div class="flex gap-2">
        <Button type="submit" size="lg" disabled={busy !== null || !maintenanceTitle.trim() || !maintenanceStart}>
          {#if busy === "maintenance"}<Loader class="size-4 animate-spin" />{/if}
          {$t("Plan maintenance")}
        </Button>
        <Button type="button" variant="ghost" size="lg" onclick={() => (openForm = null)}>{$t("Cancel")}</Button>
      </div>
    </form>
  {/if}
</section>
