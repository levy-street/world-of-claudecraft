import { describe, expect, it, vi } from 'vitest';
import { createSeekerOwnershipVerifier } from '../server/seeker_ownership_verifier';

describe('Seeker ownership verifier', () => {
  it('checks only the persisted mint using the executor deadline', async () => {
    const findToken = vi.fn(async () => ({ mint: 'sgt' }));
    const verifier = createSeekerOwnershipVerifier({
      claimForAccount: vi.fn(async () => ({ mint: 'sgt' })),
      walletForAccount: vi.fn(async () => ({ pubkey: 'wallet' })),
      findToken,
    });

    const signal = AbortSignal.timeout(1_000);
    await expect(verifier.verify(42, signal)).resolves.toBe(true);
    expect(findToken).toHaveBeenCalledWith('wallet', signal, 'sgt');
  });

  it('fails closed when the bounded RPC executor rejects', async () => {
    const findToken = vi.fn(async () => {
      throw new Error('RPC unavailable');
    });
    const verifier = createSeekerOwnershipVerifier({
      claimForAccount: vi.fn(async () => ({ mint: 'sgt' })),
      walletForAccount: vi.fn(async () => ({ pubkey: 'wallet' })),
      findToken,
    });

    await expect(verifier.verify(42, AbortSignal.timeout(1_000))).resolves.toBe(false);
    expect(findToken).toHaveBeenCalledTimes(1);
  });
});
