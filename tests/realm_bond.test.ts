// Verifies the realm bond logic (#475 buy-path "skin in the game"): the bond size
// (a fraction of the tier threshold), the pure grace state machine that decides
// when an under-bonded wallet enters grace / cures / lapses, and the initial-grace
// + coverage helpers. The reconcileBonds DB walk is covered by integration tests;
// here we pin the pure decisions. realm_bond.ts transitively imports server/db.ts
// (throws at import without DATABASE_URL), stubbed minimally.
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('../server/db', () => ({ pool: {}, walletForAccount: vi.fn() }));

import { bondAction, bondBaseForTier, initialGraceUntil, walletCoversBond, BOND_BPS } from '../server/realm_bond';

// At the default REALM_BOND_BPS=1000, a 6dp $WOC bond of 100 tokens is 100_000_000
// base units; used by the coverage helpers below (default WOC_DECIMALS=6).
const BOND_100 = 100_000_000n;

describe('bondBaseForTier', () => {
  it('is the configured fraction of the tier threshold', () => {
    // Default 1000 bps = 10% of the tier amount.
    expect(BOND_BPS).toBe(1000);
    expect(bondBaseForTier(1_000_000n)).toBe(100_000n);
    expect(bondBaseForTier(0n)).toBe(0n);
  });
});

describe('bondAction (grace state machine)', () => {
  const now = 1_000_000;
  it('is ok when covered and not in grace', () => {
    expect(bondAction({ belowBond: false, graceUntil: null, now })).toBe('ok');
  });
  it('cures (clears grace) when the wallet recovers mid-grace', () => {
    expect(bondAction({ belowBond: false, graceUntil: now + 5000, now })).toBe('cure');
  });
  it('enters grace when first found below the bond', () => {
    expect(bondAction({ belowBond: true, graceUntil: null, now })).toBe('enter_grace');
  });
  it('waits while still in the grace window', () => {
    expect(bondAction({ belowBond: true, graceUntil: now + 5000, now })).toBe('wait');
  });
  it('lapses once grace has elapsed and the bond is still unmet', () => {
    expect(bondAction({ belowBond: true, graceUntil: now - 1, now })).toBe('lapse');
    expect(bondAction({ belowBond: true, graceUntil: now, now })).toBe('lapse');
  });
});

describe('walletCoversBond', () => {
  it('covers when the held $WOC is at least the bond', () => {
    expect(walletCoversBond(150, BOND_100)).toBe(true);
    expect(walletCoversBond(100, BOND_100)).toBe(true);
  });
  it('does not cover when held below the bond', () => {
    expect(walletCoversBond(50, BOND_100)).toBe(false);
  });
  it('is lenient on an unknown balance (RPC failure does not block)', () => {
    expect(walletCoversBond(null, BOND_100)).toBe(true);
  });
});

describe('initialGraceUntil', () => {
  const now = 5_000_000;
  it('starts no grace when the buyer already covers the bond', () => {
    expect(initialGraceUntil(150, BOND_100, now)).toBeNull();
  });
  it('starts the grace clock when the buyer is below the bond', () => {
    const g = initialGraceUntil(50, BOND_100, now);
    expect(g).toBeInstanceOf(Date);
    expect((g as Date).getTime()).toBeGreaterThan(now);
  });
  it('is lenient on an unknown balance (no grace)', () => {
    expect(initialGraceUntil(null, BOND_100, now)).toBeNull();
  });
});
