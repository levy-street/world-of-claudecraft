// Procedural parkour courses for rift floors: the generator that turns the
// course kernel (src/sim/course/) into a headline mechanic.
//
// A course is an elevated deck circuit climbing a floor's FLANK, off the
// always-clear centre spine, from a low mounting stair near the entry to a
// summit near the dais end. Legs alternate mechanic kinds by rank: static
// jumps everywhere, pistons and crumble runs from C, blink tiles and rope
// spans from B, ferries, wave plazas, geysers and conveyors from A, collapse
// chases and sweepers at S. Gems hang off spur decks for completionists,
// braziers checkpoint the climb, and on gated floors the rune switch stands
// on the summit, so the way down is EARNED.
//
// Two invariants carried from the wider rift design:
//
//   The spine stays clear. Decks below SPINE_SAFE_Y keep their footprint
//   outside |x| <= AISLE + 1.2; above it they may cross the spine freely,
//   because the support query is reach-gated and a walker on the floor
//   cannot be caught by a top more than a jump-and-mantle above their feet.
//
//   Determinism without draw-order risk. The whole course draws from its OWN
//   salt stream (the SET_PIECE_CHANCE pattern), never the floor's 0xf100
//   stream, so a non-course floor regenerates byte-identical to a build that
//   never heard of courses.
//
// Every leg is built FROM the movement envelope (live constants, never
// remembered numbers), so a generated course is possible by construction;
// tests/rift_course_gen.test.ts audits the same claim with an independent
// checker across a seed sweep.

import { MANTLE_REACH } from '../colliders';
import type {
  CourseBrazier,
  CourseCrate,
  CourseDeck,
  CourseGem,
  CourseHazard,
  CoursePad,
  CoursePlan,
  CourseRope,
} from '../course';
import { GRAVITY, JUMP_VELOCITY } from '../player_motion';
import { Rng } from '../rng';
import type { RiftTier } from '../types';
import { RUN_SPEED } from '../types';
import { riftRankForBaseLevel } from './ranks';
import { mixSeed } from './style';

/** The course stream's salt: independent of every other rift stream. */
export const RIFT_COURSE_SALT = 0xc0d0;

/** Below this height a deck's footprint must stay off the spine band. */
export const SPINE_SAFE_Y = 2.5;

/** The spine half-width plus the clearance margin courses keep below
 *  SPINE_SAFE_Y. Mirrors rift_gen's AISLE_HALF without importing it (the
 *  generator's internal constant is not exported); pinned against the spine
 *  walkability test rather than the literal. */
const SPINE_KEEP_OUT = 6.7;

/** Full jump arc: seconds airborne and yards covered at run speed. */
const ARC_SECONDS = (2 * JUMP_VELOCITY) / GRAVITY;
const FLAT_GAP_MAX = RUN_SPEED * ARC_SECONDS - 0.7;

/**
 * The longest EDGE gap a leg may span for a given rise, with a safety margin
 * under the kernel's true ceiling. Rising legs shorten fast (the arc spends
 * itself climbing); dropping legs stretch a little. The +rise ceiling is the
 * jump apex plus the mantle: above that no gap is legal at all.
 */
export function courseMaxGapFor(rise: number): number {
  if (rise > JUMP_VELOCITY ** 2 / (2 * GRAVITY) + MANTLE_REACH - 0.25) return 0;
  if (rise <= 0) return FLAT_GAP_MAX + Math.min(1.6, -rise * 0.5);
  return Math.max(1.1, FLAT_GAP_MAX - rise * 2.4);
}

/** The independent reachability check the audit test uses: is the edge gap
 *  between two decks within the envelope for their rise? */
export function courseLegReachable(
  from: { x: number; z: number; y: number; hw: number; hd: number },
  to: { x: number; z: number; y: number; hw: number; hd: number },
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const centre = Math.hypot(dx, dz);
  // Half-extent of each deck along the leg direction (support of the AABB).
  const ux = centre > 1e-6 ? dx / centre : 1;
  const uz = centre > 1e-6 ? dz / centre : 0;
  const fromHalf = Math.abs(ux) * from.hw + Math.abs(uz) * from.hd;
  const toHalf = Math.abs(ux) * to.hw + Math.abs(uz) * to.hd;
  const edgeGap = Math.max(0, centre - fromHalf - toHalf);
  return edgeGap <= courseMaxGapFor(to.y - from.y) + 1e-6;
}

/** Rank tuning: every knob that makes an S course meaner than a C course. */
interface CourseTuning {
  chance: number;
  legs: [number, number];
  gap: [number, number];
  deckHw: number;
  rise: [number, number];
  summitY: number;
  pistonPeriod: [number, number];
  crumbleDelay: number;
  crumbleRespawn: number;
  blinkPeriod: number;
  blinkDuty: number;
  hazardChance: number;
  gems: number;
  gateChance: number;
  /** Mechanic kinds this rank may draw for a leg (weighted by repetition). */
  kinds: readonly LegKind[];
}

type LegKind =
  | 'static'
  | 'piston'
  | 'crumbleRun'
  | 'blinkRun'
  | 'rope'
  | 'ferry'
  | 'wave'
  | 'geyser'
  | 'conveyor'
  | 'chase';

export const RIFT_COURSE_TUNING: Record<RiftTier, CourseTuning> = {
  C: {
    chance: 0.3,
    legs: [4, 6],
    gap: [2.0, 3.2],
    deckHw: 1.3,
    rise: [0.3, 0.9],
    summitY: 4.6,
    pistonPeriod: [6.5, 8],
    crumbleDelay: 1.7,
    crumbleRespawn: 7,
    blinkPeriod: 5,
    blinkDuty: 0.68,
    hazardChance: 0.18,
    gems: 1,
    gateChance: 0,
    kinds: ['static', 'static', 'static', 'piston', 'crumbleRun'],
  },
  B: {
    chance: 0.38,
    legs: [5, 8],
    gap: [2.4, 3.8],
    deckHw: 1.2,
    rise: [0.4, 1.1],
    summitY: 5.6,
    pistonPeriod: [5.5, 7],
    crumbleDelay: 1.4,
    crumbleRespawn: 7,
    blinkPeriod: 4.4,
    blinkDuty: 0.6,
    hazardChance: 0.28,
    gems: 2,
    gateChance: 0.45,
    kinds: ['static', 'static', 'piston', 'crumbleRun', 'blinkRun', 'rope'],
  },
  A: {
    chance: 0.45,
    legs: [6, 9],
    gap: [2.8, 4.2],
    deckHw: 1.1,
    rise: [0.5, 1.25],
    summitY: 6.6,
    pistonPeriod: [4.8, 6.2],
    crumbleDelay: 1.2,
    crumbleRespawn: 6,
    blinkPeriod: 4,
    blinkDuty: 0.55,
    hazardChance: 0.38,
    gems: 2,
    gateChance: 0.55,
    kinds: [
      'static',
      'piston',
      'crumbleRun',
      'blinkRun',
      'rope',
      'ferry',
      'wave',
      'geyser',
      'conveyor',
    ],
  },
  S: {
    chance: 0.5,
    legs: [7, 10],
    gap: [3.0, 4.6],
    deckHw: 1.0,
    rise: [0.5, 1.4],
    summitY: 7.6,
    pistonPeriod: [4.2, 5.4],
    crumbleDelay: 1.0,
    crumbleRespawn: 6,
    blinkPeriod: 3.6,
    blinkDuty: 0.5,
    hazardChance: 0.5,
    gems: 3,
    gateChance: 0.65,
    kinds: [
      'piston',
      'crumbleRun',
      'blinkRun',
      'rope',
      'ferry',
      'wave',
      'geyser',
      'conveyor',
      'chase',
    ],
  },
};

/** The geometry facts planCourse reads off the generated floor. */
export interface CourseSite {
  zMin: number;
  zMax: number;
  entryZ: number;
  daisZ: number;
  halfWidthAt: (z: number) => number;
}

/** Should this floor carry a course at all? Its own stream, one draw, so the
 *  answer never disturbs anything else. Boss floors never do: the arena
 *  belongs to the fight. */
export function riftCourseRolls(seed: number, floorIndex: number, baseLevel: number): boolean {
  const tuning = RIFT_COURSE_TUNING[riftRankForBaseLevel(baseLevel)];
  return new Rng(mixSeed(seed, RIFT_COURSE_SALT + floorIndex)).chance(tuning.chance);
}

/** Clamp a deck centre into the legal band at its z and height: below
 *  SPINE_SAFE_Y the spine band is a wall; above it only the shell binds. */
function clampDeckX(
  x: number,
  z: number,
  y: number,
  hw: number,
  side: 1 | -1,
  site: CourseSite,
): number {
  const shell = site.halfWidthAt(z) - 1 - hw;
  let lo: number;
  let hi: number;
  if (y < SPINE_SAFE_Y) {
    // One-sided flank band. On a floor too narrow for the margin, the spine
    // bound WINS (a deck brushing the wall render is survivable; a deck in
    // the spine is not).
    lo = SPINE_KEEP_OUT + hw;
    hi = Math.max(lo, shell);
  } else {
    // Full width at height, bounded by the shell alone. Never forced OUT to
    // a floor width the room does not have.
    hi = Math.max(2, shell);
    lo = -hi;
  }
  const clamped = Math.max(lo, Math.min(hi, x));
  // Below the safe height the band is one-sided; reflect onto the live side.
  return y < SPINE_SAFE_Y ? Math.abs(clamped) * side : clamped;
}

/**
 * Generate the course for one floor, or null when this floor does not roll
 * one. Pure: same (seed, floorIndex, baseLevel, site) always builds the same
 * course, from its own rng stream.
 */
export function planCourse(
  seed: number,
  floorIndex: number,
  baseLevel: number,
  site: CourseSite,
): CoursePlan | null {
  if (!riftCourseRolls(seed, floorIndex, baseLevel)) return null;
  const rank = riftRankForBaseLevel(baseLevel);
  const tuning = RIFT_COURSE_TUNING[rank];
  const rng = new Rng(mixSeed(seed, RIFT_COURSE_SALT + 0x100 + floorIndex));

  const decks: CourseDeck[] = [];
  const hazards: CourseHazard[] = [];
  const ropes: CourseRope[] = [];
  const pads: CoursePad[] = [];
  const gems: CourseGem[] = [];
  const braziers: CourseBrazier[] = [];
  const crates: CourseCrate[] = [];
  const chases: CoursePlan['chases'] = [];
  const route: CoursePlan['route'] = [];

  let side: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const legCount = rng.int(tuning.legs[0], tuning.legs[1]);
  // The climb spans from just past the entry clearing to just short of the
  // dais, so the summit overlooks the boss end without touching the arena.
  const z0 = site.entryZ + 14;
  // Ends south of the gate band: a gated course floor stands its portcullis
  // at daisZ - 22 (planGate's own boundary), and the summit plate must be
  // reachable WITHOUT passing the gate it opens.
  const z1 = site.daisZ - 30;
  const dzPerLeg = (z1 - z0) / Math.max(1, legCount);

  // The mounting stair: two wide static steps a floor walker can jump-mantle
  // onto, hugging the flank. Every course starts readable.
  const hw0 = tuning.deckHw + 0.5;
  let x = clampDeckX(SPINE_KEEP_OUT + hw0 + 1.5, z0 - 4, 0.9, hw0, side, site);
  let z = z0 - 4;
  let y = 0.9;
  decks.push({ x, z, hw: hw0, hd: hw0, y });
  route.push({ x, z, y });

  // The half-extent of the deck the route currently stands on. The
  // scale-back below must use TRUE extents on both sides: assuming
  // stand-sized decks let a leg onto a smaller run tile land just outside
  // the envelope.
  let prevHalf = hw0;

  const push = (deck: CourseDeck): void => {
    decks.push(deck);
    route.push({ x: deck.x, z: deck.z, y: deck.y });
    prevHalf = Math.min(deck.hw, deck.hd);
  };

  // Choose a leg target within the envelope FROM the current stand: rise
  // first, then a gap the rise still allows. Construction, not validation.
  const nextStand = (
    hw: number,
    riseOverride?: [number, number],
    toHalf: number = hw,
  ): { x: number; z: number; y: number } => {
    const [r0, r1] = riseOverride ?? tuning.rise;
    const rise = Math.min(r1, Math.max(r0, rng.range(r0, r1)));
    const targetY = Math.min(tuning.summitY, y + rise);
    const realRise = targetY - y;
    const budget = Math.min(tuning.gap[1], courseMaxGapFor(realRise)) * 0.88;
    const gap = Math.max(1.2, Math.min(budget, rng.range(tuning.gap[0], tuning.gap[1])));
    const zStep = Math.min(Math.abs(dzPerLeg) + 2.5, gap + hw * 2);
    const nz = Math.min(z1, z + Math.max(1.5, zStep));
    // Lateral drift: wander the flank, cross freely once high enough.
    const drift = rng.range(-2.2, 2.2);
    const nx = clampDeckX(x + drift, nz, targetY, hw, side, site);
    // Re-derive the gap along the true direction so the edge gap never
    // exceeds the budget whatever the clamp did to the line.
    const d = Math.hypot(nx - x, nz - z);
    if (d > 1e-6) {
      const scale = Math.min(1, (budget + prevHalf + toHalf) / d);
      return { x: x + (nx - x) * scale, z: z + (nz - z) * scale, y: targetY };
    }
    return { x: nx, z: nz, y: targetY };
  };

  for (let leg = 0; leg < legCount; leg++) {
    const kind = tuning.kinds[rng.int(0, tuning.kinds.length - 1)];
    const hw = tuning.deckHw;
    const t = leg / Math.max(1, legCount - 1);

    if (kind === 'rope') {
      // A rope span: anchor deck, the rope, landing deck across the shell or
      // along it, level (ropes never climb).
      const a = nextStand(hw, [0, 0.2]);
      x = a.x;
      z = a.z;
      y = a.y;
      push({ x, z, hw, hd: hw, y });
      const span = rng.range(7, 10);
      const nz = Math.min(z1, z + span);
      const nx = clampDeckX(x + rng.range(-3, 3), nz, y, hw, side, site);
      ropes.push({
        id: `rope${leg}`,
        x1: x,
        z1: z,
        y1: y,
        x2: nx,
        z2: nz,
        y2: y,
        halfWidth: 0.5,
        sag: rng.range(0.5, 0.9),
        sway: rank === 'S' ? 2.4 : 1.8,
      });
      x = nx;
      z = nz;
      decks.push({ x, z, hw, hd: hw, y });
      route.push({ x, z, y, via: 'ride' });
      continue;
    }

    if (kind === 'ferry' && y >= SPINE_SAFE_Y) {
      // A ferry across the width: board deck, the ferry, far-side landing.
      const a = nextStand(hw, [0, 0.3]);
      x = a.x;
      z = a.z;
      y = a.y;
      push({ x, z, hw, hd: hw, y });
      const farSide = (side * -1) as 1 | -1;
      const nz = Math.min(z1, z + rng.range(3, 5));
      const nx = clampDeckX(Math.abs(x) * farSide, nz, y, hw, farSide, site);
      decks.push({
        x,
        z: z + 1.8,
        hw: hw + 0.2,
        hd: hw + 0.2,
        y,
        kind: 'ferry',
        track: { x2: nx, z2: nz - 1.8, period: rng.range(7, 9), phase: rng.range(0, 1) },
      });
      side = farSide;
      x = nx;
      z = nz;
      decks.push({ x, z, hw, hd: hw, y });
      route.push({ x, z, y, via: 'ride' });
      continue;
    }

    if (kind === 'wave') {
      // A plaza of five small pistons phased so the crest travels: ride it.
      const a = nextStand(hw, [0, 0.2]);
      x = a.x;
      z = a.z;
      y = a.y;
      push({ x, z, hw, hd: hw, y });
      const period = rng.range(4.5, 6);
      const count = 4;
      for (let i = 1; i <= count; i++) {
        const nz = Math.min(z1, z + i * 2.4);
        decks.push({
          x: clampDeckX(x, nz, y, 1.0, side, site),
          z: nz,
          hw: 1.0,
          hd: 1.0,
          y: Math.max(0.9, y - 0.4),
          kind: 'piston',
          motion: { amp: 1.6, period, phase: i / count },
        });
      }
      z = Math.min(z1, z + count * 2.4 + 1.6);
      x = clampDeckX(x, z, y, hw, side, site);
      decks.push({ x, z, hw, hd: hw, y });
      route.push({ x, z, y, via: 'ride' });
      continue;
    }

    if (kind === 'chase') {
      // The collapse chase: a run of crumble decks armed as a wave when the
      // first is stood on. Sprint or swim in the room floor's regret.
      const runLen = rng.int(4, 6);
      const spacing = 2.6;
      const first = decks.length;
      const indices: number[] = [];
      const spacings: number[] = [];
      for (let i = 0; i < runLen; i++) {
        const nz = Math.min(z1, z + (i + 1) * spacing);
        indices.push(decks.length);
        spacings.push(i * spacing);
        decks.push({
          x: clampDeckX(x, nz, y, 1.1, side, site),
          z: nz,
          hw: 1.1,
          hd: 1.1,
          y,
          kind: 'crumble',
          crumble: { delay: 0.9, respawn: tuning.crumbleRespawn },
        });
      }
      chases.push({
        triggerX: decks[first].x,
        triggerZ: decks[first].z,
        triggerR: 1.6,
        deckIndices: indices,
        spacings,
        waveSpeed: rng.range(3.4, 4.2),
      });
      z = Math.min(z1, z + runLen * spacing + 2);
      x = clampDeckX(x, z, y, hw, side, site);
      decks.push({ x, z, hw, hd: hw, y });
      route.push({ x, z, y, via: 'ride' });
      continue;
    }

    // The single-deck kinds share the stand picker.
    const stand = nextStand(
      tuning.deckHw,
      kind === 'geyser' ? [1.4, 1.9] : undefined,
      kind === 'crumbleRun' ? 1.1 : kind === 'blinkRun' ? 1.0 : tuning.deckHw,
    );
    x = stand.x;
    z = stand.z;
    y = stand.y;

    if (kind === 'piston') {
      const padY = Math.max(0.9, y - rng.range(0.8, 1.4));
      x = clampDeckX(x, z, padY, hw, side, site);
      decks.push({
        x,
        z,
        hw,
        hd: hw,
        y: padY,
        kind: 'piston',
        motion: {
          amp: rng.range(1.4, 2.2),
          period: rng.range(tuning.pistonPeriod[0], tuning.pistonPeriod[1]),
          phase: rng.range(0, 1),
        },
      });
      route.push({ x, z, y });
      prevHalf = hw;
    } else if (kind === 'crumbleRun') {
      const runLen = rng.int(2, 3);
      let lastZ = z;
      for (let i = 0; i < runLen; i++) {
        lastZ = Math.min(z1, z + i * 2.4);
        decks.push({
          x: clampDeckX(x, lastZ, y, 1.1, side, site),
          z: lastZ,
          hw: 1.1,
          hd: 1.1,
          y,
          kind: 'crumble',
          crumble: { delay: tuning.crumbleDelay, respawn: tuning.crumbleRespawn },
        });
        // The JUMP leg lands on the run's first deck; the rest of the run is
        // deck-to-deck hops the envelope audit has no business measuring as
        // one leap.
        if (i === 0) route.push({ x: decks[decks.length - 1].x, z: lastZ, y });
      }
      z = lastZ;
      if (runLen > 1) route.push({ x: decks[decks.length - 1].x, z, y, via: 'ride' });
      prevHalf = 1.1;
    } else if (kind === 'blinkRun') {
      const runLen = rng.int(2, 3);
      let lastZ = z;
      for (let i = 0; i < runLen; i++) {
        lastZ = Math.min(z1, z + i * 2.2);
        decks.push({
          x: clampDeckX(x, lastZ, y, 1.0, side, site),
          z: lastZ,
          hw: 1.0,
          hd: 1.0,
          y,
          kind: 'blink',
          window: {
            period: tuning.blinkPeriod,
            duty: tuning.blinkDuty,
            phase: (i % 2) * 0.5,
          },
        });
        if (i === 0) route.push({ x: decks[decks.length - 1].x, z: lastZ, y });
      }
      z = lastZ;
      if (runLen > 1) route.push({ x: decks[decks.length - 1].x, z, y, via: 'ride' });
      prevHalf = 1.0;
    } else if (kind === 'geyser') {
      // A geyser lift: stand on the pad, the eruption throws you up to the
      // next stand. The pad deck itself sits low, so it is re-clamped at its
      // OWN height: full-width placement is only legal for the height a deck
      // actually has.
      const padY = Math.max(0.6, y - 1.7);
      x = clampDeckX(x, z, padY, hw + 0.2, side, site);
      decks.push({
        x,
        z,
        hw: hw + 0.2,
        hd: hw + 0.2,
        y: padY,
        kind: 'geyser',
        window: { period: rng.range(3.5, 5), duty: 0.22, phase: rng.range(0, 1) },
      });
      route.push({ x, z, y, via: 'ride' });
      prevHalf = hw + 0.2;
    } else if (kind === 'conveyor') {
      // The belt is wider than a stand: re-clamp with its true footprint so
      // the extra width never dips into the spine band.
      const beltHw = hw + 1.4;
      x = clampDeckX(x, z, y, beltHw, side, site);
      const deck: CourseDeck = { x, z, hw: beltHw, hd: hw, y };
      decks.push(deck);
      // The belt fights the crossing: drift toward the deck's rear edge.
      pads.push({
        kind: 'conveyor',
        x,
        z,
        hw: deck.hw,
        hd: deck.hd,
        y,
        dirX: -side,
        dirZ: 0,
        strength: rank === 'S' ? 3.4 : 2.4,
      });
      route.push({ x, z, y });
      prevHalf = hw;
    } else {
      push({ x, z, hw, hd: hw, y });
    }

    // Hazard dressing on a fraction of rest decks: spikes on wide stands, a
    // blade or sweeper over mid-course straights.
    if (rng.chance(tuning.hazardChance)) {
      const roll = rng.next();
      if (roll < 0.4) {
        hazards.push({
          kind: 'spikes',
          x,
          z,
          y,
          hw: hw + 0.3,
          hd: hw + 0.3,
          period: rng.range(3.4, 4.6),
          duty: 0.3,
          phase: rng.range(0, 1),
          damage: 12,
        });
      } else if (roll < 0.75 || rank !== 'S') {
        hazards.push({
          kind: 'blade',
          x: x - 2.5,
          z,
          y,
          x2: x + 2.5,
          z2: z,
          r: 1.2,
          period: rng.range(3.6, 4.8),
          duty: 1,
          phase: rng.range(0, 1),
          damage: 16,
          shove: 8,
        });
      } else {
        hazards.push({
          kind: 'sweeper',
          x,
          z,
          y,
          len: 4.2,
          r: 0.8,
          period: rng.range(4.5, 6),
          duty: 1,
          phase: rng.range(0, 1),
          damage: 14,
          shove: 9,
        });
      }
    }

    // Brazier checkpoints at the third marks, on plain stands only.
    if (braziers.length < 2 && kind === 'static' && t >= (braziers.length + 1) / 3) {
      braziers.push({ x, z, y, index: braziers.length });
    }
  }

  // The summit: a generous final deck at the climb's peak. The approach is
  // BRIDGED in envelope-sized static steps: legs that spent their z budget
  // early (ropes and chases move far, statics barely) must never leave a
  // final leap no jump can make.
  const summitHw = tuning.deckHw + 0.8;
  const sz = Math.min(z1 + 4, site.daisZ - 28);
  // The summit carries an INTERACTABLE (the gate plate), and interactables
  // must clear the true wall polygon, which pinches inside the smooth
  // profile between its samples. The extra margin keeps the plate clear of
  // any realistic pinch; the objective-clearance sweep in rift_gen.test.ts
  // is the guard that says so across every rank.
  const sx = clampDeckX(x, sz, y, summitHw + 2.5, side, site);
  const stepGap = Math.min(tuning.gap[1], courseMaxGapFor(0)) * 0.8;
  for (let guard = 0; guard < 60; guard++) {
    const dx = sx - x;
    const dz = sz - z;
    const d = Math.hypot(dx, dz);
    if (d <= stepGap + summitHw + tuning.deckHw) break;
    const step = stepGap + tuning.deckHw * 2;
    x = clampDeckX(x + (dx / d) * step, z + (dz / d) * step, y, tuning.deckHw, side, site);
    z = z + (dz / d) * step;
    push({ x, z, hw: tuning.deckHw, hd: tuning.deckHw, y });
  }
  decks.push({ x: sx, z: sz, hw: summitHw, hd: summitHw, y });
  route.push({ x: sx, z: sz, y });
  const summit = { x: sx, z: sz, y };

  // Gem spurs: one extra deck each, one hop off a route waypoint, with the
  // gem floating over it. Optional by construction: never on the route.
  for (let g = 0; g < tuning.gems && route.length > 4; g++) {
    const at = route[rng.int(2, route.length - 2)];
    const gx = clampDeckX(
      at.x + rng.range(2.2, 3.2) * (rng.chance(0.5) ? 1 : -1),
      at.z,
      at.y,
      0.9,
      side,
      site,
    );
    if (Math.abs(gx - at.x) < 1.6) continue; // clamp folded it onto the route
    const nearRoute = route.some((w) => Math.abs(w.x - gx) < 1.4 && Math.abs(w.z - at.z) < 1.4);
    if (nearRoute) continue; // another waypoint already stands there
    decks.push({ x: gx, z: at.z, hw: 0.9, hd: 0.9, y: at.y });
    gems.push({ x: gx, z: at.z, y: at.y + 1.1 });
  }

  // Crates guard the last gem spur at A and S: a fused surprise.
  if (gems.length > 0 && (rank === 'A' || rank === 'S')) {
    const last = gems[gems.length - 1];
    crates.push({
      x: last.x + 0.9,
      z: last.z + 0.9,
      y: last.y - 1.1,
      kind: rank === 'S' ? 'nitro' : 'tnt',
    });
  }

  return { decks, hazards, ropes, pads, gems, braziers, crates, chases, summit, route };
}
