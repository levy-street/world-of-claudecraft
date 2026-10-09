// Pure placement plan for the Gravewyrm Sanctum's Blender kit
// (public/models/props/gravewyrm_sanctum_kit.glb; the piece table is the kit
// agent's NOTAS.md, conventions: game yards, base-centre origins, a piece's
// front is its local +Z after the glTF export, edge pieces run along local X
// with their drop toward +Z). Two parts:
//
// 1. Every `gs_*` prop of the sim layout drawn by its piece, FITTED to the
//    prop's collider (the scale that makes the piece's own footprint match
//    the footprint the sim blocks), so what you bump into is what you see.
// 2. The render-only scenery: the sculpted crevasse walls along every lip
//    that drops into the void, the slate cliffs under the rock terraces,
//    snow drifts and sastrugi on the snowfields, moraine and kerbs along the
//    Sledge Road, seracs and glacier walls rising out of the crevasses (never
//    on a walkway), icefalls and frozen falls, the vault's walls with the
//    held inside them, the gate tunnel's flanks, crags round the landing.
//
// The seal pillars, the chains, the face pieces and the gates are drawn by
// their own painters (they move or swap), never here.
//
// Three-free, DOM-free, deterministic (hashes only).

import {
  CHAIN_BRIDGE,
  GATE_TUNNEL,
  GRAVEWYRM_HEIGHTS,
  GRAVEWYRM_SANCTUM_FIELD,
  GRAVEWYRM_SANCTUM_VOID_HEIGHT,
  ICE_BRIDGE,
  MELT_CHANNEL,
  RITUAL_VAULT,
  ROAD_BENDS,
  SMITHS_HAMMER,
} from '../../sim/content/gravewyrm_sanctum_layout';
import { authoredFieldCliffRuns, type FieldCliffRun } from '../../sim/instances/authored_field';
import type { FieldGround, FieldProp } from '../../sim/instances/authored_field/types';
import { sanctumFloorAt, sanctumGround, sanctumHash } from './sanctum_plan_core';

export interface SanctumKitPlacement {
  piece: string;
  x: number;
  z: number;
  /** Absolute height (instance frame); else the floor under (x, z) + lift. */
  y?: number;
  lift?: number;
  /** Yaw (three.js rotation.y): the piece's local +Z turns to (sin, cos). */
  rot: number;
  scale: number;
  /** Extra scale along local X, Y and Z. */
  stretch?: number;
  scaleY?: number;
  depth?: number;
  /** Pitch and roll (radians), applied after the yaw. */
  tilt?: number;
  roll?: number;
  /** Shed on the low tier (pure dressing). */
  cosmetic?: boolean;
  /** Never casts a shadow (scenery out in the gulf, far from every walk). */
  noShadow?: boolean;
  /** Shed when the effects density is below this (0..1; the gulf's
   *  scenery thins on the middle tier). */
  shed?: number;
}

/** The kit's measured footprints (x by z after export) and heights, from its
 *  piece table: what the fitting scales against. */
export const SANCTUM_KIT_SIZES: Readonly<Record<string, readonly [number, number, number]>> = {
  Kit_SeracS: [8.4, 6.5, 9.6],
  Kit_SeracM: [13.9, 11.8, 17.1],
  Kit_SeracL: [23.6, 20.2, 29.0],
  Kit_ThornpeakRockA: [4.7, 4.2, 3.2],
  Kit_ThornpeakRockB: [5.2, 4.8, 2.0],
  Kit_ThornpeakRockC: [3.8, 3.4, 4.6],
  Kit_ThornpeakCrag: [10.0, 8.0, 10.2],
  Kit_MoraineRocks: [11.2, 7.1, 1.5],
  Kit_CultTent: [7.0, 5.9, 4.5],
  Kit_Sledge: [3.0, 10.8, 2.4],
  Kit_SoulBrazier: [1.4, 1.4, 2.2],
  Kit_Pyre: [2.6, 2.6, 2.4],
  Kit_GoadRack: [3.1, 1.0, 2.4],
  Kit_ChainHeap: [18.7, 17.4, 6.0],
  Kit_ChainAnchor: [14.9, 32.2, 8.2],
  Kit_RuneWall: [28.0, 8.3, 17.0],
  Kit_SmithsHammer: [6.6, 15.0, 3.1],
  Kit_VigilCairn: [1.8, 1.9, 2.4],
  Kit_HeldGiantA: [7.2, 17.8, 8.6],
  Kit_HeldDeadA: [3.0, 2.7, 2.0],
  Kit_VaultWall: [18.8, 7.8, 14.9],
  Kit_GlacierWallA: [34.9, 23.6, 50.6],
  Kit_GlacierWallB: [35.1, 24.3, 40.6],
  Kit_IceFall: [29.9, 53.6, 42.5],
  Kit_FrozenFall: [20.0, 11.3, 34.5],
  Kit_SnowDriftA: [11.0, 2.9, 1.6],
  Kit_SnowDriftB: [10.9, 6.2, 1.2],
  Kit_Sastrugi: [8.8, 7.1, 0.4],
  Kit_CrevasseEdgeA: [8.8, 3.8, 64],
  Kit_CrevasseEdgeB: [8.8, 4.9, 64],
  Kit_CrevasseEdgeC: [8.8, 4.4, 64],
  Kit_RockCliff: [17.1, 7.9, 64],
  Kit_HaulRoadKerb: [8.8, 10.2, 0.5],
  Kit_MeltChannel: [8.5, 8.6, 1.6],
  Kit_RitualCircle: [11.6, 12.6, 1.0],
  Kit_ThawPyre: [15.6, 15.7, 7.7],
  Kit_GateTunnel: [35.4, 26.3, 27.3],
  Kit_KeystoneSocket: [29.4, 7.5, 22.4],
};

// ---- part 1: the props --------------------------------------------------------------

const HELD_DEAD = [
  'Kit_HeldDeadA',
  'Kit_HeldDeadB',
  'Kit_HeldDeadC',
  'Kit_HeldDeadD',
  'Kit_HeldDeadE',
  'Kit_HeldDeadF',
];
const HELD_GIANTS = ['Kit_HeldGiantA', 'Kit_HeldGiantB', 'Kit_HeldGiantC'];
/** The Thornpeak boulders' widest horizontal reach from their origin (yards,
 *  measured off the kit's meshes). */
const RIM_ROCK_REACH = { A: 2.94, B: 2.95, C: 2.1 } as const;

/** The piece placements of one prop (empty for the props another painter
 *  draws: the seal pillars, the gate tunnel's own pass). */
export function placementsForProp(p: FieldProp, index: number): SanctumKitPlacement[] {
  const rot = p.rot ?? 0;
  const base = { x: p.x, z: p.z, rot };
  switch (p.kind) {
    case 'gs_gate_tunnel':
      // The tunnel mouth stands on the landing's level; its threshold faces
      // the landing (north), the tunnel runs south into the pass.
      return [{ ...base, piece: 'Kit_GateTunnel', y: 55, scale: 1, rot: GATE_TUNNEL.rot }];
    case 'gs_vigil_cairn':
      return [{ ...base, piece: 'Kit_VigilCairn', scale: 1.05 }];
    case 'gs_keystone_socket':
      // The socket's plinth: a split fin of slate with the rune-cut hollow.
      return [
        { ...base, piece: 'Kit_ThornpeakRockC', scale: (2 * (p.r ?? 2)) / 3.8, scaleY: 0.95 },
      ];
    case 'gs_chain_heap':
      return [{ ...base, piece: 'Kit_ChainHeap', scale: 0.34 }];
    case 'gs_cult_brazier':
    case 'gs_soul_brazier':
      return [{ ...base, piece: 'Kit_SoulBrazier', scale: 1.05 }];
    case 'gs_rim_rock_a':
    case 'gs_rim_rock_b':
    case 'gs_rim_rock_c': {
      // Fitted so the boulder's widest reach is the collider plus a body's
      // skin: what a body bumps is the rock it sees.
      const v = p.kind.slice(-1).toUpperCase() as 'A' | 'B' | 'C';
      return [
        { ...base, piece: `Kit_ThornpeakRock${v}`, scale: ((p.r ?? 2) + 0.35) / RIM_ROCK_REACH[v] },
      ];
    }
    case 'gs_moraine_rocks':
      return [
        { ...base, piece: 'Kit_ThornpeakRockB', scale: (2 * (p.r ?? 2.4)) / 5.0 },
        { ...base, piece: 'Kit_MoraineRocks', scale: 0.8, rot: rot + 0.9, cosmetic: true },
      ];
    case 'gs_cult_sledge':
      return [{ ...base, piece: 'Kit_Sledge', scale: (2 * (p.hd ?? 3.4)) / 8 }];
    case 'gs_goad_rack':
      return [{ ...base, piece: 'Kit_GoadRack', scale: (2 * (p.hw ?? 1.8)) / 3.2 }];
    case 'gs_serac_large': {
      // The tower's foot (its fallen blocks) reaches 12.1 yd at a body's
      // height: fitted so it stands at most a body's width past the collider.
      const fit = ((p.r ?? 5) + 1.5) / 12.1;
      return [
        {
          ...base,
          piece: 'Kit_SeracL',
          scale: fit,
          scaleY: (p.h ?? 26) / 29 / fit,
        },
      ];
    }
    case 'gs_serac_medium':
      return [
        {
          ...base,
          piece: 'Kit_SeracM',
          scale: (p.r ?? 3.6) / 5,
          scaleY: (p.h ?? 18) / 17.1 / ((p.r ?? 3.6) / 5),
        },
      ];
    case 'gs_serac_small':
      return [
        {
          ...base,
          piece: 'Kit_SeracS',
          scale: (p.r ?? 2.6) / 3,
          scaleY: (p.h ?? 12) / 9.6 / ((p.r ?? 2.6) / 3),
        },
      ];
    case 'gs_rune_wall': {
      // The wall runs along z on the ledge's east edge, the words facing west
      // onto the path: local X turns to +z, the front (local +Z) to -x.
      const len = 2 * (p.hd ?? 15);
      return [
        {
          ...base,
          piece: 'Kit_RuneWall',
          rot: -Math.PI / 2,
          scale: 1,
          stretch: len / 28,
          scaleY: (p.h ?? 16) / 17,
          depth: 0.62,
        },
      ];
    }
    case 'gs_chain_anchor':
      // The block fitted to the collider; its chain runs out south over the
      // ledge's lip into the gulf (never across the walk).
      return [
        { ...base, piece: 'Kit_ChainAnchor', rot: rot + Math.PI, scale: (2 * (p.hw ?? 4)) / 11 },
      ];
    case 'gs_held_giant':
      return [{ ...base, piece: HELD_GIANTS[index % 3], scale: (p.r ?? 3) / 4 }];
    case 'gs_smiths_hammer': {
      // The kit's head sits on its origin and the haft runs out along its +Z:
      // lay the haft along the prop's long axis, the head at its west end.
      const ax = Math.cos(rot);
      const az = -Math.sin(rot);
      const s = 0.72;
      const off = (15 * s) / 2 - 3.3 * s;
      return [
        {
          piece: 'Kit_SmithsHammer',
          x: p.x - ax * off,
          z: p.z - az * off,
          rot: Math.atan2(ax, az),
          scale: s,
        },
      ];
    }
    case 'gs_cult_tent':
      return [{ ...base, piece: 'Kit_CultTent', scale: (2 * (p.hw ?? 3)) / 5.6 }];
    case 'gs_soul_pyre':
      return [{ ...base, piece: 'Kit_Pyre', scale: (p.r ?? 1.4) / 1.1 }];
    case 'gs_ritual_circle':
      return [{ ...base, piece: 'Kit_RitualCircle', scale: 1, lift: 0.03 }];
    case 'gs_melt_channel':
      return planMeltChannelPieces();
    case 'gs_thaw_pyre':
      // Kit_ThawPyre's origin is its pool's centre (the prop stands there).
      return [{ ...base, piece: 'Kit_ThawPyre', scale: 1 }];
    case 'gs_held_dead':
      return [{ ...base, piece: HELD_DEAD[index % HELD_DEAD.length], scale: 0.95 }];
    default:
      return [];
  }
}

/** Kit_MeltChannel modules along the melt channel's line (8 yd each). */
export function planMeltChannelPieces(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  for (let i = 0; i < MELT_CHANNEL.length - 1; i++) {
    const [ax, az] = MELT_CHANNEL[i];
    const [bx, bz] = MELT_CHANNEL[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 8));
    // Local X runs along the channel: yaw so (cos, -sin) = the direction.
    const rot = Math.atan2(-(bz - az), bx - ax);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({
        piece: 'Kit_MeltChannel',
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        rot,
        scale: 1,
        stretch: len / n / 8,
        lift: 0.02,
      });
    }
  }
  return out;
}

// ---- part 2: the scenery -------------------------------------------------------------

function groundOf(surfaceId: string): FieldGround | undefined {
  return GRAVEWYRM_SANCTUM_FIELD.surfaces.find((s) => s.id === surfaceId)?.ground;
}

/** Is any walkable floor within `r` of (x, z)? (Ring of probes.) */
export function nearWalkable(x: number, z: number, r: number): boolean {
  if (sanctumFloorAt(x, z) !== null) return true;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    for (const f of [0.5, 1]) {
      if (sanctumFloorAt(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f) !== null) return true;
    }
  }
  return false;
}

const CREVASSE_EDGES = ['Kit_CrevasseEdgeA', 'Kit_CrevasseEdgeB', 'Kit_CrevasseEdgeC'];
/** How far out over the drop an edge module stands (yards). */
const EDGE_OUTSET = 1.2;
/** Lips that drop at least this far are dressed with the sculpted walls. */
const EDGE_MIN_DROP = 12;
/** How far onto the high side the lip's height is read (the cliff probe's). */
const LIP_PROBE = 0.6;
/** The most a sloping lip may fall along one module (its top stands at the
 *  module's lower end, so its upper end sits at most this far under the
 *  walk's edge, where the terrain's skirt shows). */
const EDGE_MAX_STEP = 0.6;
/** The shortest module, as a share of the piece's own length. */
const EDGE_MIN_STRETCH = 0.3;

/** The sculpted crevasse walls (snow and ice terraces) and slate cliffs (rock
 *  terraces) along every lip that drops into the gulf: modules along each
 *  cliff run, their drop turned outward. */
export function planCrevasseEdges(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  const hidden = new Set(GRAVEWYRM_SANCTUM_FIELD.surfaces.filter((s) => s.hidden).map((s) => s.id));
  let index = 0;
  for (const run of authoredFieldCliffRuns(GRAVEWYRM_SANCTUM_FIELD)) {
    if (hidden.has(run.surface)) continue;
    if (run.high - run.low < EDGE_MIN_DROP) continue;
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    if (len < 2) continue;
    const ground = groundOf(run.surface);
    const rock = ground === 'slate' || ground === 'earth';
    const module = rock ? 16 : 8;
    // The lip's height along the run, read on the high side: a run beside a
    // stair or a ramp slopes, and a module stood level at the run's first
    // sample rose as a wall over the lower steps.
    const lip = (u: number): number =>
      sanctumGround(
        run.ax + (run.bx - run.ax) * u - run.nx * LIP_PROBE,
        run.az + (run.bz - run.az) * u - run.nz * LIP_PROBE,
      );
    const fall = Math.abs(lip(1) - lip(0));
    // A sloping run takes shorter modules, each stood at the LOWER of its two
    // ends, so no module's lip ever stands over the walk (a hanging face is
    // never rolled to follow a slope: its foot would swing far along the run).
    const n = Math.max(1, Math.round(len / module), Math.ceil(fall / EDGE_MAX_STEP));
    const nominal = rock
      ? SANCTUM_KIT_SIZES.Kit_RockCliff[0]
      : SANCTUM_KIT_SIZES.Kit_CrevasseEdgeA[0];
    // Too steep for the kit's lip (a stair's sides): the terrain's own skirt
    // draws that drop.
    if (len / n < nominal * EDGE_MIN_STRETCH) continue;
    const rot = Math.atan2(run.nx, run.nz);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      // A yard out over the drop: the lip's rubble stays off the walk.
      const x = run.ax + (run.bx - run.ax) * t + run.nx * EDGE_OUTSET;
      const z = run.az + (run.bz - run.az) * t + run.nz * EDGE_OUTSET;
      const piece = rock ? 'Kit_RockCliff' : CREVASSE_EDGES[Math.floor(sanctumHash(index, 3) * 3)];
      const size = SANCTUM_KIT_SIZES[piece][0];
      out.push({
        piece,
        x,
        z,
        y: Math.min(lip(k / n), lip((k + 1) / n)),
        rot,
        scale: 1,
        // A hair long so neighbours overlap at a bend.
        stretch: (len / n / (size * 0.92)) * 1.04,
        depth: 0.9 + sanctumHash(index, 5) * 0.25,
      });
      index++;
    }
  }
  return out;
}

/** Snow drifts banked on the snowfields (walk-through, under knee
 *  height). The floors' own wind ridges are the snow texture's: the kit's
 *  sastrugi patch read as spikes standing in the snow, so it is not placed. */
export function planSnowDressing(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  // Drifts banked against the lips of the snowfields, on the lee (east) side
  // of the wind and along the north rims.
  let k = 0;
  for (const run of authoredFieldCliffRuns(GRAVEWYRM_SANCTUM_FIELD)) {
    if (groundOf(run.surface) !== 'snow' || run.high - run.low < 3) continue;
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    if (len < 8) continue;
    k++;
    if (sanctumHash(k, 9) < 0.45) continue;
    const t = 0.3 + sanctumHash(k, 10) * 0.4;
    const x = run.ax + (run.bx - run.ax) * t - run.nx * 3.2;
    const z = run.az + (run.bz - run.az) * t - run.nz * 3.2;
    if (sanctumFloorAt(x, z) === null) continue;
    out.push({
      piece: sanctumHash(k, 11) < 0.5 ? 'Kit_SnowDriftA' : 'Kit_SnowDriftB',
      x,
      z,
      // Along the lip, the lee face toward the drop.
      rot: Math.atan2(run.nx, run.nz),
      scale: 0.7 + sanctumHash(k, 12) * 0.25,
      cosmetic: true,
    });
  }
  return out;
}

/** The Sledge Road: kerbs and ruts along the haul road, moraine banked on the
 *  outside of its bends. */
export function planRoadDressing(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  const legs: [number, number, number, number][] = [
    [-6, -168.5, -30, -150.5],
    [-26, -137.9, 16, -116.1],
    [22, -99, 8, -88],
  ];
  for (const [ax, az, bx, bz] of legs) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 8.4));
    const rot = Math.atan2(-(bz - az), bx - ax);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({
        piece: 'Kit_HaulRoadKerb',
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        rot,
        scale: 1,
        stretch: len / n / 8.4,
        // The kit's kerbs stand 3.6 either side of its centre line: spread
        // them to the 14 yd road's own edges.
        depth: 6.2 / 3.6,
        lift: 0.01,
      });
    }
  }
  for (const [i, bend] of [ROAD_BENDS.upper, ROAD_BENDS.lower].entries()) {
    for (let k = 0; k < 3; k++) {
      const a = (i === 0 ? Math.PI : 0) + (k - 1) * 0.55;
      const x = bend.x + Math.cos(a) * (bend.r - 2.5);
      const z = bend.z + Math.sin(a) * (bend.r - 2.5);
      out.push({
        piece: 'Kit_MoraineRocks',
        x,
        z,
        rot: a + Math.PI / 2,
        scale: 0.55,
        cosmetic: true,
      });
    }
  }
  return out;
}

/** The scenery out in the gulf: seracs rising out of the crevasse floor, the
 *  glacier's walls along the bowl's margins, icefalls flanking the face.
 *  Nothing within reach of a walkway. */
export function planGulfScenery(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  const floor = GRAVEWYRM_SANCTUM_VOID_HEIGHT - 4;
  const b = GRAVEWYRM_SANCTUM_FIELD.bounds;
  let i = 0;
  for (let x = b.minX + 10; x <= b.maxX - 10; x += 28) {
    for (let z = b.minZ + 20; z <= b.maxZ - 8; z += 28) {
      i++;
      const jx = x + (sanctumHash(i, 21) - 0.5) * 14;
      const jz = z + (sanctumHash(i, 22) - 0.5) * 14;
      const big = sanctumHash(i, 23);
      const piece = big > 0.7 ? 'Kit_SeracL' : big > 0.35 ? 'Kit_SeracM' : 'Kit_SeracS';
      const size = SANCTUM_KIT_SIZES[piece];
      const scale = (piece === 'Kit_SeracL' ? 1.2 : 1.6) + sanctumHash(i, 24) * 0.8;
      const reach = (Math.max(size[0], size[1]) / 2) * scale + 6;
      if (nearWalkable(jx, jz, reach)) continue;
      // Tall enough to read from the terraces above: some break the void's
      // level, none reaches a walkway's height near it.
      out.push({
        piece,
        x: jx,
        z: jz,
        y: floor,
        rot: sanctumHash(i, 25) * Math.PI * 2,
        scale,
        scaleY: 1.3 + sanctumHash(i, 26) * 0.7,
        tilt: (sanctumHash(i, 27) - 0.5) * 0.12,
        cosmetic: true,
        noShadow: true,
        shed: sanctumHash(i, 28),
      });
    }
  }
  // The glacier's margins: ice cliffs climbing out of the crevasses along the
  // bowl's east and west sides, facing in.
  for (const side of [-1, 1]) {
    for (let z = b.minZ + 40; z <= b.maxZ - 30; z += 40) {
      i++;
      const x = side * (b.maxX - 4);
      if (nearWalkable(x - side * 10, z, 14)) continue;
      out.push({
        piece: sanctumHash(i, 31) < 0.5 ? 'Kit_GlacierWallA' : 'Kit_GlacierWallB',
        x,
        z,
        y: floor - 6,
        // Front (local +Z) toward the bowl's centre line.
        rot: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        scale: 1.25,
        scaleY: 1.1 + sanctumHash(i, 32) * 0.3,
        noShadow: true,
      });
    }
  }
  // Icefalls pouring down beside the Calving Face's wings.
  for (const side of [-1, 1]) {
    out.push({
      piece: 'Kit_IceFall',
      x: side * 104,
      z: 226,
      y: floor + 6,
      rot: side * 0.25 + Math.PI,
      scale: 1.5,
      cosmetic: false,
    });
  }
  return out;
}

/** The vault walls' ring (yards from the vault's centre to a piece's
 *  origin) and the clearance each opening keeps either side of its stair. */
const VAULT_WALL_RING = RITUAL_VAULT.r + 3;
const VAULT_WALL_SCALE = 1.05;
/** Pieces per side (east and west arcs between the two openings). */
const VAULT_WALL_PIECES = 3;
/** A body's margin past a stair's edge before the first wall piece. */
const VAULT_OPENING_MARGIN = 2;
/** Kit_VaultWall's front face stands this far in front of its origin. */
const VAULT_WALL_FRONT = 1.51;

/** The half-angle of the rim's opening for a stair of half width `w`: the
 *  wall's inner face ends a body's margin past the stair's edge. */
export function vaultOpeningHalfAngle(w: number): number {
  const inner = VAULT_WALL_RING - VAULT_WALL_FRONT * VAULT_WALL_SCALE;
  return Math.asin(Math.min(1, (w + VAULT_OPENING_MARGIN) / inner));
}

/** The Ritual Vault's walls: dripping blue ice with the held inside, round
 *  the rim, OPEN where the stairs come in (south, the vault stair) and go on
 *  (north, the shore stair) with a body's margin past each stair's edge, so
 *  the drawn rim and the walked way agree (the owner walked through a wall
 *  here once). Their inner faces stand outside the vault's floor. */
export function planVaultWalls(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  const r = VAULT_WALL_RING;
  const north = vaultOpeningHalfAngle(stairHalfWidth('shore_stair'));
  const south = vaultOpeningHalfAngle(stairHalfWidth('vault_stair'));
  // Angles from +z (north) turning toward +x: each side's arc runs from the
  // north opening's edge to the south opening's edge.
  const span = Math.PI - north - south;
  const step = span / VAULT_WALL_PIECES;
  // The straight piece spans the chord of its step (a hair long to close the
  // joints), its ends pulled in so they never cross into an opening.
  const chord = 2 * r * Math.sin(step / 2);
  for (const side of [1, -1]) {
    for (let k = 0; k < VAULT_WALL_PIECES; k++) {
      const a = side * (north + step * (k + 0.5));
      out.push({
        piece: 'Kit_VaultWall',
        x: RITUAL_VAULT.x + Math.sin(a) * r,
        z: RITUAL_VAULT.z + Math.cos(a) * r,
        y: RITUAL_VAULT.h - 1.5,
        // Front toward the vault's centre.
        rot: a + Math.PI,
        scale: VAULT_WALL_SCALE,
        stretch: (chord * 1.02) / (SANCTUM_KIT_SIZES.Kit_VaultWall[0] * VAULT_WALL_SCALE),
      });
    }
  }
  return out;
}

function stairHalfWidth(id: string): number {
  const s = GRAVEWYRM_SANCTUM_FIELD.surfaces.find((f) => f.id === id);
  if (!s || s.kind !== 'path') throw new Error(`no stair ${id}`);
  return s.halfWidth;
}

/** Frozen waterfalls hanging off rock lips into the gulf (a few, chosen,
 *  never by a walkway's edge where the fall's lip crust would stand on the
 *  floor): their lip sits a yard and a half under the floor and a yard out. */
export function planFrozenFalls(): SanctumKitPlacement[] {
  const spots: [number, number, number][] = [
    // Under the Lock Terrace's east and west rims and the shore's wings.
    [23.5, -14, Math.PI / 2],
    [-23.5, -14, -Math.PI / 2],
    [60, 174, 1.1],
    [-60, 174, -1.1],
  ];
  return spots.map(([x, z, rot]) => ({
    piece: 'Kit_FrozenFall',
    x,
    z,
    y: sanctumGround(x - Math.sin(rot) * 3, z - Math.cos(rot) * 3) - 1.6,
    rot,
    scale: 1,
  }));
}

/** Crags and rocks round the landing, the court and the terrace rims, the
 *  gate tunnel's flanks (cladding the pass behind it). */
export function planRockDressing(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  // The pass behind the landing: rock cliffs either side of the tunnel mouth.
  for (const side of [-1, 1]) {
    out.push({
      piece: 'Kit_RockCliff',
      x: GATE_TUNNEL.x + side * 26,
      z: GATE_TUNNEL.z + 1,
      y: 82,
      rot: Math.PI,
      scale: 1.1,
      stretch: 1.4,
    });
    out.push({
      piece: 'Kit_ThornpeakCrag',
      x: side * 21,
      z: -236,
      y: 52,
      rot: side * 0.5,
      scale: 1.5,
    });
  }
  // The rocks on the terrace rims are solid layout props (gs_rim_rock_*,
  // drawn by placementsForProp): a body bumps the rock it sees.
  // The Smith's hammer gets a broken chain heap beside it, the bridge's
  // anchor a heap at its foot (the slack the chain came down with).
  out.push({
    piece: 'Kit_ChainHeap',
    x: SMITHS_HAMMER.x + 9,
    z: SMITHS_HAMMER.z + 1.5,
    rot: 0.8,
    scale: 0.26,
    cosmetic: true,
  });
  out.push({
    piece: 'Kit_ChainHeap',
    x: CHAIN_BRIDGE.x + 9,
    z: CHAIN_BRIDGE.fromZ - 7,
    rot: 2.1,
    scale: 0.22,
    cosmetic: true,
  });
  return out;
}

/** The landmarks the layout names without a prop: the natural ice arch
 *  under the Serac Field's bridge path (its deck a hand under the walked
 *  path, its arch and abutments falling into the crevasse). The kit's
 *  keystone gate face is NOT stood over the Landing Stair: its jambs boxed
 *  the first vista into a corridor; the socket is the court's plinth prop. */
export function planLandmarks(): SanctumKitPlacement[] {
  const bridgeLen = Math.abs(ICE_BRIDGE.toZ - ICE_BRIDGE.fromZ);
  return [
    {
      piece: 'Kit_IceBridge',
      x: ICE_BRIDGE.x,
      z: (ICE_BRIDGE.fromZ + ICE_BRIDGE.toZ) / 2,
      y: Math.min(GRAVEWYRM_HEIGHTS.seracUpper, GRAVEWYRM_HEIGHTS.seracLower) - 0.25,
      // Local X (the span) runs north along the path.
      rot: Math.PI / 2,
      scale: 1,
      stretch: (bridgeLen + 8) / 26,
      depth: (ICE_BRIDGE.halfWidth * 2) / 6,
    },
  ];
}

/** The whole static kit plan (instance-local frame). */
export function planSanctumKitPlacements(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  const counts = new Map<string, number>();
  for (const p of GRAVEWYRM_SANCTUM_FIELD.props) {
    const n = counts.get(p.kind) ?? 0;
    counts.set(p.kind, n + 1);
    out.push(...placementsForProp(p, n));
  }
  out.push(...planCrevasseEdges());
  out.push(...planSnowDressing());
  out.push(...planRoadDressing());
  out.push(...planGulfScenery());
  out.push(...planVaultWalls());
  out.push(...planFrozenFalls());
  out.push(...planRockDressing());
  out.push(...planLandmarks());
  return out;
}

/** A run's mid point (tests). */
export function runMid(run: FieldCliffRun): [number, number] {
  return [(run.ax + run.bx) / 2, (run.az + run.bz) / 2];
}
