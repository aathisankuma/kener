<script lang="ts">
  // Jira Service Management tickets shared with Kener (its account is a request participant):
  // pick a service to turn one into an incident that follows the ticket, move it, or unlink it.
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import RefreshIcon from "@lucide/svelte/icons/refresh-cw";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import TicketIcon from "@lucide/svelte/icons/ticket";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import { formatDistanceToNow } from "date-fns";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import type { JsmOverview } from "$lib/server/controllers/jsmController.js";

  let { data }: { data: { userPermissions: string[] } } = $props();
  const canWrite = $derived((data.userPermissions ?? []).includes("incidents.write"));

  let loading = $state(true);
  let busy = $state<string | null>(null);
  let overview = $state<JsmOverview | null>(null);
  let loadError = $state<string | null>(null);
  let monitors = $state<Array<{ tag: string; name: string }>>([]);
  // Choices for new tickets, by ticket key
  let chosenService = $state<Record<string, string>>({});
  let chosenImpact = $state<Record<string, string>>({});
  let chosenTop = $state<Record<string, boolean>>({});

  const IMPACTS = [
    { value: "DOWN", label: "Down" },
    { value: "DEGRADED", label: "Degraded" }
  ];
  const monitorName = (tag: string | null) => monitors.find((m) => m.tag === tag)?.name ?? tag ?? "no service";
  const ago = (seconds: number | null) =>
    seconds ? formatDistanceToNow(new Date(seconds * 1000), { addSuffix: true }) : "never";

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

  async function load() {
    loading = true;
    try {
      overview = await call("getJsmTickets");
      loadError = null;
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Could not load tickets";
      if (overview) toast.error(loadError);
    } finally {
      loading = false;
    }
  }

  async function act(key: string, action: string, payload: Record<string, unknown>, done: string) {
    busy = `${action}-${key}`;
    try {
      await call(action, payload);
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      busy = null;
    }
    // Also after a failure, so the selects and checkboxes show what is saved again.
    await load();
  }

  async function syncNow() {
    busy = "sync";
    try {
      const result = await call("syncJsmTickets");
      toast.success(`Read ${result.tickets} ticket(s), posted ${result.updates} update(s)`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      busy = null;
    }
  }

  onMount(async () => {
    try {
      const result = await call("getMonitors", {});
      monitors = (Array.isArray(result) ? result : [])
        .map((m: { tag: string; name: string }) => ({ tag: m.tag, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      /* the service lists stay empty */
    }
    await load();
  });
</script>

<div class="container mx-auto space-y-6 py-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="flex items-center gap-2 text-2xl font-semibold"><TicketIcon class="size-6" /> JSM Tickets</h1>
      <p class="text-muted-foreground max-w-3xl text-sm">
        Tickets from Jira Service Management where Kener's account is a <b>request participant</b>. Pick a service to
        show a ticket as an incident on the status page. From then on Kener posts the ticket's replies to customers
        (never internal comments) and follows its status, every 2 minutes. Kener never writes to Jira.
      </p>
    </div>
    <div class="flex gap-2">
      <Button variant="outline" onclick={load} disabled={loading}>
        <RefreshIcon class="size-4" /> Refresh
      </Button>
      {#if canWrite && overview?.configured}
        <Button variant="outline" onclick={syncNow} disabled={busy !== null}>
          {#if busy === "sync"}<Spinner class="size-4" />{/if} Sync now
        </Button>
      {/if}
    </div>
  </div>

  {#if loading && !overview}
    <div class="flex justify-center py-10"><Spinner class="size-6" /></div>
  {:else if loadError && !overview}
    <Alert.Root variant="destructive">
      <Alert.Title>Could not load the tickets</Alert.Title>
      <Alert.Description>{loadError}</Alert.Description>
    </Alert.Root>
  {:else if overview && !overview.configured}
    <Alert.Root>
      <Alert.Title>Jira Service Management is not connected</Alert.Title>
      <Alert.Description>
        Set <code>JSM_BASE_URL</code>, <code>JSM_EMAIL</code> (Atlassian Cloud only) and <code>JSM_API_TOKEN</code> in
        Kener's environment and restart Kener. Use a customer account such as <code>status@…</code>: it then sees only
        the tickets it is added to as request participant.
      </Alert.Description>
    </Alert.Root>
  {:else if overview}
    {#if overview.error}
      <Alert.Root variant="destructive">
        <Alert.Title>Could not read the shared tickets</Alert.Title>
        <Alert.Description>{overview.error}</Alert.Description>
      </Alert.Root>
    {/if}

    <!-- New tickets -->
    <Card.Root>
      <Card.Header>
        <Card.Title>New tickets ({overview.shared.length})</Card.Title>
        <Card.Description>
          Shared with Kener, not on the status page yet. Only replies written after linking reach the status page.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {#if overview.shared.length === 0}
          <p class="text-muted-foreground text-sm">
            No new tickets. In Jira, add Kener's account as <b>Anfrageteilnehmer</b> (request participant) on an outage ticket
            and it appears here.
          </p>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Ticket</Table.Head>
                <Table.Head>Status in Jira</Table.Head>
                <Table.Head>Service</Table.Head>
                <Table.Head>Impact</Table.Head>
                <Table.Head class="text-right">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each overview.shared as ticket (ticket.key)}
                <Table.Row>
                  <Table.Cell>
                    <a class="font-medium hover:underline" href={ticket.url} target="_blank" rel="noreferrer">
                      {ticket.key}
                    </a>
                    <div class="text-sm">{ticket.summary}</div>
                    <div class="text-muted-foreground text-xs">opened {ago(ticket.createdAt)}</div>
                  </Table.Cell>
                  <Table.Cell><Badge variant="outline">{ticket.status}</Badge></Table.Cell>
                  <Table.Cell>
                    <select
                      class="border-input bg-background h-9 max-w-56 rounded-md border px-2 text-sm"
                      aria-label="Service"
                      bind:value={chosenService[ticket.key]}
                      disabled={!canWrite}
                    >
                      <option value={undefined}>No service</option>
                      {#each monitors as monitor (monitor.tag)}
                        <option value={monitor.tag}>{monitor.name}</option>
                      {/each}
                    </select>
                    <label class="mt-2 flex items-center gap-2 text-xs">
                      <input type="checkbox" bind:checked={chosenTop[ticket.key]} disabled={!canWrite} />
                      Show to everyone (top of status page)
                    </label>
                  </Table.Cell>
                  <Table.Cell>
                    <select
                      class="border-input bg-background h-9 rounded-md border px-2 text-sm"
                      aria-label="Impact"
                      bind:value={chosenImpact[ticket.key]}
                      disabled={!canWrite}
                    >
                      {#each IMPACTS as impact (impact.value)}
                        <option value={impact.value}>{impact.label}</option>
                      {/each}
                    </select>
                  </Table.Cell>
                  <Table.Cell class="text-right whitespace-nowrap">
                    {#if canWrite}
                      <Button
                        size="sm"
                        disabled={busy !== null || (!chosenService[ticket.key] && !chosenTop[ticket.key])}
                        title={!chosenService[ticket.key] && !chosenTop[ticket.key]
                          ? "Choose a service, or show the ticket to everyone"
                          : undefined}
                        onclick={() =>
                          act(
                            ticket.key,
                            "linkJsmTicket",
                            {
                              issue_key: ticket.key,
                              monitor_tag: chosenService[ticket.key] || "",
                              impact: chosenImpact[ticket.key] || "DOWN",
                              show_at_top: !!chosenTop[ticket.key]
                            },
                            `${ticket.key} is now on the status page`
                          )}
                      >
                        {#if busy === `linkJsmTicket-${ticket.key}`}<Spinner class="size-4" />{/if} Link
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onclick={() =>
                          act(ticket.key, "ignoreJsmTicket", { issue_key: ticket.key }, `${ticket.key} ignored`)}
                      >
                        Ignore
                      </Button>
                    {/if}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Linked tickets -->
    <Card.Root>
      <Card.Header>
        <Card.Title>Linked tickets ({overview.linked.length})</Card.Title>
        <Card.Description>
          Kept up to date from Jira while open, and for 7 days after the ticket is done. Change the service to move the
          incident; unlink to stop the updates (the incident stays).
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {#if overview.linked.length === 0}
          <p class="text-muted-foreground text-sm">No linked tickets.</p>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Ticket</Table.Head>
                <Table.Head>Incident</Table.Head>
                <Table.Head>Service</Table.Head>
                <Table.Head>Last read</Table.Head>
                <Table.Head class="text-right">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each overview.linked as link (link.issue_key)}
                <Table.Row>
                  <Table.Cell>
                    {#if link.url}
                      <a class="font-medium hover:underline" href={link.url} target="_blank" rel="noreferrer">
                        {link.issue_key}
                      </a>
                    {:else}
                      <span class="font-medium">{link.issue_key}</span>
                    {/if}
                    <div class="text-sm">{link.summary}</div>
                    {#if link.status}<Badge variant="outline" class="mt-1">{link.status}</Badge>{/if}
                  </Table.Cell>
                  <Table.Cell>
                    {#if link.incident_id}
                      <a
                        class="inline-flex items-center gap-1 text-sm hover:underline"
                        href={clientResolver(resolve, `/manage/app/incidents/${link.incident_id}`)}
                      >
                        #{link.incident_id}
                        <ExternalLinkIcon class="size-3" />
                      </a>
                      <div class="text-muted-foreground text-xs">{link.incident_state}</div>
                    {/if}
                  </Table.Cell>
                  <Table.Cell>
                    {#if canWrite}
                      <div class="flex flex-col gap-1">
                        <select
                          class="border-input bg-background h-9 max-w-56 rounded-md border px-2 text-sm"
                          aria-label="Service"
                          value={link.monitor_tag ?? ""}
                          disabled={busy !== null}
                          onchange={(e) =>
                            act(
                              link.issue_key,
                              "moveJsmTicket",
                              {
                                issue_key: link.issue_key,
                                monitor_tag: e.currentTarget.value,
                                impact: link.monitor_impact || "DOWN",
                                show_at_top: link.show_at_top
                              },
                              `${link.issue_key} moved to ${monitorName(e.currentTarget.value || null)}`
                            )}
                        >
                          <option value="">No service</option>
                          {#each monitors as monitor (monitor.tag)}
                            <option value={monitor.tag}>{monitor.name}</option>
                          {/each}
                        </select>
                        <select
                          class="border-input bg-background h-9 max-w-56 rounded-md border px-2 text-sm"
                          aria-label="Impact"
                          value={link.monitor_impact}
                          disabled={busy !== null}
                          onchange={(e) =>
                            act(
                              link.issue_key,
                              "moveJsmTicket",
                              {
                                issue_key: link.issue_key,
                                monitor_tag: link.monitor_tag ?? "",
                                impact: e.currentTarget.value,
                                show_at_top: link.show_at_top
                              },
                              `${link.issue_key} impact changed`
                            )}
                        >
                          {#each IMPACTS as impact (impact.value)}
                            <option value={impact.value}>{impact.label}</option>
                          {/each}
                        </select>
                        <label class="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={link.show_at_top}
                            disabled={busy !== null}
                            onchange={(e) =>
                              act(
                                link.issue_key,
                                "moveJsmTicket",
                                {
                                  issue_key: link.issue_key,
                                  monitor_tag: link.monitor_tag ?? "",
                                  impact: link.monitor_impact || "DOWN",
                                  show_at_top: e.currentTarget.checked
                                },
                                e.currentTarget.checked
                                  ? `${link.issue_key} is shown at the top`
                                  : `${link.issue_key} is no longer at the top`
                              )}
                          />
                          Show to everyone (top of status page)
                        </label>
                      </div>
                    {:else}
                      {monitorName(link.monitor_tag)} · {link.monitor_impact}
                      {#if link.show_at_top}<Badge variant="outline" class="ml-1">At top</Badge>{/if}
                    {/if}
                  </Table.Cell>
                  <Table.Cell>
                    <div class="text-sm">{ago(link.last_synced_at)}</div>
                    {#if link.last_error}
                      <div class="text-destructive max-w-64 text-xs">{link.last_error}</div>
                    {/if}
                  </Table.Cell>
                  <Table.Cell class="text-right">
                    {#if canWrite}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onclick={() => {
                          if (confirm(`Stop updating the incident from ${link.issue_key}? The incident stays.`)) {
                            act(link.issue_key, "unlinkJsmTicket", { issue_key: link.issue_key }, "Unlinked");
                          }
                        }}
                      >
                        Unlink
                      </Button>
                    {/if}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Card.Content>
    </Card.Root>

    {#if overview.ignored.length > 0}
      <Card.Root>
        <Card.Header>
          <Card.Title>Ignored ({overview.ignored.length})</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-2">
          {#each overview.ignored as ticket (ticket.issue_key)}
            <div class="flex items-center justify-between gap-3 text-sm">
              <span><b>{ticket.issue_key}</b> {ticket.summary}</span>
              {#if canWrite}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onclick={() =>
                    act(ticket.issue_key, "unignoreJsmTicket", { issue_key: ticket.issue_key }, "Back in the list")}
                >
                  Restore
                </Button>
              {/if}
            </div>
          {/each}
        </Card.Content>
      </Card.Root>
    {/if}
  {/if}
</div>
