// Pure dressing plan for the Sunken Bastion's open-air sea fortress: where the
// lanterns and braziers burn, where the surf breaks against the cliff foot,
// where the fog banks drift over the fen-sea, the sea stacks and the far coast
// that close the vista, the parapets and quay rails that dress the generated
// cliff edges, the Fogbeacon's lamp and beam, and the gate reveal curve.
// Everything is derived from the sim layout (content/sunken_bastion_layout.ts)
// and its cliff runs, so moving a terrace moves its dressing with it.
//
// Three-free, DOM-free, deterministic (hash-seeded, never Math.random).

import {
  BEACON_CROWN,
  FOGBEACON,
  SUNKEN_BASTION_FIELD,
  SUNKEN_BASTION_SEA_LEVEL,
} from '../../sim/content/sunken_bastion_layout';
import {
  authoredFieldCliffRuns,
  authoredFieldHeight,
  type FieldCliffRun,
} from '../../sim/instances/authored_field';

export type Vec3 = readonly [number, number, number];

export function bastionHash(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const FIELD = SUNKEN_BASTION_FIELD;
const ground = (x: number, z: number): number => authoredFieldHeight(FIELD, x, z);

// ---- lights -------------------------------------------------------------------------

export type BastionLightKind = 'lantern' | 'brazier' | 'beacon' | 'fogfire' | 'cell';

/** The kit pieces that carry a flame or a glow, and where it burns in the
 *  piece's own frame (x, y, z: glTF axes, front +Z). Taken from the Blender
 *  builders (docs/design/dungeon-rework/kit/build_sunken_bastion_kit.py). */
export const BASTION_FLAME_SOCKETS: Readonly<Record<string, readonly [number, number, number]>> = {
  // The ship's lantern hangs off the post's arm, 1 yd in front of it.
  Kit_LanternPost: [0, 3.3, 1.0],
  // The fire basket on its iron tripod.
  Kit_Brazier: [0, 1.55, 0],
  // The great lamp in the Fogbeacon's lantern room.
  Kit_Fogbeacon: [0, 41.5, 0],
  // The sickly fog-fire in a gaol cell's wall sconce.
  Kit_GaolCells: [0, 2.6, 0.55],
};

export interface BastionLightSpot {
  kind: BastionLightKind;
  /** The kit piece that carries this light (see BASTION_FLAME_SOCKETS). */
  holder: string;
  x: number;
  z: number;
  rot: number;
  /** The holder is placed by the light plan itself; else it is already a sim
   *  prop or set dressing at exactly (x, z, rot). */
  places: boolean;
}

const L = (
  kind: BastionLightKind,
  holder: string,
  x: number,
  z: number,
  rot = 0,
  places = true,
): BastionLightSpot => ({ kind, holder, x, z, rot, places });

/** Warm lanterns and braziers are the only living light; the green fog-fire
 *  belongs to Vael. At most eight per light zone; every flame in a holder. */
export const SUNKEN_BASTION_LIGHTS: readonly BastionLightSpot[] = [
  // The Sea-Gate Landing: two quay lanterns frame the first vista.
  L('lantern', 'Kit_LanternPost', -21, -219, Math.PI / 2),
  L('lantern', 'Kit_LanternPost', 1, -219, -Math.PI / 2),
  // The flats: a brazier at the outwork and at the first wreck's camp.
  L('brazier', 'Kit_Brazier', 58, -166),
  L('brazier', 'Kit_Brazier', -46, -193),
  // The Sea Gate: braziers either side of the ramp foot.
  L('brazier', 'Kit_Brazier', -11, -140),
  L('brazier', 'Kit_Brazier', 11, -140),
  // The Lower Bailey: lanterns at the chapel island's four quarters.
  L('lantern', 'Kit_LanternPost', -14, -71, 0),
  L('lantern', 'Kit_LanternPost', 14, -71, 0),
  L('lantern', 'Kit_LanternPost', -14, -105, Math.PI),
  L('lantern', 'Kit_LanternPost', 14, -105, Math.PI),
  L('brazier', 'Kit_Brazier', 44, -50),
  L('brazier', 'Kit_Brazier', 70, -50),
  // The Rampart Walk: braziers on the towers' landward sides.
  L('brazier', 'Kit_Brazier', 50, 30),
  L('brazier', 'Kit_Brazier', 50, 66),
  L('lantern', 'Kit_LanternPost', 63, 12, -Math.PI / 2),
  // The Breach Bastion: two braziers at the Rampart Door.
  L('brazier', 'Kit_Brazier', 49, 112),
  L('brazier', 'Kit_Brazier', 65, 112),
  // The Sunken Gaol: fog-fire in the cell sconces and a brazier at the grate.
  L('fogfire', 'Kit_Brazier', -18, 58),
  L('fogfire', 'Kit_Brazier', 14, 56),
  L('fogfire', 'Kit_Brazier', -37, 72),
  L('fogfire', 'Kit_Brazier', -37, 90),
  L('lantern', 'Kit_LanternPost', 42, 70, -Math.PI / 2),
  L('brazier', 'Kit_Brazier', 34, 100),
  // The Keep Stair balconies and the court.
  L('brazier', 'Kit_Brazier', -68, 28),
  L('brazier', 'Kit_Brazier', -70, 90),
  L('lantern', 'Kit_LanternPost', -30, 136, Math.PI / 2),
  L('brazier', 'Kit_Brazier', -80, 150),
  L('brazier', 'Kit_Brazier', -80, 162),
  // The Fogbeacon's great lamp (its holder is the tower itself).
  L('beacon', 'Kit_Fogbeacon', FOGBEACON.x, FOGBEACON.z, 0, false),
];

/** The flame kinds that draw a flickering flame mesh (the beacon is a lamp). */
export const BASTION_FLAME_KINDS: ReadonlySet<BastionLightKind> = new Set([
  'lantern',
  'brazier',
  'fogfire',
]);

/** Instance-local world position of a light's flame: its holder's socket
 *  turned by the holder's yaw (three.js: x' = x cos + z sin, z' = -x sin + z cos). */
export function bastionFlamePosition(spot: BastionLightSpot): [number, number, number] {
  const s = BASTION_FLAME_SOCKETS[spot.holder] ?? [0, 1, 0];
  const c = Math.cos(spot.rot);
  const n = Math.sin(spot.rot);
  const x = spot.x + s[0] * c + s[2] * n;
  const z = spot.z - s[0] * n + s[2] * c;
  return [x, ground(spot.x, spot.z) + s[1], z];
}

export const BASTION_LIGHT_STYLE: Readonly<
  Record<
    BastionLightKind,
    { color: number; flame: number; intensity: number; range: number; ember: boolean }
  >
> = {
  lantern: { color: 0xffc27a, flame: 0xffd9a0, intensity: 5, range: 16, ember: false },
  brazier: { color: 0xff9a4a, flame: 0xffb870, intensity: 9, range: 22, ember: true },
  beacon: { color: 0xfff0c8, flame: 0xfff6dc, intensity: 18, range: 46, ember: false },
  fogfire: { color: 0x7ff0b8, flame: 0x9fe0b0, intensity: 7, range: 18, ember: false },
  cell: { color: 0x6fe0c0, flame: 0x9fe0b0, intensity: 3, range: 9, ember: false },
};

// ---- the sea and its surf ------------------------------------------------------------

/** Where the surf breaks: a point on every cliff run that falls into the sea,
 *  spaced along it, with the run's outward normal (toward open water). */
export interface SurfPoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** Top of the cliff the wave climbs (the high side). */
  top: number;
  /** 0..1 phase so neighbouring bursts never fire together. */
  phase: number;
}

/** Surf along every sea-facing cliff foot, one burst every `spacing` yards. */
export function planSurf(spacing = 9): SurfPoint[] {
  const out: SurfPoint[] = [];
  let k = 0;
  for (const run of authoredFieldCliffRuns(FIELD)) {
    if (run.low > FIELD.voidHeight + 0.5) continue; // a drop onto a lower terrace
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i < n; i++) {
      k++;
      const t = (i + 0.5) / n;
      const x = run.ax + (run.bx - run.ax) * t + run.nx * 1.5;
      const z = run.az + (run.bz - run.az) * t + run.nz * 1.5;
      // Only where the open sea really laps (the cliff foot is under water).
      if (ground(x + run.nx * 3, z + run.nz * 3) > FIELD.voidHeight + 0.5) continue;
      out.push({ x, z, nx: run.nx, nz: run.nz, top: run.high, phase: bastionHash(k, 3) });
    }
  }
  return out;
}

/** Bounds of the shore mask (the field bounds plus a margin of open sea). */
export const SHORE_MASK_BOUNDS = {
  minX: FIELD.bounds.minX - 80,
  maxX: FIELD.bounds.maxX + 80,
  minZ: FIELD.bounds.minZ - 80,
  maxZ: FIELD.bounds.maxZ + 80,
} as const;

/**
 * The land mask the sea shader foams against: 1 over any terrace, 0 over open
 * water, blurred into a soft distance-to-shore ramp. `size` x `size` texels
 * over SHORE_MASK_BOUNDS, row-major from minZ.
 */
export function planShoreMask(size: number, blurPasses = 4): Float32Array {
  const b = SHORE_MASK_BOUNDS;
  const out = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const z = b.minZ + ((j + 0.5) / size) * (b.maxZ - b.minZ);
    for (let i = 0; i < size; i++) {
      const x = b.minX + ((i + 0.5) / size) * (b.maxX - b.minX);
      out[j * size + i] = ground(x, z) > FIELD.voidHeight + 0.5 ? 1 : 0;
    }
  }
  // Separable box blurs spread the coast into a gradient the foam reads as distance.
  const tmp = new Float32Array(out.length);
  const r = Math.max(1, Math.round(size / 96));
  for (let pass = 0; pass < blurPasses; pass++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let s = 0;
        let c = 0;
        for (let k = -r; k <= r; k++) {
          const ii = i + k;
          if (ii < 0 || ii >= size) continue;
          s += out[j * size + ii];
          c++;
        }
        tmp[j * size + i] = s / c;
      }
    }
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let s = 0;
        let c = 0;
        for (let k = -r; k <= r; k++) {
          const jj = j + k;
          if (jj < 0 || jj >= size) continue;
          s += tmp[jj * size + i];
          c++;
        }
        out[j * size + i] = s / c;
      }
    }
  }
  return out;
}

// ---- fog banks ------------------------------------------------------------------

export interface FogBank {
  x: number;
  z: number;
  y: number;
  /** Half size of the bank's card (yards). */
  size: number;
  /** Drift direction and speed (yards per second) and its 0..1 seed. */
  dx: number;
  dz: number;
  seed: number;
}

/** Fog banks lying on the sea round the headland and rolling over the flats,
 *  never over a terrace a fight happens on (they would veil a telegraph). */
export function planFogBanks(count: number): FogBank[] {
  const out: FogBank[] = [];
  const b = FIELD.bounds;
  let tries = 0;
  for (let i = 0; out.length < count && tries < count * 20; i++) {
    tries++;
    const x = b.minX - 140 + bastionHash(i, 11) * (b.maxX - b.minX + 280);
    const z = b.minZ - 140 + bastionHash(i, 13) * (b.maxZ - b.minZ + 280);
    const h = ground(x, z);
    const overSea = h <= FIELD.voidHeight + 0.5;
    // Only the flats (the low tide mud) take a bank inland; everything else is sea.
    const overFlats = !overSea && h < 0.5 && z < -140;
    if (!overSea && !overFlats) continue;
    // Keep a clear lane round every walkable edge so a bank never sits on a fight.
    let nearLand = false;
    if (overSea) {
      for (const [ox, oz] of [
        [14, 0],
        [-14, 0],
        [0, 14],
        [0, -14],
      ]) {
        if (ground(x + ox, z + oz) > FIELD.voidHeight + 0.5) nearLand = true;
      }
    }
    if (nearLand) continue;
    out.push({
      x,
      z,
      y: overSea ? SUNKEN_BASTION_SEA_LEVEL + 2 + bastionHash(i, 17) * 6 : 1.2,
      size: overSea ? 22 + bastionHash(i, 19) * 30 : 10 + bastionHash(i, 19) * 8,
      dx: 1.2 + bastionHash(i, 23) * 1.4,
      dz: 0.4 + bastionHash(i, 29) * 0.8,
      seed: bastionHash(i, 31),
    });
  }
  return out;
}

// ---- the sea stacks and the far coast ----------------------------------------------------

export interface SeaStack {
  x: number;
  z: number;
  radius: number;
  height: number;
  seed: number;
}

/** Sea stacks round the headland (rising out of the water, never on the route)
 *  and a broken far coastline, so the vista reads as a coast, not a void. */
export function planSeaStacks(count: number): SeaStack[] {
  const out: SeaStack[] = [];
  const cx = (FIELD.bounds.minX + FIELD.bounds.maxX) / 2;
  const cz = (FIELD.bounds.minZ + FIELD.bounds.maxZ) / 2;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + bastionHash(i, 41) * 0.4;
    // Two bands: near stacks off the cliffs, and the far coast.
    const far = i % 3 !== 0;
    const r = far ? 380 + bastionHash(i, 43) * 160 : 190 + bastionHash(i, 43) * 70;
    const x = cx + Math.sin(a) * r * 0.75;
    const z = cz + Math.cos(a) * r;
    if (ground(x, z) > FIELD.voidHeight + 0.5) continue;
    out.push({
      x,
      z,
      radius: far ? 30 + bastionHash(i, 47) * 40 : 11 + bastionHash(i, 47) * 12,
      height: far ? 14 + bastionHash(i, 53) * 26 : 10 + bastionHash(i, 53) * 22,
      seed: i + 1,
    });
  }
  return out;
}

// ---- the Fogbeacon -------------------------------------------------------------------

/** The lamp at the top of the Fogbeacon, instance-local. */
export const BEACON_LAMP: Vec3 = [
  FOGBEACON.x,
  BEACON_CROWN.h + BASTION_FLAME_SOCKETS.Kit_Fogbeacon[1],
  FOGBEACON.z,
];

/** Seconds for one idle sweep of the beam (Vael's veil drives its own). */
export const BEACON_IDLE_PERIOD = 14;

/** The beam's yaw (sim convention) at render time `t` while idle. */
export function beaconIdleYaw(t: number): number {
  return ((t / BEACON_IDLE_PERIOD) * Math.PI * 2) % (Math.PI * 2);
}

/** Vael's fog pouring off the beacon and down the headland: streams from the
 *  lamp room down the cliffs and out over the sea (render only). */
export interface FogStream {
  id: string;
  points: Vec3[];
  count: number;
}

function stream(id: string, pts: readonly Vec3[], count: number): FogStream {
  return { id, count, points: [BEACON_LAMP, ...pts] };
}

export const BASTION_FOG_STREAMS: readonly FogStream[] = [
  stream(
    'north',
    [
      [-4, 44, 236],
      [-10, 20, 262],
      [-20, -4, 300],
    ],
    70,
  ),
  stream(
    'west',
    [
      [-30, 42, 212],
      [-86, 26, 190],
      [-130, 2, 150],
      [-170, -6, 90],
    ],
    80,
  ),
  stream(
    'east',
    [
      [20, 42, 212],
      [52, 24, 200],
      [96, 6, 176],
      [140, -4, 120],
    ],
    70,
  ),
  stream(
    'south',
    [
      [-12, 40, 190],
      [-24, 30, 150],
      [-20, 12, 40],
      [-40, 2, -40],
      [-110, -4, -160],
    ],
    90,
  ),
];

/** A point on a stream at s in [0, 1) (piecewise linear by length). */
export function streamPointAt(r: FogStream, s: number): Vec3 {
  const pts = r.points;
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(
      pts[i + 1][0] - pts[i][0],
      pts[i + 1][1] - pts[i][1],
      pts[i + 1][2] - pts[i][2],
    );
    lens.push(l);
    total += l;
  }
  let d = (((s % 1) + 1) % 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const t = lens[i] > 0 ? Math.min(1, d / lens[i]) : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
        pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t,
      ];
    }
    d -= lens[i];
  }
  return pts[pts.length - 1];
}

/** Resample a stream into `n` evenly spaced points (the shader's control table). */
export function resampleStream(r: FogStream, n: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => streamPointAt(r, i / (n - 1)));
}

// ---- edge dressing ---------------------------------------------------------------------

export interface BastionEdgePiece {
  kind: 'parapet' | 'quayRail' | 'shoreRocks';
  x: number;
  z: number;
  /** Ground height under the piece's centre, on the high side of the lip. */
  y: number;
  /** Yaw so the piece runs along the edge (three.js rotation.y). */
  rot: number;
  length: number;
  /** Stretch along local X so the piece's full extent spans exactly `length`. */
  stretch: number;
  /** Rise per yard along local +X (a SHEARED rail follows a stair, posts plumb). */
  shear: number;
}

export const BASTION_EDGE_PIECES: Readonly<Record<BastionEdgePiece['kind'], string>> = {
  parapet: 'Kit_Parapet',
  quayRail: 'Kit_QuayRail',
  shoreRocks: 'Kit_ShoreRocks',
};

/** How far inside the lip each kind stands (its half depth: flush outer face). */
const EDGE_INSET: Readonly<Record<BastionEdgePiece['kind'], number>> = {
  parapet: 0.5,
  quayRail: 0.35,
  shoreRocks: 1.1,
};
/** Half the piece's length along its local X at stretch 1 (the Kit_* extents). */
const EDGE_HALF_LENGTH: Readonly<Record<BastionEdgePiece['kind'], number>> = {
  parapet: 2.0,
  quayRail: 2.0,
  shoreRocks: 2.2,
};
/** Half the piece's depth across the lip. */
const EDGE_HALF_DEPTH: Readonly<Record<BastionEdgePiece['kind'], number>> = {
  parapet: 0.5,
  quayRail: 0.2,
  shoreRocks: 1.0,
};
const EDGE_PROBE = 0.35;
const EDGE_FIT = 0.2;

/** Rise per yard from the floor at a piece's centre and its two ends. */
export function edgeShear(y: number, yMinus: number, yPlus: number, half: number): number {
  const okMinus = Math.abs(yMinus - y) <= half * 1.2;
  const okPlus = Math.abs(yPlus - y) <= half * 1.2;
  if (okMinus && okPlus) return (yPlus - yMinus) / (2 * half);
  if (okPlus) return (yPlus - y) / half;
  if (okMinus) return (y - yMinus) / half;
  return 0;
}

/** Surfaces whose lip carries no dressing: the hidden drawbridge (drawn by its
 *  gate) and the Breach Bastion's rim, where the parapet is gone between the
 *  buttresses (the terrace edge drops straight to the flats). */
const BARE_SURFACES = new Set(['breach_bastion']);

/**
 * Pieces along every cliff edge: crenellated parapets on masonry, iron-railed
 * quay posts on balustrade edges, barnacled rocks on raw rock. Placed on the
 * high side just inside the wall collider; every piece reads the REAL floor
 * under its ends so a rail follows a stair with its posts plumb.
 */
export function planBastionEdges(segment = 4): BastionEdgePiece[] {
  const out: BastionEdgePiece[] = [];
  let k = 0;
  const hidden = new Set(FIELD.surfaces.filter((s) => s.hidden).map((s) => s.id));
  for (const run of authoredFieldCliffRuns(FIELD)) {
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    if (len < 1.5 || hidden.has(run.surface) || BARE_SURFACES.has(run.surface)) continue;
    // A short step down onto another terrace keeps its lip bare (the wall face
    // below is the dressing); only real drops get a parapet or a rail.
    if (run.high - run.low < 2.5) continue;
    const pieces = Math.max(1, Math.round(len / segment));
    const step = len / pieces;
    const kind: BastionEdgePiece['kind'] =
      run.style === 'balustrade' ? 'quayRail' : run.style === 'masonry' ? 'parapet' : 'shoreRocks';
    for (let i = 0; i < pieces; i++) {
      k++;
      if (kind === 'shoreRocks' && bastionHash(k, 7) < 0.5) continue;
      fitEdgePieces(run, kind, step * i, step * (i + 1), 0, out);
    }
  }
  return out;
}

function edgePiece(
  run: FieldCliffRun,
  kind: BastionEdgePiece['kind'],
  s0: number,
  s1: number,
): BastionEdgePiece {
  const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
  const ux = (run.bx - run.ax) / len;
  const uz = (run.bz - run.az) / len;
  const inset = EDGE_INSET[kind];
  const mid = (s0 + s1) / 2;
  const x = run.ax + ux * mid - run.nx * inset;
  const z = run.az + uz * mid - run.nz * inset;
  // The piece's outer (sea) face is its local +Z: turn it toward the drop.
  const rot = Math.atan2(run.nx, run.nz);
  const lx = Math.cos(rot);
  const lz = -Math.sin(rot);
  const length = s1 - s0;
  const px = x - run.nx * EDGE_PROBE;
  const pz = z - run.nz * EDGE_PROBE;
  const y = ground(px, pz);
  const half = Math.max(0.4, length / 2 - 0.3);
  const shear = edgeShear(
    y,
    ground(px - lx * half, pz - lz * half),
    ground(px + lx * half, pz + lz * half),
    half,
  );
  return {
    kind,
    x,
    z,
    y,
    rot,
    length,
    stretch: length / (2 * EDGE_HALF_LENGTH[kind]),
    shear: Math.abs(shear) < 1e-9 ? 0 : shear,
  };
}

function edgeMisfit(run: FieldCliffRun, e: BastionEdgePiece, s0: number, s1: number): number {
  const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
  const ux = (run.bx - run.ax) / len;
  const uz = (run.bz - run.az) / len;
  const lx = Math.cos(e.rot);
  const lz = -Math.sin(e.rot);
  const inset = EDGE_INSET[e.kind];
  const depth = EDGE_HALF_DEPTH[e.kind];
  let bad = 0;
  const ends: [number, number][] = [
    [s0 + 0.12, 1],
    [(s0 + s1) / 2, 3],
    [s1 - 0.12, 2],
  ];
  for (const [s, bit] of ends) {
    for (const back of [Math.max(0.05, inset - depth) + 0.1, inset + depth - 0.1]) {
      const wx = run.ax + ux * s - run.nx * back;
      const wz = run.az + uz * s - run.nz * back;
      const f = ground(wx, wz);
      const along = (wx - e.x) * lx + (wz - e.z) * lz;
      if (f <= FIELD.voidHeight + 1e-6 || Math.abs(f - (e.y + e.shear * along)) > EDGE_FIT)
        bad |= bit;
    }
  }
  return bad;
}

function fitEdgePieces(
  run: FieldCliffRun,
  kind: BastionEdgePiece['kind'],
  s0: number,
  s1: number,
  depth: number,
  out: BastionEdgePiece[],
): void {
  let a = s0;
  let b = s1;
  while (b - a >= 1.2) {
    const e = edgePiece(run, kind, a, b);
    const bad = edgeMisfit(run, e, a, b);
    if (bad === 0) {
      out.push(e);
      return;
    }
    if (bad === 3 || (bad & 1 && bad & 2)) break;
    if (bad & 1) a += 0.25;
    if (bad & 2) b -= 0.25;
  }
  if (depth < 2 && s1 - s0 >= 2.4) {
    const m = (s0 + s1) / 2;
    fitEdgePieces(run, kind, s0, m, depth + 1, out);
    fitEdgePieces(run, kind, m, s1, depth + 1, out);
  }
}
