// The parkour-course kernel (src/sim/course/): the clock math, the runtime
// registries, and the standing-support query everything else builds on.
//
// The kernel's whole contract is determinism: every answer is a closed form
// in (authored constants, clock, what bodies did). These tests pin the shapes
// that gameplay hangs off: a piston rests at base at t = 0, a ferry has zero
// velocity at its turnarounds, a crumble deck re-hangs indistinguishable from
// new, an out-of-reach deck is invisible to the support query (which is what
// makes overlapping courses legal), and a rope thrown by a coherent crowd
// really does move out from under a foot.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CourseHazard, CourseRope } from '../src/sim/course';
import {
  armCourseChase,
  armCourseCrumble,
  blinkSolid,
  type CourseDeck,
  type CoursePlan,
  collectCourseGem,
  courseCheckpointFor,
  courseCrumblePhase,
  courseDeckCentre,
  courseDeckSolid,
  courseDeckTop,
  courseGemCount,
  coursePadAt,
  courseRopeOffset,
  courseRopePointAt,
  courseSupportAt,
  deferCourseCrumbleRehang,
  dutyActive,
  dutyTimeToFlip,
  ferryPos,
  hazardActive,
  hazardPos,
  lightCourseCheckpoint,
  pistonLift,
  resetCourseState,
  stepCourseRopes,
  sweeperFrame,
} from '../src/sim/course';

const K = 'test:0';

beforeEach(() => resetCourseState());

const plan = (over: Partial<CoursePlan>): CoursePlan => ({
  decks: [],
  hazards: [],
  ropes: [],
  pads: [],
  gems: [],
  braziers: [],
  crates: [],
  chases: [],
  summit: { x: 0, z: 0, y: 0 },
  route: [],
  ...over,
});

describe('closed-form motion', () => {
  it('pistons rest at base at t = 0 and peak at amp mid-period', () => {
    const m = { amp: 3, period: 6, phase: 0 };
    expect(pistonLift(m, 0)).toBeCloseTo(0, 9);
    expect(pistonLift(m, 3)).toBeCloseTo(3, 9);
    expect(pistonLift(m, 6)).toBeCloseTo(0, 9);
  });

  it('ferries rest at the authored end at t = 0 and pause at both turnarounds', () => {
    const track = { x2: 10, z2: 0, period: 8, phase: 0 };
    expect(ferryPos(0, 0, track, 0).x).toBeCloseTo(0, 9);
    expect(ferryPos(0, 0, track, 4).x).toBeCloseTo(10, 9);
    // Zero velocity at the turnaround: the position barely moves across it.
    const before = ferryPos(0, 0, track, 3.95).x;
    const after = ferryPos(0, 0, track, 4.05).x;
    expect(Math.abs(after - before)).toBeLessThan(0.02);
  });

  it('duty windows open for exactly their fraction, and the flip clock agrees', () => {
    const d = { period: 4, duty: 0.25, phase: 0 };
    expect(dutyActive(d, 0.5)).toBe(true);
    expect(dutyActive(d, 1.5)).toBe(false);
    expect(blinkSolid(d, 0.5)).toBe(true);
    // At t = 0.5 the window closes at cycle 0.25, i.e. t = 1.0.
    expect(dutyTimeToFlip(d, 0.5)).toBeCloseTo(0.5, 6);
    // At t = 1.5 the next window opens at t = 4.
    expect(dutyTimeToFlip(d, 1.5)).toBeCloseTo(2.5, 6);
  });

  it('blades sweep both ways, boulders reset, sweepers orbit', () => {
    const blade: CourseHazard = {
      kind: 'blade',
      x: 0,
      z: 0,
      y: 0,
      x2: 10,
      z2: 0,
      period: 4,
      duty: 1,
      phase: 0,
      damage: 10,
    };
    expect(hazardActive(blade, 99)).toBe(true);
    expect(hazardPos(blade, 0).x).toBeCloseTo(0, 6);
    expect(hazardPos(blade, 2).x).toBeCloseTo(10, 6);
    expect(hazardPos(blade, 4).x).toBeCloseTo(0, 6);

    const boulder: CourseHazard = { ...blade, kind: 'boulder' };
    // One way: just before the period ends it is near the far end; just
    // after, back at the start. A fresh mass, not a bounce.
    expect(hazardPos(boulder, 3.9).x).toBeGreaterThan(9);
    expect(hazardPos(boulder, 4.1).x).toBeLessThan(1);

    const sweeper: CourseHazard = {
      kind: 'sweeper',
      x: 0,
      z: 0,
      y: 0,
      len: 6,
      r: 0.8,
      period: 5,
      duty: 1,
      phase: 0,
      damage: 12,
      shove: 8,
    };
    // At phase 0 the beam points +z; a body 3 out on +z is ON the beam.
    const on = sweeperFrame(sweeper, 0, 0, 3);
    expect(on.along).toBeCloseTo(3, 6);
    expect(Math.abs(on.perp)).toBeLessThan(1e-6);
    // A quarter turn later the beam points +x and that body is clear.
    const off = sweeperFrame(sweeper, 1.25, 0, 3);
    expect(Math.abs(off.perp)).toBeCloseTo(3, 5);
  });
});

describe('crumble registry', () => {
  const spec = { delay: 1.2, respawn: 6 };

  it('runs solid, shaking, gone, then re-hangs indistinguishable from new', () => {
    expect(courseCrumblePhase(spec, K, 3, 10)).toBe('solid');
    expect(armCourseCrumble(K, 3, 10)).toBe(true);
    expect(armCourseCrumble(K, 3, 10.5)).toBe(false); // already armed
    expect(courseCrumblePhase(spec, K, 3, 10.6)).toBe('shaking');
    expect(courseCrumblePhase(spec, K, 3, 11.3)).toBe('gone');
    expect(courseCrumblePhase(spec, K, 3, 17.3)).toBe('solid');
    // Pruned on read: arming again works exactly like the first time.
    expect(armCourseCrumble(K, 3, 20)).toBe(true);
  });

  it('defers the re-hang under a body still falling in the column', () => {
    armCourseCrumble(K, 1, 0);
    // Just before re-hang (0 + 1.2 + 6 = 7.2), a faller defers it.
    deferCourseCrumbleRehang(spec, K, 1, 7.0);
    expect(courseCrumblePhase(spec, K, 1, 7.3)).toBe('gone');
    expect(courseCrumblePhase(spec, K, 1, 7.7)).toBe('solid');
  });

  it('arms a chase run with delays growing along the run', () => {
    expect(armCourseChase(K, [4, 5, 6], [0, 4, 8], 4, 100)).toBe(true);
    // Deck 4 arms at 100, deck 6 at 102: at t 100.1 the near deck shakes
    // while the far one is still untouched-solid.
    expect(courseCrumblePhase(spec, K, 4, 100.1)).toBe('shaking');
    expect(courseCrumblePhase(spec, K, 6, 100.1)).toBe('solid');
    expect(courseCrumblePhase(spec, K, 6, 102.5)).toBe('shaking');
    // Re-crossing the trigger never re-arms a live run.
    expect(armCourseChase(K, [4, 5, 6], [0, 4, 8], 4, 101)).toBe(false);
  });
});

describe('checkpoints and gems', () => {
  it('checkpoints only move forward, per player', () => {
    expect(courseCheckpointFor(K, 7)).toBeNull();
    expect(lightCourseCheckpoint(K, 7, 1)).toBe(true);
    expect(lightCourseCheckpoint(K, 7, 0)).toBe(false); // never backward
    expect(courseCheckpointFor(K, 7)).toBe(1);
    expect(courseCheckpointFor(K, 8)).toBeNull(); // personal progress
  });

  it('gems count once each, per player', () => {
    expect(collectCourseGem(K, 7, 2)).toBe(true);
    expect(collectCourseGem(K, 7, 2)).toBe(false);
    expect(collectCourseGem(K, 7, 5)).toBe(true);
    expect(courseGemCount(K, 7)).toBe(2);
    expect(courseGemCount(K, 8)).toBe(0);
  });
});

describe('rope oscillator', () => {
  const rope: CourseRope = {
    id: 'r1',
    x1: 0,
    z1: 0,
    y1: 4,
    x2: 12,
    z2: 0,
    y2: 4,
    halfWidth: 0.5,
    sag: 0.8,
    sway: 2.2,
  };

  it('one steady walker barely disturbs it; a coherent crowd throws it', () => {
    const DT = 1 / 20;
    // One body walking the line, no lateral velocity.
    for (let t = 0; t < 60; t++) {
      stepCourseRopes([rope], K, [{ x: 6, z: 0, y: 3.2, vx: 0, vz: 0 }], DT);
    }
    const solo = Math.abs(courseRopeOffset(K, 'r1'));
    resetCourseState();
    // Three bodies pushing the same way at midspan.
    for (let t = 0; t < 60; t++) {
      const crowd = [0, 1, 2].map((i) => ({ x: 4 + i * 2, z: 0.4, y: 3.2, vx: 0, vz: 3 }));
      stepCourseRopes([rope], K, crowd, DT);
    }
    const crowd = Math.abs(courseRopeOffset(K, 'r1'));
    expect(crowd).toBeGreaterThan(solo * 3);
    expect(crowd).toBeLessThanOrEqual(rope.sway + 1e-9); // capped, never flung
  });

  it('parks exactly at rest when unloaded, so an idle course is stable', () => {
    const DT = 1 / 20;
    for (let t = 0; t < 20; t++) {
      stepCourseRopes([rope], K, [{ x: 6, z: 0.5, y: 3.2, vx: 0, vz: 2 }], DT);
    }
    expect(Math.abs(courseRopeOffset(K, 'r1'))).toBeGreaterThan(0);
    for (let t = 0; t < 20 * 30; t++) stepCourseRopes([rope], K, [], DT);
    expect(courseRopeOffset(K, 'r1')).toBe(0);
  });

  it('the swayed line is where the foot must be', () => {
    const p = courseRopePointAt(rope, 0.5, 1.5);
    expect(p.z).toBeCloseTo(1.5, 6); // full offset at midspan
    expect(p.y).toBeCloseTo(4 - 0.8, 6); // full sag at midspan
    const anchor = courseRopePointAt(rope, 0, 1.5);
    expect(anchor.z).toBeCloseTo(0, 6); // none at the anchors
  });
});

describe('the support query', () => {
  it('ignores decks above reach, which is what makes overlap legal', () => {
    const decks: CourseDeck[] = [
      { x: 0, z: 0, hw: 2, hd: 2, y: 2 },
      { x: 0, z: 0, hw: 2, hd: 2, y: 7 }, // directly above: a spiral upper turn
    ];
    const p = plan({ decks });
    // A body at foot level reaches only the low deck.
    expect(courseSupportAt(p, K, 0, 0, 0, 3)?.top).toBe(2);
    // A body climbing near the top reads the high one.
    expect(courseSupportAt(p, K, 0, 0, 0, 8)?.top).toBe(7);
    // Nothing in reach at all: null, the caller falls back to the room floor.
    expect(courseSupportAt(p, K, 0, 0, 0, 1)).toBeNull();
  });

  it('tracks a ferry to where it actually is', () => {
    const p = plan({
      decks: [
        {
          x: 0,
          z: 0,
          hw: 1.5,
          hd: 1.5,
          y: 2,
          kind: 'ferry',
          track: { x2: 10, z2: 0, period: 8, phase: 0 },
        },
      ],
    });
    expect(courseSupportAt(p, K, 0, 0, 0, 5)?.top).toBe(2);
    expect(courseSupportAt(p, K, 0, 0, 4, 5)).toBeNull(); // it sailed away
    expect(courseSupportAt(p, K, 10, 0, 4, 5)?.top).toBe(2);
    expect(courseDeckCentre(p.decks[0], 4).x).toBeCloseTo(10, 9);
  });

  it('drops blink tiles out of their window and gone crumble decks', () => {
    const p = plan({
      decks: [
        {
          x: 0,
          z: 0,
          hw: 2,
          hd: 2,
          y: 3,
          kind: 'blink',
          window: { period: 4, duty: 0.5, phase: 0 },
        },
        { x: 6, z: 0, hw: 2, hd: 2, y: 3, kind: 'crumble', crumble: { delay: 1, respawn: 5 } },
      ],
    });
    expect(courseSupportAt(p, K, 0, 0, 1, 5)?.top).toBe(3);
    expect(courseSupportAt(p, K, 0, 0, 3, 5)).toBeNull(); // blinked out
    expect(courseDeckSolid(p.decks[0], 0, K, 3)).toBe(false);
    armCourseCrumble(K, 1, 0);
    expect(courseSupportAt(p, K, 6, 0, 0.5, 5)?.top).toBe(3); // still shaking
    expect(courseSupportAt(p, K, 6, 0, 2, 5)).toBeNull(); // gone
  });

  it('folds ropes in as narrow live stands', () => {
    const p = plan({
      ropes: [
        { id: 'r', x1: -6, z1: 0, y1: 4, x2: 6, z2: 0, y2: 4, halfWidth: 0.5, sag: 0.6, sway: 2 },
      ],
    });
    const stand = courseSupportAt(p, K, 0, 0, 0, 5);
    expect(stand).toBeTruthy();
    expect(stand?.index).toBe(-1);
    expect(stand?.top).toBeCloseTo(4 - 0.6, 6); // midspan sag
    expect(courseSupportAt(p, K, 0, 1.2, 0, 5)).toBeNull(); // off the strip
  });

  it('pistons carry their top with the clock', () => {
    const p = plan({
      decks: [
        { x: 0, z: 0, hw: 2, hd: 2, y: 2, kind: 'piston', motion: { amp: 3, period: 6, phase: 0 } },
      ],
    });
    expect(courseDeckTop(p.decks[0], 0)).toBeCloseTo(2, 9);
    expect(courseDeckTop(p.decks[0], 3)).toBeCloseTo(5, 9);
    expect(courseSupportAt(p, K, 0, 0, 3, 4)).toBeNull(); // crest out of reach
    expect(courseSupportAt(p, K, 0, 0, 3, 6)?.top).toBeCloseTo(5, 9);
  });

  it('finds the pad under a standing body and not under a flyer', () => {
    const p = plan({
      pads: [{ kind: 'conveyor', x: 0, z: 0, hw: 3, hd: 1.5, y: 2, dirX: 1, dirZ: 0, strength: 4 }],
    });
    expect(coursePadAt(p, 0, 0, 2.1)?.kind).toBe('conveyor');
    expect(coursePadAt(p, 0, 0, 6)).toBeNull();
    expect(coursePadAt(p, 5, 0, 2)).toBeNull();
  });
});
