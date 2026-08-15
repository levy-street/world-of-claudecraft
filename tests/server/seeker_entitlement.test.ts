import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRes, makeReq } from './helpers';

vi.mock('../../server/db', () => ({
  accountAndScopeForToken: vi.fn(),
  moderationStatusForAccount: vi.fn(),
  walletForAccount: vi.fn(),
  pool: {},
}));

import {
  handleSeekerEntitlementClaim,
  handleSeekerEntitlementStatus,
  resetSeekerEntitlementRuntimeForTests,
  setSeekerEntitlementRuntimeForTests,
  verifyCurrentSeekerEntitlement,
} from '../../server/seeker_entitlement';

const nativeHeaders = {
  origin: 'http://localhost',
  'content-type': 'application/json',
};

afterEach(() => resetSeekerEntitlementRuntimeForTests());

describe('Seeker entitlement claim', () => {
  it('verifies native attestation, linked wallet, SGT ownership, and permanent claim', async () => {
    const claim = vi.fn().mockResolvedValue({ status: 'claimed', mint: 'unique-mint' });
    const verifyArtifact = vi.fn().mockResolvedValue({ nonce: 'nonce' });
    const findTokens = vi.fn().mockResolvedValue([
      { mint: 'unique-mint', slot: 123 },
      { mint: 'unique-mint-2', slot: 124 },
    ]);
    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: verifyArtifact,
      walletForAccount: vi.fn().mockResolvedValue({
        pubkey: 'wallet',
        linked_at: '2026-01-01T00:00:00Z',
      }),
      seekerEntitlementForAccount: vi.fn().mockResolvedValue(null),
      findSeekerGenesisTokens: findTokens,
      claimAvailableSeekerEntitlement: claim,
    });
    const req = makeReq({
      method: 'POST',
      url: '/api/seeker/entitlement',
      headers: nativeHeaders,
      body: { nativeAttestation: { challengeId: 'id', token: 'token' } },
    });
    const res = new FakeRes();

    await handleSeekerEntitlementClaim(req, res as unknown as http.ServerResponse, 42);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ entitled: true, mint: 'unique-mint' });
    expect(verifyArtifact).toHaveBeenCalledWith(
      req,
      { challengeId: 'id', token: 'token' },
      'seeker-claim',
    );
    expect(claim).toHaveBeenCalledWith({
      candidates: [
        { mint: 'unique-mint', verificationSlot: 123 },
        { mint: 'unique-mint-2', verificationSlot: 124 },
      ],
      accountId: 42,
      claimantWallet: 'wallet',
      proofVersion: 'sgt-v1',
    });
    expect(findTokens).toHaveBeenCalledWith(
      'wallet',
      undefined,
      expect.any(AbortSignal),
      undefined,
    );
  });

  it('returns the fixed mint in status responses without exposing the claimant wallet', async () => {
    setSeekerEntitlementRuntimeForTests({
      seekerEntitlementForAccount: vi
        .fn()
        .mockResolvedValue({ mint: 'fixed-mint', claimantWallet: 'wallet' }),
    });
    const entitled = new FakeRes();
    await handleSeekerEntitlementStatus(entitled as unknown as http.ServerResponse, 42);
    expect(JSON.parse(entitled.body)).toEqual({ entitled: true, mint: 'fixed-mint' });

    setSeekerEntitlementRuntimeForTests({
      seekerEntitlementForAccount: vi.fn().mockResolvedValue(null),
    });
    const missing = new FakeRes();
    await handleSeekerEntitlementStatus(missing as unknown as http.ServerResponse, 42);
    expect(JSON.parse(missing.body)).toEqual({ entitled: false, mint: null });
  });

  it('reuses an existing fixed mint after verifying only that mint', async () => {
    const claim = vi.fn();
    const findTokens = vi.fn().mockResolvedValue([{ mint: 'fixed-mint', slot: 456 }]);
    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount: vi.fn().mockResolvedValue({
        pubkey: 'wallet',
        linked_at: '2026-01-01T00:00:00Z',
      }),
      seekerEntitlementForAccount: vi
        .fn()
        .mockResolvedValue({ mint: 'fixed-mint', claimantWallet: 'prior-wallet' }),
      findSeekerGenesisTokens: findTokens,
      claimAvailableSeekerEntitlement: claim,
    });
    const req = makeReq({
      method: 'POST',
      url: '/api/seeker/entitlement',
      headers: nativeHeaders,
      body: { nativeAttestation: {} },
    });
    const res = new FakeRes();

    await handleSeekerEntitlementClaim(req, res as unknown as http.ServerResponse, 42);

    expect(JSON.parse(res.body)).toEqual({ entitled: true, mint: 'fixed-mint' });
    expect(findTokens).toHaveBeenCalledWith(
      'wallet',
      undefined,
      expect.any(AbortSignal),
      'fixed-mint',
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it('rejects a claim when the linked wallet changes during SGT verification', async () => {
    let finishVerification!: (tokens: { mint: string; slot: number }[]) => void;
    const claim = vi.fn().mockResolvedValue({ status: 'claimed', mint: 'wallet-a-mint' });
    const walletForAccount = vi
      .fn()
      .mockResolvedValueOnce({
        pubkey: 'wallet-a',
        linked_at: '2026-01-01T00:00:00Z',
      })
      .mockResolvedValue({
        pubkey: 'wallet-b',
        linked_at: '2026-01-01T00:01:00Z',
      });
    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount,
      seekerEntitlementForAccount: vi.fn().mockResolvedValue(null),
      findSeekerGenesisTokens: vi.fn(
        () =>
          new Promise<{ mint: string; slot: number }[]>((resolve) => {
            finishVerification = resolve;
          }),
      ),
      claimAvailableSeekerEntitlement: claim,
    });
    const res = new FakeRes();
    const pending = handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      res as unknown as http.ServerResponse,
      42,
    );

    await vi.waitFor(() => expect(finishVerification).toBeTypeOf('function'));
    finishVerification([{ mint: 'wallet-a-mint', slot: 123 }]);
    await pending;

    expect(walletForAccount).toHaveBeenCalledTimes(2);
    expect(claim).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'link and verify a wallet first',
      code: 'seeker.wallet_required',
    });
  });

  it('does not coalesce claim verification across different linked wallets', async () => {
    let finishWalletA!: (tokens: { mint: string; slot: number }[]) => void;
    const walletForAccount = vi
      .fn()
      .mockResolvedValueOnce({
        pubkey: 'wallet-a',
        linked_at: '2026-01-01T00:00:00Z',
      })
      .mockResolvedValueOnce({
        pubkey: 'wallet-b',
        linked_at: '2026-01-01T00:01:00Z',
      })
      .mockResolvedValue({
        pubkey: 'wallet-b',
        linked_at: '2026-01-01T00:01:00Z',
      });
    const findTokens = vi.fn((walletAddress: string) => {
      if (walletAddress === 'wallet-a') {
        return new Promise<{ mint: string; slot: number }[]>((resolve) => {
          finishWalletA = resolve;
        });
      }
      return Promise.resolve([{ mint: 'wallet-b-mint', slot: 456 }]);
    });
    const claim = vi.fn().mockResolvedValue({ status: 'claimed', mint: 'wallet-b-mint' });
    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount,
      seekerEntitlementForAccount: vi.fn().mockResolvedValue(null),
      findSeekerGenesisTokens: findTokens,
      claimAvailableSeekerEntitlement: claim,
    });
    const firstRes = new FakeRes();
    const first = handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      firstRes as unknown as http.ServerResponse,
      42,
    );
    await vi.waitFor(() => expect(finishWalletA).toBeTypeOf('function'));

    const secondRes = new FakeRes();
    const second = handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      secondRes as unknown as http.ServerResponse,
      42,
    );
    await second;
    finishWalletA([{ mint: 'wallet-a-mint', slot: 123 }]);
    await first;

    expect(findTokens).toHaveBeenCalledTimes(2);
    expect(findTokens.mock.calls.map(([walletAddress]) => walletAddress)).toEqual([
      'wallet-a',
      'wallet-b',
    ]);
    expect(firstRes.statusCode).toBe(409);
    expect(secondRes.statusCode).toBe(200);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ claimantWallet: 'wallet-b' }));
  });

  it('continues to coalesce claim verification for the same linked wallet', async () => {
    let finishVerification!: (tokens: { mint: string; slot: number }[]) => void;
    const walletForAccount = vi.fn().mockResolvedValue({
      pubkey: 'wallet',
      linked_at: '2026-01-01T00:00:00Z',
    });
    const claimForAccount = vi.fn().mockResolvedValue(null);
    const findTokens = vi.fn(
      () =>
        new Promise<{ mint: string; slot: number }[]>((resolve) => {
          finishVerification = resolve;
        }),
    );
    const claim = vi.fn().mockResolvedValue({ status: 'claimed', mint: 'shared-mint' });
    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount,
      seekerEntitlementForAccount: claimForAccount,
      findSeekerGenesisTokens: findTokens,
      claimAvailableSeekerEntitlement: claim,
    });
    const firstRes = new FakeRes();
    const secondRes = new FakeRes();
    const first = handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      firstRes as unknown as http.ServerResponse,
      42,
    );
    const second = handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      secondRes as unknown as http.ServerResponse,
      42,
    );

    await vi.waitFor(() => expect(claimForAccount).toHaveBeenCalledTimes(2));
    expect(findTokens).toHaveBeenCalledTimes(1);
    finishVerification([{ mint: 'shared-mint', slot: 123 }]);
    await Promise.all([first, second]);

    expect(walletForAccount).toHaveBeenCalledTimes(4);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
  });

  it('does not re-read or write the wallet after RPC verification fails', async () => {
    const walletForAccount = vi.fn().mockResolvedValue({
      pubkey: 'wallet',
      linked_at: '2026-01-01T00:00:00Z',
    });
    const claim = vi.fn();
    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount,
      seekerEntitlementForAccount: vi.fn().mockResolvedValue(null),
      findSeekerGenesisTokens: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
      claimAvailableSeekerEntitlement: claim,
    });
    const res = new FakeRes();

    await handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      res as unknown as http.ServerResponse,
      42,
    );

    expect(walletForAccount).toHaveBeenCalledTimes(1);
    expect(claim).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'verified Seeker Genesis Token required',
      code: 'seeker.genesis_token_required',
    });
  });

  it('fails closed when fixed-mint verification returns a different token', async () => {
    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount: vi.fn().mockResolvedValue({
        pubkey: 'wallet',
        linked_at: '2026-01-01T00:00:00Z',
      }),
      seekerEntitlementForAccount: vi
        .fn()
        .mockResolvedValue({ mint: 'fixed-mint', claimantWallet: 'prior-wallet' }),
      findSeekerGenesisTokens: vi.fn().mockResolvedValue([{ mint: 'other-mint', slot: 456 }]),
    });
    const res = new FakeRes();
    await handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      res as unknown as http.ServerResponse,
      42,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'verified Seeker Genesis Token required',
      code: 'seeker.genesis_token_required',
    });
  });

  it('fails closed for web calls, invalid attestation, missing SGT, and consumed mint', async () => {
    const webRes = new FakeRes();
    await handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: { 'content-type': 'application/json' },
        body: {},
      }),
      webRes as unknown as http.ServerResponse,
      42,
    );
    expect(webRes.statusCode).toBe(403);
    expect(JSON.parse(webRes.body)).toEqual({
      error: 'Seeker entitlement is available only in the native app',
      code: 'seeker.native_only',
    });

    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue(null),
    });
    const invalidRes = new FakeRes();
    await handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      invalidRes as unknown as http.ServerResponse,
      42,
    );
    expect(invalidRes.statusCode).toBe(403);
    expect(JSON.parse(invalidRes.body)).toEqual({
      error: 'Solana Store app verification required',
      code: 'seeker.solana_artifact_required',
    });

    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount: vi.fn().mockResolvedValue(null),
    });
    const walletRes = new FakeRes();
    await handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      walletRes as unknown as http.ServerResponse,
      42,
    );
    expect(walletRes.statusCode).toBe(409);
    expect(JSON.parse(walletRes.body)).toEqual({
      error: 'link and verify a wallet first',
      code: 'seeker.wallet_required',
    });

    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount: vi.fn().mockResolvedValue({
        pubkey: 'wallet',
        linked_at: '2026-01-01T00:00:00Z',
      }),
      seekerEntitlementForAccount: vi.fn().mockResolvedValue(null),
      findSeekerGenesisTokens: vi.fn().mockResolvedValue([]),
    });
    const tokenRes = new FakeRes();
    await handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      tokenRes as unknown as http.ServerResponse,
      42,
    );
    expect(tokenRes.statusCode).toBe(403);
    expect(JSON.parse(tokenRes.body)).toEqual({
      error: 'verified Seeker Genesis Token required',
      code: 'seeker.genesis_token_required',
    });

    setSeekerEntitlementRuntimeForTests({
      verifySeekerSolanaArtifactAttestation: vi.fn().mockResolvedValue({ nonce: 'nonce' }),
      walletForAccount: vi.fn().mockResolvedValue({
        pubkey: 'wallet',
        linked_at: '2026-01-01T00:00:00Z',
      }),
      seekerEntitlementForAccount: vi.fn().mockResolvedValue(null),
      findSeekerGenesisTokens: vi.fn().mockResolvedValue([{ mint: 'mint', slot: 123 }]),
      claimAvailableSeekerEntitlement: vi
        .fn()
        .mockResolvedValue({ status: 'conflict', mint: null }),
    });
    const conflictRes = new FakeRes();
    await handleSeekerEntitlementClaim(
      makeReq({
        method: 'POST',
        url: '/api/seeker/entitlement',
        headers: nativeHeaders,
        body: { nativeAttestation: {} },
      }),
      conflictRes as unknown as http.ServerResponse,
      42,
    );
    expect(conflictRes.statusCode).toBe(409);
    expect(JSON.parse(conflictRes.body)).toEqual({
      error: 'Seeker Genesis Token was already claimed',
      code: 'seeker.genesis_token_claimed',
    });
  });

  it('rechecks current SGT ownership before a native daily spin', async () => {
    setSeekerEntitlementRuntimeForTests({
      seekerEntitlementForAccount: vi
        .fn()
        .mockResolvedValue({ mint: 'claimed-mint', claimantWallet: 'original-wallet' }),
      walletForAccount: vi.fn().mockResolvedValue({
        pubkey: 'current-primary-wallet',
        linked_at: '2026-01-01T00:00:00Z',
      }),
      findSeekerGenesisToken: vi.fn().mockResolvedValue({ mint: 'claimed-mint', slot: 456 }),
    });
    await expect(verifyCurrentSeekerEntitlement(42)).resolves.toBe(true);

    setSeekerEntitlementRuntimeForTests({
      seekerEntitlementForAccount: vi
        .fn()
        .mockResolvedValue({ mint: 'claimed-mint', claimantWallet: 'original-wallet' }),
      walletForAccount: vi.fn().mockResolvedValue({
        pubkey: 'current-primary-wallet',
        linked_at: '2026-01-01T00:00:00Z',
      }),
      findSeekerGenesisToken: vi.fn().mockResolvedValue({ mint: 'different-mint', slot: 456 }),
    });
    await expect(verifyCurrentSeekerEntitlement(42)).resolves.toBe(false);
  });

  it('coalesces duplicate ownership hydration and RPC work for one account', async () => {
    let release!: (value: { mint: string; slot: number } | null) => void;
    const claimForAccount = vi
      .fn()
      .mockResolvedValue({ mint: 'claimed-mint', claimantWallet: 'original-wallet' });
    const walletForAccount = vi.fn().mockResolvedValue({
      pubkey: 'current-primary-wallet',
      linked_at: '2026-01-01T00:00:00Z',
    });
    const findToken = vi.fn(
      () =>
        new Promise<{ mint: string; slot: number } | null>((resolve) => {
          release = resolve;
        }),
    );
    setSeekerEntitlementRuntimeForTests({
      seekerEntitlementForAccount: claimForAccount,
      walletForAccount,
      findSeekerGenesisToken: findToken,
    });

    const first = verifyCurrentSeekerEntitlement(42);
    const second = verifyCurrentSeekerEntitlement(42);
    await vi.waitFor(() => expect(findToken).toHaveBeenCalledTimes(1));
    expect(claimForAccount).toHaveBeenCalledTimes(1);
    expect(walletForAccount).toHaveBeenCalledTimes(1);
    release({ mint: 'claimed-mint', slot: 456 });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });
});
