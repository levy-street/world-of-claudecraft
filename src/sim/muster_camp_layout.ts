// The Mirefen muster camps, laid out: which kit piece stands where around each camp.
//
// Pure and deterministic (no Three, no DOM, no i18n, no clock, no Math.random): the
// same camp records, height sampler and obstacles always give the same plan, and a
// Vitest drives it directly (tests/muster_camps_core.test.ts). It lives in the sim
// because ONE plan feeds two readers: the art (src/render/muster_camps.ts hands it to
// the props decor pass) and the collision (src/sim/muster_camp_colliders.ts turns the
// structure pieces into sim colliders), so the wall a player bumps into is the wall
// they see. The seeded plan both read is src/sim/muster_camp_plan.ts.
//
// The boss phases through all of it (and never enters the command camp at all:
// MobTemplate.keepOut), so the rules below are about what a player SEES and walks:
//   - a PICKET (a stop on Balgath's circuit) keeps every footprint outside
//     MUSTER_PICKET_CLEAR_RADIUS of its centre: the squad stands there and he plants
//     there to slam, so no prop may hide the soldiers or the impact;
//   - the palisade FRAMES a picket but leaves wide openings toward his approach and his
//     exit (the previous and next stops on MUSTER_CIRCUIT, plus his lair for the
//     opening leg), so he visibly walks in through a gap and out through another;
//   - no footprint covers a sentry slot (or any soldier slot at the command camp), nor
//     a camp's reserved ground (the drill yard's effigy), and nothing but the rack
//     itself stands on the weapon rack's pick volume;
//   - the tier rule is graphics-neutral: STRUCTURE (walls, gate, tower, tents, rack,
//     the lantern by the rack, the gate torches) draws on every preset; CLUTTER
//     (crates, barrels, sacks, the cart wheel, the extra torches) is shed on the low
//     preset only. None of it is actionable information.
//
// The camps sit on real, uneven fen ground (the command camp is on a hillside of about
// one yard of rise in three), so every piece is fitted to the terrain under its own
// footprint: soft pieces (tents, clutter, the rack) lean with the slope, walls lean
// half of it along their length, the watchtower stays plumb, and each piece is then
// sunk until its downhill edge meets the ground. A piece whose leftover ground span is
// more than it can hide tries its next candidate spot, or is left out.
//
// Frames: bearings use the sim convention (forward is (sin b, cos b)), and a
// placement's `rot` is three's rotation.y, which turns a piece's +Z front toward
// (sin rot, cos rot). `pitch` and `roll` are the local tilt applied under the yaw
// (Euler order YXZ). A wall section faces OUT (its sharpened side toward the fen), a
// tent's door faces the camp centre.

import type { MusterCampDef, MusterCampId } from './content/mirefen_muster';

export type MusterKitKey =
  | 'musterPalisade'
  | 'musterBarricade'
  | 'musterGate'
  | 'musterWatchtower'
  | 'musterTentLarge'
  | 'musterTentSmall'
  | 'musterWeaponRack'
  | 'musterLanternPost'
  | 'musterCrate'
  | 'musterBarrel'
  | 'musterSacks'
  | 'musterCartWheel'
  | 'musterTorch';

export type MusterTierClass = 'structure' | 'clutter';

export interface MusterPlacement {
  key: MusterKitKey;
  campId: MusterCampId;
  x: number;
  z: number;
  /** three rotation.y: the piece's +Z front points at (sin rot, cos rot). */
  rot: number;
  /** Local tilt about the piece's X axis (front edge down is positive), radians. */
  pitch: number;
  /** Local tilt about the piece's Z axis (+X end up is positive), radians. */
  roll: number;
  tierClass: MusterTierClass;
  /** Yards the piece is lowered below the ground at its centre, so its downhill edge
   *  meets the terrain instead of floating (0 on flat ground). */
  sink: number;
  /** Camera-ghost circle and top (0 for pieces too small to hide the player). */
  ghostRadius: number;
  ghostHeight: number;
}

export interface MusterLayoutInput {
  camps: readonly MusterCampDef[];
  circuit: readonly MusterCampId[];
  /** Where Balgath sleeps: his opening leg runs from here to the first stop. */
  lair: { x: number; z: number };
  rack: { x: number; z: number; facing: number };
  /** Terrain height (the sim's terrainHeight with the world seed). */
  heightAt: (x: number, z: number) => number;
  /** Trunks and boulders the kit must not stand in (x, z, clearance radius). */
  obstacles: readonly { x: number; z: number; r: number }[];
  /** No piece is seated below this (the fen's waterline plus a margin). */
  minGroundY: number;
}

/** Nothing's footprint reaches inside this of a picket's centre (the squad and the slam). */
export const MUSTER_PICKET_CLEAR_RADIUS = 7;
/** Clearance kept between any footprint and a soldier slot outside that circle. */
export const MUSTER_SLOT_CLEARANCE = 1.2;
/** Half-width (radians) of the palisade opening toward an approach or exit. */
export const MUSTER_OPENING_HALF_ANGLE = 0.62;
/** The palisade ring's radius band at a picket (yd from the centre). */
export const MUSTER_WALL_RADIUS_MIN = 12.4;
export const MUSTER_WALL_RADIUS_MAX = 13.6;
/** Clearance kept between any other footprint and the weapon rack's centre. */
export const MUSTER_RACK_CLEARANCE = 2.2;

export interface MusterPieceSpec {
  /** Footprint half-extents along the piece's local X and Z (yd). */
  halfWidth: number;
  halfDepth: number;
  /** Share of the ground slope the piece leans with (0 plumb, 1 flush), per axis. */
  followRoll: number;
  followPitch: number;
  /** Largest leftover ground span (after the lean) the piece can bury. */
  maxSpan: number;
  ghostRadius: number;
  ghostHeight: number;
}

/** Footprints measured from the shipped GLBs' bounds (tests/muster_camp_asset.test.ts
 *  pins those bounds); the guy-rope pegs and ladder foot are left out of the box. */
export const MUSTER_PIECE_SPECS: Readonly<Record<MusterKitKey, MusterPieceSpec>> = Object.freeze({
  musterPalisade: wall(3.2, 1.45),
  musterBarricade: wall(3.15, 1.2),
  musterGate: wall(5.35, 1.5),
  musterWatchtower: {
    halfWidth: 2.25,
    halfDepth: 2.2,
    followRoll: 0,
    followPitch: 0,
    // plumb on four long legs: the uphill legs can take a good deal of bank
    maxSpan: 2.6,
    ghostRadius: 2.3,
    ghostHeight: 10,
  },
  musterTentLarge: { ...soft(2.2, 2.4, 2.2, 3.5), maxSpan: 0.8 },
  musterTentSmall: { ...soft(1.7, 1.8, 1.6, 2.6), maxSpan: 0.8 },
  // the rack and the supplies lean only part of the way: a barrel or a pike rack tipped
  // fully with a hillside reads as falling over, a tent pitched on one reads as pitched
  musterWeaponRack: { ...soft(1.75, 0.87), followRoll: 0.5, followPitch: 0.5 },
  musterLanternPost: { ...soft(0.5, 0.67), followRoll: 0, followPitch: 0 },
  musterCrate: { ...soft(0.53, 0.53), followRoll: 0.5, followPitch: 0.5 },
  musterBarrel: { ...soft(0.5, 0.5), followRoll: 0.5, followPitch: 0.5 },
  musterSacks: { ...soft(1.0, 0.42), followRoll: 0.5, followPitch: 0.5 },
  musterCartWheel: { ...soft(0.82, 0.78), followRoll: 0.5, followPitch: 0.5 },
  musterTorch: { ...soft(0.4, 0.45), followRoll: 0, followPitch: 0 },
});

function wall(halfWidth: number, halfDepth: number): MusterPieceSpec {
  return {
    halfWidth,
    halfDepth,
    followRoll: 0.5,
    followPitch: 0.5,
    maxSpan: 1.8,
    ghostRadius: 0,
    ghostHeight: 0,
  };
}

function soft(
  halfWidth: number,
  halfDepth: number,
  ghostRadius = 0,
  ghostHeight = 0,
): MusterPieceSpec {
  return {
    halfWidth,
    halfDepth,
    followRoll: 1,
    followPitch: 1,
    maxSpan: 0.6,
    ghostRadius,
    ghostHeight,
  };
}

/** Steepest lean any piece takes, radians (a tent on a hillside, never a toppling one). */
export const MUSTER_MAX_TILT = 0.34;

/** The pieces whose placements default to the clutter class. */
export const MUSTER_CLUTTER_KEYS: ReadonlySet<MusterKitKey> = new Set<MusterKitKey>([
  'musterCrate',
  'musterBarrel',
  'musterSacks',
  'musterCartWheel',
  'musterTorch',
]);

const TAU = Math.PI * 2;

/** Sim-convention bearing from (ax, az) toward (bx, bz). */
export function bearingTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bx - ax, bz - az);
}

/** Smallest absolute difference between two angles, in [0, PI]. */
export function angleGap(a: number, b: number): number {
  const d = (((a - b) % TAU) + TAU) % TAU;
  return d > Math.PI ? TAU - d : d;
}

/** The four footprint corners of a piece at (x, z, rot), in world XZ. */
export function musterFootprintCorners(
  key: MusterKitKey,
  x: number,
  z: number,
  rot: number,
): [number, number][] {
  const s = MUSTER_PIECE_SPECS[key];
  const ax = Math.cos(rot);
  const az = -Math.sin(rot);
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  const out: [number, number][] = [];
  for (const [u, v] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    out.push([
      x + ax * u * s.halfWidth + fx * v * s.halfDepth,
      z + az * u * s.halfWidth + fz * v * s.halfDepth,
    ]);
  }
  return out;
}

/** Distance from a world point to a piece's footprint box (0 inside it). */
export function musterFootprintDistance(
  key: MusterKitKey,
  x: number,
  z: number,
  rot: number,
  px: number,
  pz: number,
): number {
  const s = MUSTER_PIECE_SPECS[key];
  const dx = px - x;
  const dz = pz - z;
  const u = dx * Math.cos(rot) - dz * Math.sin(rot);
  const v = dx * Math.sin(rot) + dz * Math.cos(rot);
  const ou = Math.max(0, Math.abs(u) - s.halfWidth);
  const ov = Math.max(0, Math.abs(v) - s.halfDepth);
  return Math.hypot(ou, ov);
}

/** Whether two footprint boxes overlap (separating-axis test, boxes shrunk by `give`). */
function boxesOverlap(
  a: { key: MusterKitKey; x: number; z: number; rot: number },
  b: { key: MusterKitKey; x: number; z: number; rot: number },
  give: number,
): boolean {
  const boxes = [a, b].map((p) => {
    const s = MUSTER_PIECE_SPECS[p.key];
    return {
      x: p.x,
      z: p.z,
      hw: Math.max(0.05, s.halfWidth - give),
      hd: Math.max(0.05, s.halfDepth - give),
      axes: [
        [Math.cos(p.rot), -Math.sin(p.rot)],
        [Math.sin(p.rot), Math.cos(p.rot)],
      ],
    };
  });
  for (const box of boxes) {
    for (const [nx, nz] of box.axes) {
      let overlap = true;
      const proj = boxes.map((q) => {
        const c = q.x * nx + q.z * nz;
        const r =
          q.hw * Math.abs(q.axes[0][0] * nx + q.axes[0][1] * nz) +
          q.hd * Math.abs(q.axes[1][0] * nx + q.axes[1][1] * nz);
        return [c - r, c + r];
      });
      if (proj[0][1] < proj[1][0] || proj[1][1] < proj[0][0]) overlap = false;
      if (!overlap) return false;
    }
  }
  return true;
}

/**
 * The bearings (from the camp centre) Balgath arrives from and leaves toward: the
 * previous and next circuit stops, and, for the first stop, his lair (the opening leg
 * of every waking). Empty for a camp off the circuit.
 */
export function musterCampOpenings(
  camp: MusterCampDef,
  input: Pick<MusterLayoutInput, 'camps' | 'circuit' | 'lair'>,
): number[] {
  const index = input.circuit.indexOf(camp.id);
  if (index < 0) return [];
  const n = input.circuit.length;
  const at = (id: MusterCampId): { x: number; z: number } => {
    const found = input.camps.find((c) => c.id === id);
    if (!found) throw new Error(`muster circuit names an unknown camp ${id}`);
    return found.center;
  };
  const prev = at(input.circuit[(index - 1 + n) % n]);
  const next = at(input.circuit[(index + 1) % n]);
  const out = [
    bearingTo(camp.center.x, camp.center.z, prev.x, prev.z),
    bearingTo(camp.center.x, camp.center.z, next.x, next.z),
  ];
  if (index === 0) {
    out.push(bearingTo(camp.center.x, camp.center.z, input.lair.x, input.lair.z));
  }
  return out;
}

/** A small deterministic [0, 1) value per (camp, slot, salt). */
function jitter(campIndex: number, slot: number, salt: number): number {
  let h = (campIndex * 73856093) ^ (slot * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Candidate {
  key: MusterKitKey;
  x: number;
  z: number;
  rot: number;
  tierClass?: MusterTierClass;
  /** Placed whatever the clearance rules say (the weapon rack: its spot is the sim's
   *  interaction point, and its captain stands beside it on purpose). */
  force?: boolean;
}

interface Site {
  camp: MusterCampDef;
  campIndex: number;
  /** Soldier slots (world XZ) the footprints keep clear of. */
  slots: { x: number; z: number }[];
  /** A picket's approach and exit bearings (musterCampOpenings); empty elsewhere. */
  openings: number[];
  placed: MusterPlacement[];
}

interface GroundFit {
  pitch: number;
  roll: number;
  sink: number;
  span: number;
  centre: number;
}

/** Lean a piece with the ground under its footprint, then sink it onto its low edge. */
export function fitMusterPiece(
  key: MusterKitKey,
  x: number,
  z: number,
  rot: number,
  heightAt: (x: number, z: number) => number,
): GroundFit {
  const s = MUSTER_PIECE_SPECS[key];
  const ax = Math.cos(rot);
  const az = -Math.sin(rot);
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  const at = (u: number, v: number): number => heightAt(x + ax * u + fx * v, z + az * u + fz * v);
  const centre = heightAt(x, z);
  const gradU = (at(s.halfWidth, 0) - at(-s.halfWidth, 0)) / (2 * s.halfWidth);
  const gradV = (at(0, s.halfDepth) - at(0, -s.halfDepth)) / (2 * s.halfDepth);
  const clamp = (a: number): number => Math.max(-MUSTER_MAX_TILT, Math.min(MUSTER_MAX_TILT, a));
  const roll = clamp(Math.atan(gradU * s.followRoll));
  const pitch = clamp(-Math.atan(gradV * s.followPitch));
  const du = Math.tan(roll);
  const dv = -Math.tan(pitch);
  let lo = 0;
  let hi = 0;
  // corners, edge midpoints and centre: enough to seat a flat-bottomed piece
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const u = i * s.halfWidth;
      const v = j * s.halfDepth;
      // how far the ground sits above (+) or below (-) the leaned base plane
      const d = at(u, v) - (centre + u * du + v * dv);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }
  return { pitch, roll, sink: -lo, span: hi - lo, centre };
}

function placement(camp: MusterCampDef, c: Candidate, fit: GroundFit): MusterPlacement {
  const s = MUSTER_PIECE_SPECS[c.key];
  // `|| 0` folds -0 to 0, so a flat-ground lean reads as no lean at all
  const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;
  return {
    key: c.key,
    campId: camp.id,
    x: r3(c.x),
    z: r3(c.z),
    rot: r3(c.rot),
    pitch: r3(fit.pitch),
    roll: r3(fit.roll),
    tierClass: c.tierClass ?? (MUSTER_CLUTTER_KEYS.has(c.key) ? 'clutter' : 'structure'),
    sink: r3(fit.sink),
    ghostRadius: s.ghostRadius,
    ghostHeight: s.ghostHeight,
  };
}

/** Try each candidate in order and keep the first that passes every rule. */
function place(site: Site, input: MusterLayoutInput, candidates: Candidate[]): boolean {
  const { camp } = site;
  for (const c of candidates) {
    const fit = fitMusterPiece(c.key, c.x, c.z, c.rot, input.heightAt);
    if (c.force) {
      site.placed.push(placement(camp, c, fit));
      return true;
    }
    const dist = (px: number, pz: number): number =>
      musterFootprintDistance(c.key, c.x, c.z, c.rot, px, pz);
    if (camp.onCircuit && dist(camp.center.x, camp.center.z) < MUSTER_PICKET_CLEAR_RADIUS) continue;
    if (site.slots.some((slot) => dist(slot.x, slot.z) < MUSTER_SLOT_CLEARANCE)) continue;
    // ...and never on ground the camp keeps bare (the drill yard round the effigy).
    if (camp.reserved?.some((r) => dist(r.x, r.z) < r.r)) continue;
    if (!camp.onCircuit && dist(input.rack.x, input.rack.z) < MUSTER_RACK_CLEARANCE) continue;
    if (input.obstacles.some((o) => dist(o.x, o.z) < o.r)) continue;
    if (inOpeningCone(site, c)) continue;
    if (site.placed.some((p) => boxesOverlap(c, p, 0.25))) continue;
    // and never a centre inside another footprint (a torch inside a tent's canvas)
    if (
      site.placed.some(
        (p) =>
          musterFootprintDistance(p.key, p.x, p.z, p.rot, c.x, c.z) === 0 || dist(p.x, p.z) === 0,
      )
    ) {
      continue;
    }
    if (fit.span > MUSTER_PIECE_SPECS[c.key].maxSpan) continue;
    if (fit.centre - fit.sink < input.minGroundY) continue;
    site.placed.push(placement(camp, c, fit));
    return true;
  }
  return false;
}

/** Slack under MUSTER_OPENING_HALF_ANGLE a footprint's edge may reach into an opening. */
const OPENING_EDGE_SLACK = 0.08;

/**
 * Does this candidate's footprint reach into a picket's approach or exit cone? The wall
 * arc skips its sections by bearing already; this keeps every OTHER piece (the clutter
 * and tents ring the camp too) out of the gap he walks through, whichever way the circuit
 * and his lair turn the openings.
 */
function inOpeningCone(site: Site, c: Candidate): boolean {
  if (site.openings.length === 0) return false;
  const { camp } = site;
  const corners = musterFootprintCorners(c.key, c.x, c.z, c.rot);
  const samples: [number, number][] = [...corners, [c.x, c.z]];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    samples.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  for (const [x, z] of samples) {
    const bearing = bearingTo(camp.center.x, camp.center.z, x, z);
    for (const o of site.openings) {
      if (angleGap(bearing, o) <= MUSTER_OPENING_HALF_ANGLE - OPENING_EDGE_SLACK) return true;
    }
  }
  return false;
}

function polar(camp: MusterCampDef, bearing: number, radius: number): { x: number; z: number } {
  return {
    x: camp.center.x + Math.sin(bearing) * radius,
    z: camp.center.z + Math.cos(bearing) * radius,
  };
}

/** An arc of wall sections, skipping any section whose span reaches an opening. */
function wallArc(
  site: Site,
  input: MusterLayoutInput,
  from: number,
  to: number,
  openings: readonly number[],
  radiusMin: number,
  radiusMax: number,
  gaps: readonly { bearing: number; half: number }[] = [],
): void {
  const { camp, campIndex } = site;
  const mid = (radiusMin + radiusMax) / 2;
  const step = 2 * Math.asin(3.05 / mid);
  const halfSpan = Math.asin(MUSTER_PIECE_SPECS.musterPalisade.halfWidth / mid);
  let slot = 0;
  for (let b = from; b <= to + 1e-9; b += step, slot++) {
    if (openings.some((o) => angleGap(b, o) < MUSTER_OPENING_HALF_ANGLE + halfSpan)) continue;
    if (gaps.some((g) => angleGap(b, g.bearing) < g.half)) continue;
    const r = radiusMin + (radiusMax - radiusMin) * jitter(campIndex, slot, 1);
    const key: MusterKitKey =
      jitter(campIndex, slot, 2) < 0.34 ? 'musterBarricade' : 'musterPalisade';
    const other: MusterKitKey = key === 'musterPalisade' ? 'musterBarricade' : 'musterPalisade';
    const yaw = b + (jitter(campIndex, slot, 3) - 0.5) * 0.12;
    // a section that fails its slot (a trunk, a steep bank) tries a yard in or out and
    // the other variant before leaving a gap
    place(site, input, [
      { key, ...polar(camp, b, r), rot: yaw },
      { key, ...polar(camp, b, r - 1), rot: yaw },
      { key, ...polar(camp, b, r + 1), rot: yaw },
      { key: other, ...polar(camp, b, r), rot: yaw },
      { key: other, ...polar(camp, b, r - 1), rot: yaw },
    ]);
  }
}

/** Candidates at (bearing, radius) pairs from the camp centre, one key and facing rule. */
function around(
  camp: MusterCampDef,
  key: MusterKitKey,
  spots: readonly (readonly [number, number])[],
  facing: (bearing: number) => number,
  tierClass?: MusterTierClass,
): Candidate[] {
  return spots.map(([b, r]) => ({ key, ...polar(camp, b, r), rot: facing(b), tierClass }));
}

const INWARD = (b: number): number => b + Math.PI;

function planPicket(site: Site, input: MusterLayoutInput): void {
  const { camp, campIndex } = site;
  const openings = site.openings;
  const rear = camp.facing + Math.PI;
  const j = (salt: number): number => (jitter(campIndex, 100, salt) - 0.5) * 0.3;
  // The wall: the rear half-ring behind the squad, cut wide at every approach/exit.
  wallArc(
    site,
    input,
    rear - 1.9,
    rear + 1.9,
    openings,
    MUSTER_WALL_RADIUS_MIN,
    MUSTER_WALL_RADIUS_MAX,
  );
  // Tents behind the soldiers, doors toward the fire line.
  const tentSpots = (base: number): [number, number][] => [
    [base, 9.8],
    [base + 0.25, 9.8],
    [base - 0.25, 9.8],
    [base + 0.5, 9.4],
    [base - 0.5, 9.4],
  ];
  place(site, input, around(camp, 'musterTentLarge', tentSpots(rear + j(1)), INWARD));
  place(site, input, around(camp, 'musterTentSmall', tentSpots(rear + 0.72 + j(2)), INWARD));
  place(site, input, around(camp, 'musterTentSmall', tentSpots(rear - 0.72 + j(3)), INWARD));
  // Supplies between the tents and the squad, and out at the wall's ends.
  const supply = (base: number): [number, number][] => [
    [base, 8.1],
    [base + 0.12, 8.3],
    [base - 0.12, 8.3],
    [base + 0.24, 8.1],
    [base - 0.24, 8.1],
  ];
  place(
    site,
    input,
    around(camp, 'musterCrate', supply(rear + 0.36), (b) => b + j(4)),
  );
  place(
    site,
    input,
    around(camp, 'musterBarrel', supply(rear + 0.2), (b) => b),
  );
  place(
    site,
    input,
    around(camp, 'musterSacks', supply(rear - 0.34), (b) => b + Math.PI / 2 + j(5)),
  );
  place(
    site,
    input,
    around(camp, 'musterBarrel', supply(rear - 0.16), (b) => b + 1),
  );
  place(
    site,
    input,
    around(
      camp,
      'musterCartWheel',
      [
        [rear + 1.25, 10.8],
        [rear - 1.25, 10.8],
        [rear + 1.45, 10.4],
      ],
      INWARD,
    ),
  );
  place(
    site,
    input,
    around(
      camp,
      'musterCrate',
      [
        [rear - 1.05, 10.6],
        [rear + 1.05, 10.6],
        [rear - 1.3, 10.2],
      ],
      (b) => b + j(6),
    ),
  );
  // Two torches out by the tents.
  place(
    site,
    input,
    around(camp, 'musterTorch', supply(rear + 0.55), (b) => b),
  );
  place(
    site,
    input,
    around(camp, 'musterTorch', supply(rear - 0.55), (b) => b),
  );
}

/** Every (bearing, radius) on a fan around `base`, nearest bearing first. */
function fan(base: number, radii: readonly number[], steps = 12, step = 0.26): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      for (const r of radii) out.push([base + sign * k * step, r]);
    }
  }
  return out;
}

/** The command camp's wall radius: wider than a picket's, it holds tents and a tower. */
export const MUSTER_COMMAND_WALL_RADIUS = 15.8;
/** The watchtower's spot at the command camp: this far round from the gate (toward the
 *  camp's high east bank), this far out from the centre. */
export const MUSTER_TOWER_BEARING = 0.82;
export const MUSTER_TOWER_RADIUS = 13.2;
/** Clear walking room kept between the watchtower and the nearest wall section, yd. */
export const MUSTER_TOWER_WALKWAY = 2.6;

/**
 * Half-angle (from the camp centre) of the wall gap round the watchtower: a wall section
 * whose centre bearing falls inside it is left out. The tower's own half-width, the
 * walkway, and a section's half-span, all taken at the wall's radius.
 */
export function towerGapHalfAngle(wallRadius: number): number {
  const s = MUSTER_PIECE_SPECS;
  return (
    Math.asin(s.musterWatchtower.halfWidth / wallRadius) +
    MUSTER_TOWER_WALKWAY / wallRadius +
    Math.asin(s.musterPalisade.halfWidth / wallRadius)
  );
}

function planCommand(site: Site, input: MusterLayoutInput): void {
  const { camp } = site;
  const f = camp.facing;
  const rack = input.rack;
  const rear = f + Math.PI;
  // The rack first: it is the reason the camp exists, and its spot is the sim's.
  place(site, input, [
    { key: 'musterWeaponRack', x: rack.x, z: rack.z, rot: rack.facing, force: true },
  ]);
  // Along the rack's own axes (three's local +X is (cos rot, -sin rot)).
  const side = (d: number, fwd = 0): { x: number; z: number } => ({
    x: rack.x + Math.cos(rack.facing) * d + Math.sin(rack.facing) * fwd,
    z: rack.z - Math.sin(rack.facing) * d + Math.cos(rack.facing) * fwd,
  });
  // The lantern that lights it, beside it.
  place(site, input, [
    { key: 'musterLanternPost', ...side(2.7), rot: rack.facing },
    { key: 'musterLanternPost', ...side(-2.7), rot: rack.facing },
    { key: 'musterLanternPost', ...side(2.7, -1), rot: rack.facing },
  ]);
  // The gate on the camp's front (the downhill side, toward the crater and the fight).
  const wallR = MUSTER_COMMAND_WALL_RADIUS;
  const gates = fan(f, [wallR, wallR - 0.8, wallR + 0.8], 3).map(([b, r]) => ({
    key: 'musterGate' as const,
    ...polar(camp, b, r),
    rot: b,
  }));
  place(site, input, gates);
  const gate = site.placed.find((p) => p.key === 'musterGate');
  const gateBearing = gate ? bearingTo(camp.center.x, camp.center.z, gate.x, gate.z) : f;
  // The watchtower on the front east corner, up on the high bank where it looks down the
  // approach to the crater and over the whole camp, its ladder facing in. Standing off on
  // its own (a wide berth from the gate, the rack and the drill yard) it reads as a
  // landmark rather than one more thing piled by the gate; a steeper patch tries the next
  // corner spot, and the back corners are the last resort.
  place(
    site,
    input,
    around(
      camp,
      'musterWatchtower',
      [
        [gateBearing + MUSTER_TOWER_BEARING, MUSTER_TOWER_RADIUS],
        [gateBearing + MUSTER_TOWER_BEARING - 0.1, MUSTER_TOWER_RADIUS],
        [gateBearing + MUSTER_TOWER_BEARING + 0.1, MUSTER_TOWER_RADIUS],
        [gateBearing + MUSTER_TOWER_BEARING, MUSTER_TOWER_RADIUS - 0.8],
        ...fan(rear, [12.6, 11.8], 8),
      ],
      INWARD,
    ),
  );
  const tower = site.placed.find((p) => p.key === 'musterWatchtower');
  // Tents: the quarters stay at the back of the camp, behind the Commander (two large,
  // and the small ones only where the back has room), never out front by the gate or in
  // the drill yard. A tent the back cannot take is left out rather than sent round.
  const tentRadii = [12.2, 11.4, 12.8];
  place(site, input, around(camp, 'musterTentLarge', fan(rear + 0.3, tentRadii, 4), INWARD));
  place(site, input, around(camp, 'musterTentLarge', fan(rear - 0.9, tentRadii, 4), INWARD));
  place(site, input, around(camp, 'musterTentSmall', fan(rear - 0.35, tentRadii, 3), INWARD));
  place(site, input, around(camp, 'musterTentSmall', fan(rear + 1.0, tentRadii, 2), INWARD));
  // The wall round everything but the gate, and open either side of the tower: the tower
  // stands in the wall line as its corner post, with a walkway past each flank instead
  // of a stack of barricades hemming it in.
  const gateHalf = Math.asin(MUSTER_PIECE_SPECS.musterGate.halfWidth / wallR);
  const wallHalf = Math.asin(MUSTER_PIECE_SPECS.musterPalisade.halfWidth / wallR);
  const towerGaps = tower
    ? [
        {
          bearing: bearingTo(camp.center.x, camp.center.z, tower.x, tower.z),
          half: towerGapHalfAngle(wallR),
        },
      ]
    : [];
  wallArc(
    site,
    input,
    gateBearing + gateHalf + wallHalf,
    gateBearing + TAU - gateHalf - wallHalf,
    [],
    wallR - 0.5,
    wallR + 0.5,
    towerGaps,
  );
  // Gate torches out front, lighting the one way in: structure.
  if (gate) {
    for (const s of [1, -1]) {
      const tx = Math.cos(gate.rot) * s * 3.4 + Math.sin(gate.rot) * 1.7;
      const tz = -Math.sin(gate.rot) * s * 3.4 + Math.cos(gate.rot) * 1.7;
      place(site, input, [
        {
          key: 'musterTorch',
          x: gate.x + tx,
          z: gate.z + tz,
          rot: gate.rot,
          tierClass: 'structure',
        },
        {
          key: 'musterTorch',
          x: gate.x + tx * 1.15,
          z: gate.z + tz * 1.15,
          rot: gate.rot,
          tierClass: 'structure',
        },
      ]);
    }
  }
  // Supplies: a stack by the rack, more among the tents, a wheel by the wall.
  place(site, input, [
    { key: 'musterCrate', ...side(-2.9), rot: rack.facing + 0.3 },
    { key: 'musterCrate', ...side(-3.4, 0.4), rot: rack.facing + 0.3 },
    { key: 'musterCrate', ...side(-3.4, -0.6), rot: rack.facing + 0.3 },
  ]);
  place(site, input, [
    { key: 'musterBarrel', ...side(4.0), rot: rack.facing },
    { key: 'musterBarrel', ...side(-4.4), rot: rack.facing },
    { key: 'musterBarrel', ...side(4.2, -0.8), rot: rack.facing },
  ]);
  const clutterRadii = [10.6, 9.8, 11.4];
  place(
    site,
    input,
    around(camp, 'musterSacks', fan(rear + 0.8, clutterRadii, 6), (b) => b + Math.PI / 2),
  );
  place(
    site,
    input,
    around(camp, 'musterCrate', fan(rear - 0.3, clutterRadii, 6), (b) => b + 0.4),
  );
  place(
    site,
    input,
    around(camp, 'musterBarrel', fan(rear - 0.1, clutterRadii, 6), (b) => b),
  );
  place(
    site,
    input,
    around(camp, 'musterCrate', fan(rear + 1.9, clutterRadii, 6), (b) => b + 0.8),
  );
  place(site, input, around(camp, 'musterCartWheel', fan(f + 1.9, [13.2, 12.6], 6), INWARD));
  place(
    site,
    input,
    around(camp, 'musterTorch', fan(rear, [10.2, 9.6], 6), (b) => b),
  );
  place(
    site,
    input,
    around(camp, 'musterTorch', fan(f - 1.6, [11.4, 10.6], 6), (b) => b),
  );
}

/**
 * Every muster camp's full kit, both tier classes. Deterministic: a pure function of
 * its input. Use `musterPlacementsForTier` to take the live preset's share.
 */
export function planMusterCamps(input: MusterLayoutInput): MusterPlacement[] {
  const out: MusterPlacement[] = [];
  input.camps.forEach((camp, campIndex) => {
    const site: Site = {
      camp,
      campIndex,
      // At a picket only the sentries stand outside the clear circle; at the command
      // camp every soldier stands among the tents. Every OTHER camp's posts count too:
      // the south picket's flank sentries stand out where the command camp's wall runs
      // (and a west sentry where the south picket's does), and a post inside a
      // neighbour's palisade is a soldier stuck in a wall.
      slots: input.camps.flatMap((c) =>
        c.soldiers
          .filter(
            (s) =>
              c !== camp || !camp.onCircuit || Math.hypot(s.dx, s.dz) > MUSTER_PICKET_CLEAR_RADIUS,
          )
          .map((s) => ({ x: c.center.x + s.dx, z: c.center.z + s.dz })),
      ),
      openings: musterCampOpenings(camp, input),
      placed: [],
    };
    if (camp.onCircuit) planPicket(site, input);
    else planCommand(site, input);
    out.push(...site.placed);
  });
  return out;
}

/** The share of a plan the live preset draws: everything, minus clutter on low. */
export function musterPlacementsForTier(
  plan: readonly MusterPlacement[],
  lowTier: boolean,
): MusterPlacement[] {
  return lowTier ? plan.filter((p) => p.tierClass === 'structure') : plan.slice();
}
