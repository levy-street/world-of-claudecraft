// The perfect_item dispatch parse (server/perfect_item_ref.ts): the pure
// core game.ts's case consumes. The wire round trip (a real GameServer over
// the real dispatch) lives in tests/perfecting_wire.test.ts; this pins the
// decision table directly, shape by shape, so the drop rules are readable
// without a server.
import { describe, expect, it, vi } from 'vitest';
import {
  parsePerfectItemName,
  parsePerfectItemRef,
  resolvePerfectItemName,
} from '../server/perfect_item_ref';
import { MAX_INSTANCE_STRING_LENGTH } from '../src/sim/item_instance_load';
import { MAX_LEGENDARY_NAME_LENGTH } from '../src/sim/professions/legendary_name';

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

  it('a huge integer cell parses and is left to the sim, which denies it out of range', () => {
    // The parser deliberately carries no upper bound: the sim resolves through
    // selectedInventorySlot, which refuses any index at or past
    // inventory.length with no allocation and no draw, so a 2^53 cell is a
    // clean noItem denial rather than a parse rule the two layers could
    // disagree on. Pinned so a future parser ceiling is a conscious change.
    expect(parsePerfectItemRef({ bag: Number.MAX_SAFE_INTEGER, item: ITEM })).toEqual({
      bag: Number.MAX_SAFE_INTEGER,
      itemId: ITEM,
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

describe('parsePerfectItemName (Masterwrought phase 13)', () => {
  it('a bounded non-empty string rides; the sim owns the tighter live shape', () => {
    expect(parsePerfectItemName({ name: 'Dawnbreaker' })).toBe('Dawnbreaker');
    expect(parsePerfectItemName({ name: 'x'.repeat(MAX_INSTANCE_STRING_LENGTH) })).toBe(
      'x'.repeat(MAX_INSTANCE_STRING_LENGTH),
    );
    // Deliberately looser than the sim's 32-char alphabet shape: the field
    // bound is the flood ceiling only, and the sim's shape validation is the
    // one refusal the player can read.
    expect(parsePerfectItemName({ name: '!!' })).toBe('!!');
  });

  it('an OVERSIZED string is cut to the ceiling, never dropped (the host-parity rule)', () => {
    // The offline host hands the raw string to the sim, whose shape arm
    // refuses anything past MAX_LEGENDARY_NAME_LENGTH with the inscription
    // line; dropping the field here would make the online host answer the
    // needs-a-name line instead for the same input. Cutting keeps the token
    // bounded AND the two hosts on one line (pinned end to end in
    // tests/perfecting_wire.test.ts).
    const cut = parsePerfectItemName({ name: 'x'.repeat(MAX_INSTANCE_STRING_LENGTH + 1) });
    expect(cut).toBe('x'.repeat(MAX_INSTANCE_STRING_LENGTH));
    expect(parsePerfectItemName({ name: 'y'.repeat(4096) })).toHaveLength(
      MAX_INSTANCE_STRING_LENGTH,
    );
    // Any cut is still past the live shape, so the sim's shape arm owns it.
    expect(MAX_INSTANCE_STRING_LENGTH).toBeGreaterThan(MAX_LEGENDARY_NAME_LENGTH);
  });

  it('every non-string or empty shape drops the FIELD, never the frame, per dimension', () => {
    for (const name of [
      undefined, // absent: the ordinary unnamed attempt
      7, // non-string
      '', // empty
      ['a'], // array smuggle
      { toString: () => 'a' }, // object smuggle
      Number.MAX_SAFE_INTEGER, // huge-integer abuse
      null,
      true,
    ]) {
      expect(parsePerfectItemName({ name }), JSON.stringify({ name })).toBeUndefined();
    }
    // The field-drop DIRECTION: the ref beside a malformed name still parses,
    // so the frame survives as an unnamed attempt.
    expect(parsePerfectItemRef({ slot: 'neck', name: 7 } as Record<string, unknown>)).toEqual({
      slot: 'neck',
    });
  });
});

describe('resolvePerfectItemName: the whole naming decision (the phase 13 QA K17 pin)', () => {
  it('screens the NORMALIZED value, never the raw wire spelling, and passes it on', () => {
    // D13-5: the content screen prices the trimmed, whitespace-collapsed name,
    // so a spelling only normalization exposes cannot slip past a raw-token
    // screen, and there is no hidden coupling to the censorship normalizer's
    // own whitespace stripping.
    const screen = vi.fn((_name: string) => false);
    expect(resolvePerfectItemName({ name: '  Oath   of  Vale ' }, screen)).toEqual({
      refused: false,
      name: 'Oath of Vale',
    });
    expect(screen).toHaveBeenCalledTimes(1);
    expect(screen).toHaveBeenCalledWith('Oath of Vale');
  });

  it('refuses the frame on a match, with no name passed on', () => {
    const screen = vi.fn((name: string) => name === 'Bad Word');
    expect(resolvePerfectItemName({ name: 'Bad   Word' }, screen)).toEqual({ refused: true });
    expect(screen).toHaveBeenCalledWith('Bad Word');
  });

  it('a shape-INVALID name skips the screen entirely and rides RAW for the sim to refuse', () => {
    const screen = vi.fn(() => true);
    expect(resolvePerfectItemName({ name: '1Blade' }, screen)).toEqual({
      refused: false,
      name: '1Blade',
    });
    expect(
      resolvePerfectItemName({ name: 'z'.repeat(MAX_LEGENDARY_NAME_LENGTH + 1) }, screen),
    ).toEqual({ refused: false, name: 'z'.repeat(MAX_LEGENDARY_NAME_LENGTH + 1) });
    expect(screen).not.toHaveBeenCalled();
  });

  it('no usable name field passes undefined without touching the screen', () => {
    const screen = vi.fn(() => true);
    for (const msg of [{}, { name: 7 }, { name: '' }, { name: null }]) {
      expect(resolvePerfectItemName(msg as { name?: unknown }, screen)).toEqual({
        refused: false,
      });
    }
    expect(screen).not.toHaveBeenCalled();
  });
});
