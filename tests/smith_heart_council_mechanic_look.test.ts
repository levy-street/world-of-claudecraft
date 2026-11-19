// The Hammer Council's boss-mechanic looks as numbers
// (src/render/smith_heart_fx/council_mechanic_look_core.ts): each member's real
// body, Mountain's Rush's wind-up and run read the sim's own tuning, and the
// scar it tears follows the body, cools and fades.

import { describe, expect, it } from 'vitest';
import {
  MEMBER_BODY,
  RUSH_ARROW,
  RUSH_SCAR,
  RUSH_TRACE_SECONDS,
  type RushArrowLook,
  rushArrowLook,
  rushPhase,
  rushScar,
} from '../src/render/smith_heart_fx/council_mechanic_look_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { COUNCIL_TUNING as T } from '../src/sim/encounters/smith_heart/council_ids';

describe("the members' bodies", () => {
  it("reads each member's real body: the Guardian towers over the Singer", () => {
    // The Guardian drawn at 4.6 times its 3.2 scale (about 14.7 yd), the Singer at 5.5 times
    // her 2.0 (11 yd): she reaches about its shoulder.
    expect(MEMBER_BODY.guardian.height).toBeCloseTo(
      4.6 * (SMITH_HEART_MOBS.heart_hammer_guardian?.scale ?? 0),
      6,
    );
    expect(MEMBER_BODY.singer.height).toBeCloseTo(
      5.5 * (SMITH_HEART_MOBS.heart_seam_singer?.scale ?? 0),
      6,
    );
    expect(MEMBER_BODY.guardian.height).toBeGreaterThan(MEMBER_BODY.singer.height * 1.25);
    expect(MEMBER_BODY.singer.height).toBeGreaterThan(MEMBER_BODY.guardian.height * 0.65);
    for (const role of ['guardian', 'singer'] as const) {
      expect(MEMBER_BODY[role].chest).toBeGreaterThan(0.5);
      expect(MEMBER_BODY[role].chest).toBeLessThan(1);
    }
  });
});

describe("Mountain's Rush: the wind-up, the run and the scar", () => {
  it("phases off the sim's own wind-up", () => {
    const o = { phase: 'over' as const as 'windup' | 'run' | 'over', k: 0 };
    expect(rushPhase(0, 1, o).phase).toBe('windup');
    expect(rushPhase(T.rushWindup / 2, 1, o)).toEqual({ phase: 'windup', k: 0.5 });
    expect(rushPhase(T.rushWindup + 0.25, 1, o)).toEqual({ phase: 'run', k: 0.25 });
    expect(rushPhase(T.rushWindup + 1.01, 1, o).phase).toBe('over');
  });

  it('tears the scar behind the body, then cools and fades it', () => {
    const o = { reveal: 0, heat: 0, fade: 0 };
    expect(rushScar(T.rushWindup * 0.5, 1, o).reveal).toBe(0);
    rushScar(T.rushWindup + 0.5, 1, o);
    expect(o.reveal).toBeCloseTo(0.5, 9);
    expect(o.heat).toBe(1);
    expect(o.fade).toBe(1);
    rushScar(T.rushWindup + 1 + RUSH_SCAR.hold, 1, o);
    expect(o.reveal).toBe(1);
    expect(o.heat).toBe(0);
    expect(o.fade).toBe(1);
    rushScar(T.rushWindup + 1 + RUSH_TRACE_SECONDS, 1, o);
    expect(o.fade).toBe(0);
  });
});

describe("Mountain's Rush: the arrow over the marked player", () => {
  const look = (): RushArrowLook => ({ y: 0, glow: 0, scale: 0 });

  it('floats clear of the head, bobbing, and never dims below its floor', () => {
    for (let k = 0; k <= 40; k++) {
      const t = k * 0.137;
      const l = rushArrowLook(3, 5, t, false, look());
      expect(l.y).toBeGreaterThanOrEqual(RUSH_ARROW.tip - 1e-9);
      expect(l.y).toBeLessThanOrEqual(RUSH_ARROW.tip + RUSH_ARROW.bob + 1e-9);
      expect(l.glow).toBeGreaterThanOrEqual(RUSH_ARROW.glowFloor - 1e-9);
      expect(l.glow).toBeLessThanOrEqual(1 + 1e-9);
      expect(l.scale).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('pulses faster and swells more as the bar runs out', () => {
    // The bar sweeps down at 200 frames a second: count the pulse's crests and its
    // biggest swell in the bar's first second and in its last.
    const sweep = (from: number) => {
      let n = 0;
      let big = 0;
      let prev = rushArrowLook(5 - from, 5, from, false, look()).glow;
      let rising = false;
      for (let k = 1; k <= 200; k++) {
        const t = from + k * 0.005;
        const l = rushArrowLook(5 - t, 5, t, false, look());
        if (l.glow < prev && rising) n++;
        rising = l.glow > prev;
        prev = l.glow;
        big = Math.max(big, l.scale);
      }
      return { n, big };
    };
    const first = sweep(0);
    const last = sweep(4);
    expect(last.n).toBeGreaterThan(first.n);
    const early = first.big;
    const late = last.big;
    expect(late).toBeGreaterThan(early);
  });

  it('a long session never turns the pulse into flicker: frame to frame it moves a little', () => {
    // An hour into the session, the mark's bar sweeping down at 60 frames a second.
    let prev = rushArrowLook(5, 5, 3600, false, look()).glow;
    for (let k = 1; k <= 300; k++) {
      const g = rushArrowLook(5 - k / 60, 5, 3600 + k / 60, false, look()).glow;
      expect(Math.abs(g - prev)).toBeLessThan(0.1);
      prev = g;
    }
  });

  it('reduced motion holds it still and lit full: the mark stays', () => {
    const a = rushArrowLook(2, 5, 1.3, true, look());
    const b = rushArrowLook(2, 5, 7.9, true, look());
    expect(a).toEqual(b);
    expect(a).toEqual({ y: RUSH_ARROW.tip, glow: 1, scale: 1 });
  });
});
