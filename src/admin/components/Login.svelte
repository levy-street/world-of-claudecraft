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

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    const factor = auth.twoFactorRequired
      ? classifyAdminAuthCode(code)
      : { code: '', recoveryCode: '' };
    void auth.login(username.trim(), password, factor.code, factor.recoveryCode);
  }
</script>

<div id="login" class="login">
  <form class="panel" id="login-form" onsubmit={submit}>
    <div class="panel-title">{t('app.title')}</div>
    <label for="login-username">{t('auth.username')}</label>
    <input id="login-username" autocomplete="username" required bind:value={username} />
    <label for="login-password">{t('auth.password')}</label>
    <input id="login-password" type="password" autocomplete="current-password" required bind:value={password} />
    {#if auth.twoFactorRequired}
      <label for="login-2fa-code">{t('auth.twoFactorLabel')}</label>
      <input
        id="login-2fa-code"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="19"
        placeholder={t('auth.twoFactorPlaceholder')}
        bind:value={code}
      />
      <p class="two-factor-hint">{t('auth.twoFactorHint')}</p>
    {/if}
    <button type="submit">{t('auth.signIn')}</button>
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
