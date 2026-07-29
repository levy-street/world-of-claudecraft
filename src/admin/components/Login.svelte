<script lang="ts">
  import { auth } from '../state/auth.svelte';
  import { t } from '../i18n';
  import { classifyAdminAuthCode } from '../two_factor';

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

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    void auth.login(
      username.trim(),
      password,
      factorMode === 'totp' ? code.trim() : '',
      factorMode === 'recovery' ? recoveryCode.trim() : '',
    );
  }

  function switchFactorMode(mode: 'totp' | 'recovery'): void {
    factorMode = mode;
    code = '';
    recoveryCode = '';
    auth.loginError = '';
  }

  function back(): void {
    code = '';
    recoveryCode = '';
    factorMode = 'totp';
    auth.cancelTwoFactor();
  }
</script>

<div id="login" class="login">
  <form class="panel" id="login-form" onsubmit={submit}>
    <div class="panel-title">{t('app.title')}</div>
    {#if auth.twoFactorRequired}
      <div>{t('auth.twoFactorPrompt')}</div>
      {#if factorMode === 'totp'}
        <label for="login-code">{t('auth.authenticatorCode')}</label>
        <input
          id="login-code"
          inputmode="numeric"
          autocomplete="one-time-code"
          required
          bind:value={code}
        />
        <button type="button" onclick={() => switchFactorMode('recovery')}>
          {t('auth.useRecoveryCode')}
        </button>
      {:else}
        <label for="login-recovery-code">{t('auth.recoveryCode')}</label>
        <input
          id="login-recovery-code"
          autocomplete="one-time-code"
          required
          bind:value={recoveryCode}
        />
        <button type="button" onclick={() => switchFactorMode('totp')}>
          {t('auth.useAuthenticatorCode')}
        </button>
      {/if}
      <button type="submit">{t('auth.verify')}</button>
      <button type="button" onclick={back}>{t('auth.back')}</button>
    {:else}
      <label for="login-username">{t('auth.username')}</label>
      <input id="login-username" autocomplete="username" required bind:value={username} />
      <label for="login-password">{t('auth.password')}</label>
      <input id="login-password" type="password" autocomplete="current-password" required bind:value={password} />
      <button type="submit">{t('auth.signIn')}</button>
    {/if}
    <div id="login-error">{auth.loginError || auth.sessionMessage}</div>
  </form>
</div>

<style>
  .two-factor-hint {
    font-size: 12px;
    color: var(--text-dim);
    margin: 4px 0 0;
  }
</style>
