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

  it('an OVERSIZED string rides RAW and UNCUT, never dropped (the host-parity rule)', () => {
    // The offline host hands the raw string to the sim, whose shape arm
    // refuses anything past MAX_LEGENDARY_NAME_LENGTH with the inscription
    // line; dropping the field here would make the online host answer the
    // needs-a-name line instead for the same input, and CUTTING it (the first
    // QA fix, refuted by its fresh reader) could turn a shape-invalid wire
    // spelling into a valid short name online only. The frame is already
    // bounded by the socket's 16 KiB maxPayload, so the raw value rides.
    expect(parsePerfectItemName({ name: 'x'.repeat(MAX_INSTANCE_STRING_LENGTH + 1) })).toBe(
      'x'.repeat(MAX_INSTANCE_STRING_LENGTH + 1),
    );
    expect(parsePerfectItemName({ name: 'y'.repeat(4096) })).toBe('y'.repeat(4096));
    // Both are past the live shape, so the sim's shape arm owns them.
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
  // The promotion probe the dispatch binds to the live sim. Named per case so
  // each says which copy it is deciding over, and counted so the laziness
  // claim (the sim read is paid only on a screen MATCH) is asserted, not
  // assumed.
  const promoting = () => vi.fn(() => true);
  const unperfected = () => vi.fn(() => false);

  it('screens the NORMALIZED value, never the raw wire spelling, and passes it on', () => {
    // D13-5: the content screen prices the trimmed, whitespace-collapsed name,
    // so a spelling only normalization exposes cannot slip past a raw-token
    // screen, and there is no hidden coupling to the censorship normalizer's
    // own whitespace stripping.
    const screen = vi.fn((_name: string) => false);
    const promote = promoting();
    expect(resolvePerfectItemName({ name: '  Oath   of  Vale ' }, screen, promote)).toEqual({
      refused: false,
      name: 'Oath of Vale',
    });
    expect(screen).toHaveBeenCalledTimes(1);
    expect(screen).toHaveBeenCalledWith('Oath of Vale');
    // A clean name never asks the sim anything, on a promotable copy or not.
    expect(promote).not.toHaveBeenCalled();
  });

  it('a whitespace-run spelling past the raw ceiling normalizes to a live name on BOTH hosts', () => {
    // The parity case that killed the cut: raw 'Oath' + sixty spaces + 'Z' is
    // 65 characters, past the old cut, yet its NORMALIZED value 'Oath Z' is a
    // valid live name. A cut would have handed the sim 'Oath' + 60 spaces (a
    // shape refusal online, a promotion named 'Oath Z' offline); raw
    // pass-through lets the same normalizer answer 'Oath Z' on both hosts.
    const screen = vi.fn((_name: string) => false);
    expect(resolvePerfectItemName({ name: `Oath${' '.repeat(60)}Z` }, screen, promoting())).toEqual(
      {
        refused: false,
        name: 'Oath Z',
      },
    );
    expect(screen).toHaveBeenCalledWith('Oath Z');
    expect(`Oath${' '.repeat(60)}Z`.length).toBeGreaterThan(MAX_INSTANCE_STRING_LENGTH);
  });

  it('refuses the frame on a match ONLY when the copy would consume the name', () => {
    // The phase 18 narrowing. `promoting` answers whether Sim.perfectItemAs
    // would route this copy to the promotion ladder (payload.perfected), the
    // only code that can stamp a name; a screened name there is refused whole,
    // with no name passed on.
    const screen = vi.fn((name: string) => name === 'Bad Word');
    const promote = promoting();
    expect(resolvePerfectItemName({ name: 'Bad   Word' }, screen, promote)).toEqual({
      refused: true,
    });
    expect(screen).toHaveBeenCalledWith('Bad Word');
    // Asked exactly once, and only because the screen matched.
    expect(promote).toHaveBeenCalledTimes(1);
  });

  it('an offensive name on an UNPERFECTED copy is STRIPPED, and the attempt proceeds', () => {
    // The other half of the narrowing, and the defect it fixes: the ordinary
    // perfecting attempt ignores `name` entirely, so refusing the whole frame
    // cost the player an attempt over a string the sim would never have
    // written. The verdict is `refused: false` with NO name, which the
    // dispatch already handles as an unnamed attempt with no new arm.
    const screen = vi.fn((name: string) => name === 'Bad Word');
    const probe = unperfected();
    const verdict = resolvePerfectItemName({ name: 'Bad   Word' }, screen, probe);
    expect(verdict).toEqual({ refused: false });
    // Spelled out rather than left to toEqual: the strip is the ABSENCE of a
    // name, and passing the normalized value on here would stamp it.
    expect(verdict.refused).toBe(false);
    expect(verdict.name).toBeUndefined();
    expect(screen).toHaveBeenCalledWith('Bad Word');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('a shape-INVALID name skips the screen entirely and rides RAW for the sim to refuse', () => {
    const screen = vi.fn(() => true);
    const promote = promoting();
    expect(resolvePerfectItemName({ name: '1Blade' }, screen, promote)).toEqual({
      refused: false,
      name: '1Blade',
    });
    expect(
      resolvePerfectItemName({ name: 'z'.repeat(MAX_LEGENDARY_NAME_LENGTH + 1) }, screen, promote),
    ).toEqual({ refused: false, name: 'z'.repeat(MAX_LEGENDARY_NAME_LENGTH + 1) });
    expect(screen).not.toHaveBeenCalled();
    // Shape-first: an unscreened name never reaches the sim read either.
    expect(promote).not.toHaveBeenCalled();
  });

  it('no usable name field passes undefined without touching the screen', () => {
    const screen = vi.fn(() => true);
    const promote = promoting();
    for (const msg of [{}, { name: 7 }, { name: '' }, { name: null }]) {
      expect(resolvePerfectItemName(msg as { name?: unknown }, screen, promote)).toEqual({
        refused: false,
      });
    }
    expect(screen).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });
});
