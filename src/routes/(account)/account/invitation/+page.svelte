<script lang="ts">
  import { tm, tmh, tmMessage } from "$lib/uiLocale.svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import LockIcon from "@lucide/svelte/icons/lock";
  import CheckCircleIcon from "@lucide/svelte/icons/check-circle";
  import AlertCircleIcon from "@lucide/svelte/icons/alert-circle";
  import EyeClosedIcon from "@lucide/svelte/icons/eye-closed";
  import EyeOpenIcon from "@lucide/svelte/icons/eye";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  const { data } = $props();

  const valid: boolean = $derived(data.valid);
  const error: string = $derived(tmMessage(data.error));
  const token: string = $derived(data.token);
  const email: string = $derived(data.email || "");
  const name: string = $derived(data.name || "");

  let loading = $state(false);
  let showPassword = $state(false);
  let showConfirmPassword = $state(false);
  let accountActivated = $state(false);

  let newPassword = $state("");
  let confirmPassword = $state("");

  async function handleAcceptInvitation() {
    if (!newPassword || !confirmPassword) {
      toast.error(tm("Please fill in all fields"));
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error(tm("Passwords do not match"));
      return;
    }

    if (newPassword.length < 8) {
      toast.error(tm("Password must be at least 8 characters"));
      return;
    }

    loading = true;
    try {
      const response = await fetch(clientResolver(resolve, "/account/invitation/api/accept-invitation"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receivedToken: token, newPassword })
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error ? tmMessage(data.error) : tm("Failed to set password"));
        return;
      }

      accountActivated = true;
      toast.success(tm("Account activated successfully!"));
    } catch (e) {
      toast.error(tm("An error occurred. Please try again."));
    } finally {
      loading = false;
    }
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    handleAcceptInvitation();
  }
</script>

<svelte:head>
  <title>{tm("Accept Invitation")}</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center p-4">
  <Card.Root class="kener-card w-full max-w-md">
    {#if !valid}
      <!-- Error View -->
      <Card.Header class="text-center">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <AlertCircleIcon class="h-8 w-8 text-red-600" />
        </div>
        <Card.Title>{tm("Invalid Invitation")}</Card.Title>
        <Card.Description>{error}</Card.Description>
      </Card.Header>
      <Card.Content>
        <Button href={clientResolver(resolve, "/account/signin")} class="w-full">
          <ArrowLeftIcon class="mr-2 h-4 w-4" />
          {tm("Go to Sign In")}
        </Button>
      </Card.Content>
    {:else if accountActivated}
      <!-- Success View -->
      <Card.Header class="text-center">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircleIcon class="h-8 w-8 text-green-600" />
        </div>
        <Card.Title>{tm("Account Activated")}</Card.Title>
        <Card.Description>
          {tm("Your account has been set up successfully. You can now sign in with your new password.")}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <Button href={clientResolver(resolve, "/account/signin")} class="w-full">
          <ArrowLeftIcon class="mr-2 h-4 w-4" />
          {tm("Go to Sign In")}
        </Button>
      </Card.Content>
    {:else}
      <!-- Set Password View -->
      <Card.Header>
        <Card.Title>{tm("Welcome, %name!", { name })}</Card.Title>
        <Card.Description>
          <span
            >{@html tmh(
              "You've been invited to join as **%email**. Create a password to activate your account and get started.",
              { email }
            )}</span
          >
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <form onsubmit={handleSubmit}>
          <Field.Group>
            <Field.Field class="relative flex flex-col gap-1">
              <Field.Label for="newPassword">{tm("Password")}</Field.Label>
              <InputGroup.Root>
                <InputGroup.Addon>
                  <LockIcon />
                </InputGroup.Addon>
                <InputGroup.Input
                  id="newPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  bind:value={newPassword}
                  required
                />
                <InputGroup.Addon align="inline-end">
                  <InputGroup.Button
                    type="button"
                    aria-label={showPassword ? tm("Hide password") : tm("Show password")}
                    title={showPassword ? tm("Hide password") : tm("Show password")}
                    size="icon-xs"
                    onclick={() => (showPassword = !showPassword)}
                  >
                    {#if showPassword}
                      <EyeClosedIcon class="size-4" />
                    {:else}
                      <EyeOpenIcon class="size-4" />
                    {/if}
                  </InputGroup.Button>
                </InputGroup.Addon>
              </InputGroup.Root>
              <Field.Description>
                {tm("Password must contain at least 8 characters, one uppercase, one lowercase, and one number.")}
              </Field.Description>
            </Field.Field>

            <Field.Field class="relative flex flex-col gap-1">
              <Field.Label for="confirmPassword">{tm("Confirm Password")}</Field.Label>
              <InputGroup.Root>
                <InputGroup.Addon>
                  <LockIcon />
                </InputGroup.Addon>
                <InputGroup.Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••"
                  bind:value={confirmPassword}
                  required
                />
                <InputGroup.Addon align="inline-end">
                  <InputGroup.Button
                    type="button"
                    aria-label={showConfirmPassword ? tm("Hide password") : tm("Show password")}
                    title={showConfirmPassword ? tm("Hide password") : tm("Show password")}
                    size="icon-xs"
                    onclick={() => (showConfirmPassword = !showConfirmPassword)}
                  >
                    {#if showConfirmPassword}
                      <EyeClosedIcon class="size-4" />
                    {:else}
                      <EyeOpenIcon class="size-4" />
                    {/if}
                  </InputGroup.Button>
                </InputGroup.Addon>
              </InputGroup.Root>
            </Field.Field>
          </Field.Group>

          <div class="mt-6">
            <Button type="submit" class="w-full" disabled={loading}>
              {#if loading}
                {tm("Activating Account...")}
              {:else}
                {tm("Activate Account")}
              {/if}
            </Button>
          </div>

          <div class="mt-4 text-center">
            <Button variant="link" href={clientResolver(resolve, "/account/signin")} class="text-sm">
              <ArrowLeftIcon class="mr-1 h-3 w-3" />
              {tm("Back to Sign In")}
            </Button>
          </div>
        </form>
      </Card.Content>
    {/if}
  </Card.Root>
</div>
