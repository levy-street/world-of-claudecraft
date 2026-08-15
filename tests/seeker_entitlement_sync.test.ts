import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createSeekerEntitlementSync,
  seekerEntitlementFailureIsTransient,
} from '../src/net/seeker_entitlement_sync';

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const eligibleInput = {
  accountKey: 'player',
  walletPubkey: 'wallet',
  eligible: true,
};

describe('Seeker entitlement sync', () => {
  it('runs after a linked wallet status is restored and only for an enabled native Seeker', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toContain('if (statusKnown) {');
    expect(main).toContain('await seekerEntitlementSync.sync({');
    expect(main).toContain("accountKey: api.username ?? ''");
    expect(main).toContain('walletPubkey: pubkey');
    expect(main).toContain('eligible: NATIVE_APP && WALLET_ENABLED');
  });

  it('does nothing without an eligible Solana Store Seeker account and wallet', async () => {
    const entitlement = vi.fn(async () => false);
    const sync = createSeekerEntitlementSync({
      entitlement,
      createClaimProof: vi.fn(async () => ({})),
      claim: vi.fn(async () => true),
    });

    await expect(sync.sync({ ...eligibleInput, eligible: false })).resolves.toBe('not_applicable');
    await expect(sync.sync({ ...eligibleInput, walletPubkey: null })).resolves.toBe(
      'not_applicable',
    );
    await expect(sync.sync({ ...eligibleInput, accountKey: '' })).resolves.toBe('not_applicable');
    expect(entitlement).not.toHaveBeenCalled();
  });

  it('stops when entitlement already exists and otherwise claims with a fresh proof', async () => {
    const createClaimProof = vi.fn(async () => ({ challengeId: 'challenge' }));
    const claim = vi.fn(async () => true);
    const existing = createSeekerEntitlementSync({
      entitlement: vi.fn(async () => true),
      createClaimProof,
      claim,
    });
    await expect(existing.sync(eligibleInput)).resolves.toBe('already_entitled');
    expect(createClaimProof).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();

    const missing = createSeekerEntitlementSync({
      entitlement: vi.fn(async () => false),
      createClaimProof,
      claim,
    });
    await expect(missing.sync(eligibleInput)).resolves.toBe('claimed');
    expect(claim).toHaveBeenCalledWith({ challengeId: 'challenge' });
  });

  it('shares one in-flight status and claim sequence for the same account and wallet', async () => {
    const status = deferred<boolean>();
    const entitlement = vi.fn(() => status.promise);
    const createClaimProof = vi.fn(async () => ({ challengeId: 'challenge' }));
    const claim = vi.fn(async () => true);
    const sync = createSeekerEntitlementSync({ entitlement, createClaimProof, claim });

    const first = sync.sync(eligibleInput);
    const second = sync.sync(eligibleInput);
    expect(first).toBe(second);
    expect(entitlement).toHaveBeenCalledTimes(1);
    status.resolve(false);
    await expect(first).resolves.toBe('claimed');
    await expect(second).resolves.toBe('claimed');
    expect(createClaimProof).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and missing proofs on a later refresh', async () => {
    const entitlement = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(false);
    const createClaimProof = vi
      .fn<() => Promise<unknown | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ challengeId: 'challenge' });
    const sync = createSeekerEntitlementSync({
      entitlement,
      createClaimProof,
      claim: vi.fn(async () => true),
    });

    await expect(sync.sync(eligibleInput)).resolves.toBe('transient_failure');
    await expect(sync.sync(eligibleInput)).resolves.toBe('transient_failure');
    await expect(sync.sync(eligibleInput)).resolves.toBe('claimed');
    expect(entitlement).toHaveBeenCalledTimes(3);
  });

  it('suppresses repeated permanent rejection until the session cache is reset', async () => {
    const rejection = {
      status: 403,
      code: 'seeker.solana_artifact_required',
    };
    const entitlement = vi.fn(async () => false);
    const claim = vi.fn(async () => {
      throw rejection;
    });
    const onPermanentFailure = vi.fn();
    const sync = createSeekerEntitlementSync({
      entitlement,
      createClaimProof: vi.fn(async () => ({ challengeId: 'challenge' })),
      claim,
      onPermanentFailure,
    });

    await expect(sync.sync(eligibleInput)).resolves.toBe('permanent_failure');
    await expect(sync.sync(eligibleInput)).resolves.toBe('permanent_failure');
    expect(claim).toHaveBeenCalledTimes(1);
    expect(onPermanentFailure).toHaveBeenCalledWith(rejection);

    sync.reset();
    await expect(sync.sync(eligibleInput)).resolves.toBe('permanent_failure');
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('classifies retryable transport and HTTP failures without retrying ordinary 4xx', () => {
    expect(seekerEntitlementFailureIsTransient(new TypeError('network failed'))).toBe(true);
    expect(seekerEntitlementFailureIsTransient({ status: 429 })).toBe(true);
    expect(seekerEntitlementFailureIsTransient({ status: 503 })).toBe(true);
    expect(seekerEntitlementFailureIsTransient({ status: 403 })).toBe(false);
    expect(seekerEntitlementFailureIsTransient({ status: 409 })).toBe(false);
  });
});
