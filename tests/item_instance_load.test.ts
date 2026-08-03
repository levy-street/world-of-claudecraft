// The load-side instance-payload bound (src/sim/item_instance_load.ts),
// exercised directly. Six load sites share this one function (equipment,
// bags, vendor buyback, bank, and the two escrow books via sanitizeEscrowSlot
// and the market listing arm), so its arms are pinned HERE once rather than
// once per fixture; tests/professions_blob_growth.test.ts proves the four
// character containers route through it on a real save, and the
// mail/market instance suites prove the two books do.
//
// The load-bearing claim is IDENTITY ON LEGAL DATA: a payload no rule
// touches must come back the same object, with the same key order, and
// serialize to the same bytes. Everything else in this file is a drop arm.
import { describe, expect, it, vi } from 'vitest';
import {
  boundCraftedRecipeIdOnLoad,
  MAX_INSTANCE_PAYLOAD_KEYS,
  MAX_INSTANCE_STRING_LENGTH,
  MAX_INSTANCE_SUBTREE_JSON_LENGTH,
  sanitizeItemInstancePayloadOnLoad,
  warnDroppedInstanceKeys,
} from '../src/sim/item_instance_load';
import { isLegalCrafterName, MAX_CRAFTED_BY_LENGTH } from '../src/sim/professions/tools';

/** A payload carrying one legal value of every declared field, in the
 *  declaration order of ItemInstancePayload. */
const legalPayload = () => ({
  signer: 'Loggerholm',
  charges: { gatherers_cache: 3 },
  rolled: { quality: 'rare', stats: { str: 2, sta: 1 }, masterwork: true },
  enchant: 'enchant_weapon_might',
  craftedRecipeId: 'recipe_tough_jerky',
  boundTo: 41,
  bindOnTrade: true,
});

const atLimit = 'e'.repeat(MAX_INSTANCE_STRING_LENGTH);
const overLimit = 'e'.repeat(MAX_INSTANCE_STRING_LENGTH + 1);

describe('sanitizeItemInstancePayloadOnLoad: identity on legal data', () => {
  it('returns the SAME object, key order intact, serializing to the same bytes', () => {
    const payload = legalPayload();
    const before = JSON.stringify(payload);
    const out = sanitizeItemInstancePayloadOnLoad(payload);
    expect(out.dropped).toEqual([]);
    // The same object, not a copy: a rebuild would re-order keys, and the
    // save path is JSON, where key order is byte-visible.
    expect(out.payload).toBe(payload);
    expect(JSON.stringify(out.payload)).toBe(before);
    expect(Object.keys(out.payload ?? {})).toEqual([
      'signer',
      'charges',
      'rolled',
      'enchant',
      'craftedRecipeId',
      'boundTo',
      'bindOnTrade',
    ]);
    expect(out.payload).toEqual(legalPayload());
  });

  it('keeps unknown keys inside the bounds (the forward-compatibility arm)', () => {
    // Payload fields accrete over releases and the merge predicate compares
    // every present key, so silently dropping a field this binary does not
    // know about would strip identity off a live copy. A whitelist here
    // would fail this test, which is exactly why there is none.
    const payload = { futureField: 'abc', futureRecord: { nested: 'x' }, futureFlag: false };
    const out = sanitizeItemInstancePayloadOnLoad(payload);
    expect(out.dropped).toEqual([]);
    expect(out.payload).toEqual({
      futureField: 'abc',
      futureRecord: { nested: 'x' },
      futureFlag: false,
    });
  });
});

describe('sanitizeItemInstancePayloadOnLoad: the string ceiling', () => {
  it('keeps a string AT the ceiling and drops one past it, alone, on any key', () => {
    const kept = sanitizeItemInstancePayloadOnLoad({ enchant: atLimit, boundTo: 7 });
    expect(kept.dropped).toEqual([]);
    expect(kept.payload?.enchant).toBe(atLimit);
    const dropped = sanitizeItemInstancePayloadOnLoad({
      enchant: overLimit,
      signer: 'Loggerholm',
      boundTo: 7,
    });
    expect(dropped.dropped).toEqual(['enchant']);
    // ALONE: the oversized key is gone and everything beside it survived.
    expect('enchant' in (dropped.payload ?? {})).toBe(false);
    expect(dropped.payload).toEqual({ signer: 'Loggerholm', boundTo: 7 });
    // An UNKNOWN key takes the same ceiling: the bound is on the shape, not
    // on a list of names.
    const unknownKey = sanitizeItemInstancePayloadOnLoad({ futureField: overLimit, boundTo: 7 });
    expect(unknownKey.dropped).toEqual(['futureField']);
    expect(unknownKey.payload).toEqual({ boundTo: 7 });
    // The pin is on the constant itself, so the arms above cannot silently
    // follow a retuned ceiling.
    expect(MAX_INSTANCE_STRING_LENGTH).toBe(64);
  });

  it('applies the same ceiling one level into rolled and charges, per sub-key', () => {
    const out = sanitizeItemInstancePayloadOnLoad({
      rolled: { quality: overLimit, stats: { str: 2 }, masterwork: true },
      charges: { legal: 3, junk: overLimit, keptAtLimit: atLimit },
      boundTo: 7,
    });
    expect(out.dropped).toEqual(['rolled.quality', 'charges.junk']);
    // The sub-objects survive with their legal keys: a junk sub-key never
    // takes the payload, nor its own parent, with it.
    expect(out.payload).toEqual({
      rolled: { stats: { str: 2 }, masterwork: true },
      charges: { legal: 3, keptAtLimit: atLimit },
      boundTo: 7,
    });
    // Non-string sub-values are never touched by the string rule.
    expect(out.payload?.rolled?.stats).toEqual({ str: 2 });
  });

  it('names every path it removed, in key order, over a mixed-junk payload', () => {
    const out = sanitizeItemInstancePayloadOnLoad({
      signer: 41,
      enchant: overLimit,
      rolled: { quality: overLimit },
      boundTo: 7,
    });
    expect(out.dropped).toEqual(['signer', 'enchant', 'rolled.quality']);
    expect(out.payload).toEqual({ rolled: {}, boundTo: 7 });
  });
});

describe('sanitizeItemInstancePayloadOnLoad: the signer name shape', () => {
  const load = (signer: unknown) =>
    sanitizeItemInstancePayloadOnLoad({ signer, enchant: 'enchant_weapon_might' });

  it('keeps a name AT the length ceiling and drops one past it, alone', () => {
    const legal = 'A'.repeat(MAX_CRAFTED_BY_LENGTH);
    expect(load(legal).payload?.signer).toBe(legal);
    expect(load(legal).dropped).toEqual([]);
    const over = load('A'.repeat(MAX_CRAFTED_BY_LENGTH + 1));
    expect(over.dropped).toEqual(['signer']);
    expect('signer' in (over.payload ?? {})).toBe(false);
    // ALONE: the rest of the payload is untouched.
    expect(over.payload).toEqual({ enchant: 'enchant_weapon_might' });
    expect(MAX_CRAFTED_BY_LENGTH).toBe(16);
  });

  it('drops a name inside the length ceiling but outside the ASCII alphabet', () => {
    // The case a length-only test lets through, and the reason the char-code
    // half exists: 16 code units of multi-byte text weigh several times a
    // real name once JSON escapes them, and no account can hold one.
    // Spelled with char codes rather than literal bytes: this repo's source
    // is ASCII, and a literal would be invisible in a diff.
    const accented = 'A'.repeat(15) + String.fromCharCode(0xe9);
    expect(accented).toHaveLength(MAX_CRAFTED_BY_LENGTH);
    expect(load(accented).dropped).toEqual(['signer']);
    // A control character is outside the alphabet in the other direction.
    expect(load('Log\nherholm').dropped).toEqual(['signer']);
    // The predicate itself, at both boundaries of the printable range.
    expect(isLegalCrafterName(' ')).toBe(true); // char code 32
    expect(isLegalCrafterName('~')).toBe(true); // char code 126
    expect(isLegalCrafterName(String.fromCharCode(31))).toBe(false); // one below
    expect(isLegalCrafterName(String.fromCharCode(127))).toBe(false); // one above
  });

  it('drops every non-string signer', () => {
    for (const bad of [41, null, true, { name: 'Elsewhere' }, ['Elsewhere']]) {
      expect(load(bad).dropped, `signer ${JSON.stringify(bad)}`).toEqual(['signer']);
      expect(load(bad).payload).toEqual({ enchant: 'enchant_weapon_might' });
    }
  });
});

describe('sanitizeItemInstancePayloadOnLoad: whole-payload drops', () => {
  it('keeps a payload AT the key ceiling and drops one past it as corrupt', () => {
    const keys = (n: number): Record<string, number> => {
      const out: Record<string, number> = {};
      for (let i = 0; i < n; i++) out[`k${i}`] = i;
      return out;
    };
    const atCeiling = sanitizeItemInstancePayloadOnLoad(keys(MAX_INSTANCE_PAYLOAD_KEYS));
    expect(atCeiling.dropped).toEqual([]);
    expect(Object.keys(atCeiling.payload ?? {})).toHaveLength(MAX_INSTANCE_PAYLOAD_KEYS);
    const past = sanitizeItemInstancePayloadOnLoad(keys(MAX_INSTANCE_PAYLOAD_KEYS + 1));
    expect(past.payload).toBeUndefined();
    expect(past.dropped).toEqual(['payload']);
    expect(MAX_INSTANCE_PAYLOAD_KEYS).toBe(24);
  });

  it('drops a payload left with no keys at all, and an already-empty one', () => {
    // An empty {} payload is worse than none: it can never stack with a
    // plain stack of the same item again, so the row is stranded forever.
    const emptied = sanitizeItemInstancePayloadOnLoad({
      signer: 'A'.repeat(MAX_CRAFTED_BY_LENGTH + 1),
    });
    expect(emptied.payload).toBeUndefined();
    expect(emptied.dropped).toEqual(['signer', 'payload']);
    const empty = sanitizeItemInstancePayloadOnLoad({});
    expect(empty.payload).toBeUndefined();
    expect(empty.dropped).toEqual(['payload']);
  });

  it('drops anything that is not a plain object, arrays included', () => {
    for (const bad of [null, undefined, 'payload', 42, true, ['signer'], []]) {
      const out = sanitizeItemInstancePayloadOnLoad(bad);
      expect(out.payload, `input ${JSON.stringify(bad)}`).toBeUndefined();
      expect(out.dropped).toEqual(['payload']);
    }
  });

  it('drops a clone-mangled array or string wearing an object costume', () => {
    // Every call site deep-clones the stored value first, and `{ ...src }`
    // turns an array or a string into an object of decimal-numeric keys, so
    // the plain-object arm above never sees the original shape (the
    // fix-round review measured [1,2,3] surviving as {"0":1,"1":2,"2":3}).
    for (const mangled of [{ 0: 1, 1: 2, 2: 3 }, { 0: 'a' }, { 0: 'a', 1: 'b', 10: 'c' }]) {
      const out = sanitizeItemInstancePayloadOnLoad(mangled);
      expect(out.payload, `input ${JSON.stringify(mangled)}`).toBeUndefined();
      expect(out.dropped).toEqual(['payload']);
    }
    // A single numeric key beside a legal one is NOT the mangled shape: only
    // an ALL-numeric key set drops, so a future payload never loses a legal
    // field to this arm.
    const mixed = sanitizeItemInstancePayloadOnLoad({ 0: 'a', boundTo: 7 });
    expect(mixed.payload).toEqual({ 0: 'a', boundTo: 7 });
    expect(mixed.dropped).toEqual([]);
  });

  it('never descends into rift: its strings are the progression rebuild business', () => {
    // rift.sourceEventId is legitimately up to 128 characters and is
    // validated by sanitizeRiftGearInstance, so the generic 64-char rule
    // must NOT reach inside rift (adding 'rift' to the scanned sub-objects
    // would delete legal data; this pin holds that doctrine).
    const longEventId = 'e'.repeat(120);
    const out = sanitizeItemInstancePayloadOnLoad({
      rift: { tier: 'C', upgradeLevel: 1, sourceEventId: longEventId, gems: [] },
      boundTo: 3,
    });
    expect(out.dropped).toEqual([]);
    const rift = out.payload?.rift as { sourceEventId?: string } | undefined;
    expect(rift?.sourceEventId).toBe(longEventId);
  });
});

describe('warnDroppedInstanceKeys', () => {
  it('says nothing for a clean load and names owner plus paths for a junk one', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      warnDroppedInstanceKeys('Loggerholm', []);
      expect(spy).not.toHaveBeenCalled();
      warnDroppedInstanceKeys('Loggerholm', ['signer', 'rolled.quality']);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(
        '[load] dropped item-instance junk for Loggerholm: signer,rolled.quality',
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the whole-branch tightening: key names, subtree size, and depth', () => {
  it('pins the subtree ceiling literal', () => {
    expect(MAX_INSTANCE_SUBTREE_JSON_LENGTH).toBe(1024);
  });

  it('an overlong TOP-LEVEL key drops with its value, under a fixed log label', () => {
    // The key-count arm alone would pass ONE megabyte-long key: the key-name
    // bound closes that, and the log label is fixed so a corrupt key cannot
    // ride into the dev channel as unbounded bytes either.
    const { payload, dropped } = sanitizeItemInstancePayloadOnLoad({
      signer: 'Ayla',
      ['k'.repeat(MAX_INSTANCE_STRING_LENGTH + 1)]: 'short',
    });
    expect(payload).toEqual({ signer: 'Ayla' });
    expect(dropped).toEqual(['(overlong-key)']);
  });

  it('an overlong key INSIDE a scanned sub-object drops the same way', () => {
    const { payload, dropped } = sanitizeItemInstancePayloadOnLoad({
      rolled: { quality: 'fine', ['k'.repeat(MAX_INSTANCE_STRING_LENGTH + 1)]: 'short' },
    });
    expect(payload).toEqual({ rolled: { quality: 'fine' } });
    expect(dropped).toEqual(['rolled.(overlong-key)']);
  });

  it('a legal rolled.stats record survives byte-identical', () => {
    const legal = { rolled: { quality: 'fine', stats: { agi: 2, sta: 1 } } };
    const { payload, dropped } = sanitizeItemInstancePayloadOnLoad(structuredClone(legal));
    expect(payload).toEqual(legal);
    expect(dropped).toEqual([]);
  });

  it('an oversized rolled.stats subtree drops whole at the JSON ceiling', () => {
    const fat: Record<string, string> = {};
    for (let i = 0; i < 40; i++) fat[`s${i}`] = 'v'.repeat(30);
    const { payload, dropped } = sanitizeItemInstancePayloadOnLoad({
      rolled: { quality: 'fine', stats: fat },
    });
    expect(payload).toEqual({ rolled: { quality: 'fine' } });
    expect(dropped).toEqual(['rolled.stats']);
  });

  it('a FLAT wide sub-object cannot smuggle bytes either (the fix-round counterexamples)', () => {
    // Both empirically-verified bypasses of the first tightening: many short
    // keys with short string values (188 KB survived whole), and many small
    // object values each under the subtree ceiling (394 KB survived whole).
    // The sub-object own-key ceiling closes both: width drops whole, the
    // top-level key-count doctrine one level down.
    const wideStrings: Record<string, string> = {};
    for (let i = 0; i < 10_000; i++) wideStrings[`k${i}`] = 'abcdefgh';
    const a = sanitizeItemInstancePayloadOnLoad({ signer: 'Ayla', rolled: wideStrings });
    expect(a.payload).toEqual({ signer: 'Ayla' });
    expect(a.dropped).toEqual(['rolled']);

    const wideObjects: Record<string, { pad: string }> = {};
    for (let i = 0; i < 5_000; i++) wideObjects[`k${i}`] = { pad: 'x'.repeat(60) };
    const b = sanitizeItemInstancePayloadOnLoad({ charges: wideObjects });
    expect(b.payload).toBeUndefined();
    expect(b.dropped).toEqual(['charges', 'payload']);
  });

  it('a nesting bomb cannot smuggle bytes through depth the flat rules never reach', () => {
    // Each level individually passes the key and string arms; the subtree
    // ceiling measures the serialized whole, which is what the save path
    // would actually write.
    let bomb: Record<string, unknown> = { leaf: 'x'.repeat(60) };
    for (let i = 0; i < 40; i++) bomb = { [`n${i}`]: bomb, pad: 'y'.repeat(50) };
    const { payload, dropped } = sanitizeItemInstancePayloadOnLoad({
      charges: { current: bomb },
    });
    // Drop-only semantics: the sub key goes, its emptied parent survives
    // (the same residue the string arm always left), and the bytes are gone.
    expect(payload).toEqual({ charges: {} });
    expect(dropped).toEqual(['charges.current']);
  });
});

describe('boundCraftedRecipeIdOnLoad: the slot-level sibling bound', () => {
  it('keeps a legal marker, drops an oversized or non-string one, and reports the path', () => {
    const dropped: string[] = [];
    const legal = { itemId: 'hide', craftedRecipeId: 'recipe_prowlhide_jerkin' };
    boundCraftedRecipeIdOnLoad(legal, dropped, 'bag');
    expect(legal.craftedRecipeId).toBe('recipe_prowlhide_jerkin');
    expect(dropped).toEqual([]);
    const over = { itemId: 'hide', craftedRecipeId: 'r'.repeat(65) };
    boundCraftedRecipeIdOnLoad(over, dropped, 'bag');
    expect('craftedRecipeId' in over).toBe(false);
    expect(dropped).toEqual(['bag.hide.craftedRecipeId']);
    const nonString = { itemId: 'hide', craftedRecipeId: 41 as unknown };
    boundCraftedRecipeIdOnLoad(nonString, dropped, 'buyback');
    expect('craftedRecipeId' in nonString).toBe(false);
    expect(dropped).toEqual(['bag.hide.craftedRecipeId', 'buyback.hide.craftedRecipeId']);
  });
});
