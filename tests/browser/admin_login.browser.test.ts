import { mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../src/admin/admin.css';

const h = vi.hoisted(() => ({
  apiLogin: vi.fn(),
}));

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
  clearSession: vi.fn(),
  getAdminName: () => '',
  getToken: () => null,
}));

import Login from '../../src/admin/components/Login.svelte';
import { t } from '../../src/admin/i18n';
import { auth } from '../../src/admin/state/auth.svelte';

let component: ReturnType<typeof mount> | null = null;

function input(id: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(id);
  if (!el) throw new Error(`missing input ${id}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function button(name: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!match) throw new Error(`missing button ${name}`);
  return match;
}

beforeEach(async () => {
  await page.viewport(667, 320);
  h.apiLogin.mockReset();
  auth.token = null;
  auth.loginError = '';
  auth.sessionMessage = '';
  auth.twoFactorRequired = false;
  document.body.replaceChildren();
  component = mount(Login, { target: document.body });
});

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  auth.twoFactorRequired = false;
  document.body.replaceChildren();
});

describe('admin login challenge in Chromium', () => {
  it('moves focus through the challenge modes and exposes live status', async () => {
    h.apiLogin.mockResolvedValueOnce({ twoFactorRequired: true });
    input('#login-username', 'alice');
    input('#login-password', 'pw');
    document.querySelector<HTMLFormElement>('#login-form')?.requestSubmit();

    await vi.waitFor(() =>
      expect(document.querySelector('#login-code')).toBe(document.activeElement),
    );
    expect(document.querySelector('#login-two-factor-prompt')).toHaveAttribute('role', 'status');
    expect(document.querySelector('#login-error')).toHaveAttribute('role', 'alert');

    button(t('auth.useRecoveryCode')).click();
    await vi.waitFor(() =>
      expect(document.querySelector('#login-recovery-code')).toBe(document.activeElement),
    );

    button(t('auth.useAuthenticatorCode')).click();
    await vi.waitFor(() =>
      expect(document.querySelector('#login-code')).toBe(document.activeElement),
    );

    button(t('auth.back')).click();
    await vi.waitFor(() =>
      expect(document.querySelector('#login-username')).toBe(document.activeElement),
    );
  });

  it('keeps every challenge control reachable in short landscape viewports', async () => {
    auth.twoFactorRequired = true;
    await tick();

    for (const height of [280, 240]) {
      await page.viewport(667, height);
      const overlay = document.querySelector<HTMLElement>('#login');
      const panel = document.querySelector<HTMLElement>('#login-form');
      if (!overlay || !panel) throw new Error('missing login challenge');

      overlay.scrollTop = 0;
      const initialPanel = panel.getBoundingClientRect();
      expect(initialPanel.top).toBeGreaterThanOrEqual(0);
      expect(getComputedStyle(overlay).overflowY).toBe('auto');
      expect(overlay.scrollHeight).toBeGreaterThan(overlay.clientHeight);

      overlay.scrollTop = overlay.scrollHeight;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const back = button(t('auth.back')).getBoundingClientRect();
      const error = document.querySelector<HTMLElement>('#login-error')?.getBoundingClientRect();
      expect(back.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
      expect(error?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(window.innerHeight + 1);
    }
  });
});
