<script lang="ts">
  import { tm, tmh, tmStatus } from "$lib/uiLocale.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import GC from "$lib/global-constants";

  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import UsersIcon from "@lucide/svelte/icons/users";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import CheckCheckIcon from "@lucide/svelte/icons/check-check";
  import MailWarningIcon from "@lucide/svelte/icons/mail-warning";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import EyeClosedIcon from "@lucide/svelte/icons/eye-closed";
  import EyeOpenIcon from "@lucide/svelte/icons/eye";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { toast } from "svelte-sonner";
  import LocalTime from "$lib/components/LocalTime.svelte";
  import { onMount } from "svelte";
  import type { UserRecordDashboard, UserRecordPublic, RoleRecord } from "$lib/server/types/db.js";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";

  // Types
  interface NewUser {
    name: string;
    email: string;
    role_ids: string[];
  }

  interface EditUser extends UserRecordDashboard {
    /** Services (monitor tags) the user manages as a service manager. */
    monitor_tags?: string[];
    actions: {
      updatingServices?: boolean;
      sendingVerificationEmail: boolean;
      resendingInvitation: boolean;
      updatingRole: boolean;
      deactivatingUser: boolean;
      activatingUser: boolean;
    };
  }

  interface PageData {
    userDb: UserRecordPublic;
    userPermissions: string[];
    canSendEmail: boolean;
  }

  let { data }: { data: PageData } = $props();

  // Derived from data
  let currentUser = $derived(data.userDb);
  let userPermissions = $derived(data.userPermissions);
  let canSendEmail = $derived(data.canSendEmail);

  function hasPermission(perm: string): boolean {
    return userPermissions.includes(perm);
  }

  // State
  let loading = $state(true);
  let users = $state<UserRecordDashboard[]>([]);
  let roles = $state<RoleRecord[]>([]);
  let page = $state(1);
  let limit = $state(10);
  let total = $state(0);
  let totalPages = $state(0);
  let statusFilter = $state<"ACTIVE" | "INACTIVE">("ACTIVE");

  // Add user modal state
  let showAddUserDialog = $state(false);
  let creatingUser = $state(false);
  let creatingUserError = $state("");
  let newUser = $state<NewUser>({
    name: "",
    email: "",
    role_ids: []
  });

  // Edit user sheet state
  let showSettingsSheet = $state(false);
  let toEditUser = $state<EditUser | null>(null);
  let manualUpdateError = $state("");
  let manualSuccess = $state("");
  let sendingSelfVerification = $state(false);

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  function normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, " ");
  }

  // Fetch users
  async function fetchUsers() {
    loading = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getUsers",
          data: { page, limit, is_active: statusFilter === "ACTIVE" ? 1 : 0 }
        })
      });
      const result = await res.json();
      if (!result.error) {
        users = result.users || [];
        total = result.total || 0;
        totalPages = Math.ceil(total / limit);
      }
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error(tm("Failed to load users"));
    } finally {
      loading = false;
    }
  }

  // Create new user
  async function createNewUser() {
    creatingUserError = "";

    const normalizedName = normalizeName(newUser.name);
    const normalizedEmail = normalizeEmail(newUser.email);

    if (!normalizedName) {
      creatingUserError = tm("Name cannot be empty");
      return;
    }
    if (normalizedName.length < 2) {
      creatingUserError = tm("Name must be at least 2 characters");
      return;
    }
    if (normalizedName.length > 100) {
      creatingUserError = tm("Name must be less than 100 characters");
      return;
    }
    if (!normalizedEmail) {
      creatingUserError = tm("Email cannot be empty");
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      creatingUserError = tm("Please enter a valid email address");
      return;
    }
    if (newUser.role_ids.length === 0) {
      creatingUserError = tm("At least one role must be selected");
      return;
    }

    creatingUser = true;

    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createNewUser",
          data: {
            ...newUser,
            name: normalizedName,
            email: normalizedEmail
          }
        })
      });
      const result = await res.json();

      if (result.error) {
        creatingUserError = result.error;
      } else {
        users = [...users, result];
        showAddUserDialog = false;
        resetNewUser();
        toast.success(tm("User invited successfully"));
      }
    } catch (error) {
      creatingUserError = tm("Error while creating user");
    } finally {
      creatingUser = false;
    }
  }

  function resetNewUser() {
    newUser = {
      name: "",
      email: "",
      role_ids: []
    };
  }

  // Open settings for a user
  function openSettingsSheet(user: UserRecordDashboard) {
    toEditUser = {
      ...JSON.parse(JSON.stringify(user)),
      actions: {
        sendingVerificationEmail: false,
        resendingInvitation: false,
        updatingRole: false,
        deactivatingUser: false,
        activatingUser: false
      }
    };
    manualUpdateError = "";
    manualSuccess = "";
    showSettingsSheet = true;
  }

  // Resend invitation email
  async function resendInvitationEmail(email: string) {
    try {
      await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resendInvitation",
          data: { email }
        })
      });
      toast.success(tm("Invitation email resent"));
    } catch (error) {
      toast.error(tm("Failed to resend invitation email"));
    }
  }

  // Send verification email
  async function sendVerificationEmail(id: number) {
    sendingSelfVerification = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sendVerificationEmail",
          data: { toId: id }
        })
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        throw new Error(result.error || tm("Failed to send verification email"));
      }
      toast.success(tm("Verification email sent"));
    } catch (error) {
      const message = error instanceof Error ? error.message : tm("Failed to send verification email");
      toast.error(message);
    } finally {
      sendingSelfVerification = false;
    }
  }

  // Manual update user data
  async function manualUpdateData(updateType: string) {
    if (!toEditUser) return;

    manualUpdateError = "";
    manualSuccess = "";

    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manualUpdate",
          data: { ...toEditUser, updateType }
        })
      });
      const result = await res.json();

      if (result.error) {
        manualUpdateError = result.error;
      } else {
        users = users.map((user) => (user.id === toEditUser!.id ? result : user));
        manualSuccess = `User ${updateType} updated successfully`;

        // Update toEditUser with the result
        toEditUser = {
          ...result,

          actions: toEditUser.actions
        };
      }
    } catch (error) {
      manualUpdateError = tm("Error while updating user");
    }
  }

  // Pagination
  function goToPage(newPage: number) {
    page = newPage;
    fetchUsers();
  }

  // Role badge variant by precedence: admin > editor > others
  function getRoleBadgeVariant(roleIds: string[]): "default" | "secondary" | "outline" {
    if (roleIds.includes("admin")) return "default";
    if (roleIds.includes("editor")) return "secondary";
    return "outline";
  }

  let activeRoles = $derived(roles.filter((r) => r.status === "ACTIVE"));

  // Services a service manager can be given: every monitor, by name.
  let monitors = $state<Array<{ tag: string; name: string }>>([]);
  const monitorName = (tag: string) => monitors.find((m) => m.tag === tag)?.name ?? tag;

  async function fetchMonitors() {
    if (!hasPermission("monitors.read")) return;
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getMonitors", data: {} })
      });
      const result = await response.json();
      if (Array.isArray(result)) {
        monitors = result
          .map((m: { tag: string; name: string }) => ({ tag: m.tag, name: m.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch {
      /* the services card then lists no monitors */
    }
  }

  async function saveServices() {
    if (!toEditUser) return;
    toEditUser.actions.updatingServices = true;
    manualUpdateError = "";
    manualSuccess = "";
    try {
      const response = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setUserServices",
          data: { user_id: toEditUser.id, monitor_tags: toEditUser.monitor_tags ?? [] }
        })
      });
      const result = await response.json();
      if (result.error) {
        manualUpdateError = result.error;
      } else {
        toEditUser.monitor_tags = result.monitor_tags;
        manualSuccess = tm("Services updated");
        await fetchUsers();
      }
    } catch {
      manualUpdateError = tm("Error while updating services");
    } finally {
      toEditUser.actions.updatingServices = false;
    }
  }

  // Fetch roles
  async function fetchRoles() {
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getRoles", data: {} })
      });
      const result = await res.json();
      if (!result.error) {
        roles = result;
      }
    } catch {
      toast.error(tm("Failed to load roles"));
    }
  }

  function toggleRole(roleId: string, currentList: string[]): string[] {
    if (currentList.includes(roleId)) {
      return currentList.filter((r) => r !== roleId);
    } else {
      return [...currentList, roleId];
    }
  }

  // Initial load
  onMount(() => {
    fetchUsers();
    fetchRoles();
    fetchMonitors();
  });
</script>

<div class="container mx-auto space-y-6 py-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-1">
      <Button
        variant={statusFilter === "ACTIVE" ? "default" : "outline"}
        size="sm"
        onclick={() => {
          statusFilter = "ACTIVE";
          page = 1;
          fetchUsers();
        }}
      >
        {tm("Active")}
      </Button>
      <Button
        variant={statusFilter === "INACTIVE" ? "default" : "outline"}
        size="sm"
        onclick={() => {
          statusFilter = "INACTIVE";
          page = 1;
          fetchUsers();
        }}
      >
        {tm("Inactive")}
      </Button>
    </div>
    <div class="flex items-center gap-2">
      {#if loading}
        <Spinner class="size-5" />
      {/if}
      {#if hasPermission("users.write")}
        {#if !canSendEmail}
          <p class="text-muted-foreground max-w-xs text-xs">
            {tm("Email service not configured. Cannot invite new users.")}
            <a href={`${GC.DOCS_URL}/v4/setup/email-setup`} target="_blank" class="text-blue-500 underline">
              {tm("Email setup")}
            </a>
          </p>
        {/if}
        <Button onclick={() => (showAddUserDialog = true)} disabled={!canSendEmail}>
          <PlusIcon class="h-4 w-4" />
          {tm("Add User")}
        </Button>
      {/if}
    </div>
  </div>

  <!-- Users Table -->
  <div class="ktable rounded-xl border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{tm("Name")}</Table.Head>
          <Table.Head>{tm("Email")}</Table.Head>
          <Table.Head class="text-center">{tm("Auth")}</Table.Head>
          <Table.Head class="text-center">{tm("Verified")}</Table.Head>
          <Table.Head>{tm("Role")}</Table.Head>
          <Table.Head>{tm("Status")}</Table.Head>
          <Table.Head class="w-20 text-center">{tm("Actions")}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if loading && users.length === 0}
          <Table.Row>
            <Table.Cell colspan={7} class="py-8 text-center">
              <div class="flex items-center justify-center gap-2">
                <Spinner class="size-4" />
                <span class="text-muted-foreground text-sm">{tm("Loading users...")}</span>
              </div>
            </Table.Cell>
          </Table.Row>
        {:else if users.length === 0}
          <Table.Row>
            <Table.Cell colspan={7} class="text-muted-foreground py-8 text-center">{tm("No users found.")}</Table.Cell>
          </Table.Row>
        {:else}
          {#each users as user (user.id)}
            <Table.Row class={currentUser.id === user.id ? "bg-muted/50" : ""}>
              <Table.Cell class="font-medium"
                >{user.name}{#if currentUser.id === user.id}
                  <Badge variant="outline" class="ml-1 text-[10px]">{tm("You")}</Badge>{/if}</Table.Cell
              >
              <Table.Cell>{user.email}</Table.Cell>
              <Table.Cell class="text-center">
                <Badge variant={user.auth_provider === GC.AUTH_PROVIDER_OIDC ? "default" : "outline"}>
                  {user.auth_provider === GC.AUTH_PROVIDER_OIDC ? "OIDC" : tm("Local")}
                </Badge>
              </Table.Cell>
              <Table.Cell class="text-center">
                {#if user.is_verified || user.auth_provider === GC.AUTH_PROVIDER_OIDC}
                  <CheckCheckIcon class="mx-auto h-4 w-4 text-blue-500" />
                {:else}
                  <MailWarningIcon class="mx-auto h-4 w-4 text-yellow-500" />
                {/if}
              </Table.Cell>
              <Table.Cell>
                <Badge variant={getRoleBadgeVariant(user.role_ids)} class="uppercase">
                  {user.role_ids.join(", ")}
                </Badge>
                {#if ((user as EditUser).monitor_tags ?? []).length > 0}
                  <p class="text-muted-foreground mt-1 text-xs">
                    {((user as EditUser).monitor_tags ?? []).map(monitorName).join(", ")}
                  </p>
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if user.is_active}
                  <span class="text-sm font-semibold text-green-500">{tmStatus("ACTIVE")}</span>
                {:else}
                  <span class="text-sm font-semibold text-pink-500">{tmStatus("INACTIVE")}</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="text-center">
                {#if hasPermission("users.write") && currentUser.id !== user.id}
                  <Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => openSettingsSheet(user)}>
                    <SettingsIcon class="h-4 w-4" />
                  </Button>
                {:else if currentUser.id === user.id && !!!currentUser.is_verified}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sendingSelfVerification}
                    onclick={() => sendVerificationEmail(user.id)}
                  >
                    {#if sendingSelfVerification}
                      <Spinner class="size-4" />
                    {/if}
                    {tm("Verify Email")}
                  </Button>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>

  <!-- Pagination -->
  {#if total > 0}
    {@const startItem = (page - 1) * limit + 1}
    {@const endItem = Math.min(page * limit, total)}
    <div class="flex items-center justify-between">
      <span class="text-muted-foreground text-sm"
        >{tm("Showing %from-%to of %total", { from: startItem, to: endItem, total: total })}</span
      >
      {#if totalPages > 1}
        <div class="flex items-center gap-2">
          <Button variant="outline" size="icon" disabled={page === 1} onclick={() => goToPage(page - 1)}>
            <ChevronLeftIcon class="size-4" />
          </Button>
          <div class="flex items-center gap-1">
            {#each Array.from({ length: totalPages }, (_, i) => i + 1) as pageNum (pageNum)}
              {#if pageNum === 1 || pageNum === totalPages || (pageNum >= page - 1 && pageNum <= page + 1)}
                <Button variant={pageNum === page ? "default" : "ghost"} size="sm" onclick={() => goToPage(pageNum)}>
                  {pageNum}
                </Button>
              {:else if pageNum === page - 2 || pageNum === page + 2}
                <span class="text-muted-foreground px-1">...</span>
              {/if}
            {/each}
          </div>
          <Button variant="outline" size="icon" disabled={page === totalPages} onclick={() => goToPage(page + 1)}>
            <ChevronRightIcon class="size-4" />
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Add User Dialog -->
<Dialog.Root bind:open={showAddUserDialog}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{tm("Add New User")}</Dialog.Title>
      <Dialog.Description>{tm("Add a new user to your project")}</Dialog.Description>
    </Dialog.Header>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        createNewUser();
      }}
    >
      <div class="space-y-4 py-4">
        <div class="space-y-2">
          <Label for="name">{tm("Name")}</Label>
          <Input id="name" type="text" placeholder="John Doe" bind:value={newUser.name} required />
        </div>
        <div class="space-y-2">
          <Label for="email">{tm("Email")}</Label>
          <Input id="email" type="email" placeholder="email@example.com" bind:value={newUser.email} required />
        </div>

        <div class="space-y-2">
          <Label>{tm("Roles")}</Label>
          <div class="space-y-2">
            {#each activeRoles as role (role.id)}
              <label class="flex items-center gap-2">
                <Checkbox
                  checked={newUser.role_ids.includes(role.id)}
                  onCheckedChange={() => {
                    newUser.role_ids = toggleRole(role.id, newUser.role_ids);
                  }}
                />
                <span class="text-sm uppercase">{role.role_name}</span>
              </label>
            {/each}
            {#if activeRoles.length === 0}
              <p class="text-muted-foreground text-sm">{tm("No roles available")}</p>
            {/if}
          </div>
        </div>
        {#if creatingUserError}
          <p class="text-destructive text-sm font-medium">{creatingUserError}</p>
        {/if}
      </div>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (showAddUserDialog = false)}>{tm("Cancel")}</Button>
        <Button type="submit" disabled={creatingUser}>
          {#if creatingUser}
            <Spinner class="size-4" />
          {/if}
          {tm("Add User")}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- Edit User Sheet -->
<Sheet.Root bind:open={showSettingsSheet}>
  <Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-xl">
    <Sheet.Header>
      <Sheet.Title>{tm("Settings – %name", { name: toEditUser?.name ?? "" })}</Sheet.Title>
      <Sheet.Description>{tm("Manage user settings and permissions")}</Sheet.Description>
    </Sheet.Header>
    <div class="px-4">
      {#if toEditUser}
        <div class="space-y-6 py-6">
          <!-- User Info -->
          <div class="space-y-2 text-sm">
            <p>
              <strong>{tm("Created At:")}</strong>
              <LocalTime value={toEditUser.created_at} format="MMM dd, yyyy HH:mm" />
            </p>
            <p>
              <strong>{tm("Updated At:")}</strong>
              <LocalTime value={toEditUser.updated_at} format="MMM dd, yyyy HH:mm" />
            </p>
            <p>
              <strong>{tm("Name:")}</strong>
              {toEditUser.name}
            </p>
          </div>
          <!-- Resend Invitation -->
          {#if !toEditUser.has_password && toEditUser.auth_provider !== GC.AUTH_PROVIDER_OIDC}
            <Card.Root>
              <Card.Content class="">
                <p class="mb-3 text-sm">
                  {tm("This user hasn't set their password yet. Resend the invitation email to %email.", {
                    email: toEditUser.email
                  })}
                </p>
                {#if !canSendEmail}
                  <Alert.Root variant="destructive" class="mb-4">
                    <Alert.Description
                      >{tm("Email service not configured. Cannot resend invitation email.")}</Alert.Description
                    >
                  </Alert.Root>
                {/if}
                <Button
                  variant="secondary"
                  disabled={toEditUser.actions.resendingInvitation || !canSendEmail}
                  onclick={async () => {
                    toEditUser!.actions.resendingInvitation = true;
                    manualSuccess = "";
                    await resendInvitationEmail(toEditUser!.email);
                    toEditUser!.actions.resendingInvitation = false;
                    manualSuccess = tm("Invitation email resent successfully");
                  }}
                >
                  {#if toEditUser.actions.resendingInvitation}
                    <Spinner class="size-4" />
                  {/if}
                  {tm("Resend Invitation")}
                </Button>
              </Card.Content>
            </Card.Root>
          {/if}

          <!-- Update Role -->
          <Card.Root>
            <Card.Content class="p-4">
              <p class="mb-3 text-sm">
                {tm("Change the roles of the user. The user will have different permissions based on assigned roles.")}
              </p>
              <div class="space-y-2">
                {#each activeRoles as role (role.id)}
                  <label class="flex items-center gap-2">
                    <Checkbox
                      checked={toEditUser.role_ids.includes(role.id)}
                      disabled={toEditUser.actions.updatingRole}
                      onCheckedChange={() => {
                        toEditUser!.role_ids = toggleRole(role.id, toEditUser!.role_ids);
                      }}
                    />
                    <span class="text-sm uppercase">{role.role_name}</span>
                  </label>
                {/each}
                {#if activeRoles.length === 0}
                  <p class="text-muted-foreground text-sm">{tm("No roles available")}</p>
                {/if}
              </div>
              <Button
                variant="secondary"
                class="mt-3"
                disabled={toEditUser.actions.updatingRole || toEditUser.role_ids.length === 0}
                onclick={() => {
                  toEditUser!.actions.updatingRole = true;
                  manualUpdateData("role").then(() => {
                    toEditUser!.actions.updatingRole = false;
                  });
                }}
              >
                {#if toEditUser.actions.updatingRole}
                  <Spinner class="size-4" />
                {/if}
                {tm("Update Roles")}
              </Button>
            </Card.Content>
          </Card.Root>

          <!-- Services the user manages (role Service Manager) -->
          <Card.Root>
            <Card.Content class="p-4">
              <p class="mb-1 text-sm font-medium">{tm("Services this user manages")}</p>
              <p class="text-muted-foreground mb-3 text-xs">
                <span
                  >{@html tmh(
                    "With the role **Service Manager**, the user signs in to a page with only these services: they can set the status, report problems and plan maintenance, and see nothing else."
                  )}</span
                >
                {#if !toEditUser.role_ids.includes("service_manager")}
                  {tm("This user does not have that role yet.")}
                {/if}
              </p>
              <Select.Root
                type="multiple"
                value={toEditUser.monitor_tags ?? []}
                onValueChange={(v) => (toEditUser!.monitor_tags = v)}
              >
                <Select.Trigger class="w-full" disabled={toEditUser.actions.updatingServices}>
                  <span class="truncate">
                    {#if (toEditUser.monitor_tags ?? []).length === 0}
                      {tm("No services")}
                    {:else}
                      {(toEditUser.monitor_tags ?? []).map(monitorName).join(", ")}
                    {/if}
                  </span>
                </Select.Trigger>
                <Select.Content class="max-h-80">
                  {#each monitors as monitor (monitor.tag)}
                    <Select.Item value={monitor.tag} label={monitor.name}>{monitor.name}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
              <Button
                variant="secondary"
                class="mt-3"
                disabled={toEditUser.actions.updatingServices}
                onclick={saveServices}
              >
                {#if toEditUser.actions.updatingServices}
                  <Spinner class="size-4" />
                {/if}
                {tm("Update Services")}
              </Button>
            </Card.Content>
          </Card.Root>

          <!-- Activate/Deactivate User -->
          {#if toEditUser.is_active}
            <Card.Root class="border-destructive">
              <Card.Content class="p-4">
                <p class="mb-3 text-sm">
                  {tm("Deactivate User. The user will not be able to login. Existing session will get invalidated.")}
                </p>
                <Button
                  variant="destructive"
                  disabled={toEditUser.actions.deactivatingUser}
                  onclick={() => {
                    toEditUser!.actions.deactivatingUser = true;
                    toEditUser!.is_active = 0;
                    manualUpdateData("is_active").then(() => {
                      toEditUser!.actions.deactivatingUser = false;
                    });
                  }}
                >
                  {#if toEditUser.actions.deactivatingUser}
                    <Spinner class="size-4" />
                  {/if}
                  {tm("Deactivate User")}
                </Button>
              </Card.Content>
            </Card.Root>
          {:else}
            <Card.Root>
              <Card.Content class="p-4">
                <p class="mb-3 text-sm">{tm("Activate User. The user will be able to login.")}</p>
                <Button
                  variant="secondary"
                  disabled={toEditUser.actions.activatingUser}
                  onclick={() => {
                    toEditUser!.actions.activatingUser = true;
                    toEditUser!.is_active = 1;
                    manualUpdateData("is_active").then(() => {
                      toEditUser!.actions.activatingUser = false;
                    });
                  }}
                >
                  {#if toEditUser.actions.activatingUser}
                    <Spinner class="size-4" />
                  {/if}
                  {tm("Activate User")}
                </Button>
              </Card.Content>
            </Card.Root>
          {/if}

          <!-- Status Messages -->
          {#if manualUpdateError}
            <Alert.Root variant="destructive">
              <Alert.Description>{manualUpdateError}</Alert.Description>
            </Alert.Root>
          {/if}
          {#if manualSuccess}
            <Alert.Root class="border-green-500 text-green-500">
              <Alert.Description>{manualSuccess}</Alert.Description>
            </Alert.Root>
          {/if}
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
