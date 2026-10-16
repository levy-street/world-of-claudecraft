// Balgath's ground-effect planning math (src/render/balgath_fx_core.ts).
//
// The curves matter for a reason beyond looks: the shockwave ring is the visual
// confirmation of a mechanic players dodge, so it must always reach the blast radius,
// always be visible at the moment of impact, and always fade to nothing rather than
// popping out. Each of those is asserted here rather than eyeballed in a render.

import { describe, expect, it } from 'vitest';
// The router lives in the painter module (it touches a BalgathFx), but its DECISION is
// what this suite is about, so it is tested here beside the constants it keys on. The
// module reaches for `document` only lazily inside the soft-disc texture, which none of
// these paths hit, so a plain Node import is safe.
import { BalgathFx, routeBalgathSpellfxAt } from '../src/render/balgath_fx';
import {
  BALGATH_CRATER_SECONDS,
  BALGATH_EYE_POOL_RADIUS,
  BALGATH_RING_SECONDS,
  BALGATH_SMASH_TRAUMA,
  BALGATH_STOMP_TRAUMA,
  BALGATH_STRIDE_UNITS,
  balgathRingAlpha,
  balgathRingRadius,
  planBalgathRing,
} from '../src/render/balgath_fx_core';

describe('balgath ring plan', () => {
  it('covers at least the true blast radius by the end of the sweep', () => {
    for (const radius of [4, 8, 11, 14]) {
      const plan = planBalgathRing(radius, 1);
      expect(balgathRingRadius(plan, 1)).toBeGreaterThanOrEqual(radius);
    }
  });

  it('starts wide rather than at a point (his fists are not a pin)', () => {
    const plan = planBalgathRing(11, 1);
    expect(balgathRingRadius(plan, 0)).toBeGreaterThan(0.5);
    expect(balgathRingRadius(plan, 0)).toBeLessThan(11 * 0.4);
  });

  it('expands monotonically', () => {
    const plan = planBalgathRing(11, 1);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const r = balgathRingRadius(plan, t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it('scales its punch with power, so a footfall never reads like a smash', () => {
    const smash = planBalgathRing(11, 1);
    const step = planBalgathRing(2.2, 0.34);
    expect(balgathRingAlpha(smash, 0.2)).toBeGreaterThan(balgathRingAlpha(step, 0.2));
    expect(smash.maxRadius).toBeGreaterThan(step.maxRadius * 3);
  });
});

describe('balgath ring alpha', () => {
  it('is visible almost immediately at impact', () => {
    const plan = planBalgathRing(11, 1);
    expect(balgathRingAlpha(plan, 0)).toBe(0);
    expect(balgathRingAlpha(plan, 0.12)).toBeCloseTo(plan.peakAlpha, 5);
  });

  it('fades to nothing by the end of its life (no pop-out)', () => {
    const plan = planBalgathRing(11, 1);
    expect(balgathRingAlpha(plan, 1)).toBeCloseTo(0, 6);
  });

  it('never exceeds its peak or goes negative, including out-of-range input', () => {
    const plan = planBalgathRing(11, 1);
    for (const t of [-1, -0.01, 0, 0.3, 0.9, 1, 1.5, 12]) {
      const a = balgathRingAlpha(plan, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(plan.peakAlpha + 1e-9);
    }
  });

  it('decays after the hold, so the ring reads as dust settling', () => {
    const plan = planBalgathRing(11, 1);
    expect(balgathRingAlpha(plan, 0.4)).toBeGreaterThan(balgathRingAlpha(plan, 0.8));
  });
});

describe('balgath timing constants', () => {
  it('keeps the ring shorter than the crater it leaves behind', () => {
    expect(BALGATH_RING_SECONDS).toBeLessThan(BALGATH_CRATER_SECONDS);
  });

  it('lights a ground pool big enough to read under a boss-scale body', () => {
    expect(BALGATH_EYE_POOL_RADIUS).toBeGreaterThan(3);
  });
});

// --- the spellfxAt router ----------------------------------------------------
// This is the whole reason Balgath's ground layer ever fires. It resolves the boss
// by POSITION off shared mob-mechanic events that carry no source id, so the two
// failure modes are opposite and both bad: claim another boss's blast, or silently
// claim none and leave the effect layer dead. Both are pinned.
describe('routeBalgathSpellfxAt', () => {
  const at = (id = 7, templateId = 'balgath_cyclops') => ({ id, templateId });
  function spy() {
    const calls: Array<[string, number]> = [];
    return {
      calls,
      fx: {
        smashImpact: (_x: number, _z: number, r: number) => calls.push(['smash', r]),
        stompRing: (_x: number, _z: number, r: number) => calls.push(['stomp', r]),
        impactFelt: () => {},
      } as unknown as BalgathFx,
    };
  }

  it('claims a nova standing on Balgath and picks the slam by footprint', () => {
    const big = spy();
    expect(
      routeBalgathSpellfxAt({ x: 10, z: 20, fx: 'nova', radius: 12, sourceId: 7 }, big.fx, () => [
        at(),
      ]),
    ).toBe(true);
    expect(big.calls).toEqual([['smash', 12]]);

    const small = spy();
    expect(
      routeBalgathSpellfxAt({ x: 10, z: 20, fx: 'nova', radius: 6, sourceId: 7 }, small.fx, () => [
        at(),
      ]),
    ).toBe(true);
    expect(small.calls).toEqual([['stomp', 6]]);
  });

  it('leaves the telegraph alone so the dodgeable ring is never replaced', () => {
    // runeCircle IS the actionable information. Consuming it here would swap a
    // gameplay ring for a cosmetic one, which the graphics-neutrality invariant forbids.
    const s = spy();
    expect(
      routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'runeCircle', radius: 12, sourceId: 7 }, s.fx, () => [
        at(),
      ]),
    ).toBe(false);
    expect(s.calls).toEqual([]);
  });

  it("ignores another boss's blast, however close it lands", () => {
    // Identity is the id, so a different caster detonating on the exact same spot is
    // still not his: this is what a positional match could never get right.
    const s = spy();
    const other = { id: 9, templateId: 'thunzharr_waking_peak' };
    expect(
      routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12, sourceId: 9 }, s.fx, () => [
        at(),
        other,
      ]),
    ).toBe(false);
    // An id nothing in the world answers to, and an empty world.
    expect(
      routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12, sourceId: 404 }, s.fx, () => [
        at(),
      ]),
    ).toBe(false);
    expect(
      routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12, sourceId: 7 }, s.fx, () => []),
    ).toBe(false);
    // An anchorless event (every mechanic that is not a telegraphed one).
    expect(routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12 }, s.fx, () => [at()])).toBe(
      false,
    );
    expect(s.calls).toEqual([]);
  });

  it('claims wherever the blast lands, however far he has walked from it', () => {
    // The 1.2s windup lets him leave the ring entirely before it goes off. The effect has
    // to draw at the ring, and it still has to be recognised as his.
    const s = spy();
    expect(
      routeBalgathSpellfxAt({ x: 400, z: -400, fx: 'nova', radius: 12, sourceId: 7 }, s.fx, () => [
        at(),
      ]),
    ).toBe(true);
    expect(s.calls).toEqual([['smash', 12]]);
  });

  it('claims for any balgath body, so a future phase-two form needs no rewiring', () => {
    for (const id of ['balgath_cyclops', 'balgath_awakened']) {
      const s = spy();
      expect(
        routeBalgathSpellfxAt({ x: 5, z: 5, fx: 'nova', radius: 12, sourceId: 7 }, s.fx, () => [
          at(7, id),
        ]),
      ).toBe(true);
    }
  });

  it('never walks the entity list for an event that cannot be his', () => {
    // The thunk is the point. This runs at the top of a per-event hot path, and it also
    // means a caller whose world is not wired yet (a bare-stub Renderer in a unit test)
    // cannot be made to throw by an unrelated effect event, which is how it first broke.
    const s = spy();
    let walked = 0;
    const entities = () => {
      walked++;
      return [at()];
    };
    routeBalgathSpellfxAt(
      { x: 0, z: 0, fx: 'runeCircle', radius: 12, sourceId: 7 },
      s.fx,
      entities,
    );
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'burst', radius: 12, sourceId: 7 }, s.fx, entities);
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', sourceId: 7 }, s.fx, entities);
    expect(walked).toBe(0);
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12, sourceId: 7 }, s.fx, entities);
    expect(walked).toBe(1);
  });

  it('needs a radius, because the ring is drawn at the blast size', () => {
    const s = spy();
    expect(routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', sourceId: 7 }, s.fx, () => [at()])).toBe(
      false,
    );
    expect(s.calls).toEqual([]);
  });
});

// --- the continuous world layer ----------------------------------------------
// Footfall dust and the eye pool are read from the live entity list every frame rather
// than pushed from events, so their correctness is entirely about WHEN they fire.
describe('BalgathFx world integration', () => {
  function harness() {
    const calls: string[] = [];
    const fx = new BalgathFx({ add: () => {}, remove: () => {} } as never, () => 0);
    (fx as unknown as { footfall: (x: number, z: number) => void }).footfall = (x) =>
      calls.push(`foot:${Math.round(x)}`);
    (fx as unknown as { eyeGlow: (x: number, z: number, s: number) => void }).eyeGlow = () =>
      calls.push('eye');
    return { fx, calls };
  }
  const body = (over: Record<string, unknown> = {}) => ({
    id: 1,
    templateId: 'balgath_cyclops',
    pos: { x: 0, y: 0, z: 0 },
    castingAbility: null as string | null,
    ...over,
  });

  it('puffs once per stride travelled, never on a standing giant', () => {
    // A timer would keep puffing at a boss stood still; distance cannot.
    const { fx, calls } = harness();
    const e = body();
    fx.update(0.016, false, [e]); // first frame only seeds the accumulator
    expect(calls).toEqual([]);
    for (let i = 0; i < 10; i++) fx.update(0.016, false, [e]);
    expect(calls, 'stationary boss should never puff').toEqual([]);
    e.pos.x = BALGATH_STRIDE_UNITS + 0.1;
    fx.update(0.016, false, [e]);
    expect(calls).toHaveLength(1);
  });

  it('spaces puffs by distance, so a slow walk still lands one per stride', () => {
    const { fx, calls } = harness();
    const e = body();
    fx.update(0.016, false, [e]);
    // Creep forward in small increments: the count follows ground covered, not frames.
    // Asserted as a band rather than an exact count because the accumulator compares
    // floating-point distance against the stride, so a step that lands exactly on the
    // boundary can fall either side of it; what matters is one puff per stride, not
    // which side of the epsilon the tenth one lands on.
    const strides = 10;
    for (let i = 0; i < strides * 4; i++) {
      e.pos.x += BALGATH_STRIDE_UNITS / 4;
      fx.update(0.016, false, [e]);
    }
    expect(calls.length).toBeGreaterThanOrEqual(strides - 1);
    expect(calls.length).toBeLessThanOrEqual(strides + 1);
  });

  it('lights the eye pool only while the channel runs', () => {
    const { fx, calls } = harness();
    const e = body();
    fx.update(0.016, false, [e]);
    expect(calls.filter((c) => c === 'eye')).toHaveLength(0);
    e.castingAbility = 'balgath_scry';
    fx.update(0.016, false, [e]);
    fx.update(0.016, false, [e]);
    expect(calls.filter((c) => c === 'eye')).toHaveLength(2);
    // An interrupted cast just stops refreshing; there is no cancel event to miss.
    e.castingAbility = null;
    fx.update(0.016, false, [e]);
    expect(calls.filter((c) => c === 'eye')).toHaveLength(2);
  });

  it('ignores every other entity in the world', () => {
    const { fx, calls } = harness();
    const other = body({ id: 2, templateId: 'fen_troll' });
    fx.update(0.016, false, [other]);
    other.pos.x = 100;
    fx.update(0.016, false, [other]);
    expect(calls).toEqual([]);
  });

  it('forgets a despawned boss instead of leaking his stride entry', () => {
    const { fx } = harness();
    const e = body();
    fx.update(0.016, false, [e]);
    const stride = (fx as unknown as { stride: Map<number, unknown> }).stride;
    expect(stride.size).toBe(1);
    fx.update(0.016, false, []);
    expect(stride.size, 'a killed boss must not stay in the table').toBe(0);
  });
});

describe('slam camera trauma', () => {
  it('kicks harder for the smash than the stomp, so they feel different', () => {
    // addShake squares its input, so these are not linear: the telegraphed
    // circle-breaker has to outweigh its quicker cousin or the two stop being
    // distinguishable by feel alone.
    expect(BALGATH_SMASH_TRAUMA).toBeGreaterThan(BALGATH_STOMP_TRAUMA);
    for (const t of [BALGATH_SMASH_TRAUMA, BALGATH_STOMP_TRAUMA]) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('reports the right trauma for each slam, and none when it does not claim', () => {
    // The camera wire lives on the instance, not on the call: the layer owns how a slam
    // feels, the same way it owns where the ground is.
    const seen: number[] = [];
    const fx = new BalgathFx(
      { add: () => {}, remove: () => {} } as never,
      () => 0,
      (t) => seen.push(t),
    );
    const at = [{ id: 7, templateId: 'balgath_cyclops' }];
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12, sourceId: 7 }, fx, () => at);
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 6, sourceId: 7 }, fx, () => at);
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'runeCircle', radius: 12, sourceId: 7 }, fx, () => at);
    expect(seen).toEqual([BALGATH_SMASH_TRAUMA, BALGATH_STOMP_TRAUMA]);
  });
});
