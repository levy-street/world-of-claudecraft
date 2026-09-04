// The ordinal-plus-count copy anchor (src/sim/item_copy_anchor.ts): the second
// description a per-copy command carries beside its bag index, so the server can
// tell a STALE selection from a live one.
//
// The defect it closes is silent. An index check proves the named cell still
// holds the right ITEM; it cannot prove the cell still holds the right COPY,
// and a client mirror lagging by one snapshot is exactly the case where those
// differ: a splice moves every slot above the gap down one, the index the player
// clicked now names the id-mate beside their enchanted piece, and the command
// destroys, sells or locks the wrong one.

import { describe, expect, it } from 'vitest';
import {
  anchorMatchesSelection,
  baggedCopyAnchor,
  parseItemCopyAnchor,
} from '../src/sim/item_copy_anchor';
import type { InvSlot } from '../src/sim/types';

/** A bag with two `ring` copies around an unrelated stack, so an ordinal and an
 *  index are deliberately different numbers. */
function bags(): InvSlot[] {
  return [
    { itemId: 'ring', count: 1, instance: { enchant: { id: 'e' } } },
    { itemId: 'cloth', count: 5 },
    { itemId: 'ring', count: 1 },
  ] as unknown as InvSlot[];
}

describe('baggedCopyAnchor (the sender half)', () => {
  it('counts same-id siblings in bag order, not raw indices', () => {
    const inv = bags();
    expect(baggedCopyAnchor(inv, 'ring', 0)).toEqual({ ordinal: 0, count: 2 });
    // Index 2, ordinal 1: the unrelated stack between them is not a sibling.
    expect(baggedCopyAnchor(inv, 'ring', 2)).toEqual({ ordinal: 1, count: 2 });
  });

  it('answers null when the index names no live cell of that id', () => {
    const inv = bags();
    expect(baggedCopyAnchor(inv, 'ring', 1)).toBeNull(); // wrong id
    expect(baggedCopyAnchor(inv, 'ring', 99)).toBeNull(); // out of range
    expect(baggedCopyAnchor(inv, 'ring', -1)).toBeNull();
    expect(baggedCopyAnchor(inv, 'ring', 0.5)).toBeNull();
    expect(baggedCopyAnchor([], 'ring', 0)).toBeNull();
  });
});

describe('anchorMatchesSelection (the receiver half)', () => {
  it('accepts when NO anchor was sent, so nothing about the old path changes', () => {
    // The load-bearing default: an older client, and every command that never
    // gained an anchor, behave exactly as they did.
    expect(anchorMatchesSelection(bags(), 'ring', 0, undefined)).toBe(true);
    expect(anchorMatchesSelection(bags(), 'ring', undefined, { ordinal: 9, count: 9 })).toBe(true);
  });

  it('accepts an anchor that still describes the named slot', () => {
    expect(anchorMatchesSelection(bags(), 'ring', 2, { ordinal: 1, count: 2 })).toBe(true);
  });

  it('REFUSES when a splice slid a different sibling onto the clicked index', () => {
    // THE case. The player clicked index 2 (the plain ring, ordinal 1 of 2).
    // Between the click and the command landing, the enchanted copy at index 0
    // left, so index 2 no longer exists and index 1 is now the plain ring...
    const before = bags();
    const anchor = baggedCopyAnchor(before, 'ring', 2);
    expect(anchor).toEqual({ ordinal: 1, count: 2 });
    const after = [
      { itemId: 'cloth', count: 5 },
      { itemId: 'ring', count: 1 },
    ] as InvSlot[];
    // ...so the index-only check would accept index 1 (it does hold a `ring`),
    // while the anchor sees one sibling where the sender saw two and refuses.
    expect(after[1].itemId).toBe('ring');
    expect(anchorMatchesSelection(after, 'ring', 1, anchor ?? undefined)).toBe(false);
  });

  it('REFUSES a same-count shift that lands on the other sibling', () => {
    // The count is unchanged (still two rings) but the ORDINAL at that index
    // moved: the cell now holds the other copy.
    const anchor = { ordinal: 1, count: 2 };
    const shifted = [
      { itemId: 'ring', count: 1 },
      { itemId: 'ring', count: 1 },
    ] as InvSlot[];
    expect(anchorMatchesSelection(shifted, 'ring', 0, anchor)).toBe(false);
    expect(anchorMatchesSelection(shifted, 'ring', 1, anchor)).toBe(true);
  });

  it('REFUSES when the named slot holds nothing of that id at all', () => {
    expect(anchorMatchesSelection(bags(), 'ring', 1, { ordinal: 0, count: 2 })).toBe(false);
    expect(anchorMatchesSelection([], 'ring', 0, { ordinal: 0, count: 1 })).toBe(false);
  });
});

describe('parseItemCopyAnchor (the wire boundary)', () => {
  it('reads a well-formed pair', () => {
    expect(parseItemCopyAnchor(1, 3)).toEqual({ ordinal: 1, count: 3 });
    expect(parseItemCopyAnchor(0, 1)).toEqual({ ordinal: 0, count: 1 });
  });

  it('drops anything that cannot describe a bag, rather than normalizing it', () => {
    // The dispatch-layer laundering rule: never turn a bad value into a
    // plausible one. A dropped anchor degrades to the pre-anchor behavior,
    // which is safe, because the index check the command already runs stands.
    for (const [ord, n] of [
      [undefined, 2],
      [1, undefined],
      ['1', 2],
      [1, '2'],
      [1.5, 3],
      [1, 3.5],
      [-1, 3],
      [0, 0],
      [0, -1],
      [3, 3], // ordinal outside the count
      [Number.NaN, 2],
      [1, Number.POSITIVE_INFINITY],
    ] as [unknown, unknown][]) {
      expect(parseItemCopyAnchor(ord, n), `${String(ord)}/${String(n)}`).toBeUndefined();
    }
  });
});

describe('the sender and receiver halves agree over a whole bag', () => {
  it('every anchorable slot round-trips: build it, then match it', () => {
    // Non-vacuous by its own floor, and it covers the ordinal-vs-index gap at
    // every position rather than one hand-picked cell.
    const inv = [
      { itemId: 'ring', count: 1 },
      { itemId: 'cloth', count: 5 },
      { itemId: 'ring', count: 1 },
      { itemId: 'ring', count: 1 },
    ] as unknown as InvSlot[];
    let checked = 0;
    for (let i = 0; i < inv.length; i++) {
      const id = inv[i].itemId;
      const anchor = baggedCopyAnchor(inv, id, i);
      expect(anchor, `slot ${i}`).not.toBeNull();
      expect(anchorMatchesSelection(inv, id, i, anchor ?? undefined), `slot ${i}`).toBe(true);
      // And it does NOT match any OTHER slot of the same id.
      for (let j = 0; j < inv.length; j++) {
        if (j === i || inv[j].itemId !== id) continue;
        expect(anchorMatchesSelection(inv, id, j, anchor ?? undefined), `${i} vs ${j}`).toBe(false);
      }
      checked++;
    }
    expect(checked).toBe(inv.length);
  });
});
