import { describe, expect, it } from 'vitest';
import {
  createDesktopWalletHandoffStore,
  DESKTOP_WALLET_HANDOFF_TTL_MS,
  DESKTOP_WALLET_TRANSACTION_RECORD_GRACE_MS,
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
    ).toThrow('authorized quote');

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
    ).toThrow('authorized quote');
  });

  it('caps a transaction handoff at its quote expiry plus the recording grace', () => {
    // The grace exists for the record-a-late-signature stance: the browser
    // wallet BROADCASTS at approval, so a signature landing at the quote
    // boundary must still be completable and readable, exactly as the game's
    // confirm intake deliberately records a signature for an expired quote.
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
    expect(created.expiresInMs).toBe(100 + DESKTOP_WALLET_TRANSACTION_RECORD_GRACE_MS);
    expect(store.claim(created.code, '192.0.2.9')).toMatchObject({
      kind: 'transaction',
      reference: 'CLM_short_quote',
    });

    // Just past the QUOTE expiry, inside the grace: a signature the wallet
    // broadcast at the boundary still lands and is still readable.
    now += 101;
    store.complete(created.code, '192.0.2.9', {
      kind: 'transaction',
      address: 'expected-wallet',
      signature: 'boundary-chain-signature',
    });
    expect(store.result(9, created.code)).toMatchObject({ status: 'complete' });

    // Past the grace the entry is gone entirely.
    now += DESKTOP_WALLET_TRANSACTION_RECORD_GRACE_MS;
    expect(() => store.claim(created.code, '192.0.2.9')).toThrow('invalid or expired');
    expect(store.result(9, created.code)).toEqual({ status: 'missing' });
    // And a NEW handoff cannot be minted for the expired authorization.
    expect(() =>
      store.createTransaction(9, '192.0.2.9', {
        reference: 'CLM_short_quote',
        expectedAddress: 'expected-wallet',
      }),
    ).toThrow('not backed by an authorized quote');
  });

  it('a completed step-up frees its authorization slot (single-use downstream)', () => {
    const store = createDesktopWalletHandoffStore();
    const nonce = 'e'.repeat(32);
    store.authorizeStepUp(9, {
      nonce,
      message: 'challenge text',
      expectedAddress: 'expected-wallet',
      expiresAtMs: Date.now() + 60_000,
    });
    const created = store.createStepUp(9, '192.0.2.9', {
      nonce,
      expectedAddress: 'expected-wallet',
    });
    store.complete(created.code, '192.0.2.9', {
      kind: 'stepup',
      address: 'expected-wallet',
      signature: 'msg-signature',
    });
    // The stored result stays readable, but no SECOND handoff can be minted
    // for the consumed challenge.
    expect(store.result(9, created.code)).toMatchObject({ status: 'complete' });
    expect(() =>
      store.createStepUp(9, '192.0.2.9', { nonce, expectedAddress: 'expected-wallet' }),
    ).toThrow('not backed by an issued Exchange challenge');
  });

  it('bounds each account to its authorization budget, evicting its own oldest', () => {
    const evictions: string[] = [];
    const store = createDesktopWalletHandoffStore({
      onMetric: (event) => {
        evictions.push(event);
      },
    });
    const expiresAtMs = Date.now() + 60_000;
    for (let index = 0; index < 9; index++) {
      store.authorizeStepUp(9, {
        nonce: String(index).repeat(32),
        message: 'challenge text',
        expectedAddress: 'expected-wallet',
        expiresAtMs,
      });
    }
    // The 9th insert evicted the account's OLDEST (nonce 0...), and only that
    // one; the newest 8 all still mint.
    expect(evictions).toEqual(['authorization_evicted']);
    expect(() =>
      store.createStepUp(9, '192.0.2.9', {
        nonce: '0'.repeat(32),
        expectedAddress: 'expected-wallet',
      }),
    ).toThrow('not backed by an issued Exchange challenge');
    for (let index = 1; index < 9; index++) {
      store.createStepUp(9, '192.0.2.9', {
        nonce: String(index).repeat(32),
        expectedAddress: 'expected-wallet',
      });
    }
    // A DIFFERENT account is untouched by the first account's budget.
    store.authorizeStepUp(8, {
      nonce: 'a'.repeat(32),
      message: 'challenge text',
      expectedAddress: 'other-wallet',
      expiresAtMs,
    });
    store.createStepUp(8, '192.0.2.9', {
      nonce: 'a'.repeat(32),
      expectedAddress: 'other-wallet',
    });
    // A same-key re-registration REPLACES in place, no eviction.
    store.authorizeStepUp(8, {
      nonce: 'a'.repeat(32),
      message: 'newer challenge text',
      expectedAddress: 'other-wallet',
      expiresAtMs,
    });
    expect(evictions).toEqual(['authorization_evicted']);
  });

  it('expires operations and rejects browser requests from a different IP', () => {
    let now = 100;
    const store = createDesktopWalletHandoffStore({ now: () => now });
    const created = store.create(5, '203.0.113.10', { kind: 'link' });
    expect(() => store.claim(created.code, '203.0.113.11')).toThrow('invalid or expired');

    now += DESKTOP_WALLET_HANDOFF_TTL_MS + 1;
    expect(store.result(5, created.code)).toEqual({ status: 'missing' });
  });

  it('binds step-up claims and completions to the expected wallet', () => {
    const store = createDesktopWalletHandoffStore();
    const nonce = 'a'.repeat(32);
    store.authorizeStepUp(9, {
      nonce,
      message: 'World of ClaudeCraft $WOC Exchange: authorize moving an item into escrow.',
      expectedAddress: 'expected-wallet',
      expiresAtMs: Date.now() + 60_000,
    });
    const created = store.createStepUp(9, '192.0.2.9', {
      nonce,
      expectedAddress: 'expected-wallet',
    });

    // The claim serves the SERVER-stored message (never renderer text).
    expect(store.claim(created.code, '192.0.2.9')).toEqual({
      kind: 'stepup',
      nonce,
      message: 'World of ClaudeCraft $WOC Exchange: authorize moving an item into escrow.',
      expectedAddress: 'expected-wallet',
    });
    expect(() =>
      store.complete(created.code, '192.0.2.9', {
        kind: 'stepup',
        address: 'wrong-wallet',
        signature: 'msg-signature',
      }),
    ).toThrow('wallet does not match');
    // A completion of the wrong KIND is refused before any address check.
    expect(() =>
      store.complete(created.code, '192.0.2.9', {
        kind: 'transaction',
        address: 'expected-wallet',
        signature: 'msg-signature',
      }),
    ).toThrow('action mismatch');
    store.complete(created.code, '192.0.2.9', {
      kind: 'stepup',
      address: 'expected-wallet',
      signature: 'msg-signature',
    });
    expect(store.result(9, created.code)).toEqual({
      status: 'complete',
      result: { kind: 'stepup', address: 'expected-wallet', signature: 'msg-signature' },
    });
  });

  it('rejects step-up handoffs without an issued, matching, unexpired challenge', () => {
    let now = 1_000;
    const store = createDesktopWalletHandoffStore({ now: () => now });
    const nonce = 'b'.repeat(32);

    // Never registered.
    expect(() =>
      store.createStepUp(9, '192.0.2.9', { nonce, expectedAddress: 'expected-wallet' }),
    ).toThrow('not backed by an issued Exchange challenge');

    store.authorizeStepUp(9, {
      nonce,
      message: 'challenge text',
      expectedAddress: 'expected-wallet',
      expiresAtMs: now + 5_000,
    });
    // Another account cannot mint against this nonce (the key is per-account).
    expect(() =>
      store.createStepUp(8, '192.0.2.9', { nonce, expectedAddress: 'expected-wallet' }),
    ).toThrow('not backed by an issued Exchange challenge');
    // A different wallet than the registered one is refused.
    expect(() =>
      store.createStepUp(9, '192.0.2.9', { nonce, expectedAddress: 'other-wallet' }),
    ).toThrow('not backed by an issued Exchange challenge');
    // Expiry closes it.
    now += 5_001;
    expect(() =>
      store.createStepUp(9, '192.0.2.9', { nonce, expectedAddress: 'expected-wallet' }),
    ).toThrow('not backed by an issued Exchange challenge');
  });

  it('never lets a step-up handoff outlive its challenge, and screens registrations', () => {
    let now = 1_000;
    const store = createDesktopWalletHandoffStore({ now: () => now });
    const nonce = 'c'.repeat(32);
    store.authorizeStepUp(9, {
      nonce,
      message: 'challenge text',
      expectedAddress: 'expected-wallet',
      expiresAtMs: now + 100,
    });
    const created = store.createStepUp(9, '192.0.2.9', {
      nonce,
      expectedAddress: 'expected-wallet',
    });
    expect(created.expiresInMs).toBe(100);
    now += 101;
    expect(() => store.claim(created.code, '192.0.2.9')).toThrow('invalid or expired');
    expect(store.result(9, created.code)).toEqual({ status: 'missing' });

    // Registration screens: a malformed nonce, an empty message, and a stale
    // expiry are each refused at authorize time.
    expect(() =>
      store.authorizeStepUp(9, {
        nonce: 'not-a-nonce',
        message: 'x',
        expectedAddress: 'w',
        expiresAtMs: now + 100,
      }),
    ).toThrow('invalid step-up authorization');
    expect(() =>
      store.authorizeStepUp(9, {
        nonce: 'd'.repeat(32),
        message: '',
        expectedAddress: 'w',
        expiresAtMs: now + 100,
      }),
    ).toThrow('invalid step-up authorization');
    expect(() =>
      store.authorizeStepUp(9, {
        nonce: 'd'.repeat(32),
        message: 'x',
        expectedAddress: 'w',
        expiresAtMs: now,
      }),
    ).toThrow('invalid step-up authorization');
    // The remaining screens, one negative per dimension: an over-long
    // message, an empty expected address, and a non-finite expiry.
    expect(() =>
      store.authorizeStepUp(9, {
        nonce: 'd'.repeat(32),
        message: 'y'.repeat(2_049),
        expectedAddress: 'w',
        expiresAtMs: now + 100,
      }),
    ).toThrow('invalid step-up authorization');
    expect(() =>
      store.authorizeStepUp(9, {
        nonce: 'd'.repeat(32),
        message: 'x',
        expectedAddress: '',
        expiresAtMs: now + 100,
      }),
    ).toThrow('invalid step-up authorization');
    expect(() =>
      store.authorizeStepUp(9, {
        nonce: 'd'.repeat(32),
        message: 'x',
        expectedAddress: 'w',
        expiresAtMs: Number.NaN,
      }),
    ).toThrow('invalid step-up authorization');
  });

  it('at the global cap the oldest LIVE authorization is evicted, expired ones first', () => {
    let now = 1_000;
    const evictions: string[] = [];
    const store = createDesktopWalletHandoffStore({
      now: () => now,
      onMetric: (event) => {
        evictions.push(event);
      },
    });
    // Fill the map to its 2000 cap across 250 accounts (8 per account, the
    // per-account budget, so no per-account eviction fires while filling).
    for (let account = 0; account < 250; account++) {
      for (let slot = 0; slot < 8; slot++) {
        store.authorizeStepUp(account, {
          nonce: `${account.toString(16).padStart(4, '0')}${slot}`.padEnd(32, 'f'),
          message: 'challenge text',
          expectedAddress: `wallet-${account}`,
          expiresAtMs: now + 60_000,
        });
      }
    }
    expect(evictions).toEqual([]);
    // A NEW account at the cap evicts the globally oldest entry instead of
    // refusing (a refusal would hard-fail the co-tenant's quote path).
    store.authorizeStepUp(9_999, {
      nonce: 'a'.repeat(32),
      message: 'challenge text',
      expectedAddress: 'wallet-new',
      expiresAtMs: now + 60_000,
    });
    expect(evictions).toEqual(['authorization_evicted']);
    store.createStepUp(9_999, '192.0.2.9', {
      nonce: 'a'.repeat(32),
      expectedAddress: 'wallet-new',
    });
    // Expired registrations stop counting toward the cap: advance past the
    // TTL and a fresh insert prunes them instead of evicting anything live.
    now += 60_001;
    store.authorizeStepUp(1, {
      nonce: 'b'.repeat(32),
      message: 'challenge text',
      expectedAddress: 'wallet-1',
      expiresAtMs: now + 60_000,
    });
    expect(evictions).toEqual(['authorization_evicted']);
  });
});
