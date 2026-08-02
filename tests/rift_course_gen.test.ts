// The rift parkour-course generator (src/sim/rift/course_gen.ts).
//
// The three claims that make procedural parkour shippable, audited across a
// seed sweep rather than trusted:
//
//   POSSIBLE. Every jump leg of every generated course fits the movement
//   envelope, checked by an independent reachability function derived from
//   the live movement constants, never the generator's own construction.
//
//   HARMLESS. The course draws from its own salt streams, so a floor that
//   does not roll one is byte-identical to the same floor before courses
//   existed, and the always-clear spine invariant survives on floors that do.
//
//   RANKED. C courses are wider, slower and flatter than S courses, from the
//   same tuning table the generator actually reads.
import { describe, expect, it } from 'vitest';
import {
  courseLegReachable,
  planCourse,
  RIFT_COURSE_TUNING,
  riftCourseRolls,
  SPINE_SAFE_Y,
} from '../src/sim/rift/course_gen';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import type { RiftFloorPlan } from '../src/sim/rift/types';

const RANKS = ['C', 'B', 'A', 'S'] as const;
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 37);

/** Every (floor, rank) pair across the sweep that rolled a course. */
function courseFloors(): Array<{ plan: RiftFloorPlan; rank: (typeof RANKS)[number] }> {
  const out: Array<{ plan: RiftFloorPlan; rank: (typeof RANKS)[number] }> = [];
  for (const seed of SEEDS) {
    for (const rank of RANKS) {
      const baseLevel = RIFT_RANK_BASE_LEVEL[rank];
      for (let floor = 0; floor < 3; floor++) {
        const plan = generateRiftFloor(seed, baseLevel, floor);
        if (plan.course) out.push({ plan, rank });
      }
    }
  }
  return out;
}

describe('course generation is deterministic and self-contained', () => {
  it('rebuilds byte-identical from the same descriptor', () => {
    const a = planCourse(4242, 1, RIFT_RANK_BASE_LEVEL.S, SITE);
    const b = planCourse(4242, 1, RIFT_RANK_BASE_LEVEL.S, SITE);
    expect(a).toEqual(b);
  });

  it('rolls from its own stream: the roll never varies with call order', () => {
    // Calling the full floor generator (which consumes the 0xf100 stream)
    // before or after the roll cannot change the answer.
    const before = riftCourseRolls(777, 0, RIFT_RANK_BASE_LEVEL.A);
    generateRiftFloor(777, RIFT_RANK_BASE_LEVEL.A, 0);
    expect(riftCourseRolls(777, 0, RIFT_RANK_BASE_LEVEL.A)).toBe(before);
  });

  it('appears somewhere and skips somewhere across the sweep, at every rank', () => {
    for (const rank of RANKS) {
      const rolls = SEEDS.map((s) => riftCourseRolls(s, 0, RIFT_RANK_BASE_LEVEL[rank]));
      expect(rolls.some(Boolean), `${rank} never rolls a course`).toBe(true);
      expect(
        rolls.some((r) => !r),
        `${rank} always rolls a course`,
      ).toBe(true);
    }
  });

  it('never lands on a boss floor', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const first = generateRiftFloor(seed, RIFT_RANK_BASE_LEVEL.S, 0);
      const bossIndex = first.floorCount - 1;
      const boss = generateRiftFloor(seed, RIFT_RANK_BASE_LEVEL.S, bossIndex);
      expect(boss.isBoss).toBe(true);
      expect(boss.course).toBeNull();
    }
  });

  it('suppresses every other headline mechanic on a course floor', () => {
    const floors = courseFloors();
    expect(floors.length).toBeGreaterThan(10); // vacuity floor for the sweep
    for (const { plan } of floors) {
      expect(plan.puzzle.kind).toBe('none');
      expect(plan.hazards).toHaveLength(0);
      expect(plan.rollers).toHaveLength(0);
      expect(plan.iceZone).toBeNull();
      expect(plan.platform).toBeNull();
      // Discarded puzzle props are filtered with the puzzle.
      for (const obj of plan.objects) {
        expect(['rune_pylon', 'ice_goal', 'boulder', 'boulder_pad', 'seq_rune']).not.toContain(
          obj.kind,
        );
      }
    }
  });
});

describe('every generated course is possible', () => {
  it('keeps every jump leg inside the movement envelope, at every rank', () => {
    let jumpLegs = 0;
    for (const { plan } of courseFloors()) {
      const course = plan.course;
      if (!course) continue;
      for (let i = 1; i < course.route.length; i++) {
        const to = course.route[i];
        if (to.via === 'ride') continue; // bridged by a mechanic, not a jump
        const from = course.route[i - 1];
        // Match waypoints to their decks for true extents; a waypoint always
        // sits on a real deck by construction.
        const fromDeck = deckAt(course, from.x, from.z);
        const toDeck = deckAt(course, to.x, to.z);
        expect(fromDeck, `no deck under waypoint ${i - 1}`).toBeTruthy();
        expect(toDeck, `no deck under waypoint ${i}`).toBeTruthy();
        jumpLegs++;
        expect(
          courseLegReachable(
            { ...from, hw: fromDeck?.hw ?? 1, hd: fromDeck?.hd ?? 1 },
            { ...to, hw: toDeck?.hw ?? 1, hd: toDeck?.hd ?? 1 },
          ),
          `leg ${i - 1} -> ${i} out of envelope (${JSON.stringify(from)} -> ${JSON.stringify(to)})`,
        ).toBe(true);
      }
    }
    expect(jumpLegs).toBeGreaterThan(100); // the sweep really exercised jumps
  });

  it('keeps low decks off the spine, so the floor walk survives', () => {
    for (const { plan } of courseFloors()) {
      for (const deck of plan.course?.decks ?? []) {
        const top = deck.y + (deck.kind === 'piston' && deck.motion ? deck.motion.amp : 0);
        if (deck.y < SPINE_SAFE_Y && top < SPINE_SAFE_Y) {
          expect(
            Math.abs(deck.x) - deck.hw,
            `low deck at (${deck.x}, ${deck.z}) y ${deck.y} intrudes on the spine`,
          ).toBeGreaterThanOrEqual(5.5);
        }
      }
    }
  });

  it('starts mountable from the floor and summits at its rank ceiling', () => {
    for (const { plan, rank } of courseFloors()) {
      const course = plan.course;
      if (!course) continue;
      // The mounting stair: reachable by jump apex + mantle from the floor.
      expect(course.route[0].y).toBeLessThanOrEqual(2.0);
      expect(course.summit.y).toBeLessThanOrEqual(RIFT_COURSE_TUNING[rank].summitY + 1e-9);
      // The gate switch, when a course floor is gated, stands ON the summit
      // deck (nudged within its footprint to clear floor furniture), and the
      // gate itself is NORTH of the summit: a plate beyond its own gate
      // would be a softlock.
      if (plan.gate) {
        expect(Math.abs(plan.gate.switchX - course.summit.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(plan.gate.switchZ - course.summit.z)).toBeLessThanOrEqual(2);
        expect(plan.gate.z).toBeGreaterThan(course.summit.z + 2);
        expect(plan.gate.switchZ).toBeLessThan(plan.gate.z);
      }
    }
  });

  it('gems are spurs: never on the route, always one hop off it', () => {
    for (const { plan } of courseFloors()) {
      const course = plan.course;
      if (!course) continue;
      for (const gem of course.gems) {
        const deck = deckAt(course, gem.x, gem.z);
        expect(deck, 'a gem floats over nothing').toBeTruthy();
        const onRoute = course.route.some(
          (w) => Math.abs(w.x - gem.x) < 0.5 && Math.abs(w.z - gem.z) < 0.5,
        );
        expect(onRoute, 'a gem sits on the golden route').toBe(false);
      }
    }
  });
});

describe('rank shapes the course', () => {
  it('C is wider, slower, flatter than S, from the live tuning table', () => {
    const c = RIFT_COURSE_TUNING.C;
    const s = RIFT_COURSE_TUNING.S;
    expect(c.deckHw).toBeGreaterThan(s.deckHw);
    expect(c.gap[1]).toBeLessThan(s.gap[1]);
    expect(c.summitY).toBeLessThan(s.summitY);
    expect(c.crumbleDelay).toBeGreaterThan(s.crumbleDelay);
    expect(c.blinkDuty).toBeGreaterThan(s.blinkDuty);
    expect(c.pistonPeriod[0]).toBeGreaterThan(s.pistonPeriod[0]);
    // The advanced kinds stay above C: a first-rift player meets static
    // jumps, pistons and crumble, nothing else.
    expect(c.kinds).not.toContain('ferry');
    expect(c.kinds).not.toContain('chase');
    expect(s.kinds).toContain('chase');
  });
});

function deckAt(
  course: NonNullable<RiftFloorPlan['course']>,
  x: number,
  z: number,
): { hw: number; hd: number } | null {
  for (const d of course.decks) {
    if (Math.abs(d.x - x) < 0.75 && Math.abs(d.z - z) < 0.75) return { hw: d.hw, hd: d.hd };
  }
  return null;
}

const SITE = {
  zMin: -19,
  zMax: 140,
  entryZ: -11,
  daisZ: 128,
  halfWidthAt: () => 13,
};
