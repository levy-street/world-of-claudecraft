// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stateful mock of the network/token layer so auth state transitions are exercised
// without a server. h.token backs getToken(); a successful apiLogin sets it.
const h = vi.hoisted(() => {
  let token: string | null = null;
  return {
    apiLogin: vi.fn(),
    setToken: (v: string | null) => {
      token = v;
    },
    getToken: () => token,
  };
});

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiLogin: h.apiLogin,
  apiMe: vi.fn(async () => ({ username: 'alice', roles: [], permissions: [] })),
  apiGet: vi.fn(async () => ({ rows: [] })),
  clearSession: () => h.setToken(null),
  getAdminName: () => 'alice',
  getToken: () => h.getToken(),
}));

import App from '../../src/admin/App.svelte';
import { ApiError, apiMe } from '../../src/admin/api';
import { t } from '../../src/admin/i18n';
import { auth } from '../../src/admin/state/auth.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  history.replaceState(null, '', '/admin?page=moderation');
  h.apiLogin.mockReset();
  h.setToken(null);
  auth.token = null;
  auth.name = '';
  auth.roles = [];
  auth.permissions = [];
  auth.permissionsLoaded = false;
  auth.hydrateFailed = false;
  auth.loginError = '';
  auth.sessionMessage = '';
});

describe('admin auth flow', () => {
  function loginForm(): HTMLFormElement {
    const form = screen.getByText(t('auth.signIn')).closest('form');
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('login form not found');
    }
    return form;
  }

  it('shows the login screen when not authed', () => {
    render(App);
    expect(screen.getByText(t('auth.signIn'))).toBeInTheDocument();
    expect(screen.queryByText(t('auth.signOut'))).not.toBeInTheDocument();
  });

  it('logs in and reveals the dashboard chrome', async () => {
    h.apiLogin.mockImplementation(async () => {
      h.setToken('tok');
      return {
        username: 'alice',
        roles: ['superadmin'],
        permissions: ['analytics.read', 'accounts.read', 'moderation.read', 'moderation.act'],
      };
    });
    render(App);
    await fireEvent.input(screen.getByLabelText(t('auth.username')), {
      target: { value: 'alice' },
    });
    await fireEvent.input(screen.getByLabelText(t('auth.password')), { target: { value: 'pw' } });
    await fireEvent.submit(loginForm());

    expect(await screen.findByText(t('auth.signOut'))).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: t('nav.reports') })).toBeInTheDocument();
    expect(h.apiLogin).toHaveBeenCalledWith('alice', 'pw');
  });

  it('shows a localized error and stays on login when credentials fail', async () => {
    h.apiLogin.mockRejectedValue(new ApiError(401, 'invalid credentials'));
    render(App);
    await fireEvent.input(screen.getByLabelText(t('auth.username')), { target: { value: 'bob' } });
    await fireEvent.input(screen.getByLabelText(t('auth.password')), { target: { value: 'nope' } });
    await fireEvent.submit(loginForm());

    await vi.waitFor(() => expect(auth.loginError).not.toBe(''));
    expect(screen.queryByText(t('auth.signOut'))).not.toBeInTheDocument();
  });

  it('logout returns to the login screen with a session message', async () => {
    auth.token = 'tok';
    auth.name = 'alice';
    grantPermissions();
    render(App);
    expect(screen.getByText(t('auth.signOut'))).toBeInTheDocument();
    await fireEvent.click(screen.getByText(t('auth.signOut')));
    expect(await screen.findByText(t('auth.signIn'))).toBeInTheDocument();
  });

  it('keeps the URL and active page in sync across navigation and popstate', async () => {
    auth.token = 'tok';
    auth.name = 'alice';
    grantPermissions();
    render(App);

    const blockedIps = screen.getByRole('link', { name: t('nav.blockedIps') });
    await fireEvent.click(blockedIps);
    expect(location.search).toContain('page=blocked-ips');
    expect(blockedIps).toHaveAttribute('aria-current', 'page');

    history.replaceState(null, '', '/admin?page=moderation');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() =>
      expect(screen.getByRole('link', { name: t('nav.reports') })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });

  it('keeps the session on a 403 (missing permission) and logs out on a 401', () => {
    auth.token = 'tok';
    grantPermissions();

    expect(auth.handleAuthFailure(new ApiError(403, 'you do not have permission to do this'))).toBe(
      false,
    );
    expect(auth.token).toBe('tok');

    expect(auth.handleAuthFailure(new ApiError(401, 'admin authentication required'))).toBe(true);
    expect(auth.token).toBeNull();
  });

  it('opens the mobile navigation and returns focus after Escape', async () => {
    auth.token = 'tok';
    auth.name = 'alice';
    grantPermissions();
    render(App);

    const open = screen.getByRole('button', { name: t('nav.openMenu') });
    await fireEvent.click(open);
    expect(open).toHaveAccessibleName(t('nav.closeMenu'));
    expect(open).toHaveAttribute('aria-expanded', 'true');

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: t('nav.openMenu') })).toHaveFocus();
  });

  it('hydrates roles and permissions from /me on boot', async () => {
    h.setToken('tok');
    auth.token = 'tok';
    vi.mocked(apiMe).mockResolvedValueOnce({
      username: 'alice',
      roles: ['viewer'],
      permissions: ['analytics.read', 'support.read', 'accounts.read'],
    });

    await auth.hydrate();

    expect(auth.permissionsLoaded).toBe(true);
    expect(auth.roles).toEqual(['viewer']);
    expect(auth.can('analytics.read')).toBe(true);
    expect(auth.can('moderation.act')).toBe(false);
  });

  it('logs out when /me returns 401, keeps the session on a transient failure', async () => {
    h.setToken('tok');
    auth.token = 'tok';
    vi.mocked(apiMe).mockRejectedValueOnce(new Error('network down'));
    await auth.hydrate();
    expect(auth.token).toBe('tok');
    expect(auth.hydrateFailed).toBe(true);

    vi.mocked(apiMe).mockRejectedValueOnce(new ApiError(401, 'admin authentication required'));
    await auth.hydrate();
    expect(auth.token).toBeNull();
  });

  it('renders a retry state instead of a blank screen when /me fails', async () => {
    h.setToken('tok');
    auth.token = 'tok';
    vi.mocked(apiMe).mockRejectedValue(new Error('network down'));
    render(App);

    expect(await screen.findByText(t('auth.sessionLoadFailed'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('auth.retry') })).toBeInTheDocument();
  });

  it('renders the first permitted page when the URL points at a forbidden one', async () => {
    history.replaceState(null, '', '/admin?page=moderation');
    auth.token = 'tok';
    auth.name = 'alice';
    grantPermissions(['support.read']);
    render(App);

    expect(
      await screen.findByRole('heading', { level: 1, name: t('nav.bugReports') }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: t('nav.reports') }),
    ).not.toBeInTheDocument();
  });
});
