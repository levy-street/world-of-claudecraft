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
  apiGet: vi.fn(async () => ({ rows: [] })),
  clearSession: () => h.setToken(null),
  getAdminName: () => 'alice',
  getToken: () => h.getToken(),
}));

import App from '../../src/admin/App.svelte';
import { ApiError } from '../../src/admin/api';
import { t } from '../../src/admin/i18n';
import { auth } from '../../src/admin/state/auth.svelte';

beforeEach(() => {
  history.replaceState(null, '', '/admin?page=moderation');
  h.apiLogin.mockReset();
  h.setToken(null);
  auth.token = null;
  auth.name = '';
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
      return 'alice';
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
    render(App);
    expect(screen.getByText(t('auth.signOut'))).toBeInTheDocument();
    await fireEvent.click(screen.getByText(t('auth.signOut')));
    expect(await screen.findByText(t('auth.signIn'))).toBeInTheDocument();
  });

  it('keeps the URL and active page in sync across navigation and popstate', async () => {
    auth.token = 'tok';
    auth.name = 'alice';
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

  it('opens the mobile navigation and returns focus after Escape', async () => {
    auth.token = 'tok';
    auth.name = 'alice';
    render(App);

    const open = screen.getByRole('button', { name: t('nav.openMenu') });
    await fireEvent.click(open);
    expect(open).toHaveAccessibleName(t('nav.closeMenu'));
    expect(open).toHaveAttribute('aria-expanded', 'true');

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: t('nav.openMenu') })).toHaveFocus();
  });
});
