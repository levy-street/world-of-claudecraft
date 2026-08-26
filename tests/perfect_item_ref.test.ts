// The perfect_item dispatch parse (server/perfect_item_ref.ts): the pure
// core game.ts's case consumes. The wire round trip (a real GameServer over
// the real dispatch) lives in tests/perfecting_wire.test.ts; this pins the
// decision table directly, shape by shape, so the drop rules are readable
// without a server.
import { describe, expect, it } from 'vitest';
import { parsePerfectItemRef } from '../server/perfect_item_ref';
import { MAX_INSTANCE_STRING_LENGTH } from '../src/sim/item_instance_load';

const ITEM = 'wyrmfall_pendant';

describe('parsePerfectItemRef', () => {
  it('a real equipment key rides as a worn ref, alone', () => {
    expect(parsePerfectItemRef({ slot: 'neck' })).toEqual({ slot: 'neck' });
    expect(parsePerfectItemRef({ slot: 'ring1' })).toEqual({ slot: 'ring1' });
  });

  it('a non-negative integer cell beside a bounded item id rides as a bagged ref', () => {
    expect(parsePerfectItemRef({ bag: 0, item: ITEM })).toEqual({ bag: 0, itemId: ITEM });
    expect(parsePerfectItemRef({ bag: 7, item: 'x'.repeat(MAX_INSTANCE_STRING_LENGTH) })).toEqual({
      bag: 7,
      itemId: 'x'.repeat(MAX_INSTANCE_STRING_LENGTH),
    });
  });

  it('drops both-usable, neither, and every malformed single token', () => {
    for (const msg of [
      { slot: 'neck', bag: 0, item: ITEM }, // both usable: never a guess
      {}, // neither
      { bag: 0 }, // a cell with no item id is not a bagged ref
      { bag: 0, item: 7 }, // a non-string item id
      { bag: 0, item: '' }, // an empty item id
      { bag: 0, item: 'x'.repeat(MAX_INSTANCE_STRING_LENGTH + 1) }, // over the ceiling
      { bag: 1.5, item: ITEM }, // non-integer cell
      { bag: -1, item: ITEM }, // negative cell
      { bag: '0', item: ITEM }, // a numeric STRING is not a cell
      { bag: Number.NaN, item: ITEM },
      { slot: 'hat' }, // bogus slot string
      { slot: 3 }, // a number is not a slot
      { slot: '__proto__' }, // a prototype key is not a slot
      { slot: 'hat', bag: 'x', item: ITEM }, // both malformed
    ]) {
      expect(parsePerfectItemRef(msg as Record<string, unknown>), JSON.stringify(msg)).toBeNull();
    }
  });

  it('one malformed token beside one usable one falls to the usable one (the apply_enchant precedent)', () => {
    expect(parsePerfectItemRef({ slot: 'hat', bag: 0, item: ITEM })).toEqual({
      bag: 0,
      itemId: ITEM,
    });
    expect(parsePerfectItemRef({ slot: 'neck', bag: 'x', item: ITEM })).toEqual({ slot: 'neck' });
    expect(parsePerfectItemRef({ slot: 'neck', bag: 0 })).toEqual({ slot: 'neck' });
  });
});
