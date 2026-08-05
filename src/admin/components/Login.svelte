<script lang="ts">
  import { tick } from 'svelte';
  import { auth } from '../state/auth.svelte';
  import { t } from '../i18n';

  // Login screen (fixed overlay). Ids kept (#login, #login-username, #login-password,
  // #login-error) for style + mobile-zoom-check fidelity. Auth is server-gated; this
  // just submits credentials and shows the localized error/session-expiry notice.
  // The 2FA code field only appears once the server challenges (auth.twoFactorRequired,
  // set after a password-accepted response with no token): username/password stay in
  // their fields so the second submit reuses them, mirroring the game client's flow.
  let username = $state('');
  let password = $state('');
  let code = $state('');
  let recoveryCode = $state('');
  let factorMode = $state<'totp' | 'recovery'>('totp');
  let busy = $state(false);
  let usernameInput = $state<HTMLInputElement>();
  let passwordInput = $state<HTMLInputElement>();
  let factorInput = $state<HTMLInputElement>();

  async function focusFactorInput(): Promise<void> {
    await tick();
    factorInput?.focus();
  }

  async function focusPasswordInput(): Promise<void> {
    await tick();
    passwordInput?.focus();
  }

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const wasTwoFactorRequired = auth.twoFactorRequired;
    busy = true;
    try {
      await auth.login(
        username.trim(),
        password,
        factorMode === 'totp' ? code.trim() : '',
        factorMode === 'recovery' ? recoveryCode.trim() : '',
      );
    } finally {
      busy = false;
      if (auth.twoFactorRequired) await focusFactorInput();
      else if (!wasTwoFactorRequired && !auth.authed && auth.loginError) {
        await focusPasswordInput();
      }
    }
  }

  async function switchFactorMode(mode: 'totp' | 'recovery'): Promise<void> {
    if (busy) return;
    factorMode = mode;
    code = '';
    recoveryCode = '';
    auth.loginError = '';
    await focusFactorInput();
  }

  async function back(): Promise<void> {
    if (busy) return;
    code = '';
    recoveryCode = '';
    factorMode = 'totp';
    auth.cancelTwoFactor();
    await tick();
    usernameInput?.focus();
  }
</script>

<div id="login" class="login">
  <form class="panel" id="login-form" onsubmit={submit} aria-busy={busy}>
    <div class="panel-title">{t('app.title')}</div>
    {#if auth.twoFactorRequired}
      <div id="login-two-factor-prompt" role="status">{t('auth.twoFactorPrompt')}</div>
      {#if factorMode === 'totp'}
        <label for="login-code">{t('auth.authenticatorCode')}</label>
        <input
          id="login-code"
          inputmode="numeric"
          autocomplete="one-time-code"
          required
          disabled={busy}
          aria-describedby="login-two-factor-prompt"
          bind:this={factorInput}
          bind:value={code}
        />
        <button type="button" disabled={busy} onclick={() => switchFactorMode('recovery')}>
          {t('auth.useRecoveryCode')}
        </button>
      {:else}
        <label for="login-recovery-code">{t('auth.recoveryCode')}</label>
        <input
          id="login-recovery-code"
          autocomplete="one-time-code"
          required
          disabled={busy}
          aria-describedby="login-two-factor-prompt"
          bind:this={factorInput}
          bind:value={recoveryCode}
        />
        <button type="button" disabled={busy} onclick={() => switchFactorMode('totp')}>
          {t('auth.useAuthenticatorCode')}
        </button>
      {/if}
      <button type="submit" disabled={busy}>{t('auth.verify')}</button>
      <button type="button" disabled={busy} onclick={back}>{t('auth.back')}</button>
    {:else}
      <label for="login-username">{t('auth.username')}</label>
      <input
        id="login-username"
        autocomplete="username"
        required
        disabled={busy}
        bind:this={usernameInput}
        bind:value={username}
      />
      <label for="login-password">{t('auth.password')}</label>
      <input
        id="login-password"
        type="password"
        autocomplete="current-password"
        required
        disabled={busy}
        bind:this={passwordInput}
        bind:value={password}
      />
      <button type="submit" disabled={busy}>{t('auth.signIn')}</button>
    {/if}
    <div id="login-error" role="alert" aria-atomic="true">
      {auth.loginError || auth.sessionMessage}
    </div>
  </form>
</div>
