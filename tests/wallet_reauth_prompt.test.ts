// The client arm of the R11 relink gate (src/ui/wallet_reauth_prompt.ts):
// these pins hold the DOM-free decision cores. The prompt only fires on a
// CHANGE to an existing link, the plan mirrors the account's real recovery
// shape (with a fail-open full form when the account read breaks), the one
// second-factor field splits TOTP from recovery codes exactly like login,
// and only a reauth-coded refusal replaces the flow's generic error text.
import { describe, expect, it } from 'vitest';
import {
  acquireWalletReauth,
  buildWalletReauthProof,
  needsWalletReauth,
  type WalletReauthPlan,
  walletChangeErrorText,
  walletReauthPlan,
} from '../src/ui/wallet_reauth_prompt';

describe('needsWalletReauth', () => {
  it('a first link (no current wallet) never prompts', () => {
    expect(needsWalletReauth(null, 'NewAddr')).toBe(false);
  });

  it('re-verifying the SAME wallet never prompts (no custody change)', () => {
    expect(needsWalletReauth('SameAddr', 'SameAddr')).toBe(false);
  });

  it('switching to a DIFFERENT wallet prompts', () => {
    expect(needsWalletReauth('OldAddr', 'NewAddr')).toBe(true);
  });
});

describe('walletReauthPlan', () => {
  it('password-only account gets the password form without the factor field', () => {
    expect(walletReauthPlan({ twoFactorEnabled: false, passwordSet: true })).toEqual({
      kind: 'password',
      showTwoFactor: false,
    });
  });

  it('an enrolled second factor adds the factor field', () => {
    expect(walletReauthPlan({ twoFactorEnabled: true, passwordSet: true })).toEqual({
      kind: 'password',
      showTwoFactor: true,
    });
  });

  it('a passwordless account is pointed at set-a-password', () => {
    expect(walletReauthPlan({ twoFactorEnabled: false, passwordSet: false })).toEqual({
      kind: 'no_password',
    });
  });

  it('a failed account read fails OPEN to the full form (the server re-checks)', () => {
    expect(walletReauthPlan(null)).toEqual({ kind: 'password', showTwoFactor: true });
  });
});

describe('buildWalletReauthProof', () => {
  it('password alone carries no factor fields', () => {
    expect(buildWalletReauthProof('hunter2', '')).toEqual({ password: 'hunter2' });
  });

  it('a 6-digit entry rides as the TOTP code', () => {
    expect(buildWalletReauthProof('hunter2', ' 123456 ')).toEqual({
      password: 'hunter2',
      totp: '123456',
    });
  });

  it('a non-digit entry rides as the recovery code', () => {
    const proof = buildWalletReauthProof('hunter2', 'abcd-efgh');
    expect(proof.password).toBe('hunter2');
    expect(proof.totp).toBeUndefined();
    expect(proof.recoveryCode).toBeTruthy();
  });
});

describe('acquireWalletReauth', () => {
  it('a rejected account read still prompts with the FULL form (fail open to the server)', async () => {
    const plans: WalletReauthPlan[] = [];
    const proof = { password: 'p' };
    const out = await acquireWalletReauth(
      () => Promise.reject(new Error('offline')),
      'unlink',
      {} as never,
      async (plan) => {
        plans.push(plan);
        return proof;
      },
    );
    expect(out).toBe(proof);
    expect(plans).toEqual([{ kind: 'password', showTwoFactor: true }]);
  });
});

describe('walletChangeErrorText', () => {
  it('a reauth-coded refusal renders its own message, not the fallback', () => {
    const text = walletChangeErrorText(
      { code: 'wallet.reauth_bad_password', status: 401, message: 'password verification failed' },
      'FALLBACK',
    );
    // The resolved catalog string, not the server's English prose passthrough.
    expect(text).toBe('Your password is incorrect.');
  });

  it('the lockout 429 renders its own message too (the shared identity)', () => {
    const text = walletChangeErrorText(
      { code: 'auth.too_many_failed_attempts', status: 429 },
      'FALLBACK',
    );
    expect(text).toBe('Too many failed attempts. Wait a few minutes and try again.');
  });

  it('a non-reauth error keeps the fallback', () => {
    expect(walletChangeErrorText(new Error('boom'), 'FALLBACK')).toBe('FALLBACK');
    expect(walletChangeErrorText({ code: 'woc_market.disabled' }, 'FALLBACK')).toBe('FALLBACK');
    expect(walletChangeErrorText(undefined, 'FALLBACK')).toBe('FALLBACK');
  });
});
