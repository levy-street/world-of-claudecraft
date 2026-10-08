// The boss's phase aura (src/render/balgath_aura_core.ts).
//
// This layer exists so a player can read the fight from across the arena without a buff
// bar, which makes its PRIORITIES the thing worth pinning rather than its colours. A boss
// quietly healing while the aura still says "travelling" is the failure that costs a pull,
// and it is invisible in every screenshot because the aura is present and plausible either
// way.
import { describe, expect, it } from 'vitest';
import {
  auraAlphaAt,
  bossAuraPlan,
  moteBudget,
  readBossVfxState,
} from '../src/render/balgath_aura_core';

const entity = (over: Record<string, unknown> = {}) => ({
  hp: 1000,
  maxHp: 1000,
  auras: [],
  enraged: false,
  castingAbility: null,
  ...over,
});

describe('reading the state off the entity', () => {
  it('says nothing is happening for an ordinary body', () => {
    const s = readBossVfxState(entity());
    expect(s.phase).toBeNull();
    expect(s.shielded).toBe(false);
    expect(s.mending).toBe(false);
    expect(s.enraged).toBe(false);
  });

  it('sees Barrowhide through the shipped absorb aura', () => {
    // Read by KIND rather than by a hardcoded id, so the shield still reads if the template
    // is renamed or a second boss reuses the mechanic.
    const s = readBossVfxState(entity({ auras: [{ kind: 'absorb', id: 'stoneskin_x' }] }));
    expect(s.shielded).toBe(true);
  });

  it('only calls him healing when the sim actually is', () => {
    // The mending glow keys off the SAME unharried clock the regen itself uses, so it can
    // never advertise a heal that is not happening. Each of the three conditions alone must
    // not be enough.
    const healing = { warpathPhase: 'travel', warpathUnharried: 4, hp: 500 };
    expect(readBossVfxState(entity(healing)).mending).toBe(true);
    // ...at full health there is nothing to mend.
    expect(readBossVfxState(entity({ ...healing, hp: 1000 })).mending).toBe(false);
    // ...freshly hit, the clock has reset.
    expect(readBossVfxState(entity({ ...healing, warpathUnharried: 0.5 })).mending).toBe(false);
    // ...and he only regenerates while travelling.
    expect(readBossVfxState(entity({ ...healing, warpathPhase: 'focus' })).mending).toBe(false);
  });

  it('reports how worn down he is', () => {
    expect(readBossVfxState(entity({ hp: 1000 })).wounded).toBe(0);
    expect(readBossVfxState(entity({ hp: 250 })).wounded).toBeCloseTo(0.75, 5);
  });
});

describe('what the aura shows', () => {
  const plan = (over: Record<string, unknown> = {}) => bossAuraPlan(readBossVfxState(entity(over)));

  it('gives each warpath phase its own colour', () => {
    const focus = plan({ warpathPhase: 'focus' });
    const travel = plan({ warpathPhase: 'travel' });
    const wreck = plan({ warpathPhase: 'wreck' });
    expect(new Set([focus.color, travel.color, wreck.color]).size).toBe(3);
  });

  it('winds visibly tighter and faster into the arrival slam', () => {
    // The wreck is the one phase with a hard deadline, so it has to look like one.
    const focus = plan({ warpathPhase: 'focus' });
    const wreck = plan({ warpathPhase: 'wreck' });
    expect(wreck.pulseHz).toBeGreaterThan(focus.pulseHz * 3);
    expect(wreck.moteRate).toBeGreaterThan(focus.moteRate * 3);
    expect(wreck.alpha).toBeGreaterThan(focus.alpha);
  });

  it('draws motes INWARD for anything he is taking in, and outward otherwise', () => {
    // The grammar players read without being taught: outward is spent, inward is gathered.
    expect(plan({ warpathPhase: 'focus' }).moteFlow).toBe('rise');
    expect(plan({ warpathPhase: 'travel' }).moteFlow).toBe('rise');
    expect(plan({ warpathPhase: 'wreck' }).moteFlow).toBe('inward');
    expect(plan({ auras: [{ kind: 'absorb' }] }).moteFlow).toBe('inward');
    expect(plan({ warpathPhase: 'travel', warpathUnharried: 4, hp: 400 }).moteFlow).toBe('inward');
  });

  it('lets healing override the phase colour, because it is the actionable thing', () => {
    const travelling = plan({ warpathPhase: 'travel' });
    const mending = plan({ warpathPhase: 'travel', warpathUnharried: 4, hp: 400 });
    expect(mending.color).not.toBe(travelling.color);
    expect(mending.moteRate).toBeGreaterThan(travelling.moteRate);
  });

  it('makes the blind window the loudest thing short of enrage', () => {
    // This is the raid's damage window and it lasts seconds. It has to outrank the phase
    // tint AND the mending cue, because it changes what every other player should be doing,
    // and it has to be a DIFFERENT colour from both or the read is ambiguous.
    const travelling = plan({ warpathPhase: 'travel' });
    const mending = plan({ warpathPhase: 'travel', warpathUnharried: 4, hp: 400 });
    const blinded = plan({
      warpathPhase: 'travel',
      warpathUnharried: 4,
      hp: 400,
      auras: [{ id: 'eye_ward_blinded' }],
    });
    expect(blinded.color).not.toBe(travelling.color);
    expect(blinded.color).not.toBe(mending.color);
    expect(blinded.pulseHz).toBeGreaterThan(mending.pulseHz);
    expect(blinded.moteRate).toBeGreaterThan(mending.moteRate);
    // ...and it throws motes OUT, not in: the grammar is that inward is something he is
    // taking in, and a pried-open ward is the opposite of that.
    expect(blinded.moteFlow).toBe('rise');
  });

  it('reads the blind off the aura the ward mirrors itself through', () => {
    expect(readBossVfxState(entity()).blinded).toBe(false);
    expect(readBossVfxState(entity({ auras: [{ id: 'eye_ward' }] })).blinded).toBe(false);
    expect(readBossVfxState(entity({ auras: [{ id: 'eye_ward_blinded' }] })).blinded).toBe(true);
  });

  it('lets enrage override everything, including healing', () => {
    const mending = plan({ warpathPhase: 'travel', warpathUnharried: 4, hp: 400 });
    const enraged = plan({ warpathPhase: 'travel', warpathUnharried: 4, hp: 400, enraged: true });
    expect(enraged.color).not.toBe(mending.color);
    expect(enraged.pulseHz).toBeGreaterThanOrEqual(mending.pulseHz);
  });

  it('smoulders harder as he is worn down, without ever washing out', () => {
    const fresh = plan({ warpathPhase: 'focus', hp: 1000 });
    const beaten = plan({ warpathPhase: 'focus', hp: 100 });
    expect(beaten.alpha).toBeGreaterThan(fresh.alpha);
    expect(beaten.alpha).toBeLessThanOrEqual(0.55);
  });
});

describe('aura animation', () => {
  it('breathes, and holds still under reduced motion', () => {
    const p = bossAuraPlan(readBossVfxState(entity({ warpathPhase: 'travel' })));
    // A QUARTER period apart, not a half: the breath is a sine, and t=0 against a half
    // period samples its two zero crossings, which are identical and prove nothing.
    const a = auraAlphaAt(p, 0.0);
    const b = auraAlphaAt(p, 1 / (p.pulseHz * 4));
    expect(a).not.toBeCloseTo(b, 3);
    expect(auraAlphaAt(p, 0.0, true)).toBe(p.alpha);
    expect(auraAlphaAt(p, 12.34, true)).toBe(p.alpha);
  });

  it('never drives the aura opaque or negative at any point in its cycle', () => {
    const p = bossAuraPlan(readBossVfxState(entity({ warpathPhase: 'wreck', hp: 50 })));
    for (let t = 0; t < 4; t += 0.017) {
      const a = auraAlphaAt(p, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(0.8);
    }
  });

  it('emits at the right average rate even when a frame is worth less than one mote', () => {
    // Without the carried remainder a 5-per-second rate at 120fps floors to zero every
    // frame and the aura silently emits nothing at all.
    const p = bossAuraPlan(readBossVfxState(entity({ warpathPhase: 'focus' })));
    let carry = 0;
    let total = 0;
    const dt = 1 / 120;
    for (let i = 0; i < 120; i++) {
      const [n, next] = moteBudget(p, dt, carry);
      total += n;
      carry = next;
    }
    // One second of frames should emit one second of motes, give or take the single mote
    // still sitting in the carried remainder when the loop stops.
    expect(total).toBeGreaterThanOrEqual(p.moteRate - 1);
    expect(total).toBeLessThanOrEqual(p.moteRate + 1);
  });
});
