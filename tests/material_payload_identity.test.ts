// The canonical payload identity of a NORMALIZED material slot: what belongs in
// the key, what is deliberately excluded, and the one equivalence that has to
// hold with item_instance_merge (two payloads share a key exactly when they
// compare equal there).

import { describe, expect, it } from 'vitest';
import { itemInstancePayloadsEqual } from '../src/sim/item_instance_merge';
import { cloneMaterialPayload, materialPayloadKey } from '../src/sim/material_payload_identity';
import type { ItemInstancePayload } from '../src/sim/types';

/** A payload literal including fields this model has never heard of. */
const payload = (raw: Record<string, unknown>): ItemInstancePayload => raw as ItemInstancePayload;

/** The persistence path: JSON.parse is the only way an OWN '__proto__' key is
 *  minted, and a JSONB round trip really produces one. */
const parsed = (json: string): ItemInstancePayload => JSON.parse(json) as ItemInstancePayload;

describe('materialPayloadKey identity dimensions', () => {
  it('separates item ids', () => {
    expect(materialPayloadKey({ itemId: 'ore' })).not.toBe(materialPayloadKey({ itemId: 'herb' }));
  });

  it('is key-order independent for nested objects', () => {
    const a = payload({ rolled: { stats: { agi: 2, str: 1 } }, boundTo: 7 });
    const b = payload({ boundTo: 7, rolled: { stats: { str: 1, agi: 2 } } });

    expect(materialPayloadKey({ itemId: 'ore', instance: a })).toBe(
      materialPayloadKey({ itemId: 'ore', instance: b }),
    );
  });

  it('preserves array order', () => {
    const a = payload({ tags: ['x', 'y'] });
    const b = payload({ tags: ['y', 'x'] });

    expect(materialPayloadKey({ itemId: 'ore', instance: a })).not.toBe(
      materialPayloadKey({ itemId: 'ore', instance: b }),
    );
  });

  it('includes unknown persisted payload properties', () => {
    const a = payload({ harvestNote: { season: 3 } });
    const b = payload({ harvestNote: { season: 4 } });

    expect(materialPayloadKey({ itemId: 'ore', instance: a })).not.toBe(
      materialPayloadKey({ itemId: 'ore', instance: b }),
    );
    expect(materialPayloadKey({ itemId: 'ore', instance: a })).not.toBe(
      materialPayloadKey({ itemId: 'ore' }),
    );
  });

  it('treats an explicitly undefined key as absent', () => {
    const a = payload({ boundTo: 7, enchant: undefined });
    const b = payload({ boundTo: 7 });

    expect(materialPayloadKey({ itemId: 'ore', instance: a })).toBe(
      materialPayloadKey({ itemId: 'ore', instance: b }),
    );
  });

  it('keeps no payload distinct from an empty payload', () => {
    expect(materialPayloadKey({ itemId: 'ore', instance: payload({}) })).not.toBe(
      materialPayloadKey({ itemId: 'ore' }),
    );
  });

  it('keeps the slot craftedRecipeId a separate channel from the payload one', () => {
    const onSlot = materialPayloadKey({ itemId: 'ore', craftedRecipeId: 'r1' });
    const onPayload = materialPayloadKey({
      itemId: 'ore',
      instance: payload({ craftedRecipeId: 'r1' }),
    });

    expect(onSlot).not.toBe(onPayload);
    expect(onSlot).not.toBe(materialPayloadKey({ itemId: 'ore' }));
    expect(onSlot).not.toBe(materialPayloadKey({ itemId: 'ore', craftedRecipeId: 'r2' }));
  });

  it('distinguishes an empty-string craftedRecipeId from an absent one', () => {
    expect(materialPayloadKey({ itemId: 'ore', craftedRecipeId: '' })).not.toBe(
      materialPayloadKey({ itemId: 'ore' }),
    );
  });

  it('is unambiguous across the itemId / craftedRecipeId boundary', () => {
    expect(materialPayloadKey({ itemId: 'ore', craftedRecipeId: 'x' })).not.toBe(
      materialPayloadKey({ itemId: 'orex' }),
    );
    expect(materialPayloadKey({ itemId: 'ab', craftedRecipeId: 'c' })).not.toBe(
      materialPayloadKey({ itemId: 'a', craftedRecipeId: 'bc' }),
    );
  });

  it('does not confuse a string value with a number of the same spelling', () => {
    expect(materialPayloadKey({ itemId: 'ore', instance: payload({ n: 7 }) })).not.toBe(
      materialPayloadKey({ itemId: 'ore', instance: payload({ n: '7' }) }),
    );
    expect(materialPayloadKey({ itemId: 'ore', instance: payload({ n: null }) })).not.toBe(
      materialPayloadKey({ itemId: 'ore', instance: payload({ n: false }) }),
    );
  });

  it('reads an own __proto__ key as an ordinary identity term', () => {
    const instance = parsed('{"__proto__":{"a":1}}');
    const tainted = materialPayloadKey({ itemId: 'ore', instance });

    expect(tainted).not.toBe(materialPayloadKey({ itemId: 'ore' }));
    expect(tainted).not.toBe(
      materialPayloadKey({ itemId: 'ore', instance: parsed('{"__proto__":{"a":2}}') }),
    );
    expect(tainted).toBe(
      materialPayloadKey({ itemId: 'ore', instance: parsed('{"__proto__":{"a":1}}') }),
    );
  });

  it('excludes count, composition, manual separation and the bag cell', () => {
    // Both objects are whole slot shapes; only the excluded dimensions differ.
    const lean = { itemId: 'ore', count: 1, slot: 0 };
    const rich = {
      itemId: 'ore',
      count: 42,
      slot: 17,
      materialSeparated: true as const,
      materialSources: [{ source: { signer: 'Ayla' }, count: 42 }],
    };

    expect(materialPayloadKey(rich)).toBe(materialPayloadKey(lean));
  });
});

describe('materialPayloadKey agrees with item_instance_merge equality', () => {
  const pairs: { name: string; a: ItemInstancePayload; b: ItemInstancePayload }[] = [
    { name: 'reordered keys', a: payload({ x: 1, y: 2 }), b: payload({ y: 2, x: 1 }) },
    { name: 'explicit undefined', a: payload({ x: 1, y: undefined }), b: payload({ x: 1 }) },
    {
      name: 'nested reorder',
      a: payload({ o: { a: 1, b: 2 } }),
      b: payload({ o: { b: 2, a: 1 } }),
    },
    { name: 'differing value', a: payload({ x: 1 }), b: payload({ x: 2 }) },
    { name: 'extra field', a: payload({ x: 1, z: 3 }), b: payload({ x: 1 }) },
    { name: 'array order', a: payload({ a: [1, 2] }), b: payload({ a: [2, 1] }) },
    { name: 'array equal', a: payload({ a: [1, 2] }), b: payload({ a: [1, 2] }) },
    { name: 'null vs absent', a: payload({ x: null }), b: payload({}) },
    { name: 'own __proto__ vs another key', a: parsed('{"__proto__":{}}'), b: payload({ z: {} }) },
    { name: 'own __proto__ pair', a: parsed('{"__proto__":{}}'), b: parsed('{"__proto__":{}}') },
    {
      name: 'own __proto__ values differ',
      a: parsed('{"__proto__":{"a":1}}'),
      b: parsed('{"__proto__":{"a":2}}'),
    },
    { name: 'string vs number', a: payload({ x: '1' }), b: payload({ x: 1 }) },
    {
      name: 'deep equal',
      a: payload({ o: { p: [{ q: true }] } }),
      b: payload({ o: { p: [{ q: true }] } }),
    },
  ];

  for (const { name, a, b } of pairs) {
    it(`matches structural equality: ${name}`, () => {
      const sameKey =
        materialPayloadKey({ itemId: 'ore', instance: a }) ===
        materialPayloadKey({ itemId: 'ore', instance: b });

      expect(sameKey).toBe(itemInstancePayloadsEqual(a, b));
    });
  }
});

describe('cloneMaterialPayload', () => {
  it('deep copies known and unknown payload data', () => {
    const source = payload({
      rolled: { stats: { str: 1 } },
      harvestNote: { seasons: [1, 2], deep: { flag: true } },
    });

    const copy = cloneMaterialPayload(source) as Record<string, unknown>;
    const note = copy.harvestNote as { seasons: number[]; deep: { flag: boolean } };
    note.seasons.push(3);
    note.deep.flag = false;
    (copy.rolled as { stats: Record<string, number> }).stats.str = 99;

    expect(source).toEqual(
      payload({
        rolled: { stats: { str: 1 } },
        harvestNote: { seasons: [1, 2], deep: { flag: true } },
      }),
    );
    expect(materialPayloadKey({ itemId: 'ore', instance: source })).not.toBe(
      materialPayloadKey({ itemId: 'ore', instance: copy as ItemInstancePayload }),
    );
  });

  it('keeps an own __proto__ key own, at the top level and nested', () => {
    // `out[key] = ...` would hit Object.prototype's accessor here: the key would
    // vanish from the copy and take the copy's prototype with it.
    const source = parsed('{"__proto__":{"tainted":1},"rolled":{"__proto__":{"deep":2}}}');
    const copy = cloneMaterialPayload(source) as Record<string, unknown>;

    expect(Object.keys(copy)).toEqual(['__proto__', 'rolled']);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(copy, '__proto__')?.value).toEqual({ tainted: 1 });

    const nested = copy.rolled as Record<string, unknown>;
    expect(Object.hasOwn(nested, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(nested, '__proto__')?.value).toEqual({ deep: 2 });

    // Nothing inherited rides along, and the copy is detached from the source.
    expect(Object.keys(copy)).not.toContain('constructor');
    const carried = Object.getOwnPropertyDescriptor(copy, '__proto__')?.value as {
      tainted: number;
    };
    carried.tainted = 9;
    expect(Object.getOwnPropertyDescriptor(source, '__proto__')?.value).toEqual({ tainted: 1 });
  });

  it('keeps arrays arrays and preserves null', () => {
    const clone = cloneMaterialPayload(payload({ list: [1, null, { a: 'b' }] }));
    const copy = clone as Record<string, unknown>;

    expect(Array.isArray(copy.list)).toBe(true);
    expect(copy.list).toEqual([1, null, { a: 'b' }]);
  });
});
