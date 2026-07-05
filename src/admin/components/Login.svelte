<script lang="ts">
  import { auth } from '../state/auth.svelte';
  import { t } from '../i18n';

  // Login screen (fixed overlay). Ids kept (#login, #login-username, #login-password,
  // #login-error) for style + mobile-zoom-check fidelity. Auth is server-gated; this
  // just submits credentials and shows the localized error/session-expiry notice.
  let username = $state('');
  let password = $state('');

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    void auth.login(username.trim(), password);
  }
</script>

<div id="login" class="login">
  <form class="panel" id="login-form" onsubmit={submit}>
    <div class="panel-title">{t('app.title')}</div>
    <label for="login-username">{t('auth.username')}</label>
    <input id="login-username" autocomplete="username" required bind:value={username} />
    <label for="login-password">{t('auth.password')}</label>
    <input id="login-password" type="password" autocomplete="current-password" required bind:value={password} />
    <button type="submit">{t('auth.signIn')}</button>
    <div id="login-error">{auth.loginError || auth.sessionMessage}</div>
  </form>
</div>
