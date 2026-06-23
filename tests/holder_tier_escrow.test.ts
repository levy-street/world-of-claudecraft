// Holder-tier badge counts escrowed realm stake (#475).
//
// Staking $WOC to found a realm moves the principal into a program-owned escrow
// vault that getTokenAccountsByOwner cannot see, so a wallet-only badge read would
// drop the moment a player commits the most $WOC. These tests pin the fix: the
// holder balance is wallet $WOC plus escrowed (non-released) stake. The pure
// combiner is tested directly; the wiring test stubs the RPC + injects an escrow
// source to prove holderInfoForPubkey sums them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import bs58 from 'bs58';
import {
  holderInfoFromParts,
  holderInfoForPubkey,
  setEscrowedWocSource,
  resetEscrowedWocSourceForTests,
  resetWocBalanceCacheForTests,
} from '../server/woc_balance';

const ADDR = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 7));

// Mock the Solana JSON-RPC: one token account per uiAmount.
function mockRpc(uiAmounts: number[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      result: { value: uiAmounts.map((ui) => ({ account: { data: { parsed: { info: { tokenAmount: { uiAmount: ui } } } } } })) },
    }),
  }));
}

afterEach(() => {
  resetWocBalanceCacheForTests();
  resetEscrowedWocSourceForTests();
  vi.unstubAllGlobals();
});

describe('holderInfoFromParts (pure: wallet + escrow -> tier)', () => {
  it('counts escrowed $WOC so founding a Gold realm does not drop the badge', () => {
    // Wallet emptied to fund the stake, 100,000,000 $WOC (10% of supply) escrowed:
    // the badge stays at Worldbearer (rung 17), not gone.
    expect(holderInfoFromParts(0, 100_000_000)).toEqual({ tier: 17, balance: 100_000_000 });
  });

  it('sums wallet and escrow for the tier', () => {
    // 30M wallet + 20M escrowed = 50M = Titanforged (rung 12, 5% of supply).
    expect(holderInfoFromParts(30_000_000, 20_000_000)).toEqual({ tier: 12, balance: 50_000_000 });
  });

  it('keeps the badge from escrow alone when the wallet read failed (null)', () => {
    // 10M (1% of supply) escrowed = Leviathan (rung 8), even with the RPC down.
    expect(holderInfoFromParts(null, 10_000_000)).toEqual({ tier: 8, balance: 10_000_000 });
  });

  it('is {0,0} only when the wallet is unread AND nothing is escrowed', () => {
    expect(holderInfoFromParts(null, 0)).toEqual({ tier: 0, balance: 0 });
  });

  it('leaves a sub-rung wallet balance with no escrow at tier 0', () => {
    expect(holderInfoFromParts(0.5, 0)).toEqual({ tier: 0, balance: 0.5 });
  });

  it('clamps a negative escrow to zero (guard against a bad source)', () => {
    expect(holderInfoFromParts(1_000, -5)).toEqual({ tier: 4, balance: 1_000 });
  });
});

describe('holderInfoForPubkey honors the injected escrow source', () => {
  it('adds escrowed stake to the wallet RPC balance', async () => {
    vi.stubGlobal('fetch', mockRpc([5_000_000])); // 5M $WOC in the wallet
    setEscrowedWocSource(async () => 45_000_000); // 45M staked into realms
    expect(await holderInfoForPubkey(ADDR)).toEqual({ tier: 12, balance: 50_000_000 }); // 50M -> rung 12
  });

  it('keeps the badge when the wallet is fully emptied into a stake', async () => {
    vi.stubGlobal('fetch', mockRpc([0]));
    setEscrowedWocSource(async () => 10_000_000); // 1% of supply locked
    expect(await holderInfoForPubkey(ADDR)).toEqual({ tier: 8, balance: 10_000_000 });
  });

  it('defaults to wallet-only when no escrow source is wired', async () => {
    vi.stubGlobal('fetch', mockRpc([10_000]));
    expect(await holderInfoForPubkey(ADDR)).toEqual({ tier: 5, balance: 10_000 }); // gilded, escrow defaults to 0
  });
});
