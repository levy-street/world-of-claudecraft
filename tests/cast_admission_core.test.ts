// The per-cast verdict (src/render/ability_vfx/cast_admission_core.ts): a cast
// is decided at its first entry point and a refusal holds through the rest of
// that cast, so the painter draws a cast whole or not at all.

import { describe, expect, it } from 'vitest';
import {
  CastAdmission,
  REFUSED_CAST_TAIL_SEC,
} from '../src/render/ability_vfx/cast_admission_core';

const ENGINE = 1;
const KIT = 2;
const WARRIOR = ENGINE | KIT;

function harness(readyBits = 0) {
  const gate = {
    bits: readyBits,
    admits: 0,
    refusals: 0,
    admit(mask: number) {
      this.admits++;
      const ok = (mask & ~this.bits) === 0;
      if (!ok) this.refusals++;
      return ok;
    },
    ready(mask: number) {
      return (mask & ~this.bits) === 0;
    },
  };
  return { gate, admission: new CastAdmission(gate) };
}

describe('a cast refused at its cast bar', () => {
  it('stays refused through its release, impact and ticks after the family latches mid-cast', () => {
    const { gate, admission } = harness(ENGINE);
    expect(admission.windup(7, 'mortal_strike', WARRIOR, 0, 1.5, true)).toBe(false);
    expect(admission.windup(7, 'mortal_strike', WARRIOR, 0.5, 1, false)).toBe(false);
    gate.bits = WARRIOR;
    expect(admission.windup(7, 'mortal_strike', WARRIOR, 1, 0.5, false)).toBe(false);
    expect(admission.release(7, 'mortal_strike', WARRIOR, 1.5)).toBe(false);
    expect(admission.follow(7, 'mortal_strike', WARRIOR, 2)).toBe(false);
    expect(admission.follow(7, 'mortal_strike', WARRIOR, 5)).toBe(false);
    // One refused cast, one counted refusal.
    expect(gate.refusals).toBe(1);
  });

  it('lets the next cast of the same ability decide afresh', () => {
    const { gate, admission } = harness(0);
    expect(admission.windup(7, 'frostbolt', ENGINE, 0, 2, true)).toBe(false);
    expect(admission.release(7, 'frostbolt', ENGINE, 2)).toBe(false);
    gate.bits = ENGINE;
    expect(admission.windup(7, 'frostbolt', ENGINE, 2.5, 2, true)).toBe(true);
    expect(admission.release(7, 'frostbolt', ENGINE, 4.5)).toBe(true);
    expect(admission.follow(7, 'frostbolt', ENGINE, 5)).toBe(true);
  });

  it('drops the latch of an interrupted cast bar, so a later instant release is its own cast', () => {
    const { gate, admission } = harness(0);
    expect(admission.windup(7, 'frostbolt', ENGINE, 0, 2, true)).toBe(false);
    gate.bits = ENGINE;
    admission.interrupted(7);
    expect(admission.isRefused(7, 'frostbolt', 1)).toBe(false);
    expect(admission.release(7, 'frostbolt', ENGINE, 1)).toBe(true);
    expect(gate.refusals).toBe(1);
  });

  it('keeps a refused release through an interrupt of another bar, and leaves other casters alone', () => {
    const { gate, admission } = harness(0);
    expect(admission.release(7, 'fire_blast', ENGINE, 0)).toBe(false);
    expect(admission.windup(7, 'frostbolt', ENGINE, 0, 2, true)).toBe(false);
    expect(admission.windup(8, 'frostbolt', ENGINE, 0, 2, true)).toBe(false);
    gate.bits = ENGINE;
    admission.interrupted(7);
    // The released cast is still in flight: its impact stays refused.
    expect(admission.follow(7, 'fire_blast', ENGINE, 1)).toBe(false);
    expect(admission.release(7, 'frostbolt', ENGINE, 1)).toBe(true);
    // The other caster's bar was not interrupted: its release belongs to it.
    expect(admission.release(8, 'frostbolt', ENGINE, 2)).toBe(false);
  });

  it('refuses a cast first seen mid-bar while its families are not ready, and latches it', () => {
    const { gate, admission } = harness(0);
    expect(admission.windup(7, 'frostbolt', ENGINE, 0, 1, false)).toBe(false);
    gate.bits = ENGINE;
    expect(admission.release(7, 'frostbolt', ENGINE, 1)).toBe(false);
  });
});

describe('an admitted cast', () => {
  it('stays admitted at every later entry point, uncounted', () => {
    const { gate, admission } = harness(WARRIOR);
    expect(admission.windup(7, 'slam', WARRIOR, 0, 1, true)).toBe(true);
    expect(admission.windup(7, 'slam', WARRIOR, 0.5, 0.5, false)).toBe(true);
    expect(admission.release(7, 'slam', WARRIOR, 1)).toBe(true);
    expect(admission.follow(7, 'slam', WARRIOR, 1.2)).toBe(true);
    expect(gate.refusals).toBe(0);
  });
});

describe('an instant', () => {
  it('is decided at its release, and its impact follows the verdict', () => {
    const { gate, admission } = harness(0);
    expect(admission.release(3, 'fire_blast', ENGINE, 0)).toBe(false);
    gate.bits = ENGINE;
    expect(admission.follow(3, 'fire_blast', ENGINE, 0.4)).toBe(false);
    expect(gate.refusals).toBe(1);
  });

  it('is a new cast on every release: a refusal never holds the next press', () => {
    const { gate, admission } = harness(0);
    expect(admission.release(3, 'fire_blast', ENGINE, 0)).toBe(false);
    gate.bits = ENGINE;
    expect(admission.release(3, 'fire_blast', ENGINE, 1.5)).toBe(true);
    expect(admission.follow(3, 'fire_blast', ENGINE, 1.8)).toBe(true);
  });

  it('decides a follow-through with no earlier entry point as the cast itself', () => {
    const { gate, admission } = harness(0);
    expect(admission.follow(3, 'arcane_missiles', ENGINE, 0)).toBe(false);
    gate.bits = ENGINE;
    expect(admission.follow(3, 'arcane_missiles', ENGINE, 1)).toBe(false);
    expect(gate.refusals).toBe(1);
  });
});

describe('the latch lifetime', () => {
  it('keeps a refused channel refused to its end: every tick extends the tail', () => {
    const { gate, admission } = harness(0);
    expect(admission.release(3, 'drain_soul', ENGINE, 0)).toBe(false);
    gate.bits = ENGINE;
    for (let t = 1; t <= 12; t++) expect(admission.channel(3, 'drain_soul', ENGINE, t)).toBe(false);
    expect(admission.isRefused(3, 'drain_soul', 12 + REFUSED_CAST_TAIL_SEC - 0.01)).toBe(true);
    expect(admission.channel(3, 'drain_soul', ENGINE, 12 + REFUSED_CAST_TAIL_SEC)).toBe(true);
  });

  it('never lets follow-through extend a refusal: a pressed-again strike reads afresh after the tail', () => {
    // A Warrior strike whose contact IS its cast arrives as follow-through
    // every press; if each press extended the first refusal, a player
    // spamming it would never see it once the kit is ready.
    const { gate, admission } = harness(ENGINE);
    expect(admission.follow(3, 'heroic_strike', WARRIOR, 0)).toBe(false);
    gate.bits = WARRIOR;
    for (let t = 1.5; t < REFUSED_CAST_TAIL_SEC; t += 1.5)
      expect(admission.follow(3, 'heroic_strike', WARRIOR, t)).toBe(false);
    expect(admission.follow(3, 'heroic_strike', WARRIOR, REFUSED_CAST_TAIL_SEC)).toBe(true);
  });

  it('holds a cast bar refusal over the remaining bar plus the tail', () => {
    const { admission } = harness(0);
    admission.windup(3, 'pyroblast', ENGINE, 0, 4, true);
    expect(admission.isRefused(3, 'pyroblast', 4 + REFUSED_CAST_TAIL_SEC - 0.01)).toBe(true);
    expect(admission.isRefused(3, 'pyroblast', 4 + REFUSED_CAST_TAIL_SEC)).toBe(false);
  });

  it('pins the tail to the longest authored linger dwell', () => {
    expect(REFUSED_CAST_TAIL_SEC).toBe(6);
  });
});

describe('the verdict is per caster and per ability', () => {
  it('never lets one refused cast hold another caster or another ability', () => {
    const { gate, admission } = harness(ENGINE);
    expect(admission.release(1, 'heroic_strike', WARRIOR, 0)).toBe(false);
    expect(admission.release(2, 'fireball', ENGINE, 0)).toBe(true);
    expect(admission.release(1, 'frostbolt', ENGINE, 0)).toBe(true);
    gate.bits = WARRIOR;
    expect(admission.follow(2, 'heroic_strike', WARRIOR, 0.5)).toBe(true);
    expect(admission.follow(1, 'heroic_strike', WARRIOR, 0.5)).toBe(false);
  });

  it('keeps its book bounded: expired refusals are pruned as it grows', () => {
    const { admission } = harness(0);
    for (let caster = 0; caster < 200; caster++) admission.release(caster, 'x', ENGINE, caster);
    const book = (admission as unknown as { refused: Map<number, unknown> }).refused;
    expect(book.size).toBeLessThanOrEqual(66);
  });
});

describe('a cue that names no caster', () => {
  it('is counted but latches nothing', () => {
    const { gate, admission } = harness(0);
    expect(admission.once(ENGINE)).toBe(false);
    expect(gate.refusals).toBe(1);
    expect((admission as unknown as { refused: Map<number, unknown> }).refused.size).toBe(0);
    gate.bits = ENGINE;
    expect(admission.once(ENGINE)).toBe(true);
  });
});

describe('a per-frame hold', () => {
  it('shows the frame its families are ready, with no latch and no count', () => {
    const { gate, admission } = harness(ENGINE);
    expect(admission.hold(WARRIOR)).toBe(false);
    expect(admission.hold(WARRIOR)).toBe(false);
    gate.bits = WARRIOR;
    expect(admission.hold(WARRIOR)).toBe(true);
    expect(gate.admits).toBe(0);
  });
});
