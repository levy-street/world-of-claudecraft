// The shared unknown-id predicate (src/ui/known_item.ts): the R34 fallback
// family branches on THIS, not on bare table truthiness, because the content
// tables are prototype-bearing Records. These arms are what keep a
// prototype-key id ('constructor' is a truthy FUNCTION, '__proto__' a truthy
// object) on the unknown side of every guarded surface.
import { describe, expect, it } from 'vitest';
import { ITEMS, QUESTS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { knownItemDef, ownEntry } from '../src/ui/known_item';

const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];

describe('knownItemDef', () => {
  it('resolves a real shipped id to its def', () => {
    // Reference identity, not a field self-comparison: the claim is that the
    // predicate returns THE table row, undefined being the failure shape.
    expect(knownItemDef(ITEMS, 'copper_ore')).toBe(ITEMS.copper_ore);
  });

  it('refuses every prototype key and a plain unknown id', () => {
    for (const key of PROTO_KEYS) {
      expect(knownItemDef(ITEMS, key), key).toBeUndefined();
    }
    expect(knownItemDef(ITEMS, 'ghost_item_from_v33')).toBeUndefined();
  });

  it('refuses an own-property row with no string name (the shape half)', () => {
    const table = { broken: {} as ItemDef, fine: { name: 'Fine' } as ItemDef };
    expect(knownItemDef(table, 'broken')).toBeUndefined();
    expect(knownItemDef(table, 'fine')?.name).toBe('Fine');
  });
});

describe('ownEntry', () => {
  it('resolves own rows and refuses prototype keys', () => {
    expect(ownEntry(QUESTS, Object.keys(QUESTS)[0])).toBeDefined();
    for (const key of PROTO_KEYS) {
      expect(ownEntry(QUESTS, key), key).toBeUndefined();
    }
  });
});
