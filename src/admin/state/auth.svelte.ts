import { ApiError, apiLogin, apiMe, clearSession, getAdminName, getToken } from '../api';
import { localizeAdminError, t } from '../i18n';
import type { AdminPermission } from '../permissions';
import { hasPermission } from '../permissions';

// Reactive auth state for the admin SPA. Auth is server-gated: this only mirrors the
// token/name held in localStorage (by api.ts) and decides which screen to show. It
// never grants access; every /admin/api call is re-checked server-side. Permissions
// mirror the operator's server-side roles for PRESENTATION only (sidebar filtering,
// hiding action buttons); they are hydrated from the login response or /me on boot
// and never persisted. A 401 kicks back to the login screen via handleAuthFailure();
// a 403 (missing permission) surfaces as an inline error and never logs out.
class AuthState {
  token = $state<string | null>(getToken());
  name = $state<string>(getAdminName());
  roles = $state<string[]>([]);
  permissions = $state<string[]>([]);
  // False until the boot /me round-trip resolves (or login provides the data);
  // the app holds off rendering permission-gated chrome until then.
  permissionsLoaded = $state<boolean>(false);
  // A transient /me failure (network, 5xx): the session is kept and the app
  // offers a retry instead of stranding a blank screen.
  hydrateFailed = $state<boolean>(false);
  // Distinct fields so a fresh login attempt error and a "session expired" notice do
  // not clobber each other; both render in #login-error.
  loginError = $state<string>('');
  sessionMessage = $state<string>('');

  get authed(): boolean {
    return this.token !== null;
  }

  can(permission: AdminPermission): boolean {
    return hasPermission(this.permissions, permission);
  }

  async login(username: string, password: string): Promise<void> {
    this.loginError = '';
    this.sessionMessage = '';
    try {
      const session = await apiLogin(username, password);
      this.name = session.username;
      this.roles = session.roles;
      this.permissions = session.permissions;
      this.permissionsLoaded = true;
      this.token = getToken();
    } catch (err) {
      this.loginError =
        err instanceof ApiError ? localizeAdminError(err.message) : t('auth.loginFailed');
    }
  }

  // Boot hydration for an already-stored token. Any failure other than an
  // explicit 401 leaves the session alone with hydrateFailed set (a transient
  // network error must not log the operator out; the app offers a retry).
  async hydrate(): Promise<void> {
    if (this.token === null || this.permissionsLoaded) return;
    this.hydrateFailed = false;
    try {
      const session = await apiMe();
      this.name = session.username;
      this.roles = session.roles;
      this.permissions = session.permissions;
      this.permissionsLoaded = true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.logout(t('auth.sessionExpired'));
      } else {
        this.hydrateFailed = true;
      }
    }
  }

  logout(message = ''): void {
    clearSession();
    this.token = null;
    this.roles = [];
    this.permissions = [];
    this.permissionsLoaded = false;
    this.hydrateFailed = false;
    this.sessionMessage = message;
  }

  // True if the error was an auth failure (and the login screen is now shown). Callers
  // use the return to suppress a redundant in-panel error after a forced logout.
  // 403 is NOT an auth failure: it means "authenticated but missing a permission",
  // so the caller surfaces it inline (localizeAdminError) instead of logging out.
  handleAuthFailure(err: unknown): boolean {
    if (err instanceof ApiError && err.status === 401) {
      this.logout(t('auth.sessionExpired'));
      return true;
    }
    return false;
  }
}

export const auth = new AuthState();
