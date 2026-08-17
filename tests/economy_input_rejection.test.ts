// THE REJECTION MATRIX: what every client-named sum does when it is not a sum.
//
// Each of these commands lets a player type a number, and each one used to guard
// it slightly differently: one checked `Number.isFinite`, one checked
// `typeof === 'number'`, one clamped with `Math.max`. This file states the rule
// once, as a table, so a new money command that skips it is a visible hole
// rather than an invisible one.
//
// WHY THIS IS AN ECONOMY TEST AND NOT A VALIDATION TEST. A poisoned amount is
// not merely invalid input: NaN compares false against everything, so an
// affordability check reads as "they can afford it", the gameplay decision that
// check gates goes ahead, and only the ledger write at the very end refuses. By
// then the item has moved. The rule is therefore that a bad amount must be
// neutralised BEFORE it can reach a decision, not caught after one.
//
// `applyMoneyDelta` refuses unsafe values too. That is the backstop, not the
// gate, and asserting only on it would pass for a build where the gate is gone.

import { describe, expect, it } from 'vitest';
import { applyMoneyDelta, sanitizeCopperInput } from '../src/sim/economy_events';
import type { Entity, SimEvent } from '../src/sim/types';

/**
 * Shapes that are meaningless as an AMOUNT under any reading: not a number at
 * all, or a number no purse can hold.
 */
const UNREPRESENTABLE: { name: string; value: unknown }[] = [
  { name: 'NaN', value: Number.NaN },
  { name: 'Infinity', value: Number.POSITIVE_INFINITY },
  { name: '-Infinity', value: Number.NEGATIVE_INFINITY },
  { name: 'a fraction', value: 12.5 },
  { name: 'past MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER + 2 },
  { name: 'a numeric string', value: '500' },
  { name: 'a boolean', value: true },
  { name: 'null', value: null },
  { name: 'undefined', value: undefined },
  { name: 'an object', value: { valueOf: () => 500 } },
];

/**
 * Everything a PLAYER-NAMED sum must refuse, which is the set above plus the
 * negatives. The two tables are deliberately not one: a negative delta is
 * perfectly legitimate deeper in (every sink in the game is one), so a guard
 * that rejected negatives everywhere would break vendor buys, and a guard that
 * accepted them at the wire would let "deposit -500" read as a withdrawal.
 */
const PLAYER_NAMED_POISON = [
  ...UNREPRESENTABLE,
  { name: 'a negative amount', value: -500 },
  { name: 'a negative fraction', value: -0.5 },
];

describe('sanitizeCopperInput neutralises every poisoned shape', () => {
  for (const { name, value } of PLAYER_NAMED_POISON) {
    it(`turns ${name} into 0`, () => {
      // 0, deliberately, and not an error or a clamp to some maximum: both of
      // those invent an intent the player did not express, while 0 is the
      // amount that changes nothing and every caller already handles it.
      expect(sanitizeCopperInput(value)).toBe(0);
    });
  }

  it('passes an honest amount through untouched', () => {
    // The complement, and the one that fails if the guard is inverted or too
    // greedy. Without it every case above passes for a function returning 0.
    expect(sanitizeCopperInput(1)).toBe(1);
    expect(sanitizeCopperInput(500)).toBe(500);
    expect(sanitizeCopperInput(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses 0 itself, so a caller cannot be handed a no-op it treats as real', () => {
    expect(sanitizeCopperInput(0)).toBe(0);
  });
});

describe('the clamp shape that used to leak', () => {
  for (const held of [0, 1000]) {
    it(`floors a NaN offer to 0 against a purse of ${held}`, () => {
      // The exact expression tradeSetOffer used: Math.max(0, Math.min(NaN, n))
      // is NaN, not 0. A clamp that LOOKS like a floor stored the poison, and
      // every later comparison against it read as false.
      expect(Math.max(0, Math.min(Math.floor(Number.NaN), held))).toBeNaN();
      // What it does now.
      expect(Math.min(sanitizeCopperInput(Math.floor(Number.NaN)), held)).toBe(0);
    });
  }
});

describe('applyMoneyDelta is the backstop, and it holds', () => {
  function holder(copper = 1000) {
    return { entityId: 1, copper };
  }
  function ctx() {
    const events: SimEvent[] = [];
    return {
      tickCount: 5,
      entities: new Map<number, Entity>(),
      emit: (ev: SimEvent) => events.push(ev),
      events,
    };
  }

  for (const { name, value } of UNREPRESENTABLE) {
    it(`refuses ${name} whole, writing neither the purse nor a row`, () => {
      const c = ctx();
      const h = holder();
      // Cast because the wire is untyped: the point of the case is what happens
      // when a value the types say is impossible arrives anyway.
      const applied = applyMoneyDelta(c, h, 'mob_loot', value as number);
      // Refused WHOLE. A partial application would put a fractional or NaN
      // purse into the save blob, and a NaN would then poison every later chain
      // check silently rather than loudly.
      expect(applied).toBe(0);
      expect(h.copper).toBe(1000);
      // And no row: a no-op is not a ledger row, and writing one per refused
      // command would flood a keep-forever table at the command-lane rate.
      expect(c.events).toEqual([]);
    });
  }

  it('still applies an honest negative delta, which is not poison here', () => {
    // The line between the two tables above, asserted. Every sink in the game
    // is a negative delta, so this layer must accept them; sanitizeCopperInput
    // rejects them because a player naming "-500" at a deposit prompt means
    // something no deposit can honour.
    const c = ctx();
    const h = holder();
    expect(applyMoneyDelta(c, h, 'vendor_buy', -250)).toBe(-250);
    expect(h.copper).toBe(750);
    expect(c.events).toHaveLength(1);
  });
});
