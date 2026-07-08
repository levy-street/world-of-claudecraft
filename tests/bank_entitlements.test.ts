import { describe, expect, it } from 'vitest';

import {
  BANK_BONUS_SOURCES,
  type BankBonusFacts,
  type BankBonusSourceDef,
  computeBankBonus,
  maxBankBonusSlots,
} from '../server/bank_entitlements';
import { BANK_MAX_BONUS_SLOTS } from '../src/sim/bank';
import type { BankBonusSource } from '../src/world_api';

// The bank bonus-slot registry math. Every source grants +2 per unit: email/Discord/
// wallet are binary (1 unit, cap 1 -> +2), referral is +2 per qualified referral capped
// at 5 (+10). Values are pinned as bare literals, never a constant compared to itself.

const facts = (over: Partial<BankBonusFacts> = {}): BankBonusFacts => ({
  emailVerified: false,
  discordLinked: false,
  walletLinked: false,
  qualifiedReferrals: 0,
  ...over,
});

function rowFor(r: { sources: BankBonusSource[] }, id: string): BankBonusSource {
  const row = r.sources.find((s) => s.id === id);
  if (!row) throw new Error(`no bonus row for ${id}`);
  return row;
}

const sumSlots = (r: { sources: BankBonusSource[] }): number =>
  r.sources.reduce((s, x) => s + x.slots, 0);

describe('computeBankBonus: per-source math (each dimension toggled independently)', () => {
  it('grants nothing when no fact is earned (the per-dimension negative baseline)', () => {
    const r = computeBankBonus(facts());
    expect(r.bonusSlots).toBe(0);
    expect(rowFor(r, 'email')).toEqual({ id: 'email', slots: 0, maxSlots: 2 });
    expect(rowFor(r, 'discord')).toEqual({ id: 'discord', slots: 0, maxSlots: 2 });
    expect(rowFor(r, 'wallet')).toEqual({ id: 'wallet', slots: 0, maxSlots: 2 });
    expect(rowFor(r, 'referral')).toEqual({
      id: 'referral',
      slots: 0,
      maxSlots: 10,
      count: 0,
      cap: 5,
    });
  });

  it('grants +2 for a verified email in isolation, 0 for every other source', () => {
    const r = computeBankBonus(facts({ emailVerified: true }));
    expect(rowFor(r, 'email')).toEqual({ id: 'email', slots: 2, maxSlots: 2 });
    expect(rowFor(r, 'discord').slots).toBe(0);
    expect(rowFor(r, 'wallet').slots).toBe(0);
    expect(rowFor(r, 'referral').slots).toBe(0);
    expect(r.bonusSlots).toBe(2);
  });

  it('grants +2 for a linked Discord in isolation, 0 for every other source', () => {
    const r = computeBankBonus(facts({ discordLinked: true }));
    expect(rowFor(r, 'discord')).toEqual({ id: 'discord', slots: 2, maxSlots: 2 });
    expect(rowFor(r, 'email').slots).toBe(0);
    expect(rowFor(r, 'wallet').slots).toBe(0);
    expect(rowFor(r, 'referral').slots).toBe(0);
    expect(r.bonusSlots).toBe(2);
  });

  it('grants +2 for a linked wallet in isolation, 0 for every other source', () => {
    const r = computeBankBonus(facts({ walletLinked: true }));
    expect(rowFor(r, 'wallet')).toEqual({ id: 'wallet', slots: 2, maxSlots: 2 });
    expect(rowFor(r, 'email').slots).toBe(0);
    expect(rowFor(r, 'discord').slots).toBe(0);
    expect(rowFor(r, 'referral').slots).toBe(0);
    expect(r.bonusSlots).toBe(2);
  });

  it('grants +2 per qualified referral in isolation, 0 for every other source', () => {
    const r = computeBankBonus(facts({ qualifiedReferrals: 3 }));
    expect(rowFor(r, 'referral')).toEqual({
      id: 'referral',
      slots: 6,
      maxSlots: 10,
      count: 3,
      cap: 5,
    });
    expect(rowFor(r, 'email').slots).toBe(0);
    expect(rowFor(r, 'discord').slots).toBe(0);
    expect(rowFor(r, 'wallet').slots).toBe(0);
    expect(r.bonusSlots).toBe(6);
  });
});

describe('computeBankBonus: the referral cap holds at exactly 5', () => {
  it('4 referrals -> 8 slots, displayed 4/5', () => {
    const r = computeBankBonus(facts({ qualifiedReferrals: 4 }));
    expect(rowFor(r, 'referral')).toEqual({
      id: 'referral',
      slots: 8,
      maxSlots: 10,
      count: 4,
      cap: 5,
    });
    expect(r.bonusSlots).toBe(8);
  });

  it('exactly 5 referrals -> 10 slots, displayed 5/5 (the cap boundary)', () => {
    const r = computeBankBonus(facts({ qualifiedReferrals: 5 }));
    expect(rowFor(r, 'referral')).toEqual({
      id: 'referral',
      slots: 10,
      maxSlots: 10,
      count: 5,
      cap: 5,
    });
    expect(r.bonusSlots).toBe(10);
  });

  it('6 referrals -> still 10 slots, and the DISPLAYED count is capped at 5 (not 6)', () => {
    const r = computeBankBonus(facts({ qualifiedReferrals: 6 }));
    expect(rowFor(r, 'referral')).toEqual({
      id: 'referral',
      slots: 10,
      maxSlots: 10,
      count: 5,
      cap: 5,
    });
    expect(r.bonusSlots).toBe(10);
  });
});

describe('computeBankBonus: row shape and total invariants', () => {
  it('binary rows carry NO count/cap keys', () => {
    const r = computeBankBonus(
      facts({ emailVerified: true, discordLinked: true, walletLinked: true }),
    );
    for (const id of ['email', 'discord', 'wallet']) {
      const row = rowFor(r, id);
      expect(row).not.toHaveProperty('count');
      expect(row).not.toHaveProperty('cap');
    }
    // The referral row, being multi-unit, DOES carry them (the contrast that makes the
    // "binary rows omit" assertion meaningful).
    expect(rowFor(r, 'referral')).toHaveProperty('count');
    expect(rowFor(r, 'referral')).toHaveProperty('cap');
  });

  it('bonusSlots always equals the sum of the row slots', () => {
    const combos = [
      facts(),
      facts({ emailVerified: true }),
      facts({ qualifiedReferrals: 3 }),
      facts({ discordLinked: true, qualifiedReferrals: 6 }),
      facts({
        emailVerified: true,
        discordLinked: true,
        walletLinked: true,
        qualifiedReferrals: 7,
      }),
    ];
    for (const f of combos) {
      const r = computeBankBonus(f);
      expect(r.bonusSlots).toBe(sumSlots(r));
    }
  });

  it('all facts earned -> 16 bonus slots, and maxBankBonusSlots() === 16', () => {
    const maxed = computeBankBonus(
      facts({
        emailVerified: true,
        discordLinked: true,
        walletLinked: true,
        qualifiedReferrals: 5,
      }),
    );
    expect(maxed.bonusSlots).toBe(16);
    expect(maxBankBonusSlots()).toBe(16);
  });
});

describe('computeBankBonus: the sim-constant tripwire', () => {
  it('the registry ceiling equals BANK_MAX_BONUS_SLOTS (a future source bumps both in one change)', () => {
    // The registry can never grant more capacity than the sim load-clamp admits. These
    // are two independent sources of the same 16: the registry cap sum vs the sim
    // constant; adding a source that raises one without the other reds here.
    expect(maxBankBonusSlots(BANK_BONUS_SOURCES)).toBe(BANK_MAX_BONUS_SLOTS);
  });
});

describe('computeBankBonus: a new future source row lands without touching the wire shape', () => {
  it('appends one row over a registry COPY, changing no existing row or the shipped registry', () => {
    // The packet acceptance criterion: a future source (X, Twitch) is one more registry
    // row. Prove it composes over a COPY without editing any shipped row or pinned count.
    const fakeRow: BankBonusSourceDef = {
      id: 'x_follow',
      slotsPerUnit: 2,
      capUnits: 1,
      units: () => 1,
    };
    const extended = [...BANK_BONUS_SOURCES, fakeRow];
    const r = computeBankBonus(facts({ emailVerified: true }), extended);
    const shipped = computeBankBonus(facts({ emailVerified: true }));

    // Same SHAPE: still { sources: BankBonusSource[]; bonusSlots: number }, the new row
    // is exactly one more entry appended last.
    expect(Array.isArray(r.sources)).toBe(true);
    expect(typeof r.bonusSlots).toBe('number');
    expect(r.sources).toHaveLength(BANK_BONUS_SOURCES.length + 1);
    // Every prior row is byte-identical to the shipped computation: no existing row moved.
    expect(r.sources.slice(0, BANK_BONUS_SOURCES.length)).toEqual(shipped.sources);
    expect(rowFor(r, 'x_follow')).toEqual({ id: 'x_follow', slots: 2, maxSlots: 2 });
    // The total is still the row sum, grown by exactly the new row's slots.
    expect(r.bonusSlots).toBe(sumSlots(r));
    expect(r.bonusSlots).toBe(shipped.bonusSlots + 2);

    // ...and doing so required NO edit to the shipped registry: it is still the four v1
    // rows in order. A regression that mutated the module-level array would red here.
    expect(BANK_BONUS_SOURCES).toHaveLength(4);
    expect(BANK_BONUS_SOURCES.map((d) => d.id)).toEqual(['email', 'discord', 'wallet', 'referral']);
  });

  it('a malformed future units() (NaN or negative) decays to 0 slots, never propagating', () => {
    // The registry is the extensibility seam, so harden it like clampBonusSlots: a
    // future row whose criterion misbehaves must not poison bonusSlots (NaN) or
    // subtract capacity (negative). Infinity is bounded by the capUnits min.
    const badRows: BankBonusSourceDef[] = [
      { id: 'nan_source', slotsPerUnit: 2, capUnits: 1, units: () => Number.NaN },
      { id: 'neg_source', slotsPerUnit: 2, capUnits: 1, units: () => -3 },
      { id: 'inf_source', slotsPerUnit: 2, capUnits: 1, units: () => Number.POSITIVE_INFINITY },
    ];
    const r = computeBankBonus(facts({ emailVerified: true }), [...BANK_BONUS_SOURCES, ...badRows]);
    expect(rowFor(r, 'nan_source')).toEqual({ id: 'nan_source', slots: 0, maxSlots: 2 });
    expect(rowFor(r, 'neg_source')).toEqual({ id: 'neg_source', slots: 0, maxSlots: 2 });
    expect(rowFor(r, 'inf_source')).toEqual({ id: 'inf_source', slots: 2, maxSlots: 2 });
    expect(Number.isFinite(r.bonusSlots)).toBe(true);
    expect(r.bonusSlots).toBe(sumSlots(r));
    expect(r.bonusSlots).toBe(4); // email +2, inf bounded to +2, nan/neg contribute 0
  });
});
