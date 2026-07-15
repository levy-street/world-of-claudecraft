// Hodric's Castle: the course GENERATOR. Lord Hodric rebuilds his gauntlet
// for every round of every match ("my castle bores me by breakfast"), so a
// course is a VALUE, not a constant: `generateHcCourse(seed, difficulty)` is
// a pure function from a 32-bit seed to a complete race course (surfaces,
// colliders, checkpoints, obstacles, bot hints), assembled from a library of
// hand-tuned parametric segments. Same seed, same course, every host.
//
// DETERMINISM: generation uses its OWN local Rng instance seeded from the
// argument; it never touches the shared world stream, so parity goldens
// cannot fork. The active course per race slot lives in a module registry
// (written by the match module at round start, read by the base sim's
// ground/collider routing arms and by the renderer). Registry writes are
// derived purely from sim state, so every host converges on the same entry.
//
// QUALITY BY CONSTRUCTION: segments are parameterized designs, not noise.
// Every course is start yard + 3-4 obstacle segments (no immediate repeats,
// stone landing + checkpoint between each) + red ascent + finish keep, with
// funnel walls auto-emitted at every width change and every open edge either
// intentional (falls are part of the game) or railed. validateHcCourse
// asserts the invariants; the test suite sweeps it across hundreds of seeds.
//
// Sim layer: no DOM/three.js imports.

import type { Collider } from './colliders';
import { HODRICS_SLOT_COUNT, hodricsOrigin } from './data';
import {
  HC_CHASM_Y,
  HC_FIELD_SIZE,
  type HcAxeDef,
  type HcBoulderLaneDef,
  type HcCheckpoint,
  type HcDrawspanDef,
  type HcFlailDef,
  type HcPusherDef,
  type HcRotorDef,
  type HcSpinnerDef,
  type HcSurface,
} from './hodrics_layout';
import { Rng } from './rng';

// ---------------------------------------------------------------------------
// Course shape
// ---------------------------------------------------------------------------

export type HcSectionId =
  | 'start_yard'
  | 'hammer_bridge'
  | 'rotor_court'
  | 'axe_walk'
  | 'drawspan'
  | 'boulder_climb'
  | 'piston_ledge'
  | 'spinner_court'
  | 'landing'
  | 'red_ascent'
  | 'finish_keep';

export interface HcSectionSpan {
  id: HcSectionId;
  z0: number;
  z1: number;
}

export interface HcCourse {
  seed: number;
  difficulty: number; // 0..2 (round - 1)
  surfaces: HcSurface[];
  colliders: Collider[];
  checkpoints: HcCheckpoint[];
  sections: HcSectionSpan[];
  flails: HcFlailDef[];
  axes: HcAxeDef[];
  rotors: HcRotorDef[];
  drawspans: HcDrawspanDef[];
  boulderLanes: HcBoulderLaneDef[];
  pushers: HcPusherDef[];
  spinners: HcSpinnerDef[];
  /** Start plate anchor: two rows of five, facing +z. */
  plateZ: number;
  /** Countdown rope: nobody crosses this z before GO. */
  ropeZ: number;
  finishZ: number;
  finishY: number;
  /** Spectator balcony for the eliminated (railed; jumps cannot leave it). */
  gallery: { x: number; z: number; y: number };
}

// ---------------------------------------------------------------------------
// Collider helpers (same shapes the classic course used)
// ---------------------------------------------------------------------------

function wallX(x: number, z0: number, z1: number): Collider {
  return { type: 'obb', x, z: (z0 + z1) / 2, hw: 0.4, hd: (z1 - z0) / 2, rot: 0 };
}

function wallZ(z: number, x0: number, x1: number): Collider {
  return { type: 'obb', x: (x0 + x1) / 2, z, hw: (x1 - x0) / 2, hd: 0.4, rot: 0 };
}

function post(x: number, z: number, r: number): Collider {
  return { type: 'circle', x, z, r };
}

// ---------------------------------------------------------------------------
// Segment generators. Each takes the builder + cursor and returns the next
// cursor. Segments declare their mouth half-width at entry and exit; the
// assembler emits funnel walls at every width transition.
// ---------------------------------------------------------------------------

interface Cursor {
  z: number;
  y: number;
}

interface Builder {
  rng: Rng;
  diff: number;
  course: HcCourse;
  /** Mouth half-width of the previous piece, for funnel walls. */
  prevMouth: number;
}

function pushSection(b: Builder, id: HcSectionId, z0: number, z1: number): void {
  b.course.sections.push({ id, z0, z1 });
}

// Funnel walls at a width transition (covers both sides, blocks both ways).
function funnel(b: Builder, z: number, fromHalf: number, toHalf: number): void {
  const lo = Math.min(fromHalf, toHalf);
  const hi = Math.max(fromHalf, toHalf);
  if (hi - lo < 0.5) return;
  b.course.colliders.push(wallZ(z, -hi, -lo), wallZ(z, lo, hi));
}

const LANDING_LEN = 7;
const LANDING_HALF = 12;

function genLanding(b: Builder, c: Cursor): Cursor {
  const z1 = c.z + LANDING_LEN;
  b.course.surfaces.push({
    id: `landing_${b.course.checkpoints.length}`,
    kind: 'stone',
    x0: -LANDING_HALF,
    x1: LANDING_HALF,
    z0: c.z,
    z1,
    y0: c.y,
  });
  b.course.colliders.push(wallX(-LANDING_HALF, c.z, z1), wallX(LANDING_HALF, c.z, z1));
  b.course.checkpoints.push({ z: c.z + 1.5, spawnX0: -8, spawnX1: 8 });
  pushSection(b, 'landing', c.z, z1);
  funnel(b, c.z, b.prevMouth, LANDING_HALF);
  b.prevMouth = LANDING_HALF;
  return { z: z1, y: c.y };
}

function genStartYard(b: Builder, c: Cursor): Cursor {
  const half = 16;
  const len = 30;
  const z1 = c.z + len;
  b.course.surfaces.push({
    id: 'start_yard',
    kind: 'grass',
    x0: -half,
    x1: half,
    z0: c.z,
    z1,
    y0: c.y,
  });
  b.course.colliders.push(
    wallZ(c.z, -half, half),
    wallX(-half, c.z, z1),
    wallX(half, c.z, z1),
    post(-7, c.z + 24, 0.5),
    post(7, c.z + 24, 0.5),
  );
  b.course.plateZ = c.z + 14;
  b.course.ropeZ = z1 - 1;
  b.course.checkpoints.push({ z: b.course.plateZ, spawnX0: -12, spawnX1: 12 });
  pushSection(b, 'start_yard', c.z, z1);
  b.prevMouth = half;
  return { z: z1, y: c.y };
}

function genHammerBridge(b: Builder, c: Cursor, maxLen: number): Cursor {
  const rng = b.rng;
  const half = rng.int(5, 7);
  const cap = Math.min(maxLen, 44);
  let n = Math.min(3 + b.diff + (rng.chance(0.4) ? 1 : 0), 5);
  n = Math.max(2, Math.min(n, Math.floor((cap - 8) / 7.5)));
  const spacing = Math.min(9.5, (cap - 8) / n);
  const len = n * spacing + 8;
  const z1 = c.z + len;
  b.course.surfaces.push({
    id: `bridge_${c.z}`,
    kind: 'wood',
    x0: -half,
    x1: half,
    z0: c.z,
    z1,
    y0: c.y,
  });
  const period = rng.range(2.35, 2.75) - b.diff * 0.08;
  for (let i = 0; i < n; i++) {
    const z = c.z + 5 + spacing * (i + 0.5);
    b.course.flails.push({
      z,
      y: c.y,
      pivotY: 7,
      chainLen: 5.4,
      bobR: 1.3,
      amp: rng.range(1.0, 1.15),
      period,
      phase: rng.range(0, Math.PI * 2),
    });
    b.course.colliders.push(post(-(half + 0.9), z, 0.45), post(half + 0.9, z, 0.45));
  }
  pushSection(b, 'hammer_bridge', c.z, z1);
  funnel(b, c.z, b.prevMouth, half);
  b.prevMouth = half;
  return { z: z1, y: c.y };
}

function genRotorCourt(b: Builder, c: Cursor, maxLen: number): Cursor {
  const rng = b.rng;
  const half = 14;
  const n = 2 + (b.diff >= 1 && rng.chance(0.5) ? 1 : 0);
  const len = Math.min(maxLen, rng.int(44, 48) + (n - 2) * 6);
  const reachCap = len / (n + 1) - 0.8;
  const z1 = c.z + len;
  b.course.surfaces.push({
    id: `court_${c.z}`,
    kind: 'plaza',
    x0: -half,
    x1: half,
    z0: c.z,
    z1,
    y0: c.y,
  });
  b.course.colliders.push(wallX(-half, c.z, z1), wallX(half, c.z, z1));
  // Gate walls both ends (mouth 3), the serpentine entry/exit.
  b.course.colliders.push(wallZ(c.z, -half, -3), wallZ(c.z, 3, half));
  b.course.colliders.push(wallZ(z1, -half, -3), wallZ(z1, 3, half));
  for (let i = 0; i < n; i++) {
    const r = Math.min(rng.range(9, Math.min(11, half - 3)), reachCap);
    b.course.rotors.push({
      cx: (i % 2 === 0 ? -1 : 1) * 4,
      cz: c.z + (len / (n + 1)) * (i + 1),
      y: c.y,
      r,
      omega: ((i % 2 === 0 ? 1 : -1) * (Math.PI * 2)) / (rng.range(4.2, 5.6) - b.diff * 0.15),
      beamHalf: 0.55,
      beamTopY: 0.85,
    });
  }
  pushSection(b, 'rotor_court', c.z, z1);
  funnel(b, c.z, b.prevMouth, 3);
  b.prevMouth = 3;
  return { z: z1, y: c.y };
}

function genAxeWalk(b: Builder, c: Cursor, maxLen: number): Cursor {
  const rng = b.rng;
  const half = 4;
  const cap = Math.min(maxLen, 40);
  let n = Math.min(3 + (rng.chance(0.5) ? 1 : 0) + (b.diff >= 2 ? 1 : 0), 5);
  n = Math.max(2, Math.min(n, Math.floor((cap - 6) / 6.5)));
  const spacing = Math.min(8, (cap - 6) / n);
  const len = n * spacing + 6;
  const z1 = c.z + len;
  b.course.surfaces.push({
    id: `walk_${c.z}`,
    kind: 'carpet',
    x0: -half,
    x1: half,
    z0: c.z,
    z1,
    y0: c.y,
  });
  b.course.colliders.push(wallX(-(half + 0.4), c.z, z1), wallX(half + 0.4, c.z, z1));
  const period = rng.range(2.2, 2.55) - b.diff * 0.06;
  for (let i = 0; i < n; i++) {
    b.course.axes.push({
      z: c.z + 3 + spacing * (i + 0.5),
      y: c.y,
      pivotY: 7.5,
      armLen: 5.9,
      headR: 1.7,
      amp: rng.range(0.9, 1.0),
      period,
      phase: rng.range(0, Math.PI * 2),
    });
  }
  pushSection(b, 'axe_walk', c.z, z1);
  funnel(b, c.z, b.prevMouth, half);
  b.prevMouth = half;
  return { z: z1, y: c.y };
}

function genDrawspan(b: Builder, c: Cursor, maxLen: number): Cursor {
  const rng = b.rng;
  const n = b.diff >= 1 && maxLen >= 30 && rng.chance(0.45) ? 3 : 2;
  const len = n * 10;
  const z1 = c.z + len;
  const period = rng.range(8.6, 10.2) - b.diff * 0.4;
  const halfX = rng.range(2.8, 3.4);
  for (let i = 0; i < n; i++) {
    b.course.drawspans.push({
      xMin: -6,
      xMax: 6,
      zCenter: c.z + 5 + 10 * i,
      halfX,
      halfZ: 5,
      y: c.y,
      period,
      phase: i / n,
    });
  }
  // The gap itself: no surfaces, no side rails; falling is the failure mode.
  // Entry is gated to the center (the decks always pass under x 0); the exit
  // stays fully open so riders can step off anywhere along the deck.
  pushSection(b, 'drawspan', c.z, z1);
  funnel(b, c.z, b.prevMouth, 4);
  b.prevMouth = LANDING_HALF;
  return { z: z1, y: c.y };
}

function genBoulderClimb(b: Builder, c: Cursor, maxLen: number): Cursor {
  const rng = b.rng;
  const half = 10;
  const len = Math.min(maxLen, rng.int(20, 24));
  const rise = 6;
  const z1 = c.z + len;
  b.course.surfaces.push({
    id: `climb_${c.z}`,
    kind: 'stone',
    x0: -half,
    x1: half,
    z0: c.z,
    z1,
    y0: c.y,
    y1: c.y + rise,
  });
  b.course.colliders.push(wallX(-(half + 0.5), c.z, z1), wallX(half + 0.5, c.z, z1));
  const laneCount = Math.min(2 + (b.diff >= 1 ? 1 : 0) + (rng.chance(0.4) ? 1 : 0), 4);
  const xs = laneCount === 2 ? [-4, 4] : laneCount === 3 ? [-6, 0, 6] : [-6, -2, 2, 6];
  for (let i = 0; i < laneCount; i++) {
    b.course.boulderLanes.push({
      x: xs[i],
      laneHalf: 2.6,
      zTop: z1,
      zEnd: c.z - 2,
      yTop: c.y + rise,
      yEnd: c.y,
      speed: rng.range(8, 9.5) + b.diff * 0.4,
      r: 1.35,
      period: rng.range(3.4, 5.4),
      phase: rng.range(0, 3),
    });
  }
  pushSection(b, 'boulder_climb', c.z, z1);
  funnel(b, c.z, b.prevMouth, half);
  b.prevMouth = half;
  return { z: z1, y: c.y + rise };
}

function genPistonLedge(b: Builder, c: Cursor, maxLen: number): Cursor {
  const rng = b.rng;
  const half = 3.2;
  const side = rng.chance(0.5) ? 1 : -1;
  const spacing = 8;
  let n = 3 + (b.diff >= 1 && rng.chance(0.5) ? 1 : 0);
  const len = Math.min(maxLen, n * spacing + 6);
  n = Math.max(2, Math.min(n, Math.floor((len - 6) / spacing)));
  const z1 = c.z + len;
  b.course.surfaces.push({
    id: `ledge_${c.z}`,
    kind: 'stone',
    x0: -half,
    x1: half,
    z0: c.z,
    z1,
    y0: c.y,
  });
  // Mount wall on one side only; the other side is open chasm.
  b.course.colliders.push(wallX(side * (half + 0.4), c.z, z1));
  const period = rng.range(2.8, 3.6) - b.diff * 0.15;
  for (let i = 0; i < n; i++) {
    b.course.pushers.push({
      z: c.z + 3 + spacing * (i + 0.5),
      y: c.y,
      side: side as 1 | -1,
      wallX: side * half,
      reach: half * 2 + 1,
      headR: 1.1,
      period,
      phase: rng.range(0, 1),
    });
  }
  pushSection(b, 'piston_ledge', c.z, z1);
  funnel(b, c.z, b.prevMouth, half);
  b.prevMouth = half;
  return { z: z1, y: c.y };
}

function genSpinnerCourt(b: Builder, c: Cursor, maxLen: number): Cursor {
  const rng = b.rng;
  const n = 2 + (rng.chance(b.diff >= 1 ? 0.6 : 0.35) ? 1 : 0);
  const tongue = 3;
  let z = c.z + tongue;
  const discs: HcSpinnerDef[] = [];
  let prevR = 0;
  for (let i = 0; i < n; i++) {
    const r = rng.range(4.6, 5.4);
    const gap = rng.range(0.6, 1.3);
    const cz = i === 0 ? z + r : z + prevR + gap + r;
    // Never let a disc overrun the length budget (its rim plus the exit
    // tongue must fit); a clamped court just runs fewer discs.
    if (discs.length >= 2 && cz + r + tongue > c.z + maxLen) break;
    discs.push({
      cx: (i % 2 === 0 ? -1 : 1) * 2.5,
      cz,
      y: c.y,
      r,
      omega: (i % 2 === 0 ? 1 : -1) * (rng.range(0.55, 0.85) + b.diff * 0.08),
    });
    z = cz;
    prevR = r;
  }
  const z1 = z + prevR + tongue;
  b.course.spinners.push(...discs);
  // Entry and exit tongues are the only static ground; the discs carry you
  // across the chasm between them.
  b.course.surfaces.push(
    {
      id: `spin_in_${c.z}`,
      kind: 'stone',
      x0: -3,
      x1: 3,
      z0: c.z,
      z1: c.z + tongue + 1,
      y0: c.y,
    },
    {
      id: `spin_out_${c.z}`,
      kind: 'stone',
      x0: -3,
      x1: 3,
      z0: z1 - tongue - 1,
      z1,
      y0: c.y,
    },
  );
  pushSection(b, 'spinner_court', c.z, z1);
  funnel(b, c.z, b.prevMouth, 3);
  b.prevMouth = 3;
  return { z: z1, y: c.y };
}

function genRedAscent(b: Builder, c: Cursor): Cursor {
  const half = 8;
  const len = 13;
  const rise = 6;
  const z1 = c.z + len;
  b.course.surfaces.push({
    id: 'red_ascent',
    kind: 'carpet',
    x0: -half,
    x1: half,
    z0: c.z,
    z1,
    y0: c.y,
    y1: c.y + rise,
  });
  b.course.colliders.push(wallX(-(half + 0.4), c.z, z1), wallX(half + 0.4, c.z, z1));
  pushSection(b, 'red_ascent', c.z, z1);
  funnel(b, c.z, b.prevMouth, half);
  b.prevMouth = half;
  return { z: z1, y: c.y + rise };
}

function genFinishKeep(b: Builder, c: Cursor): Cursor {
  const half = 14;
  const len = 24;
  const z1 = c.z + len;
  b.course.surfaces.push({
    id: 'finish_keep',
    kind: 'keep',
    x0: -half,
    x1: half,
    z0: c.z,
    z1,
    y0: c.y,
  });
  b.course.colliders.push(
    wallX(-half, c.z, z1),
    wallX(half, c.z, z1),
    wallZ(z1, -half, half),
    post(-5, c.z + 1, 0.6),
    post(5, c.z + 1, 0.6),
  );
  b.course.finishZ = c.z + 1;
  b.course.finishY = c.y;
  pushSection(b, 'finish_keep', c.z, z1);
  // The keep is wider than the ascent: wall the shoulders so nobody sidesteps
  // off the terrace mouth into the void behind the ramp rails.
  funnel(b, c.z, b.prevMouth, half);
  b.prevMouth = half;
  return { z: z1, y: c.y };
}

// The spectator gallery: a railed balcony floating beside the start yard,
// high over the chasm. Rails on all four sides mean neither a jump nor a
// hammer arc can put a body on or off it; the eliminated arrive by Hodric's
// catapult (a scripted teleport) and leave when the match ends.
function genGallery(b: Builder, startZ: number): void {
  const x0 = -36;
  const x1 = -24;
  const z0 = startZ + 2;
  const z1 = z0 + 16;
  const y = 20;
  b.course.surfaces.push({ id: 'gallery', kind: 'gallery', x0, x1, z0, z1, y0: y });
  b.course.colliders.push(
    wallX(x0, z0, z1),
    wallX(x1, z0, z1),
    wallZ(z0, x0, x1),
    wallZ(z1, x0, x1),
  );
  b.course.gallery = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

type MiddleSegment = (b: Builder, c: Cursor, maxLen: number) => Cursor;

const MIDDLE_POOL: { id: HcSectionId; gen: MiddleSegment }[] = [
  { id: 'hammer_bridge', gen: genHammerBridge },
  { id: 'rotor_court', gen: genRotorCourt },
  { id: 'axe_walk', gen: genAxeWalk },
  { id: 'drawspan', gen: genDrawspan },
  { id: 'boulder_climb', gen: genBoulderClimb },
  { id: 'piston_ledge', gen: genPistonLedge },
  { id: 'spinner_court', gen: genSpinnerCourt },
];

const COURSE_Z0 = -128;
const MIDDLE_BUDGET = 172;

/** Pure: 32-bit seed + difficulty tier (0..2) to a complete course. */
export function generateHcCourse(seed: number, difficulty: number): HcCourse {
  const rng = new Rng(seed >>> 0);
  const course: HcCourse = {
    seed: seed >>> 0,
    difficulty,
    surfaces: [],
    colliders: [],
    checkpoints: [],
    sections: [],
    flails: [],
    axes: [],
    rotors: [],
    drawspans: [],
    boulderLanes: [],
    pushers: [],
    spinners: [],
    plateZ: COURSE_Z0 + 14,
    ropeZ: COURSE_Z0 + 29,
    finishZ: 0,
    finishY: 0,
    gallery: { x: -30, z: COURSE_Z0 + 10, y: 20 },
  };
  const b: Builder = { rng, diff: difficulty, course, prevMouth: 16 };

  // Draw the middle plan: 3 segments in round 1, 4 after, no repeats.
  const count = difficulty === 0 ? 3 : 4;
  const pool = [...MIDDLE_POOL];
  const plan: { id: HcSectionId; gen: MiddleSegment }[] = [];
  for (let i = 0; i < count; i++) {
    const pick = Math.floor(rng.next() * pool.length);
    plan.push(pool[pick]);
    pool.splice(pick, 1);
  }

  let c = genStartYard(b, { z: COURSE_Z0, y: 0 });
  let used = 0;
  for (let i = 0; i < plan.length; i++) {
    c = genLanding(b, c);
    used += LANDING_LEN;
    const remaining = plan.length - i - 1;
    const maxLen = MIDDLE_BUDGET - used - remaining * (LANDING_LEN + 26) - LANDING_LEN;
    const before = c.z;
    c = plan[i].gen(b, c, Math.max(26, maxLen));
    used += c.z - before;
  }
  c = genLanding(b, c);
  c = genRedAscent(b, c);
  genFinishKeep(b, c);
  genGallery(b, COURSE_Z0);
  return course;
}

// ---------------------------------------------------------------------------
// Course-parameterized geometry queries (the classic statics, now per-course)
// ---------------------------------------------------------------------------

/** Walkable ground height at an instance-local point, or the chasm floor. */
export function hodricsGroundLocal(course: HcCourse, lx: number, lz: number): number {
  for (const s of course.surfaces) {
    if (lx >= s.x0 && lx <= s.x1 && lz >= s.z0 && lz <= s.z1) {
      if (s.y1 === undefined) return s.y0;
      const f = (lz - s.z0) / (s.z1 - s.z0);
      return s.y0 + (s.y1 - s.y0) * f;
    }
  }
  for (const d of course.spinners) {
    const dx = lx - d.cx;
    const dz = lz - d.cz;
    if (dx * dx + dz * dz <= d.r * d.r) return d.y;
  }
  return HC_CHASM_Y;
}

/** The course surface under an instance-local point, if any (discs excluded). */
export function hodricsSurfaceAt(course: HcCourse, lx: number, lz: number): HcSurface | null {
  for (const s of course.surfaces) {
    if (lx >= s.x0 && lx <= s.x1 && lz >= s.z0 && lz <= s.z1) return s;
  }
  return null;
}

/** True when the point stands on one of the spinner discs. */
export function hodricsOnSpinner(course: HcCourse, lx: number, lz: number): HcSpinnerDef | null {
  for (const d of course.spinners) {
    const dx = lx - d.cx;
    const dz = lz - d.cz;
    if (dx * dx + dz * dz <= d.r * d.r) return d;
  }
  return null;
}

/** Two rows of five start plates in the yard, facing the course (+z). */
export function hcStartPlate(
  course: HcCourse,
  seat: number,
): { x: number; z: number; facing: number } {
  const row = seat < 5 ? 0 : 1;
  const col = seat % 5;
  return { x: -12 + col * 6, z: course.plateZ - row * 4, facing: 0 };
}

export function hcCheckpointSpawn(
  course: HcCourse,
  cp: number,
  seat: number,
): { x: number; z: number } {
  const list = course.checkpoints;
  const c = list[Math.max(0, Math.min(cp, list.length - 1))];
  const lanes = HC_FIELD_SIZE;
  const f = lanes <= 1 ? 0.5 : (seat % lanes) / (lanes - 1);
  return { x: c.spawnX0 + (c.spawnX1 - c.spawnX0) * f, z: c.z };
}

/** Course progress metric: furthest local z, normalized 0..1 for the HUD. */
export function hcProgressFrac(course: HcCourse, furthestZ: number): number {
  const z0 = course.checkpoints[0]?.z ?? 0;
  const f = (furthestZ - z0) / (course.finishZ - z0);
  return Math.max(0, Math.min(1, f));
}

/** Section id under a local z, for HUD progress labels and the bot brain. */
export function hcSectionAt(course: HcCourse, lz: number): HcSectionSpan {
  for (const s of course.sections) {
    if (lz >= s.z0 && lz < s.z1) return s;
  }
  const last = course.sections[course.sections.length - 1];
  return lz < course.sections[0].z0 ? course.sections[0] : last;
}

// ---------------------------------------------------------------------------
// Active-course registry: the seam between per-match generated courses and
// the base sim's static routing arms (groundHeight, resolvePosition, sweeps).
// The match module writes a slot's course at every round start, and resets it
// to the slot's idle course when the match returns home; with no write yet, a
// slot resolves to its idle course (a stable seed, so the castle stands and
// swings in attract mode for anyone gazing across the chasm).
//
// Writes derive purely from sim state (round seeds come from tick + match
// id), so every host writes identical values at identical ticks. The
// renderer also writes the course it builds (derived from the same seed off
// the wire), which is idempotent by construction.
// ---------------------------------------------------------------------------

const activeCourses = new Map<number, HcCourse>();
const idleCourses = new Map<number, HcCourse>();
const courseCache = new Map<string, HcCourse>();

/** Stable idle-course seed per slot: the castle's between-matches face. */
export function hcIdleCourseSeed(slot: number): number {
  return (0x484f4452 ^ Math.imul(slot + 1, 0x9e3779b9)) >>> 0;
}

/** Memoized generation (courses are pure values keyed by seed+difficulty). */
export function hcCourseFor(seed: number, difficulty: number): HcCourse {
  const key = `${seed >>> 0}:${difficulty}`;
  let course = courseCache.get(key);
  if (!course) {
    course = generateHcCourse(seed, difficulty);
    courseCache.set(key, course);
    if (courseCache.size > 32) {
      // Drop the oldest entry; 32 courses is far beyond two live slots.
      const first = courseCache.keys().next().value;
      if (first !== undefined) courseCache.delete(first);
    }
  }
  return course;
}

export function setActiveHodricsCourse(slot: number, course: HcCourse): void {
  activeCourses.set(slot, course);
}

export function resetHodricsCourse(slot: number): void {
  activeCourses.delete(slot);
}

export function activeHodricsCourse(slot: number): HcCourse {
  const live = activeCourses.get(slot);
  if (live) return live;
  let idle = idleCourses.get(slot);
  if (!idle) {
    idle = generateHcCourse(hcIdleCourseSeed(slot), 0);
    idleCourses.set(slot, idle);
  }
  return idle;
}

/** Slot index of the race instance nearest this world z. */
export function hodricsSlotAt(z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < HODRICS_SLOT_COUNT; i++) {
    const d = Math.abs(z - hodricsOrigin(i).z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** World-space course ground for the band routing arm in world.groundHeight. */
export function hodricsGroundWorld(x: number, z: number): number {
  const slot = hodricsSlotAt(z);
  const o = hodricsOrigin(slot);
  return hodricsGroundLocal(activeHodricsCourse(slot), x - o.x, z - o.z);
}

/** Active colliders + origin for the band routing arms in colliders.ts. */
export function hodricsCollidersAt(z: number): {
  colliders: Collider[];
  ox: number;
  oz: number;
} {
  const slot = hodricsSlotAt(z);
  const o = hodricsOrigin(slot);
  return { colliders: activeHodricsCourse(slot).colliders, ox: o.x, oz: o.z };
}

// ---------------------------------------------------------------------------
// Validation: the quality gate the seed-sweep tests drive.
// ---------------------------------------------------------------------------

/** Returns human-readable violations; a sound course returns []. */
export function validateHcCourse(course: HcCourse): string[] {
  const bad: string[] = [];
  const secs = course.sections;
  if (secs[0]?.id !== 'start_yard') bad.push('first section is not the start yard');
  if (secs[secs.length - 1]?.id !== 'finish_keep') bad.push('last section is not the keep');
  const end = secs[secs.length - 1]?.z1 ?? 0;
  if (end > 136) bad.push(`course overruns the band: ends at ${end}`);
  if (course.finishZ <= course.plateZ) bad.push('finish is not ahead of the plates');

  // Sections tile without gaps or overlaps.
  for (let i = 1; i < secs.length; i++) {
    if (Math.abs(secs[i].z0 - secs[i - 1].z1) > 0.01) {
      bad.push(`section gap between ${secs[i - 1].id} and ${secs[i].id}`);
    }
  }

  // Checkpoints strictly advance and respawn onto real ground.
  for (let i = 0; i < course.checkpoints.length; i++) {
    const cp = course.checkpoints[i];
    if (i > 0 && cp.z <= course.checkpoints[i - 1].z) bad.push(`checkpoint ${i} does not advance`);
    for (const f of [0, 0.5, 1]) {
      const x = cp.spawnX0 + (cp.spawnX1 - cp.spawnX0) * f;
      if (hodricsGroundLocal(course, x, cp.z) <= HC_CHASM_Y + 1) {
        bad.push(`checkpoint ${i} respawn probes the chasm at x ${x}`);
      }
    }
  }

  // The center line is walkable everywhere except the deliberate gap
  // sections (drawspan decks and spinner discs bridge those).
  for (const s of secs) {
    if (s.id === 'drawspan' || s.id === 'spinner_court') continue;
    for (let z = s.z0 + 0.5; z < s.z1 - 0.01; z += 1.5) {
      if (hodricsGroundLocal(course, 0, z) <= HC_CHASM_Y + 1) {
        bad.push(`chasm on the center line in ${s.id} at z ${z.toFixed(1)}`);
        break;
      }
    }
  }

  // Every obstacle lies inside its section span.
  const within = (z: number, id: HcSectionId) =>
    secs.some((s) => s.id === id && z >= s.z0 - 0.01 && z <= s.z1 + 0.01);
  for (const f of course.flails) {
    if (!within(f.z, 'hammer_bridge')) bad.push(`flail at z ${f.z} outside any bridge`);
  }
  for (const a of course.axes) {
    if (!within(a.z, 'axe_walk')) bad.push(`axe at z ${a.z} outside any walk`);
  }
  for (const r of course.rotors) {
    if (!within(r.cz, 'rotor_court')) bad.push(`rotor at z ${r.cz} outside any court`);
    const court = secs.find((s) => s.id === 'rotor_court' && r.cz >= s.z0 && r.cz <= s.z1);
    if (court && (r.cz - r.r < court.z0 + 0.4 || r.cz + r.r > court.z1 - 0.4)) {
      bad.push(`rotor sweep at z ${r.cz} crosses its court gate`);
    }
  }
  for (const p of course.pushers) {
    if (!within(p.z, 'piston_ledge')) bad.push(`pusher at z ${p.z} outside any ledge`);
  }
  for (const d of course.drawspans) {
    if (!within(d.zCenter, 'drawspan')) bad.push(`drawspan at z ${d.zCenter} outside any gap`);
  }
  for (const sp of course.spinners) {
    if (!within(sp.cz, 'spinner_court')) bad.push(`spinner at z ${sp.cz} outside any court`);
  }

  // Spinner chains are hop-crossable: consecutive discs no further apart
  // than a small jump, tongues reach the first/last disc.
  const courts = secs.filter((s) => s.id === 'spinner_court');
  for (const court of courts) {
    const discs = course.spinners
      .filter((d) => d.cz >= court.z0 && d.cz <= court.z1)
      .sort((a, b) => a.cz - b.cz);
    for (let i = 1; i < discs.length; i++) {
      const gap = discs[i].cz - discs[i - 1].cz - discs[i].r - discs[i - 1].r;
      if (gap > 2.2) bad.push(`spinner gap ${gap.toFixed(1)} too wide in ${court.z0}`);
    }
  }
  return bad;
}
