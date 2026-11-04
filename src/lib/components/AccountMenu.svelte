<script lang="ts">
  // The signed-in person in the status page's top bar: their name, and a menu with their role and
  // what that role can do (open the admin area, edit what this page shows, or for a service manager
  // their own services), and log out.
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import { t, translations } from "$lib/stores/i18n";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { navigationMenuTriggerStyle } from "$lib/components/ui/navigation-menu/navigation-menu-trigger.svelte";
  import CircleUser from "@lucide/svelte/icons/circle-user";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Settings from "@lucide/svelte/icons/settings";
  import Pencil from "@lucide/svelte/icons/pencil";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";

  const user = $derived(page.data?.loggedInUser as { name: string; email: string } | null);

  const BUILT_IN_ROLES: Record<string, string> = {
    admin: "Administrator",
    editor: "Editor",
    member: "Member",
    service_manager: "Service Manager"
  };
  const roles = $derived(
    ((page.data?.loggedInRoles ?? []) as Array<{ id: string; name: string }>)
      .map((r) => {
        const key = BUILT_IN_ROLES[r.id];
        return key ? ($translations[key] ?? key) : r.name;
      })
      .join(", ")
  );

  const firstName = $derived((user?.name || "").trim().split(/\s+/)[0] || user?.email || "");

  type Item = { label: string; url: string; icon: typeof Settings };

  // What this person can do from here, depending on their role and the page they are on.
  const items = $derived.by((): Item[] => {
    if (!user) return [];
    if (page.data?.homePath === "/my-services") {
      const tag = page.params.monitor_tag;
      const list: Item[] = [];
      if (tag && page.data.myServiceTags?.includes(tag)) {
        list.push({
          label: $t("Report status"),
          url: clientResolver(resolve, `/my-services#service-${tag}`),
          icon: Pencil
        });
      }
      list.push({ label: $t("My services"), url: clientResolver(resolve, "/my-services"), icon: ListChecks });
      return list;
    }
    const list: Item[] = [];
    if (page.route.id === "/(kener)/monitors/[monitor_tag]") {
      list.push({
        label: $t("Edit Monitor"),
        url: clientResolver(resolve, "/manage/app/monitors/" + page.params.monitor_tag),
        icon: Pencil
      });
    } else if (page.route.id === "/(kener)/incidents/[incident_id]") {
      list.push({
        label: $t("Update Incident"),
        url: clientResolver(resolve, "/manage/app/incidents/" + page.params.incident_id),
        icon: Pencil
      });
    } else if (page.route.id === "/(kener)/maintenances/[maintenance_id]" && page.data.maintenance?.id) {
      list.push({
        label: $t("Update Maintenance"),
        url: clientResolver(resolve, "/manage/app/maintenances/" + page.data.maintenance.id),
        icon: Pencil
      });
    }
    list.push({
      label: $t("Manage Site"),
      url: clientResolver(resolve, page.data?.homePath || "/manage/app/site-configurations"),
      icon: Settings
    });
    return list;
  });
</script>

{#if user}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          data-testid="account-menu"
          title={user.email}
          class="{navigationMenuTriggerStyle()} hover:border-border max-w-48 gap-1.5 border border-transparent bg-transparent text-xs hover:bg-transparent focus:bg-current/10 focus:text-current data-[state=open]:bg-current/10 data-[state=open]:text-current"
          style="border-radius: var(--radius-3xl)"
        >
          <span class="bg-up size-2 shrink-0 rounded-full" aria-hidden="true"></span>
          <span class="truncate">{firstName}</span>
          <ChevronDown class="size-3 shrink-0 opacity-70" />
        </button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-64 rounded-2xl p-2">
      <DropdownMenu.Label class="font-normal">
        <div class="flex items-center gap-2">
          <CircleUser class="text-muted-foreground size-8 shrink-0" />
          <div class="grid min-w-0 text-sm leading-tight">
            <span class="truncate font-medium">{user.name}</span>
            <span class="text-muted-foreground truncate text-xs">{user.email}</span>
          </div>
        </div>
        <p class="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
          <span class="bg-up size-2 rounded-full" aria-hidden="true"></span>
          <span>{$t("Signed in")}</span>
          {#if roles}
            <span aria-hidden="true">·</span>
            <span class="text-foreground font-medium" data-testid="account-role">{roles}</span>
          {/if}
        </p>
      </DropdownMenu.Label>
      <DropdownMenu.Separator />
      {#each items as item (item.url)}
        <DropdownMenu.Item class="rounded-xl">
          {#snippet child({ props })}
            <a {...props} href={item.url} class="{props.class} flex items-center gap-2 text-sm">
              <item.icon class="size-4" />
              {item.label}
            </a>
          {/snippet}
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator />
      <form method="POST" action={clientResolver(resolve, "/account/logout")}>
        <button
          type="submit"
          class="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm"
        >
          <LogOut class="size-4" />
          {$t("Log out")}
        </button>
      </form>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
