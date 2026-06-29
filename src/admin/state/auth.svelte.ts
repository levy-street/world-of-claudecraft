import { ApiError, apiLogin, clearSession, getAdminName, getToken } from '../api';
import { localizeAdminError, t } from '../i18n';

// Reactive auth state for the admin SPA. Auth is server-gated: this only mirrors the
// token/name held in localStorage (by api.ts) and decides which screen to show. It
// never grants access; every /admin/api call is re-checked server-side, and a 401/403
// kicks back to the login screen via handleAuthFailure(). Mirrors the old main.ts
// showLogin/showApp/handleAuthFailure flow.
class AuthState {
  token = $state<string | null>(getToken());
  name = $state<string>(getAdminName());
  // Distinct fields so a fresh login attempt error and a "session expired" notice do
  // not clobber each other; both render in #login-error.
  loginError = $state<string>('');
  sessionMessage = $state<string>('');

  get authed(): boolean {
    return this.token !== null;
  }

  async login(username: string, password: string): Promise<void> {
    this.loginError = '';
    this.sessionMessage = '';
    try {
      this.name = await apiLogin(username, password);
      this.token = getToken();
    } catch (err) {
      this.loginError =
        err instanceof ApiError ? localizeAdminError(err.message) : t('auth.loginFailed');
    }
  }

  logout(message = ''): void {
    clearSession();
    this.token = null;
    this.sessionMessage = message;
  }

  // True if the error was an auth failure (and the login screen is now shown). Callers
  // use the return to suppress a redundant in-panel error after a forced logout.
  handleAuthFailure(err: unknown): boolean {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      this.logout(t('auth.sessionExpired'));
      return true;
    }
    return false;
  }
}

export const auth = new AuthState();
