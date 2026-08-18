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
import { type BalgathFx, routeBalgathSpellfxAt } from '../src/render/balgath_fx';
import {
  BALGATH_CRATER_SECONDS,
  BALGATH_EYE_POOL_RADIUS,
  BALGATH_RING_SECONDS,
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
  const at = (x: number, z: number, templateId = 'balgath_foreman') => ({
    templateId,
    pos: { x, z },
  });
  function spy() {
    const calls: Array<[string, number]> = [];
    return {
      calls,
      fx: {
        smashImpact: (_x: number, _z: number, r: number) => calls.push(['smash', r]),
        stompRing: (_x: number, _z: number, r: number) => calls.push(['stomp', r]),
      } as unknown as BalgathFx,
    };
  }

  it('claims a nova standing on Balgath and picks the slam by footprint', () => {
    const big = spy();
    expect(
      routeBalgathSpellfxAt({ x: 10, z: 20, fx: 'nova', radius: 12 }, big.fx, () => [at(10, 20)]),
    ).toBe(true);
    expect(big.calls).toEqual([['smash', 12]]);

    const small = spy();
    expect(
      routeBalgathSpellfxAt({ x: 10, z: 20, fx: 'nova', radius: 6 }, small.fx, () => [at(10, 20)]),
    ).toBe(true);
    expect(small.calls).toEqual([['stomp', 6]]);
  });

  it('leaves the telegraph alone so the dodgeable ring is never replaced', () => {
    // runeCircle IS the actionable information. Consuming it here would swap a
    // gameplay ring for a cosmetic one, which the graphics-neutrality invariant forbids.
    const s = spy();
    expect(
      routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'runeCircle', radius: 12 }, s.fx, () => [at(0, 0)]),
    ).toBe(false);
    expect(s.calls).toEqual([]);
  });

  it('ignores another boss detonating away from Balgath', () => {
    const s = spy();
    expect(
      routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12 }, s.fx, () => [at(40, 40)]),
    ).toBe(false);
    expect(routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12 }, s.fx, () => [])).toBe(
      false,
    );
    expect(s.calls).toEqual([]);
  });

  it('claims for BOTH silhouettes, which are one encounter', () => {
    for (const id of ['balgath_foreman', 'balgath_cyclops']) {
      const s = spy();
      expect(
        routeBalgathSpellfxAt({ x: 5, z: 5, fx: 'nova', radius: 12 }, s.fx, () => [at(5, 5, id)]),
      ).toBe(true);
    }
    const other = spy();
    expect(
      routeBalgathSpellfxAt({ x: 5, z: 5, fx: 'nova', radius: 12 }, other.fx, () => [
        at(5, 5, 'thunzharr_waking_peak'),
      ]),
    ).toBe(false);
  });

  it('never walks the entity list for an event that cannot be his', () => {
    // The thunk is the point. This runs at the top of a per-event hot path, and it also
    // means a caller whose world is not wired yet (a bare-stub Renderer in a unit test)
    // cannot be made to throw by an unrelated effect event, which is how it first broke.
    const s = spy();
    let walked = 0;
    const entities = () => {
      walked++;
      return [at(0, 0)];
    };
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'runeCircle', radius: 12 }, s.fx, entities);
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'burst', radius: 12 }, s.fx, entities);
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova' }, s.fx, entities);
    expect(walked).toBe(0);
    routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova', radius: 12 }, s.fx, entities);
    expect(walked).toBe(1);
  });

  it('needs a radius, because the ring is drawn at the blast size', () => {
    const s = spy();
    expect(routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'nova' }, s.fx, () => [at(0, 0)])).toBe(false);
    expect(s.calls).toEqual([]);
  });
});
