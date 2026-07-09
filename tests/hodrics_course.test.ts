// Hodric's Castle course generation: determinism, the quality invariants
// (validateHcCourse) swept across hundreds of seeds and all difficulty
// tiers, segment coverage, the registry, and the pure obstacle pose math
// every host shares.

import { describe, expect, it } from 'vitest';
import {
  activeHodricsCourse,
  generateHcCourse,
  hcCourseFor,
  hcIdleCourseSeed,
  hcProgressFrac,
  hcSectionAt,
  hcStartPlate,
  hodricsGroundLocal,
  resetHodricsCourse,
  setActiveHodricsCourse,
  validateHcCourse,
} from '../src/sim/hodrics_course';
import {
  HC_CHASM_Y,
  type HcPusherDef,
  hcDrawspanX,
  hcLaneBoulders,
  hcPendulumAngle,
  hcPendulumAngVel,
  hcPusherExt,
  hcPusherX,
  hcSpinnerAngle,
} from '../src/sim/hodrics_layout';
import { hcRoundSeed } from '../src/sim/social/hodrics';

const SWEEP_SEEDS = 240;

describe('generateHcCourse determinism', () => {
  it('same seed and difficulty produce a deep-equal course', () => {
    for (const seed of [1, 42, 0xdeadbeef, 987654321]) {
      for (const diff of [0, 1, 2]) {
        expect(generateHcCourse(seed, diff)).toEqual(generateHcCourse(seed, diff));
      }
    }
  });

  it('different seeds produce different courses', () => {
    const a = generateHcCourse(1001, 1);
    const b = generateHcCourse(1002, 1);
    expect(JSON.stringify(a.sections.map((s) => s.id))).not.toEqual(
      JSON.stringify(b.sections.map((s) => s.id)),
    );
  });

  it('round seeds are distinct per round and stable', () => {
    const base = 123456;
    const seeds = [1, 2, 3].map((r) => hcRoundSeed(base, r));
    expect(new Set(seeds).size).toBe(3);
    expect(hcRoundSeed(base, 2)).toBe(seeds[1]);
  });
});

describe('quality invariants across the seed sweep', () => {
  it(`validateHcCourse is clean for ${SWEEP_SEEDS} seeds x 3 difficulties`, () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= SWEEP_SEEDS; seed++) {
      for (const diff of [0, 1, 2]) {
        const problems = validateHcCourse(generateHcCourse(seed * 7919, diff));
        if (problems.length > 0) bad.push(`seed ${seed * 7919} diff ${diff}: ${problems[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every middle segment type appears somewhere in the sweep', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      for (const s of generateHcCourse(seed * 104729, 1).sections) seen.add(s.id);
    }
    for (const id of [
      'hammer_bridge',
      'rotor_court',
      'axe_walk',
      'drawspan',
      'boulder_climb',
      'piston_ledge',
      'spinner_court',
    ]) {
      expect(seen.has(id), `segment ${id} never generated`).toBe(true);
    }
  });

  it('round 1 races 3 obstacle segments, later rounds 4', () => {
    const middle = (d: number) =>
      generateHcCourse(555, d).sections.filter(
        (s) =>
          s.id !== 'start_yard' &&
          s.id !== 'landing' &&
          s.id !== 'red_ascent' &&
          s.id !== 'finish_keep',
      ).length;
    expect(middle(0)).toBe(3);
    expect(middle(1)).toBe(4);
    expect(middle(2)).toBe(4);
  });

  it('start plates and the gallery stand on real ground; the rope is ahead of the plates', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const course = generateHcCourse(seed * 31337, seed % 3);
      for (let seat = 0; seat < 10; seat++) {
        const p = hcStartPlate(course, seat);
        expect(hodricsGroundLocal(course, p.x, p.z)).toBeGreaterThan(HC_CHASM_Y);
        expect(p.z).toBeLessThan(course.ropeZ);
      }
      const g = course.gallery;
      expect(hodricsGroundLocal(course, g.x, g.z)).toBeCloseTo(g.y);
    }
  });

  it('progress runs 0 at the plates to 1 at the finish', () => {
    const course = generateHcCourse(777, 1);
    expect(hcProgressFrac(course, course.checkpoints[0].z)).toBe(0);
    expect(hcProgressFrac(course, course.finishZ)).toBe(1);
    expect(hcProgressFrac(course, (course.checkpoints[0].z + course.finishZ) / 2)).toBeGreaterThan(
      0.2,
    );
  });

  it('hcSectionAt resolves every z inside the course to its span', () => {
    const course = generateHcCourse(4242, 2);
    for (const s of course.sections) {
      expect(hcSectionAt(course, (s.z0 + s.z1) / 2).id).toBe(s.id);
    }
  });
});

describe('the active-course registry', () => {
  it('falls back to the idle course, honors writes, resets clean', () => {
    resetHodricsCourse(0);
    const idle = activeHodricsCourse(0);
    expect(idle.seed).toBe(hcIdleCourseSeed(0));
    const live = hcCourseFor(999, 1);
    setActiveHodricsCourse(0, live);
    expect(activeHodricsCourse(0)).toBe(live);
    resetHodricsCourse(0);
    expect(activeHodricsCourse(0).seed).toBe(hcIdleCourseSeed(0));
  });

  it('hcCourseFor memoizes by seed and difficulty', () => {
    expect(hcCourseFor(31415, 1)).toBe(hcCourseFor(31415, 1));
    expect(hcCourseFor(31415, 1)).not.toBe(hcCourseFor(31415, 2));
  });
});

describe('obstacle pose math', () => {
  it('pendulum angle and angular velocity are consistent (numeric derivative)', () => {
    const amp = 1.05;
    const period = 2.6;
    const phase = 1.2;
    for (const t of [0, 0.31, 1.7, 4.44]) {
      const dt = 0.0005;
      const numeric =
        (hcPendulumAngle(amp, period, phase, t + dt) - hcPendulumAngle(amp, period, phase, t)) / dt;
      expect(hcPendulumAngVel(amp, period, phase, t)).toBeCloseTo(numeric, 2);
    }
  });

  it('drawspan x sweeps min..max as a triangle wave', () => {
    const d = {
      xMin: -6,
      xMax: 6,
      zCenter: 0,
      halfX: 3,
      halfZ: 5,
      y: 0,
      period: 8,
      phase: 0,
    };
    expect(hcDrawspanX(d, 0)).toBeCloseTo(-6);
    expect(hcDrawspanX(d, 2)).toBeCloseTo(0);
    expect(hcDrawspanX(d, 4)).toBeCloseTo(6);
    expect(hcDrawspanX(d, 8)).toBeCloseTo(-6);
  });

  it('boulder lanes release on schedule and interpolate their own ground line', () => {
    const lane = {
      x: 0,
      laneHalf: 2.6,
      zTop: 100,
      zEnd: 80,
      yTop: 6,
      yEnd: 0,
      speed: 10,
      r: 1.35,
      period: 3,
      phase: 0,
    };
    expect(hcLaneBoulders(lane, 0.0)).toHaveLength(1);
    const mid = hcLaneBoulders(lane, 1.0)[0];
    expect(mid.z).toBeCloseTo(90);
    expect(mid.y).toBeCloseTo(3 + lane.r);
    // travel = 2s, period 3: at t=2.5 the first is gone, none released since 3.
    expect(hcLaneBoulders(lane, 2.5)).toHaveLength(0);
  });

  it('pusher rams jab fast, retract slower, and dwell flush', () => {
    const d: HcPusherDef = {
      z: 0,
      y: 0,
      side: 1,
      wallX: 3.2,
      reach: 7.4,
      headR: 1.1,
      period: 3,
      phase: 0,
    };
    expect(hcPusherExt(d, 0)).toBeCloseTo(0);
    expect(hcPusherExt(d, 0.3)).toBeCloseTo(0.5); // mid-jab (20% of 3s = 0.6s)
    expect(hcPusherExt(d, 0.6)).toBeCloseTo(1); // full extension
    expect(hcPusherExt(d, 2.0)).toBeCloseTo(0); // dwelling flush
    // Head travels from the wall face toward -side across the ledge.
    expect(hcPusherX(d, 0)).toBeCloseTo(3.2);
    expect(hcPusherX(d, 0.6)).toBeCloseTo(3.2 - 7.4);
  });

  it('spinner angle advances linearly with omega', () => {
    const d = { cx: 0, cz: 0, y: 0, r: 5, omega: 0.7 };
    expect(hcSpinnerAngle(d, 0)).toBe(0);
    expect(hcSpinnerAngle(d, 2)).toBeCloseTo(1.4);
  });
});
