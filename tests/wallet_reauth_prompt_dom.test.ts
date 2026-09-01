// @vitest-environment happy-dom
//
// The R11 re-auth modal itself (src/ui/wallet_reauth_prompt.ts): the DOM-free
// decision cores are pinned in wallet_reauth_prompt.test.ts; this suite drives
// the modal the way a player does. HARNESS NOTE: never assert.equal on a
// happy-dom NODE (a failing node assertion walks the circular graph building
// its message and reads as a hang); assert on strings, counts, and booleans.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusManager } from '../src/ui/focus_manager';

vi.mock('../src/ui/i18n', () => ({
  t: (key: string) => {
    const strings: Record<string, string> = {
      'wallet.reauthTitle': 'Confirm wallet change',
      'wallet.reauthUnlinkTitle': 'Confirm wallet removal',
      'wallet.reauthHelp': 'Enter your password.',
      'wallet.reauthNoPassword': 'Set a password first.',
      'wallet.reauthConfirm': 'Confirm',
      'wallet.reauthCancel': 'Cancel',
      'wallet.reauthClose': 'Close',
      'auth.password': 'Password',
      'auth.passwordError': 'Please enter your password.',
      'auth.twoFactorLabel': 'Authentication code',
      'auth.twoFactorPlaceholder': '6-digit or recovery code',
    };
    return strings[key] ?? key;
  },
}));

function fakeFocus(): {
  focusManager: FocusManager;
  open: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const release = vi.fn();
  const open = vi.fn(() => ({ focusFirst: vi.fn(), release }));
  return { focusManager: { open } as unknown as FocusManager, open, release };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('the wallet re-auth modal', () => {
  it('collects password plus second factor and resolves the proof', async () => {
    const { focusManager, open, release } = fakeFocus();
    const { promptWalletReauth } = await import('../src/ui/wallet_reauth_prompt');
    const pending = promptWalletReauth(
      { kind: 'password', showTwoFactor: true },
      'relink',
      focusManager,
    );
    expect(document.querySelector('#wallet-reauth-title')?.textContent).toBe(
      'Confirm wallet change',
    );
    expect(open).toHaveBeenCalledOnce();
    const password = document.querySelector<HTMLInputElement>('#wallet-reauth-password');
    const factor = document.querySelector<HTMLInputElement>('#wallet-reauth-factor');
    expect(password === null).toBe(false);
    expect(factor === null).toBe(false);
    if (password) password.value = 'hunter2';
    if (factor) factor.value = '123456';
    document.querySelector<HTMLButtonElement>('.btn-primary')?.click();
    await expect(pending).resolves.toEqual({ password: 'hunter2', totp: '123456' });
    expect(release).toHaveBeenCalledWith(true);
    expect(document.querySelector('#wallet-reauth-modal')).toBeNull();
  });

  it('autofocuses the password input (the trap engages on open)', async () => {
    const { focusManager } = fakeFocus();
    const { promptWalletReauth } = await import('../src/ui/wallet_reauth_prompt');
    void promptWalletReauth({ kind: 'password', showTwoFactor: false }, 'relink', focusManager);
    await vi.waitFor(() => {
      expect(document.activeElement?.id).toBe('wallet-reauth-password');
    });
  });

  it('Enter in either field submits', async () => {
    const { focusManager } = fakeFocus();
    const { promptWalletReauth } = await import('../src/ui/wallet_reauth_prompt');
    const pending = promptWalletReauth(
      { kind: 'password', showTwoFactor: true },
      'relink',
      focusManager,
    );
    const password = document.querySelector<HTMLInputElement>('#wallet-reauth-password');
    if (password) password.value = 'hunter2';
    const factor = document.querySelector<HTMLInputElement>('#wallet-reauth-factor');
    if (factor) factor.value = 'abcd-efgh';
    factor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(pending).resolves.toEqual({ password: 'hunter2', recoveryCode: 'abcd-efgh' });
  });

  it('hides the factor field when no second factor is enrolled', async () => {
    const { focusManager } = fakeFocus();
    const { promptWalletReauth } = await import('../src/ui/wallet_reauth_prompt');
    const pending = promptWalletReauth(
      { kind: 'password', showTwoFactor: false },
      'relink',
      focusManager,
    );
    expect(document.querySelector('#wallet-reauth-factor')).toBeNull();
    document.querySelector<HTMLButtonElement>('.btn-secondary')?.click();
    await expect(pending).resolves.toBeNull();
  });

  it('an empty password shows the inline error and keeps the modal open', async () => {
    const { focusManager, release } = fakeFocus();
    const { promptWalletReauth } = await import('../src/ui/wallet_reauth_prompt');
    void promptWalletReauth({ kind: 'password', showTwoFactor: false }, 'relink', focusManager);
    document.querySelector<HTMLButtonElement>('.btn-primary')?.click();
    expect(document.querySelector('.auth-error')?.textContent).toBe('Please enter your password.');
    expect(document.querySelector('#wallet-reauth-modal') === null).toBe(false);
    expect(release).not.toHaveBeenCalled();
  });

  it('cancel, Escape, and a backdrop click each resolve null and release the trap', async () => {
    const { promptWalletReauth } = await import('../src/ui/wallet_reauth_prompt');

    const a = fakeFocus();
    const viaCancel = promptWalletReauth(
      { kind: 'password', showTwoFactor: false },
      'unlink',
      a.focusManager,
    );
    expect(document.querySelector('#wallet-reauth-title')?.textContent).toBe(
      'Confirm wallet removal',
    );
    document.querySelector<HTMLButtonElement>('.btn-secondary')?.click();
    await expect(viaCancel).resolves.toBeNull();
    expect(a.release).toHaveBeenCalledWith(true);

    const b = fakeFocus();
    const viaEscape = promptWalletReauth(
      { kind: 'password', showTwoFactor: false },
      'unlink',
      b.focusManager,
    );
    const back = document.querySelector<HTMLElement>('#wallet-reauth-modal');
    back?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(viaEscape).resolves.toBeNull();
    expect(b.release).toHaveBeenCalledWith(true);

    const c = fakeFocus();
    const viaBackdrop = promptWalletReauth(
      { kind: 'password', showTwoFactor: false },
      'unlink',
      c.focusManager,
    );
    document.querySelector<HTMLElement>('#wallet-reauth-modal')?.click();
    await expect(viaBackdrop).resolves.toBeNull();
    expect(c.release).toHaveBeenCalledWith(true);
  });

  it('the no-password plan offers only acknowledgement and focuses the dialog', async () => {
    const { focusManager, open } = fakeFocus();
    const { promptWalletReauth } = await import('../src/ui/wallet_reauth_prompt');
    const pending = promptWalletReauth({ kind: 'no_password' }, 'unlink', focusManager);
    expect(document.querySelector('#wallet-reauth-password')).toBeNull();
    expect(document.querySelectorAll('.confirm-actions button').length).toBe(1);
    expect(open).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Close');
    });
    document.querySelector<HTMLButtonElement>('.btn-primary')?.click();
    await expect(pending).resolves.toBeNull();
  });
});
