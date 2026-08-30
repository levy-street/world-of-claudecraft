// The bind-on-pickup party trade window's pure core
// (src/sim/loot/bop_trade_window.ts): the payload builder, the two validity
// reads, and the remaining-time clamp, plus the payload's deep-clone
// plumbing (types.ts cloneItemInstancePayload). The drop-moment eligibility
// snapshot and the equip-ends-it rule are integration facts pinned in
// tests/loot_roll.test.ts and tests/bop_party_trade.test.ts.
import { describe, expect, it } from 'vitest';
import {
  BOP_PARTY_TRADE_MS,
  bopPartyTradeInstance,
  isLoadablePartyTradeMarker,
  partyTradeActive,
  partyTradeMsLeft,
  partyTradeWindowAllows,
  withoutPartyTradeMarker,
} from '../src/sim/loot/bop_trade_window';
import { cloneItemInstancePayload, type ItemInstancePayload } from '../src/sim/types';

describe('bop_trade_window: bopPartyTradeInstance', () => {
  it('is a two hour window', () => {
    expect(BOP_PARTY_TRADE_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('builds a window at now + 2h carrying the eligible snapshot', () => {
    const instance = bopPartyTradeInstance(10_000, ['Alice', 'Bob']);
    expect(instance).toEqual({
      partyTrade: { untilMs: 10_000 + BOP_PARTY_TRADE_MS, eligible: ['Alice', 'Bob'] },
    });
  });

  it('carries the stable character ids when the host knows them', () => {
    const instance = bopPartyTradeInstance(10_000, ['Alice', 'Bob'], [11, 22]);
    expect(instance?.partyTrade?.eligibleIds).toEqual([11, 22]);
  });

  it('copies the eligible list rather than aliasing the caller array', () => {
    const names = ['Alice', 'Bob'];
    const instance = bopPartyTradeInstance(0, names);
    names.push('Mallory');
    expect(instance?.partyTrade?.eligible).toEqual(['Alice', 'Bob']);
  });

  it('returns undefined when fewer than two names are eligible (nobody to trade with)', () => {
    expect(bopPartyTradeInstance(0, ['Alice'])).toBeUndefined();
    expect(bopPartyTradeInstance(0, [])).toBeUndefined();
  });
});

describe('bop_trade_window: partyTradeActive / partyTradeWindowAllows', () => {
  const windowed: ItemInstancePayload = {
    partyTrade: { untilMs: 5_000, eligible: ['Alice', 'Bob'] },
  };

  it('is active strictly before untilMs and inactive at and after it', () => {
    expect(partyTradeActive(windowed, 4_999)).toBe(true);
    expect(partyTradeActive(windowed, 5_000)).toBe(false);
    expect(partyTradeActive(windowed, 6_000)).toBe(false);
  });

  it('treats an absent or malformed window as no window (the JSONB-load safe direction)', () => {
    expect(partyTradeActive(undefined, 0)).toBe(false);
    expect(partyTradeActive({}, 0)).toBe(false);
    expect(partyTradeActive({ partyTrade: { untilMs: Number.NaN, eligible: ['Alice'] } }, 0)).toBe(
      false,
    );
    expect(
      partyTradeActive(
        { partyTrade: { untilMs: 5_000, eligible: 'Alice' } } as unknown as ItemInstancePayload,
        0,
      ),
    ).toBe(false);
  });

  it('allows exactly the drop-moment names, case-insensitively', () => {
    expect(partyTradeWindowAllows(windowed, { name: 'Bob' }, 0)).toBe(true);
    expect(partyTradeWindowAllows(windowed, { name: 'bob' }, 0)).toBe(true);
    expect(partyTradeWindowAllows(windowed, { name: 'Mallory' }, 0)).toBe(false);
  });

  it('denies an eligible name once the window has expired', () => {
    expect(partyTradeWindowAllows(windowed, { name: 'Bob' }, 5_000)).toBe(false);
  });

  it('skips non-string entries in a tampered eligible list instead of throwing', () => {
    const tampered = {
      partyTrade: { untilMs: 5_000, eligible: [42, 'Bob'] },
    } as unknown as ItemInstancePayload;
    expect(partyTradeWindowAllows(tampered, { name: 'Bob' }, 0)).toBe(true);
    expect(partyTradeWindowAllows(tampered, { name: '42' }, 0)).toBe(false);
  });

  describe('stable character ids beat names when both sides carry them', () => {
    const idWindowed: ItemInstancePayload = {
      partyTrade: { untilMs: 5_000, eligible: ['Alice', 'Bob'], eligibleIds: [11, 22] },
    };

    it('a renamed drop-mate stays eligible: the id matches even though the name no longer does', () => {
      expect(partyTradeWindowAllows(idWindowed, { name: 'Bobrenamed', characterId: 22 }, 0)).toBe(
        true,
      );
    });

    it('a stranger who took a freed drop-mate name is refused: name matches, id does not', () => {
      expect(partyTradeWindowAllows(idWindowed, { name: 'Bob', characterId: 99 }, 0)).toBe(false);
    });

    it('falls back to the name match when the counterparty has no character id', () => {
      expect(partyTradeWindowAllows(idWindowed, { name: 'Bob' }, 0)).toBe(true);
      expect(partyTradeWindowAllows(idWindowed, { name: 'Mallory' }, 0)).toBe(false);
    });

    it('falls back to the name match for a pre-id persisted window', () => {
      expect(partyTradeWindowAllows(windowed, { name: 'Bob', characterId: 99 }, 0)).toBe(true);
    });
  });
});

describe('bop_trade_window: partyTradeMsLeft', () => {
  it('reports the remaining span and clamps an expired or absent window to zero', () => {
    const windowed: ItemInstancePayload = {
      partyTrade: { untilMs: 5_000, eligible: ['Alice', 'Bob'] },
    };
    expect(partyTradeMsLeft(windowed, 1_500)).toBe(3_500);
    expect(partyTradeMsLeft(windowed, 9_000)).toBe(0);
    expect(partyTradeMsLeft(undefined, 0)).toBe(0);
  });
});

describe('bop_trade_window: payload cloning', () => {
  it('cloneItemInstancePayload deep-clones the window (no shared eligible array)', () => {
    const src: ItemInstancePayload = {
      partyTrade: { untilMs: 5_000, eligible: ['Alice', 'Bob'], eligibleIds: [11, 22] },
    };
    const clone = cloneItemInstancePayload(src);
    expect(clone).toEqual(src);
    expect(clone.partyTrade).not.toBe(src.partyTrade);
    clone.partyTrade?.eligible.push('Mallory');
    clone.partyTrade?.eligibleIds?.push(99);
    expect(src.partyTrade?.eligible).toEqual(['Alice', 'Bob']);
    expect(src.partyTrade?.eligibleIds).toEqual([11, 22]);
  });

  it('cloneItemInstancePayload is total over a malformed persisted window (never throws)', () => {
    // The clone runs BEFORE the load sanitizer on every persisted container,
    // so a hand-edited marker must copy without throwing; the sanitizer then
    // drops the whole malformed marker atomically.
    const malformed = [
      { partyTrade: { untilMs: 5_000, eligible: 5 } },
      { partyTrade: { untilMs: 5_000, eligible: ['Alice'], eligibleIds: 7 } },
      { partyTrade: 'junk' },
      { partyTrade: { untilMs: 5_000 } },
    ] as unknown as ItemInstancePayload[];
    for (const src of malformed) {
      expect(() => cloneItemInstancePayload(src), JSON.stringify(src)).not.toThrow();
    }
  });

  it('cloneItemInstancePayload is total over malformed rift gems too', () => {
    const src = {
      rift: { sourceEventId: 'ev', tier: 'C', power: 1, gems: 'junk', baseStats: {} },
    } as unknown as ItemInstancePayload;
    expect(() => cloneItemInstancePayload(src)).not.toThrow();
  });
});

describe('bop_trade_window: isLoadablePartyTradeMarker', () => {
  const MAX_NAME = 64;

  it('accepts a legal persisted marker, with or without the id list', () => {
    expect(
      isLoadablePartyTradeMarker({ untilMs: 5_000, eligible: ['Alice', 'Bob'] }, MAX_NAME),
    ).toBe(true);
    expect(
      isLoadablePartyTradeMarker(
        { untilMs: 5_000, eligible: ['Alice', 'Bob'], eligibleIds: [11, 22] },
        MAX_NAME,
      ),
    ).toBe(true);
  });

  it('refuses any marker whose required eligibility data is invalid or missing', () => {
    const refused: unknown[] = [
      undefined,
      null,
      'junk',
      [5_000],
      { eligible: ['Alice'] }, // untilMs missing
      { untilMs: Number.NaN, eligible: ['Alice'] },
      { untilMs: '5000', eligible: ['Alice'] },
      { untilMs: 5_000 }, // eligible missing
      { untilMs: 5_000, eligible: 5 }, // not iterable, the load-crash shape
      { untilMs: 5_000, eligible: ['Alice', 42] },
      { untilMs: 5_000, eligible: ['Alice', 'x'.repeat(MAX_NAME + 1)] },
      { untilMs: 5_000, eligible: ['Alice'], eligibleIds: 'junk' },
      { untilMs: 5_000, eligible: ['Alice'], eligibleIds: [11, 'x'] },
      { untilMs: 5_000, eligible: ['Alice'], eligibleIds: [Number.NaN] },
    ];
    for (const marker of refused) {
      expect(isLoadablePartyTradeMarker(marker, MAX_NAME), JSON.stringify(marker)).toBe(false);
    }
  });

  it('admits unknown extra keys inside the marker (additive forward compat)', () => {
    expect(
      isLoadablePartyTradeMarker(
        { untilMs: 5_000, eligible: ['Alice', 'Bob'], futureField: true },
        MAX_NAME,
      ),
    ).toBe(true);
  });
});

describe('bop_trade_window: withoutPartyTradeMarker', () => {
  it('strips the marker, keeps every other field, and never mutates the input', () => {
    const src: ItemInstancePayload = {
      signer: 'Ana',
      partyTrade: { untilMs: 5_000, eligible: ['Alice', 'Bob'] },
    };
    const stripped = withoutPartyTradeMarker(src);
    expect(stripped).toEqual({ signer: 'Ana' });
    expect(src.partyTrade?.eligible).toEqual(['Alice', 'Bob']);
  });

  it('collapses a marker-only payload to undefined (an empty {} would strand the slot)', () => {
    expect(
      withoutPartyTradeMarker({ partyTrade: { untilMs: 5_000, eligible: ['Alice', 'Bob'] } }),
    ).toBeUndefined();
    expect(withoutPartyTradeMarker({})).toBeUndefined();
  });

  it('returns a windowless payload unchanged in content', () => {
    expect(withoutPartyTradeMarker({ signer: 'Ana' })).toEqual({ signer: 'Ana' });
  });
});
