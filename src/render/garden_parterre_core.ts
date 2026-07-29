// The Evergarden's formal planting plan (pure core, no Three/DOM). The realm
// reads as a Victorian palace garden: every flower and bush belongs to an
// authored arrangement instead of a random scatter. The beds are MODELED
// decor in a satellite pattern (large square ornamental gardens, each
// orbited by small round beds; they render and collide as decorProps in
// content/evergarden, on level pads from world.ts GARDEN_BED_PADS). Only
// the mill lawn's three ring beds stay procedural (a solid bed model would
// bury the windmill bases), plus the low ribbon beds flanking the walks
// and the clipped hedge lines edging every road. Consumer: foliage.ts
// (ground flowers via parterreFlowerTintAt, hedge and rose bushes via
// parterreBushSpots). Placement is deterministic; the plot sites are
// validated against terrain, water, roads, the Great Maze, camps, gather
// nodes, and the great trees by tests/garden_parterre.test.ts.

import { EVERGARDEN_PROPS, EVERGARDEN_ROADS, EVERGARDEN_ZONE } from '../sim/content/evergarden';
import { fbm2, hash2 } from '../sim/rng';
import {
  gardenLandness,
  gardenMazeCellPieces,
  MAZE_CELL,
  MAZE_COLS,
  MAZE_WALL_DEPTH,
  MAZE_X0,
  MAZE_Z0,
  MAZE_Z1,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
} from '../sim/world';

export type ParterreKind = 'square' | 'round' | 'ring';

export interface ParterrePlot {
  x: number;
  z: number;
  r: number;
  /** 'square': a large ornamental square bed model; 'round': a small round
   * bed model orbiting a large bed; 'ring': a mill-lawn procedural ring
   * planting with a windmill at its heart. The modeled beds render and
   * collide as decorProps (content/evergarden), stand on level pads
   * (world.ts GARDEN_BED_PADS), and this table drives the planting
   * exclusions; the paired test pins all three lists against each other. */
  kind: ParterreKind;
  /** 'windmill': the ring plots' built centerpiece (a decorProps entry) */
  centerpiece?: 'windmill';
}

export interface ParterreBushSpot {
  x: number;
  z: number;
  kind: 'bush' | 'bushFlowers';
  scale: number;
  /** raw instance tint for bushFlowers; hedges (plain bush) leave it unset */
  bloomTint?: number;
}

// The bed layout: six large square ornamental gardens, each orbited by
// three or four small round beds at its outer edges (a formal satellite
// pattern), plus the mill lawn's three procedural ring beds. Every site
// sits on flat dry lawn clear of the maze, the hamlet, the walks, camps,
// nodes, and great trees (the paired test re-validates all of that against
// the live terrain), and every modeled bed stands on a level pad.
export const PARTERRE_PLOTS: readonly ParterrePlot[] = [
  // west of the Parterre Walk: the grand garden and its four satellites
  { x: 322, z: 878, r: 10, kind: 'square' },
  { x: 322, z: 892.8, r: 3.25, kind: 'round' },
  { x: 322, z: 863.2, r: 3.25, kind: 'round' },
  { x: 336.8, z: 878, r: 3.25, kind: 'round' },
  { x: 307.2, z: 878, r: 3.25, kind: 'round' },
  // east of the Parterre Walk
  { x: 400, z: 866, r: 9, kind: 'square' },
  { x: 400, z: 879.8, r: 3.25, kind: 'round' },
  { x: 400, z: 852.2, r: 3.25, kind: 'round' },
  { x: 413.8, z: 866, r: 3.25, kind: 'round' },
  { x: 386.2, z: 866, r: 3.25, kind: 'round' },
  // the west maze forecourt
  { x: 256, z: 952, r: 9, kind: 'square' },
  { x: 256, z: 965.8, r: 3.25, kind: 'round' },
  { x: 256, z: 938.2, r: 3.25, kind: 'round' },
  { x: 269.8, z: 952, r: 3.25, kind: 'round' },
  { x: 242.2, z: 952, r: 3.25, kind: 'round' },
  // east of the maze road (the east water bites off the fourth satellite)
  { x: 476, z: 1010, r: 7.5, kind: 'square' },
  { x: 476, z: 1022.3, r: 3.25, kind: 'round' },
  { x: 476, z: 997.7, r: 3.25, kind: 'round' },
  { x: 463.7, z: 1010, r: 3.25, kind: 'round' },
  // (no bed east of the Garden Gate road: the extended gate wall and its
  // channel-bank tower hold that lawn now)
  // the north lawn
  { x: 300, z: 1118, r: 6, kind: 'square' },
  { x: 300, z: 1128.8, r: 3.25, kind: 'round' },
  { x: 300, z: 1107.3, r: 3.25, kind: 'round' },
  { x: 310.8, z: 1118, r: 3.25, kind: 'round' },
  { x: 289.2, z: 1118, r: 3.25, kind: 'round' },
  // the mill lawn: three windmills turning over their own ring beds
  { x: 504, z: 760, r: 8.5, kind: 'ring', centerpiece: 'windmill' },
  { x: 492, z: 744, r: 7, kind: 'ring', centerpiece: 'windmill' },
  { x: 516, z: 750, r: 6.5, kind: 'ring', centerpiece: 'windmill' },
] as const;

// The bed colorways: a much wider wheel than the old three-rose palette.
export const GARDEN_BED_TINTS: readonly number[] = [
  0xd8385a, // crimson
  0xf27ba6, // rose pink
  0xf7c6d9, // blush
  0xffffff, // white
  0xf2c94c, // gold
  0xf5a25d, // apricot
  0xb07bd8, // violet
  0x7b9bd8, // cornflower
  0xc9b8e8, // lavender
  0xf27b62, // coral
] as const;

// Walk-ribbon colorway: a repeating white / rose / gold border along roads,
// planted just behind the clipped path hedge line (HEDGE_OFFSET below).
const RIBBON_TINTS = [0xffffff, 0xf27ba6, 0xf2c94c] as const;
const RIBBON_NEAR = 5.2;
const RIBBON_FAR = 6.6;
// the path hedge: a continuous clipped bush line edging every walk
const HEDGE_OFFSET = 4.15;
const HEDGE_STEP = 2.1;

const GARDEN_X0 = EVERGARDEN_ZONE.xMin ?? 180;
const GARDEN_X1 = EVERGARDEN_ZONE.xMax ?? 540;
const GARDEN_Z0 = EVERGARDEN_ZONE.zMin;
const GARDEN_Z1 = EVERGARDEN_ZONE.zMax;
const MAZE_MARGIN = 6;
const MAZE_X1 = MAZE_X0 + MAZE_COLS * MAZE_CELL;
// the maze bloom band: how far off a hedge face the white and gold border
// grows (NEAR keeps flowers out of the hedge itself)
export const MAZE_BLOOM_NEAR = 0.15;
export const MAZE_BLOOM_FAR = 1.5;
// The Garden Gate's welcome front: the doubled stone arch at the zone entry
// with flanking walls (EVERGARDEN_PROPS.decorProps), dressed on the garden
// side with a clipped hedge line and a flower border. Wall-line coordinates:
// u runs along the wall line, v is the offset toward the garden (north).
const GATE = { x: 391, z: 747, rot: 2.97 } as const;
const GATE_P = { x: Math.cos(GATE.rot), z: -Math.sin(GATE.rot) } as const; // wall line dir
const GATE_N = { x: -Math.sin(GATE.rot), z: -Math.cos(GATE.rot) } as const; // garden side
const GATE_HALF = 24; // the dressed frontage west of the arch (positive u)
// the east arm (negative u) runs longer: the wall extension to the channel
// bank replaced the old gate flower bed, and its dressing follows it
const GATE_EAST_HALF = 45;
const GATE_MOUTH = 7; // clear of the arch opening

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// The modeled beds' source footprint: each GLB is ~0.98 wide at unit scale,
// so a decor entry's scale spans 2r as scale = 2r / 0.98 (pinned by the
// paired test against the content/evergarden entries).
export const BED_MODEL_WIDTH = 0.98;

// Visual footprints of the garden's built structures, so no planting grows
// through a wall or floor. Walls use their thin VISUAL depth, not their fat
// movement collider circle (a hedge alongside a wall face is the whole
// point); everything else uses its collider footprint.
const BUILT_FOOTPRINTS: { x: number; z: number; r: number }[] = (() => {
  const out: { x: number; z: number; r: number }[] = [];
  for (const d of EVERGARDEN_PROPS.decorProps ?? []) {
    if (d.key === 'hexWall') out.push({ x: d.x, z: d.z, r: 1.8 });
    else if (d.r) out.push({ x: d.x, z: d.z, r: d.r });
  }
  for (const b of EVERGARDEN_PROPS.buildings) {
    out.push({ x: b.x, z: b.z, r: Math.max(b.w, b.d) * 0.6 });
  }
  for (const w of EVERGARDEN_PROPS.wells) out.push({ x: w.x, z: w.z, r: w.r });
  for (const s of EVERGARDEN_PROPS.stalls) out.push({ x: s.x, z: s.z, r: s.r });
  return out;
})();

/** True when (x, z) stands clear of every built structure by the margin. */
export function clearOfGardenBuildings(x: number, z: number, margin = 0.8): boolean {
  for (const f of BUILT_FOOTPRINTS) {
    if (Math.hypot(x - f.x, z - f.z) < f.r + margin) return false;
  }
  return true;
}

function inMazeRect(x: number, z: number): boolean {
  return (
    x > MAZE_X0 - MAZE_MARGIN &&
    x < MAZE_X1 + MAZE_MARGIN &&
    z > MAZE_Z0 - MAZE_MARGIN &&
    z < MAZE_Z1 + MAZE_MARGIN
  );
}

// Each plot draws four distinct colors from the wheel, seeded by position:
// two pattern colors, a boss color, and a filler for the ground between.
function plotPalette(p: ParterrePlot): [number, number, number, number] {
  const n = GARDEN_BED_TINTS.length;
  const a = Math.floor(hash2(p.x, p.z, 7101) * n) % n;
  const b = (a + 2 + Math.floor(hash2(p.x, p.z, 7111) * (n - 4))) % n;
  let cIdx = (b + 2 + Math.floor(hash2(p.x, p.z, 7121) * (n - 4))) % n;
  if (cIdx === a) cIdx = (cIdx + 1) % n;
  let dIdx = (cIdx + 3 + Math.floor(hash2(p.x, p.z, 7131) * (n - 5))) % n;
  if (dIdx === a || dIdx === b || dIdx === cIdx) dIdx = (dIdx + 2) % n;
  return [GARDEN_BED_TINTS[a], GARDEN_BED_TINTS[b], GARDEN_BED_TINTS[cIdx], GARDEN_BED_TINTS[dIdx]];
}

/**
 * The ground-flower plan: returns the raw tint for a flower at (x, z), or -1
 * where no planting reaches. The stand-alone beds are modeled now (see
 * parterreBedSpots), so the only bed flowers left here are the mill lawn's
 * procedural ring beds; the gate border and walk ribbons carry on unchanged.
 */
export function parterreFlowerTintAt(x: number, z: number): number {
  for (const p of PARTERRE_PLOTS) {
    if (!p.centerpiece) continue; // modeled beds paint nothing on the ground
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.abs(dx) > p.r || Math.abs(dz) > p.r) continue;
    const [ca, cb, cc] = plotPalette(p);
    const d = Math.hypot(dx, dz);
    if (d > p.r * 0.9) continue;
    if (d < p.r * 0.16) return cc; // the center boss under the mill
    // solid alternating rings edge to edge
    const band = Math.floor((d - p.r * 0.16) / (p.r * 0.15));
    return band % 2 === 0 ? ca : cb;
  }
  // the Great Maze's borders: white and gold blooms edging every hedge face,
  // along the corridor walls inside and around the outer perimeter, mixed
  // flower by flower the way a gardener under-plants a hedge line
  {
    const m = MAZE_BLOOM_FAR + 1;
    if (x > MAZE_X0 - m && x < MAZE_X1 + m && z > MAZE_Z0 - m && z < MAZE_Z1 + m) {
      const ci = Math.floor((x - MAZE_X0) / MAZE_CELL);
      const ri = Math.floor((MAZE_Z1 - z) / MAZE_CELL);
      const half = MAZE_CELL / 2;
      const deep = MAZE_WALL_DEPTH / 2;
      let dist = Number.POSITIVE_INFINITY;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const p = gardenMazeCellPieces(ci + dc, ri + dr);
          if (!p) continue;
          const cx = MAZE_X0 + (ci + dc + 0.5) * MAZE_CELL;
          const cz = MAZE_Z1 - (ri + dr + 0.5) * MAZE_CELL;
          if (p.h) {
            const ox = Math.max(0, Math.abs(x - cx) - half);
            const oz = Math.max(0, Math.abs(z - cz) - deep);
            dist = Math.min(dist, Math.hypot(ox, oz));
          }
          if (p.v) {
            const ox = Math.max(0, Math.abs(x - cx) - deep);
            const oz = Math.max(0, Math.abs(z - cz) - half);
            dist = Math.min(dist, Math.hypot(ox, oz));
          }
        }
      }
      if (dist > MAZE_BLOOM_NEAR && dist < MAZE_BLOOM_FAR) {
        return hash2(x * 5.1, z * 5.1, 7501) < 0.5 ? 0xffffff : 0xf2c94c;
      }
    }
  }
  // never under a modeled bed: those plots carry their own planting
  if (inParterrePlot(x, z, 0.5)) return -1;
  // the Garden Gate's flower border, along the garden face of its walls
  {
    const gdx = x - GATE.x;
    const gdz = z - GATE.z;
    const u = gdx * GATE_P.x + gdz * GATE_P.z;
    const v = gdx * GATE_N.x + gdz * GATE_N.z;
    const onArm = (u > GATE_MOUTH && u < GATE_HALF) || (-u > GATE_MOUTH && -u < GATE_EAST_HALF);
    if (onArm && v > 2.8 && v < 4.6) {
      if (!clearOfGardenBuildings(x, z, 0.5)) return -1;
      const block = Math.abs(Math.floor((u + 60) / 6));
      return RIBBON_TINTS[block % RIBBON_TINTS.length];
    }
  }
  // the walk ribbons: continuous border beds behind the path hedges
  if (x > GARDEN_X0 + 12 && x < GARDEN_X1 - 12 && z > GARDEN_Z0 + 10 && z < GARDEN_Z1 - 10) {
    if (inMazeRect(x, z)) return -1;
    const hub = EVERGARDEN_ZONE.hub;
    if (Math.hypot(x - hub.x, z - hub.z) < hub.radius + 5) return -1;
    const rd = roadDistance(x, z);
    if (rd >= RIBBON_NEAR && rd < RIBBON_FAR) {
      if (!clearOfGardenBuildings(x, z, 0.5)) return -1;
      // color repeats in fixed blocks down the walk, a stitched border
      const block = Math.abs(Math.floor((x + z * 0.618) / 8));
      return RIBBON_TINTS[block % RIBBON_TINTS.length];
    }
  }
  return -1;
}

// Open-lawn meadow tints: soft pastels growing mixed through one another,
// the way the Veiled Hollow's wild meadows read.
const MEADOW_TINTS = [0xffffff, 0xf7c6d9, 0xf2c94c, 0xc9b8e8, 0xf27ba6, 0x7b9bd8] as const;

/**
 * Flower fields on the open lawns: irregular noise-shaped patches bloom
 * between the formal features, colors mixed per flower inside each patch,
 * keeping clear of walks, beds, the maze, and the hamlet. Returns a tint or
 * -1, sampled per candidate flower position.
 */
export function gardenMeadowTintAt(x: number, z: number): number {
  if (x < GARDEN_X0 + 12 || x > GARDEN_X1 - 12 || z < GARDEN_Z0 + 10 || z > GARDEN_Z1 - 10) {
    return -1;
  }
  if (inMazeRect(x, z)) return -1;
  if (inParterrePlot(x, z, 4)) return -1;
  const hub = EVERGARDEN_ZONE.hub;
  if (Math.hypot(x - hub.x, z - hub.z) < hub.radius + 10) return -1;
  // patchy blob fields: two noise octaves shape ragged meadow edges instead
  // of square cells, so drifts wander the lawn the way wild growth does
  const patch = fbm2(x * 0.045, z * 0.045, 7301, 2);
  if (patch < 0.62) return -1;
  // denser toward each patch heart, airy at the ragged edge
  const density = 0.35 + smoothstep(0.62, 0.8, patch) * 0.4;
  if (hash2(x * 3.1, z * 3.1, 7311) > density) return -1;
  if (roadDistance(x, z) < 7.5) return -1; // clear of walks, hedges, ribbons
  if (!clearOfGardenBuildings(x, z, 0.5)) return -1;
  // colors grow mixed within the patch, flower by flower
  return MEADOW_TINTS[
    Math.floor(hash2(x * 7.3, z * 7.3, 7321) * MEADOW_TINTS.length) % MEADOW_TINTS.length
  ];
}

/**
 * True inside any parterre plot (plus margin): the beds stay clear of the
 * random decoration trees and boulders, the way a gardener would keep them.
 */
export function inParterrePlot(x: number, z: number, margin = 0): boolean {
  for (const p of PARTERRE_PLOTS) {
    if (Math.hypot(x - p.x, z - p.z) < p.r + margin) return true;
  }
  return false;
}

const SLOPE_EPS = 1.2;
function flatDryLawn(x: number, z: number, seed: number): boolean {
  const h = terrainHeight(x, z, seed);
  if (h < WATER_LEVEL + 1.6) return false;
  if (gardenLandness(x, z) < 0.25) return false;
  const hx = terrainHeight(x + SLOPE_EPS, z, seed) - terrainHeight(x - SLOPE_EPS, z, seed);
  const hz = terrainHeight(x, z + SLOPE_EPS, seed) - terrainHeight(x, z - SLOPE_EPS, seed);
  return Math.hypot(hx, hz) / (2 * SLOPE_EPS) <= 0.62;
}

/**
 * The bush plan: the mill lawn's clipped hedge rings and cardinal roses
 * (the stand-alone beds are modeled and bring their own edging), plus
 * continuous hedge lines edging every walk and the gate front.
 */
export function parterreBushSpots(seed: number): ParterreBushSpot[] {
  const out: ParterreBushSpot[] = [];
  const hedge = (x: number, z: number): void => {
    // never grow a hedge through a wall, floor, or well
    if (!clearOfGardenBuildings(x, z, 0.8)) return;
    if (flatDryLawn(x, z, seed)) out.push({ x, z, kind: 'bush', scale: 0.82 });
  };
  const rose = (x: number, z: number, scale: number, tint: number): void => {
    if (flatDryLawn(x, z, seed)) out.push({ x, z, kind: 'bushFlowers', scale, bloomTint: tint });
  };
  const hedgeRing = (cx: number, cz: number, radius: number): void => {
    const n = Math.round((Math.PI * 2 * radius) / HEDGE_STEP);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      hedge(cx + Math.sin(a) * radius, cz + Math.cos(a) * radius);
    }
  };
  for (const p of PARTERRE_PLOTS) {
    if (!p.centerpiece) continue; // modeled beds carry their own edging
    const [ca, cb] = plotPalette(p);
    // solid hedge ring outside the flower rings, roses at the cardinals
    hedgeRing(p.x, p.z, p.r * 0.98);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      rose(p.x + Math.sin(a) * p.r * 0.62, p.z + Math.cos(a) * p.r * 0.62, 0.95, i % 2 ? ca : cb);
    }
  }
  // the walk hedges: clipped lines flanking every road, broken at junctions,
  // the hamlet, the statue lane, and the maze mouth
  const hub = EVERGARDEN_ZONE.hub;
  for (const road of EVERGARDEN_ROADS) {
    let carry = HEDGE_STEP * 0.5;
    for (let s = 0; s < road.length - 1; s++) {
      const a = road[s];
      const b = road[s + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 1e-6) continue;
      const ux = (b.x - a.x) / segLen;
      const uz = (b.z - a.z) / segLen;
      for (let t = carry; t <= segLen; t += HEDGE_STEP) {
        const cx = a.x + ux * t;
        const cz = a.z + uz * t;
        for (const side of [-1, 1]) {
          const x = cx - uz * side * HEDGE_OFFSET;
          const z = cz + ux * side * HEDGE_OFFSET;
          if (inMazeRect(x, z)) continue;
          if (Math.hypot(x - hub.x, z - hub.z) < hub.radius + 4) continue;
          // a crossing road runs closer than this spot's own: a junction gap
          if (roadDistance(x, z) < HEDGE_OFFSET - 0.8) continue;
          if (inParterrePlot(x, z, 1)) continue;
          hedge(x, z);
        }
      }
      carry = ((carry - segLen) % HEDGE_STEP) + HEDGE_STEP;
      if (carry >= HEDGE_STEP) carry -= HEDGE_STEP;
    }
  }
  // the Garden Gate's hedge line, hugging the garden face of its walls
  // (the east arm, side -1, follows the longer wall to the channel bank)
  for (const side of [-1, 1]) {
    const armEnd = side === -1 ? GATE_EAST_HALF : GATE_HALF;
    for (let u = GATE_MOUTH + 1; u <= armEnd - 1; u += HEDGE_STEP) {
      const x = GATE.x + GATE_P.x * u * side + GATE_N.x * 2.0;
      const z = GATE.z + GATE_P.z * u * side + GATE_N.z * 2.0;
      hedge(x, z);
    }
  }
  return out;
}

/**
 * True where lawn grass should grow back around the plantings: a lush halo
 * just beyond every bed (but not under the modeled beds themselves, whose
 * bases carry their own ground), and across the meadow patches a bit past
 * where the flowers stop, so both read lush instead of clipped edges.
 */
export function gardenLushGrassAt(x: number, z: number): boolean {
  if (inParterrePlot(x, z, 1.8)) return !inParterrePlot(x, z, -1);
  if (x < GARDEN_X0 + 12 || x > GARDEN_X1 - 12 || z < GARDEN_Z0 + 10 || z > GARDEN_Z1 - 10) {
    return false;
  }
  if (inMazeRect(x, z)) return false;
  const hub = EVERGARDEN_ZONE.hub;
  if (Math.hypot(x - hub.x, z - hub.z) < hub.radius + 10) return false;
  if (roadDistance(x, z) < 6.5) return false;
  if (!clearOfGardenBuildings(x, z, 0.5)) return false;
  // the meadow patch shape at a looser threshold than the flowers (0.62), so
  // the grass halo runs a little beyond the blooms
  return fbm2(x * 0.045, z * 0.045, 7301, 2) >= 0.58;
}

// (The avenue and sentinel topiary retired entirely: even the last clipped
// ball form read as a lollipop tree by the walks. The garden's greenery is
// now hedges, oaks, and the specimen elders alone.)
