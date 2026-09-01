// The aura half of the snapshot decode (src/net/aura_wire_decode.ts), extracted
// from ClientWorld.applySnapshot. The end-to-end behavior is pinned through the
// real client in tests/client_snapshot_timer_wire.test.ts and
// tests/snapshots.test.ts; these own the two properties only the unit can show:
// the in-place fast path really preserves object identity, and the two decode
// paths (update and rebuild) agree field for field, which is the drift the
// extraction exists to make impossible.

import { describe, expect, it } from 'vitest';
import {
  type AuraTimerContext,
  applyAuraWire,
  auraRemaining,
  type ClientWireAura,
  snapshotCarriesAuras,
} from '../src/net/aura_wire_decode';
import type { Aura } from '../src/sim/types';

const LEGACY: AuraTimerContext = { mode: 'legacy', time: null };
const STABLE: AuraTimerContext = { mode: 'stable', time: 100 };

function row(over: Partial<ClientWireAura> = {}): ClientWireAura {
  return { id: 'a', name: 'A', kind: 'buff_sta', dur: 10, rem: 4, ...over } as ClientWireAura;
}

describe('auraRemaining', () => {
  it('a permanent aura never counts down', () => {
    expect(auraRemaining(row({ perm: 1 }), STABLE)).toBe(Number.POSITIVE_INFINITY);
    expect(auraRemaining(row({ perm: 1 }), LEGACY)).toBe(Number.POSITIVE_INFINITY);
  });

  it('the legacy wire reads the per-snapshot remaining', () => {
    expect(auraRemaining(row({ rem: 4 }), LEGACY)).toBe(4);
  });

  it('the stable wire ages an absolute deadline against the snapshot clock', () => {
    // exp 130 at time 100 is 30 seconds left, without the server resending it.
    expect(auraRemaining(row({ exp: 130 }), STABLE)).toBe(30);
  });

  it('a stable row with no usable deadline falls back to rem, then to 0', () => {
    expect(auraRemaining(row({ rem: 7 }), STABLE)).toBe(7);
    expect(auraRemaining(row({ rem: undefined }), STABLE)).toBe(0);
  });
});

describe('snapshotCarriesAuras', () => {
  it('the legacy wire always carries the list', () => {
    expect(snapshotCarriesAuras(LEGACY, undefined)).toBe(true);
  });

  it('the stable wire delta-gates it: absent means UNCHANGED, never empty', () => {
    // The failure this guards is silent and total: applying an empty list for
    // an absent key strips every aura the entity is wearing.
    expect(snapshotCarriesAuras(STABLE, undefined)).toBe(false);
    expect(snapshotCarriesAuras(STABLE, [])).toBe(true);
  });

  it('an unknown timer wire carries nothing', () => {
    expect(snapshotCarriesAuras({ mode: 'unsupported', time: 100 }, [])).toBe(false);
  });
});

describe('applyAuraWire', () => {
  it('updates IN PLACE when the composition is unchanged, preserving identity', () => {
    // The allocation contract: a steady aura set at 20 Hz must not mint an
    // array and an object per entity per snapshot, and the preserved identity
    // is what matches the offline Sim's one-live-object-per-aura shape.
    const held: Aura[] = [{ id: 'a', name: 'A', kind: 'buff_sta', remaining: 9 } as Aura];
    const first = held[0];
    const out = applyAuraWire(held, [row({ rem: 4 })], LEGACY);
    expect(out).toBe(held);
    expect(out[0]).toBe(first);
    expect(out[0].remaining).toBe(4);
  });

  it('rebuilds when the composition changes (a gain, a fade, a reorder)', () => {
    const held: Aura[] = [{ id: 'a', name: 'A', kind: 'buff_sta', remaining: 9 } as Aura];
    const gained = applyAuraWire(held, [row({ id: 'a' }), row({ id: 'b' })], LEGACY);
    expect(gained).not.toBe(held);
    expect(gained.map((x) => x.id)).toEqual(['a', 'b']);

    const reordered = applyAuraWire(
      [{ id: 'a' } as Aura, { id: 'b' } as Aura],
      [row({ id: 'b' }), row({ id: 'a' })],
      LEGACY,
    );
    expect(reordered.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('decodes every field IDENTICALLY on both paths (the extraction contract)', () => {
    // THE drift this module exists to prevent: two decode paths that must agree
    // field for field, previously written out twice inside one method. Driven
    // over a row carrying every optional key at once.
    const full = row({
      id: 'x',
      name: 'X',
      kind: 'buff_int',
      exp: 160,
      dur: 90,
      value: 15,
      value2: 3,
      value3: 4,
      tickInterval: 2,
      school: 'nature',
      stacks: 5,
      charges: 2,
      emp: ['smite'],
      src: 77,
      ub: 1,
      und: 1,
      fl: 1,
      bt: 1,
    });
    // Both paths are compared against a HAND-WRITTEN record, never against each
    // other's key set. The loop this replaces walked `Object.keys(rebuilt)`, so
    // it only ever asked about the fields the REBUILD happens to emit: drop
    // `school` (or value2, stacks, charges, empowerAbilities) from decodeAura
    // and the key is missing on both sides, compared on neither, and the case
    // stays green while the field stops crossing the wire.
    const expected: Aura = {
      id: 'x',
      name: 'X',
      kind: 'buff_int',
      // exp 160 aged against the stable wire's snapshot clock at 100.
      remaining: 60,
      duration: 90,
      permanent: false,
      value: 15,
      value2: 3,
      value3: 4,
      tickInterval: 2,
      sourceId: 77,
      school: 'nature',
      stacks: 5,
      charges: 2,
      empowerAbilities: ['smite'],
      unbreakableControl: true,
      undispellable: true,
      flask: true,
      breakThreshold: 1,
    };
    const rebuilt = applyAuraWire([], [full], STABLE)[0];
    const inPlace = applyAuraWire([{ id: 'x' } as Aura], [full], STABLE)[0];
    // toStrictEqual, so a key that is merely PRESENT-and-undefined on one side
    // counts as a difference, and a field ADDED to the decode without being
    // added here reds rather than passing unmeasured.
    expect(rebuilt, 'the rebuild path').toStrictEqual(expected);
    expect(inPlace, 'the in-place path').toStrictEqual(expected);
  });

  it('takes the same DEFAULT arms on both paths for a row that omits every optional', () => {
    // The case above drives a row carrying EVERY optional key, so it measures
    // the mapped arms and never the `??` defaults sitting beside them. That
    // hole is real, not theoretical: moving the school default from 'physical'
    // to 'arcane' on BOTH decode paths left this file,
    // tests/client_snapshot_timer_wire.test.ts and tests/snapshots.test.ts all
    // green across 274 cases, because nothing anywhere decoded a row that
    // omits `school`. A sparse row is the ORDINARY wire shape rather than an
    // edge: an older server, and any aura with no second value, no stacks and
    // no recorded caster, sends exactly this one.
    const bare = row();
    const defaults: Aura = {
      id: 'a',
      name: 'A',
      kind: 'buff_sta',
      // legacy timer wire, so remaining is the per-snapshot `rem` verbatim.
      remaining: 4,
      duration: 10,
      permanent: false,
      // The three defaults with a VALUE, which are the ones a drift can hide
      // in: an absent amount is 0, an absent caster is entity 0 (matching no
      // player), and an absent school is physical.
      value: 0,
      sourceId: 0,
      school: 'physical',
      // ... and every remaining optional spelled as an explicit undefined,
      // because toStrictEqual separates present-and-undefined from absent and
      // both decode paths write these keys unconditionally.
      value2: undefined,
      value3: undefined,
      tickInterval: undefined,
      stacks: undefined,
      charges: undefined,
      empowerAbilities: undefined,
      unbreakableControl: undefined,
      undispellable: undefined,
      flask: undefined,
      breakThreshold: undefined,
    };
    expect(applyAuraWire([], [bare], LEGACY)[0], 'the rebuild path').toStrictEqual(defaults);
    expect(
      applyAuraWire([{ id: 'a' } as Aura], [bare], LEGACY)[0],
      'the in-place path',
    ).toStrictEqual(defaults);
  });

  it('CLEARS every presence-only marker when the wire stops sending it', () => {
    // A sticky mirror keeps answering for a state that ended: the wrong glyph,
    // or a right-click cancel the server would refuse.
    const held = applyAuraWire([], [row({ ub: 1, und: 1, fl: 1, bt: 1 })], LEGACY);
    const cleared = applyAuraWire(held, [row()], LEGACY);
    expect(cleared).toBe(held); // same composition, so the in-place path
    expect(cleared[0].unbreakableControl).toBeUndefined();
    expect(cleared[0].undispellable).toBeUndefined();
    expect(cleared[0].flask).toBeUndefined();
    expect(cleared[0].breakThreshold).toBeUndefined();
  });

  it('an empty list decodes to an empty list', () => {
    expect(applyAuraWire([{ id: 'a' } as Aura], [], LEGACY)).toEqual([]);
  });
});
