<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as InputOTP from "$lib/components/ui/input-otp/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { onMount } from "svelte";
  import { base, resolve } from "$app/paths";
  import { page } from "$app/state";
  import clientResolver from "$lib/client/resolver.js";

  import Mail from "@lucide/svelte/icons/mail";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Bell from "@lucide/svelte/icons/bell";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Wrench from "@lucide/svelte/icons/wrench";
  import Layers from "@lucide/svelte/icons/layers";
  import LogIn from "@lucide/svelte/icons/log-in";
  import UserCheck from "@lucide/svelte/icons/user-check";
  import { t } from "$lib/stores/i18n";
  import trackEvent from "$lib/beacon";
  import ICONS from "$lib/icons";
  import Captcha from "./Captcha.svelte";
  import { PlanScopedSubscription } from "$lib/subscribeScope";

  interface Props {
    compact?: boolean;
    /** Monitors of the current monitor or app page; the button then subscribes to these. */
    scopeTags?: string[];
    /** Name of that monitor or page, shown in the dialog. */
    scopeName?: string;
  }

  let { compact = false, scopeTags = [], scopeName = "" }: Props = $props();
  let isScoped = $derived(scopeTags.length > 0 && !!scopeName);
  // Set when the dialog is opened from a scoped button; used once preferences are loaded.
  let pendingScope = $state(false);
  let scopeMessage = $state("");
  let open = $state(false);

  const STORAGE_KEY = "subscriber_token";

  // UI States
  type View = "loading" | "login" | "signin" | "otp" | "preferences" | "error";
  let currentView = $state<View>("loading");
  let isSubmitting = $state(false);
  let errorMessage = $state("");

  // Form data
  let email = $state("");
  let otpValue = $state("");
  let captchaRequired = $state(false);
  let captchaToken = $state<string | null>(null);
  let captchaRef: { reset: () => void } | undefined = $state();

  // Preferences data
  let subscriberEmail = $state("");
  let incidentsEnabled = $state(false);
  let maintenancesEnabled = $state(false);
  let availableSubscriptions = $state<{ incidents: boolean; maintenances: boolean }>({
    incidents: false,
    maintenances: false
  });

  // Monitor choices: an empty list means every monitor.
  interface SubscribableMonitor {
    tag: string;
    name: string;
    image: string | null;
  }
  let availableMonitors = $state<SubscribableMonitor[]>([]);
  let chosenMonitorTags = $state<string[]>([]);
  // "Only selected services" is on while the visitor picks; it stays on with nothing picked
  // until they pick one, and nothing is saved until then.
  let onlySelectedMonitors = $state(false);
  let monitorSearch = $state("");
  let savingMonitors = $state(false);
  let filteredMonitors = $derived(
    monitorSearch.trim()
      ? availableMonitors.filter((m) => m.name.toLowerCase().includes(monitorSearch.trim().toLowerCase()))
      : availableMonitors
  );

  // Signed-in people subscribe with the email of their account, without a code. With "only
  // signed-in people" on, visitors are asked to sign in instead of entering an email.
  const signedIn = $derived(!!page.data?.loggedInUser);
  const requireSignIn = $derived(!!page.data?.subsRequireSignIn);
  // Back to this page after signing in (the path without the site's base path).
  const signInHref = $derived.by(() => {
    const here = page.url.pathname.startsWith(base) ? page.url.pathname.slice(base.length) || "/" : "/";
    return clientResolver(resolve, "/account/signin") + "?next=" + encodeURIComponent(here + page.url.search);
  });

  // Check token on mount
  onMount(() => {
    checkExistingToken();
  });

  // Also check when dialog opens
  $effect(() => {
    if (open) {
      checkExistingToken();
    }
  });

  function signedOutView(): View {
    return requireSignIn ? "signin" : "login";
  }

  /** A subscriber token for the signed-in person's account; null when that is not possible. */
  async function accountToken(): Promise<string | null> {
    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "account" })
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.token) return null;
      localStorage.setItem(STORAGE_KEY, data.token);
      return data.token;
    } catch {
      return null;
    }
  }

  async function checkExistingToken() {
    let token = localStorage.getItem(STORAGE_KEY);
    if (signedIn && open) {
      // Always the account's own subscription, even if this browser had another email before.
      currentView = "loading";
      token = await accountToken();
    }
    if (!token) {
      currentView = signedOutView();
      return;
    }

    currentView = "loading";
    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getPreferences", token })
      });

      if (!response.ok) {
        // Token invalid or expired
        localStorage.removeItem(STORAGE_KEY);
        currentView = signedOutView();
        return;
      }

      const data = await response.json();
      subscriberEmail = data.email || "";
      incidentsEnabled = data.subscriptions?.incidents || false;
      maintenancesEnabled = data.subscriptions?.maintenances || false;
      availableSubscriptions = data.availableSubscriptions || { incidents: false, maintenances: false };
      availableMonitors = data.availableMonitors || [];
      chosenMonitorTags = data.monitorTags || [];
      onlySelectedMonitors = chosenMonitorTags.length > 0;
      monitorSearch = "";
      currentView = "preferences";
      if (pendingScope && open) {
        pendingScope = false;
        await applyScope(token);
      }
    } catch (err) {
      localStorage.removeItem(STORAGE_KEY);
      currentView = signedOutView();
    }
  }

  async function handleLogin() {
    if (!email.trim()) {
      errorMessage = $t("Please enter a valid email address");
      return;
    }

    isSubmitting = true;
    errorMessage = "";

    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email: email.trim(), captchaToken })
      });

      if (!response.ok) {
        const data = await response.json();
        errorMessage = data?.message || $t("Failed to send verification code");
        captchaToken = null;
        captchaRef?.reset();
        return;
      }

      trackEvent("subscribe_login_sent", { source: "subscribe_menu" });

      // The token is single-use and has now been consumed by the provider
      // regardless of which UI path sent it -- clear it so nothing can
      // accidentally resubmit it later.
      captchaToken = null;
      currentView = "otp";
      otpValue = "";
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
    } finally {
      isSubmitting = false;
    }
  }

  function handleResend() {
    if (captchaRequired) {
      // The OTP view has no captcha widget to produce a fresh token, and
      // the one from the original submission is already consumed -- send
      // the user back to solve a new challenge instead of silently
      // replaying a token the provider will reject.
      handleBackToEmail();
      return;
    }
    handleLogin();
  }

  async function handleVerifyOTP() {
    if (otpValue.length !== 6) {
      errorMessage = $t("Please enter the 6-digit verification code");
      return;
    }

    isSubmitting = true;
    errorMessage = "";

    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", email: email.trim(), code: otpValue })
      });

      if (!response.ok) {
        const data = await response.json();
        errorMessage = $t("Verification failed");
        return;
      }

      const data = await response.json();
      localStorage.setItem(STORAGE_KEY, data.token);
      trackEvent("subscribe_otp_verified", { source: "subscribe_menu" });
      await checkExistingToken();
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
    } finally {
      isSubmitting = false;
    }
  }

  async function handlePreferenceChange(type: "incidents" | "maintenances", value: boolean) {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      currentView = signedOutView();
      return;
    }

    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updatePreferences",
          token,
          [type]: value
        })
      });

      if (!response.ok) {
        const data = await response.json();
        errorMessage = $t("Failed to update preference");
        // Revert the toggle
        if (type === "incidents") {
          incidentsEnabled = !value;
        } else {
          maintenancesEnabled = !value;
        }
        return;
      }

      // Update local state
      if (type === "incidents") {
        incidentsEnabled = value;
      } else {
        maintenancesEnabled = value;
      }

      trackEvent("subscribe_pref_toggled", { source: "subscribe_menu", type, value });
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
      // Revert the toggle
      if (type === "incidents") {
        incidentsEnabled = !value;
      } else {
        maintenancesEnabled = !value;
      }
    }
  }

  async function saveMonitorTags(tags: string[]): Promise<boolean> {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      currentView = signedOutView();
      return false;
    }
    savingMonitors = true;
    errorMessage = "";
    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updatePreferences", token, monitorTags: tags })
      });
      if (!response.ok) {
        errorMessage = $t("Failed to update preference");
        return false;
      }
      trackEvent("subscribe_monitors_changed", { source: "subscribe_menu", count: tags.length });
      return true;
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
      return false;
    } finally {
      savingMonitors = false;
    }
  }

  /** Adds this page's monitors to the visitor's subscription, see PlanScopedSubscription. */
  async function applyScope(token: string) {
    const plan = PlanScopedSubscription({
      scopeTags,
      availableTags: availableMonitors.map((m) => m.tag),
      chosenTags: chosenMonitorTags,
      incidentsEnabled,
      maintenancesEnabled,
      availableSubscriptions
    });
    if (plan.result === "none") return;
    if (plan.monitorTags || plan.enable) {
      savingMonitors = true;
      try {
        const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "updatePreferences",
            token,
            ...(plan.enable ?? {}),
            ...(plan.monitorTags ? { monitorTags: plan.monitorTags } : {})
          })
        });
        if (!response.ok) {
          errorMessage = $t("Failed to update preference");
          return;
        }
      } catch (err) {
        errorMessage = $t("Network error. Please try again.");
        return;
      } finally {
        savingMonitors = false;
      }
      if (plan.monitorTags) {
        chosenMonitorTags = plan.monitorTags;
        onlySelectedMonitors = true;
      }
      if (plan.enable?.incidents) incidentsEnabled = true;
      if (plan.enable?.maintenances) maintenancesEnabled = true;
      trackEvent("subscribe_scope_applied", { source: "subscribe_menu", result: plan.result });
    }
    const messages = {
      only: "You now get updates only for %name.",
      added: "%name was added to your services.",
      already: "You already get updates for %name."
    };
    scopeMessage = $t(messages[plan.result], { name: scopeName });
  }

  async function handleOnlySelectedChange(value: boolean) {
    onlySelectedMonitors = value;
    if (!value && chosenMonitorTags.length > 0) {
      const previous = chosenMonitorTags;
      chosenMonitorTags = [];
      if (!(await saveMonitorTags([]))) {
        chosenMonitorTags = previous;
        onlySelectedMonitors = true;
      }
    }
  }

  async function handleMonitorToggle(tag: string, value: boolean) {
    const previous = chosenMonitorTags;
    const next = value ? [...previous.filter((t) => t !== tag), tag] : previous.filter((t) => t !== tag);
    chosenMonitorTags = next;
    // With nothing picked the visitor still hears of every monitor; keep the list open and
    // save only once a monitor is picked again.
    const toSave = next.length > 0 ? next : previous.length > 0 ? [] : null;
    if (toSave === null) return;
    if (!(await saveMonitorTags(toSave))) {
      chosenMonitorTags = previous;
    }
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEY);
    email = "";
    otpValue = "";
    subscriberEmail = "";
    incidentsEnabled = false;
    maintenancesEnabled = false;
    chosenMonitorTags = [];
    onlySelectedMonitors = false;
    errorMessage = "";
    currentView = signedOutView();
    trackEvent("subscribe_logout", { source: "subscribe_menu" });
  }

  function handleBackToEmail() {
    currentView = "login";
    otpValue = "";
    errorMessage = "";
  }

  function openDialog() {
    pendingScope = isScoped;
    scopeMessage = "";
    open = true;
    trackEvent("subscribe_opened", { source: "theme_plus", scoped: isScoped });
  }

  function handleClose() {
    open = false;
    errorMessage = "";
  }

  // Google reCAPTCHA's expanded image-challenge renders as a second iframe
  // appended outside this Dialog's own DOM subtree (unlike the basic
  // checkbox, which nests inside it). Bits UI's outside-interaction
  // detection sees clicks/focus landing on that iframe as "outside" and
  // dismisses the dialog, orphaning the still-open challenge. Any outside
  // interaction targeting an iframe is treated as captcha-challenge traffic
  // and kept open — nothing else in this dialog renders a bare iframe.
  function ignoreCaptchaIframeInteraction(event: PointerEvent | FocusEvent) {
    if (event.target instanceof HTMLIFrameElement) {
      event.preventDefault();
    }
  }
</script>

{#if compact}
  <Button
    variant="outline"
    size="icon-sm"
    class="bg-background/80 dark:bg-background/70 border-foreground/10 rounded-full border shadow-none backdrop-blur-md"
    aria-label={isScoped ? $t("Subscribe to %name", { name: scopeName }) : $t("Subscribe")}
    onclick={openDialog}
  >
    <ICONS.Bell />
  </Button>
{:else}
  <Button
    variant="outline"
    size="sm"
    class="rounded-btn bg-background/80 dark:bg-background/70 border-foreground/10 border text-xs backdrop-blur-md"
    aria-label={isScoped ? $t("Subscribe to %name", { name: scopeName }) : $t("Subscribe")}
    title={isScoped ? $t("Subscribe to %name", { name: scopeName }) : undefined}
    onclick={openDialog}
  >
    <ICONS.Bell class="" />
    {isScoped ? $t("Subscribe to this service") : $t("Subscribe")}
  </Button>
{/if}

<Dialog.Root bind:open>
  <Dialog.Overlay class="backdrop-blur-[2px]" />
  <Dialog.Content
    class="max-w-sm rounded-3xl"
    onInteractOutside={ignoreCaptchaIframeInteraction}
    onFocusOutside={ignoreCaptchaIframeInteraction}
  >
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <Bell class="h-5 w-5" />
        {$t("Subscribe to Updates")}
      </Dialog.Title>
      <Dialog.Description>
        {#if currentView === "signin" && isScoped}
          {$t("Sign in to get notified about incidents and scheduled maintenance of %name.", { name: scopeName })}
        {:else if currentView === "signin"}
          {$t("Sign in to get notified about incidents and scheduled maintenance.")}
        {:else if currentView === "login" && isScoped}
          {$t("Get notified about incidents and scheduled maintenance of %name.", { name: scopeName })}
        {:else if currentView === "login"}
          {$t("Get notified about incidents and scheduled maintenance.")}
        {:else if currentView === "otp"}
          {$t("Enter the verification code sent to your email.")}
        {:else if currentView === "preferences"}
          {$t("Manage your notification preferences.")}
        {:else if currentView === "loading"}
          {$t("Loading your preferences...")}
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="py-4">
      {#if currentView === "loading"}
        <div class="flex items-center justify-center py-8">
          <Loader2 class="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      {:else if currentView === "signin"}
        <!-- Sign-in View: only signed-in people subscribe -->
        <div class="flex flex-col items-center gap-4 text-center">
          <div class="bg-muted flex size-12 items-center justify-center rounded-full">
            <LogIn class="text-muted-foreground size-5" />
          </div>
          <p class="text-muted-foreground text-sm">
            {$t("Sign in with your company account. You then get the emails at your work address, no code needed.")}
          </p>
          <Button href={signInHref} class="w-full" data-testid="subscribe-sign-in">
            <LogIn class="mr-2 h-4 w-4" />
            {$t("Sign in to subscribe")}
          </Button>
        </div>
      {:else if currentView === "login"}
        <!-- Login View -->
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <Label for="email">{$t("Email address")}</Label>
            <div class="relative">
              <Mail class="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                class="pl-10"
                bind:value={email}
                disabled={isSubmitting}
                onkeydown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
          </div>

          <Captcha
            bind:this={captchaRef}
            onReady={(required) => (captchaRequired = required)}
            onVerify={(token) => (captchaToken = token)}
          />

          {#if errorMessage}
            <p class="text-destructive text-sm">{errorMessage}</p>
          {/if}

          <Button onclick={handleLogin} disabled={isSubmitting || (captchaRequired && !captchaToken)} class="w-full">
            {#if isSubmitting}
              <Loader2 class="mr-2 h-4 w-4 animate-spin" />
              {$t("Sending...")}
            {:else}
              {$t("Continue")}
            {/if}
          </Button>
        </div>
      {:else if currentView === "otp"}
        <!-- OTP View -->
        <div class="flex flex-col gap-4">
          <div class="flex flex-col items-center gap-4">
            <p class="text-muted-foreground text-center text-sm">
              {$t("We sent a 6-digit code to")} <strong class="text-foreground">{email}</strong>
            </p>

            <InputOTP.Root maxlength={6} bind:value={otpValue}>
              {#snippet children({ cells })}
                <InputOTP.Group>
                  {#each cells as cell, i (i)}
                    <InputOTP.Slot {cell} />
                  {/each}
                </InputOTP.Group>
              {/snippet}
            </InputOTP.Root>
          </div>

          {#if errorMessage}
            <p class="text-destructive text-center text-sm">{errorMessage}</p>
          {/if}

          <div class="flex gap-2">
            <Button variant="outline" onclick={handleBackToEmail} disabled={isSubmitting} class="flex-1">
              <ArrowLeft class="mr-2 h-4 w-4" />
              {$t("Back")}
            </Button>
            <Button onclick={handleVerifyOTP} disabled={isSubmitting || otpValue.length !== 6} class="flex-1">
              {#if isSubmitting}
                <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                {$t("Verifying")}...
              {:else}
                {$t("Verify")}
              {/if}
            </Button>
          </div>

          <Button variant="link" onclick={handleResend} disabled={isSubmitting} class="text-xs">
            {$t("Didn't receive the code? Resend")}
          </Button>
        </div>
      {:else if currentView === "preferences"}
        <!-- Preferences View -->
        <div class="flex flex-col gap-6">
          {#if scopeMessage}
            <p class="bg-muted rounded-lg px-3 py-2 text-sm" role="status">{scopeMessage}</p>
          {/if}
          <div class="rounded-lg border p-4">
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 gap-2">
                {#if signedIn}
                  <UserCheck class="text-muted-foreground h-4 w-4 shrink-0" />
                {:else}
                  <Mail class="text-muted-foreground h-4 w-4 shrink-0" />
                {/if}
                <span class="truncate text-sm font-medium">{subscriberEmail}</span>
              </div>
              {#if !signedIn}
                <Button variant="ghost" size="icon-sm" onclick={handleLogout} class="rounded-btn">
                  <LogOut class="h-4 w-4" />
                </Button>
              {/if}
            </div>
          </div>

          <div class="flex flex-col gap-4">
            {#if availableSubscriptions.incidents}
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <AlertTriangle class="h-5 w-5 text-orange-500" />
                  <div>
                    <Label class="font-medium">{$t("Incident Updates")}</Label>
                    <p class="text-muted-foreground text-xs">{$t("Get notified about incidents updates")}</p>
                  </div>
                </div>
                <Switch
                  checked={incidentsEnabled}
                  onCheckedChange={(value) => handlePreferenceChange("incidents", value)}
                />
              </div>
            {/if}

            {#if availableSubscriptions.maintenances}
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <Wrench class="h-5 w-5 text-blue-500" />
                  <div>
                    <Label class="font-medium">{$t("Maintenance Updates")}</Label>
                    <p class="text-muted-foreground text-xs">{$t("Get notified about scheduled maintenance")}</p>
                  </div>
                </div>
                <Switch
                  checked={maintenancesEnabled}
                  onCheckedChange={(value) => handlePreferenceChange("maintenances", value)}
                />
              </div>
            {/if}
          </div>

          {#if availableMonitors.length > 0 && (availableSubscriptions.incidents || availableSubscriptions.maintenances)}
            <div class="flex flex-col gap-3 border-t pt-4">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-3">
                  <Layers class="text-muted-foreground h-5 w-5" />
                  <div>
                    <Label class="font-medium">{$t("Only selected services")}</Label>
                    <p class="text-muted-foreground text-xs">
                      {$t("Get updates only for the services you pick")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={onlySelectedMonitors}
                  disabled={savingMonitors}
                  onCheckedChange={(value) => handleOnlySelectedChange(value)}
                />
              </div>

              {#if onlySelectedMonitors}
                {#if availableMonitors.length > 8}
                  <Input
                    type="search"
                    placeholder={$t("Search services")}
                    class="h-8 text-sm"
                    bind:value={monitorSearch}
                  />
                {/if}
                <div class="scrollbar-hidden max-h-56 overflow-y-auto rounded-lg border">
                  {#each filteredMonitors as monitor (monitor.tag)}
                    <label
                      class="hover:bg-muted/60 flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0"
                    >
                      <Checkbox
                        checked={chosenMonitorTags.includes(monitor.tag)}
                        disabled={savingMonitors}
                        onCheckedChange={(value) => handleMonitorToggle(monitor.tag, value === true)}
                      />
                      {#if monitor.image}
                        <img
                          src={clientResolver(resolve, monitor.image)}
                          alt=""
                          class="size-5 shrink-0 rounded object-contain"
                        />
                      {/if}
                      <span class="min-w-0 truncate text-sm">{monitor.name}</span>
                    </label>
                  {:else}
                    <p class="text-muted-foreground px-3 py-2 text-sm">{$t("No services found")}</p>
                  {/each}
                </div>
                <p class="text-muted-foreground text-xs">
                  {#if chosenMonitorTags.length === 0}
                    {$t("Pick at least one service. Until then you get updates for all services.")}
                  {:else}
                    {$t("You get updates only for the selected services.")}
                  {/if}
                </p>
              {/if}
            </div>
          {/if}

          {#if errorMessage}
            <p class="text-destructive text-sm">{errorMessage}</p>
          {/if}
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
