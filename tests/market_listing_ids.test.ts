// The World Market's listing-id allocator (src/sim/market_listing_ids.ts), the
// pure core behind the house-band / player-band split (#2463). Tested directly:
// no Sim, no clock, no rng.
import { describe, expect, it } from 'vitest';
import {
  isListingId,
  MARKET_PLAYER_LISTING_ID_BASE,
  planListingIds,
  playerListingIdFloor,
} from '../src/sim/market_listing_ids';

describe('MARKET_PLAYER_LISTING_ID_BASE', () => {
  it('is pinned to its literal value', () => {
    // Deliberately a literal, not a self-comparison: every OTHER assertion in
    // this file and in tests/market.test.ts is written against the constant, so
    // shrinking it would leave all of them green while destroying the headroom
    // the band exists to provide (at base 24 the 23-row stock table already sits
    // flush against the first player id, re-arming #2463 on the next stock row).
    // Raising it is fine on its own, but it moves where every future player id
    // lands, so it should be a deliberate edit rather than a silent one.
    expect(MARKET_PLAYER_LISTING_ID_BASE).toBe(1000);
  });
});

describe('isListingId', () => {
  it('accepts only positive safe integers', () => {
    expect(isListingId(1)).toBe(true);
    expect(isListingId(1000)).toBe(true);
    expect(isListingId(Number.MAX_SAFE_INTEGER)).toBe(true);

    expect(isListingId(0)).toBe(false);
    expect(isListingId(-1)).toBe(false);
    expect(isListingId(1.5)).toBe(false);
    expect(isListingId(NaN)).toBe(false);
    expect(isListingId(Infinity)).toBe(false);
    expect(isListingId(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isListingId('7')).toBe(false);
    expect(isListingId(null)).toBe(false);
    expect(isListingId(undefined)).toBe(false);
  });
});

describe('playerListingIdFloor', () => {
  it('starts the player band at the reserved base, whatever the house band holds', () => {
    expect(playerListingIdFloor([])).toBe(MARKET_PLAYER_LISTING_ID_BASE);
    expect(playerListingIdFloor([1, 2, 3])).toBe(MARKET_PLAYER_LISTING_ID_BASE);
    // the whole reserved span is the Merchant's to grow into
    expect(playerListingIdFloor([MARKET_PLAYER_LISTING_ID_BASE - 1])).toBe(
      MARKET_PLAYER_LISTING_ID_BASE,
    );
    // boundary: a seeded row ON the base pushes the floor past it, never onto it
    expect(playerListingIdFloor([MARKET_PLAYER_LISTING_ID_BASE])).toBe(
      MARKET_PLAYER_LISTING_ID_BASE + 1,
    );
  });

  it('clears a house band that outgrew the reserved base', () => {
    const past = MARKET_PLAYER_LISTING_ID_BASE + 40;
    expect(playerListingIdFloor([1, past, 2])).toBe(past + 1);
  });

  it('ignores malformed seeded ids instead of poisoning the floor', () => {
    expect(playerListingIdFloor([NaN, Infinity, -5, 0] as number[])).toBe(
      MARKET_PLAYER_LISTING_ID_BASE,
    );
  });
});

describe('planListingIds', () => {
  it('keeps a healthy save verbatim and settles the counter past it', () => {
    const plan = planListingIds({
      taken: [1, 2, 3],
      saved: [1001, 1002],
      from: 1000,
      savedNext: 1003,
    });
    expect(plan.ids).toEqual([1001, 1002]);
    expect(plan.remapped).toBe(0);
    expect(plan.nextListingId).toBe(1003);
  });

  it('reissues a persisted id the house band has already taken', () => {
    // the #2463 shape: the save was written when the stock table was smaller,
    // so id 7 was a player listing then and names a house row now.
    const plan = planListingIds({
      taken: [1, 2, 3, 4, 5, 6, 7],
      saved: [7],
      from: 1000,
      savedNext: 8,
    });
    expect(plan.ids).toEqual([1000]);
    expect(plan.remapped).toBe(1);
    expect(plan.nextListingId).toBe(1001);
  });

  it('never hands a reissued id to a row a later save entry keeps verbatim', () => {
    // The counter must be settled BEFORE the first id is handed out: advancing
    // it only as rows are pushed (the old order) would reissue the colliding 2
    // as 4 and collide head-on with the 4 further down the same save.
    const plan = planListingIds({ taken: [1, 2, 3], saved: [2, 4], from: 4, savedNext: 4 });
    expect(plan.ids).toEqual([5, 4]);
    expect(new Set(plan.ids).size).toBe(plan.ids.length);
    expect(plan.remapped).toBe(1);
    expect(plan.nextListingId).toBe(6);
  });

  it('breaks up ids duplicated inside one save', () => {
    const plan = planListingIds({
      taken: [],
      saved: [1001, 1001, 1001],
      from: 1000,
      savedNext: 1002,
    });
    expect(plan.ids).toEqual([1001, 1002, 1003]);
    expect(plan.remapped).toBe(2);
    expect(plan.nextListingId).toBe(1004);
  });

  it('reissues every malformed id and stays index-aligned with the save', () => {
    const saved = [undefined, null, 0, -3, 2.5, NaN, Infinity, '1001', Number.MAX_SAFE_INTEGER + 1];
    const plan = planListingIds({ taken: [1], saved, from: 1000, savedNext: 1000 });
    expect(plan.ids.length).toBe(saved.length); // one planned id per save row
    expect(plan.ids).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008]);
    expect(plan.remapped).toBe(saved.length);
    expect(plan.nextListingId).toBe(1009);
  });

  it('honours a saved counter that runs ahead of every id', () => {
    const plan = planListingIds({ taken: [1], saved: [1001], from: 1000, savedNext: 5000 });
    expect(plan.ids).toEqual([1001]);
    expect(plan.nextListingId).toBe(5000); // the next id issued is 5000
  });

  it('ignores a malformed or stale saved counter instead of walking backwards', () => {
    for (const savedNext of [undefined, null, NaN, -1, 0, 'lots', 2]) {
      const plan = planListingIds({ taken: [1, 2, 3], saved: [1001], from: 1000, savedNext });
      expect(plan.ids).toEqual([1001]);
      expect(plan.nextListingId).toBe(1002); // past the book and past the save
    }
  });

  it('settles past an id the book holds ON the counter, never onto it', () => {
    // boundary: `from` equal to a taken id must still advance, or the first
    // reissued row lands on the house row that already owns that id.
    const plan = planListingIds({ taken: [1000], saved: [null], from: 1000, savedNext: 0 });
    expect(plan.ids).toEqual([1001]);
    expect(plan.nextListingId).toBe(1002);
  });

  it('settles past the book even when the incoming counter lags behind it', () => {
    const plan = planListingIds({ taken: [1, 2, 3, 4], saved: [], from: 1, savedNext: 1 });
    expect(plan.ids).toEqual([]);
    expect(plan.remapped).toBe(0);
    expect(plan.nextListingId).toBe(5);
  });

  it('leaves no two rows sharing an id across a mixed, hostile save', () => {
    const taken = [1, 2, 3, 4, 5];
    const saved = [3, 3, 1002, undefined, 1002, 5, 1001];
    const plan = planListingIds({ taken, saved, from: 1000, savedNext: 7 });
    const all = [...taken, ...plan.ids];
    expect(new Set(all).size).toBe(all.length);
    expect(plan.ids.every((id) => Number.isSafeInteger(id) && id >= 1)).toBe(true);
    expect(Math.max(...plan.ids)).toBeLessThan(plan.nextListingId);
  });
});
