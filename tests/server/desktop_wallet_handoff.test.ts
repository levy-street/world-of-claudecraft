import { describe, expect, it } from 'vitest';
import {
  createDesktopWalletHandoffStore,
  DESKTOP_WALLET_HANDOFF_TTL_MS,
} from '../../server/desktop_wallet_handoff';

describe('desktop wallet handoff store', () => {
  it('keeps the secret out of the public id and binds status reads to the account', () => {
    let now = 1_000;
    const store = createDesktopWalletHandoffStore({
      now: () => now,
      randomBytes: (size) => new Uint8Array(size).fill(7),
    });
    const created = store.create(42, '203.0.113.4', { kind: 'link' });

    expect(created.code).toMatch(/^[A-Za-z0-9_-]{40,80}$/);
    expect(created.expiresInMs).toBe(DESKTOP_WALLET_HANDOFF_TTL_MS);
    expect(store.result(41, created.code)).toEqual({ status: 'missing' });
    expect(store.result(42, created.code)).toEqual({ status: 'pending' });
    now += 1;
  });

  it('issues one link challenge and keeps the completed result retryable until expiry', async () => {
    const store = createDesktopWalletHandoffStore();
    const created = store.create(7, '198.51.100.8', { kind: 'link' });
    const issueChallenge = async (accountId: number, address: string) => ({
      nonce: `nonce-${accountId}`,
      message: `Link ${address}`,
    });

    await expect(
      store.claimLink(created.code, '198.51.100.8', 'wallet-address', issueChallenge),
    ).resolves.toEqual({
      kind: 'link',
      address: 'wallet-address',
      nonce: 'nonce-7',
      message: 'Link wallet-address',
    });
    await expect(
      store.claimLink(created.code, '198.51.100.8', 'other-address', issueChallenge),
    ).rejects.toThrow('already claimed');

    store.complete(created.code, '198.51.100.8', {
      kind: 'link',
      address: 'wallet-address',
      nonce: 'nonce-7',
      signature: 'signed-message',
    });
    expect(store.result(7, created.code)).toEqual({
      status: 'complete',
      result: {
        kind: 'link',
        address: 'wallet-address',
        nonce: 'nonce-7',
        signature: 'signed-message',
      },
    });
    expect(store.result(7, created.code)).toEqual({
      status: 'complete',
      result: {
        kind: 'link',
        address: 'wallet-address',
        nonce: 'nonce-7',
        signature: 'signed-message',
      },
    });
  });

  it('serializes concurrent link claims and rejects a competing address', async () => {
    const store = createDesktopWalletHandoffStore();
    const created = store.create(7, '198.51.100.8', { kind: 'link' });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const issueChallenge = async (_accountId: number, address: string) => {
      calls += 1;
      await blocked;
      return { nonce: 'nonce', message: `Link ${address}` };
    };

    const first = store.claimLink(created.code, '198.51.100.8', 'wallet-address', issueChallenge);
    const sameAddress = store.claimLink(
      created.code,
      '198.51.100.8',
      'wallet-address',
      issueChallenge,
    );
    await expect(
      store.claimLink(created.code, '198.51.100.8', 'other-address', issueChallenge),
    ).rejects.toThrow('already claimed');
    release();

    await expect(Promise.all([first, sameAddress])).resolves.toEqual([
      {
        kind: 'link',
        address: 'wallet-address',
        nonce: 'nonce',
        message: 'Link wallet-address',
      },
      {
        kind: 'link',
        address: 'wallet-address',
        nonce: 'nonce',
        message: 'Link wallet-address',
      },
    ]);
    expect(calls).toBe(1);
  });

  it('binds transaction claims and completions to the expected wallet', () => {
    const store = createDesktopWalletHandoffStore();
    store.authorizeTransaction(9, {
      reference: 'CLM_authorized',
      transactionBase64: 'AQID',
      expectedAddress: 'expected-wallet',
      rail: 'sol',
      amountBase: '1234',
      destination: 'treasury-wallet',
      expiresAtMs: Date.now() + 60_000,
    });
    const created = store.createTransaction(9, '192.0.2.9', {
      reference: 'CLM_authorized',
      expectedAddress: 'expected-wallet',
    });

    expect(store.claim(created.code, '192.0.2.9')).toEqual({
      kind: 'transaction',
      reference: 'CLM_authorized',
      transactionBase64: 'AQID',
      expectedAddress: 'expected-wallet',
      rail: 'sol',
      amountBase: '1234',
      destination: 'treasury-wallet',
    });
    expect(() =>
      store.complete(created.code, '192.0.2.9', {
        kind: 'transaction',
        address: 'wrong-wallet',
        signature: 'chain-signature',
      }),
    ).toThrow('wallet does not match');
    store.complete(created.code, '192.0.2.9', {
      kind: 'transaction',
      address: 'expected-wallet',
      signature: 'chain-signature',
    });
    expect(store.result(9, created.code)).toEqual({
      status: 'complete',
      result: {
        kind: 'transaction',
        address: 'expected-wallet',
        signature: 'chain-signature',
      },
    });
  });

  it('rejects transaction handoffs without an unexpired server-authorized quote', () => {
    let now = 1_000;
    const store = createDesktopWalletHandoffStore({ now: () => now });

    expect(() =>
      store.createTransaction(9, '192.0.2.9', {
        reference: 'CLM_missing',
        expectedAddress: 'expected-wallet',
      }),
    ).toThrow('authorized Claudium quote');

    store.authorizeTransaction(9, {
      reference: 'CLM_expiring',
      transactionBase64: 'AQID',
      expectedAddress: 'expected-wallet',
      rail: 'usdc',
      amountBase: '4990000',
      destination: 'token-account',
      expiresAtMs: now + 100,
    });
    now += 101;

    expect(() =>
      store.createTransaction(9, '192.0.2.9', {
        reference: 'CLM_expiring',
        expectedAddress: 'expected-wallet',
      }),
    ).toThrow('authorized Claudium quote');
  });

  it('never lets a transaction handoff outlive its authorized quote', () => {
    let now = 1_000;
    const store = createDesktopWalletHandoffStore({ now: () => now });
    store.authorizeTransaction(9, {
      reference: 'CLM_short_quote',
      transactionBase64: 'AQID',
      expectedAddress: 'expected-wallet',
      rail: 'woc',
      amountBase: '500',
      destination: 'treasury-wallet',
      expiresAtMs: now + 100,
    });

    const created = store.createTransaction(9, '192.0.2.9', {
      reference: 'CLM_short_quote',
      expectedAddress: 'expected-wallet',
    });
    expect(created.expiresInMs).toBe(100);
    expect(store.claim(created.code, '192.0.2.9')).toMatchObject({
      kind: 'transaction',
      reference: 'CLM_short_quote',
    });

    now += 100;
    expect(() => store.claim(created.code, '192.0.2.9')).toThrow('invalid or expired');
    expect(() =>
      store.complete(created.code, '192.0.2.9', {
        kind: 'transaction',
        address: 'expected-wallet',
        signature: 'late-chain-signature',
      }),
    ).toThrow('invalid or expired');
    expect(store.result(9, created.code)).toEqual({ status: 'missing' });
  });

  it('expires operations and rejects browser requests from a different IP', () => {
    let now = 100;
    const store = createDesktopWalletHandoffStore({ now: () => now });
    const created = store.create(5, '203.0.113.10', { kind: 'link' });
    expect(() => store.claim(created.code, '203.0.113.11')).toThrow('invalid or expired');

    now += DESKTOP_WALLET_HANDOFF_TTL_MS + 1;
    expect(store.result(5, created.code)).toEqual({ status: 'missing' });
  });
});
