// Pure placement plan for the Sunken Bastion kit: which Kit_* piece every sim
// prop draws, the curtain walls tiled with wall modules, the edge dressing,
// the light holders and the render-only set dressing (the gatehouses, the
// keep, the gaol cells, the bartizans, the kelp over the mud), in one list the
// painter (bastion_kit.ts) instances.
//
// The contract (docs/design/dungeon-rework/sunken_bastion.md, "Environment"):
// nothing floats. A piece stands on the floor under its own footprint, rests
// on the headland rock, hangs off a wall (a bartizan corbelled out over the
// sea), or rises out of the water. Tall render-only pieces never stand on a
// walkable floor without a sim collider under them.
//
// Three-free, DOM-free, deterministic.

import {
  BAILEY_CHAPEL,
  SUNKEN_BASTION_FIELD,
  SUNKEN_BASTION_SEA_LEVEL,
} from '../../sim/content/sunken_bastion_layout';
import {
  authoredFieldHeight,
  authoredFieldSurfaceAt,
  type FieldProp,
} from '../../sim/instances/authored_field';
import {
  BASTION_EDGE_PIECES,
  bastionHash,
  planBastionEdges,
  SUNKEN_BASTION_LIGHTS,
} from './bastion_plan_core';

export interface BastionKitPlacement {
  piece: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  /** Absolute instance-local height (else the ground under x, z). */
  y?: number;
  /** Extra lift above the ground. */
  lift?: number;
  /** Stretch along the piece's local x (edge segments fit their run). */
  stretch?: number;
  /** Rise per yard along the piece's local x (a sheared rail on a stair). */
  shear?: number;
  /** Sheds on the low graphics tier. */
  cosmetic?: boolean;
}

const FIELD = SUNKEN_BASTION_FIELD;
const ground = (x: number, z: number): number => authoredFieldHeight(FIELD, x, z);

/** The kit node a sim prop kind draws ('' for a collider-only prop). */
export function bastionPieceForProp(p: FieldProp): string {
  const h = bastionHash(Math.round(p.x * 7), Math.round(p.z * 3));
  switch (p.kind) {
    case 'sb_bollard':
      return 'Kit_Bollard';
    case 'sb_wreck_hull':
      return 'Kit_WreckHull';
    case 'sb_wreck_mast':
      return 'Kit_WreckMast';
    case 'sb_rowboat':
      return 'Kit_Rowboat';
    case 'sb_outwork_ruin':
      return 'Kit_OutworkRuin';
    case 'sb_tide_rocks':
      return h < 0.5 ? 'Kit_TideRocksA' : 'Kit_TideRocksB';
    case 'sb_drowned_chapel':
      return 'Kit_DrownedChapel';
    case 'sb_cistern':
      return 'Kit_Cistern';
    case 'sb_cargo_stack':
      return 'Kit_CargoStack';
    case 'sb_anchor':
      return 'Kit_Anchor';
    case 'sb_cannon':
      return 'Kit_Cannon';
    case 'sb_buttress':
      // Drawn by Olen's encounter visuals (intact, cracked, broken).
      return '';
    case 'sb_flooded_well':
      return 'Kit_FloodedWell';
    case 'sb_gibbet_post':
      return 'Kit_GibbetPost';
    case 'sb_drowning_winch':
      return 'Kit_DrowningWinch';
    case 'sb_mooring_post':
      return 'Kit_MooringPost';
    case 'sb_court_fountain':
      return 'Kit_CourtFountain';
    case 'sb_court_statue':
      return 'Kit_CourtStatue';
    case 'sb_fogbeacon':
      return 'Kit_Fogbeacon';
    case 'sb_crown_merlon':
      return 'Kit_CrownMerlon';
    case 'sb_gate_tower':
    case 'sb_pier':
      // Collider only: the tower or pier it makes solid is part of its gatehouse.
      return '';
    default:
      return 'Kit_Rubble';
  }
}

/** The authored curtain walls tiled with 6 yd wall modules. */
export function planBastionCurtain(): BastionKitPlacement[] {
  const out: BastionKitPlacement[] = [];
  for (const w of FIELD.walls) {
    const n = Math.max(1, Math.round((w.hw * 2) / 6));
    const cos = Math.cos(w.rot);
    const sin = Math.sin(w.rot);
    for (let i = 0; i < n; i++) {
      const along = -w.hw + (w.hw * 2 * (i + 0.5)) / n;
      out.push({
        // The wall's sea face is its front: turned toward the flats (south).
        piece: bastionHash(i + 3, w.x) < 0.3 ? 'Kit_CurtainWallBroken' : 'Kit_CurtainWall',
        x: w.x + along * cos,
        z: w.z - along * sin,
        rot: w.rot + Math.PI,
        scale: 1,
        stretch: (w.hw * 2) / n / 6,
      });
    }
  }
  return out;
}

/** The holders the light plan stands for its own flames. */
export function planBastionLightHolders(): BastionKitPlacement[] {
  return SUNKEN_BASTION_LIGHTS.filter((l) => l.places).map((l) => ({
    piece: l.holder,
    x: l.x,
    z: l.z,
    rot: l.rot,
    scale: 1,
  }));
}

const P = (
  piece: string,
  x: number,
  z: number,
  rot = 0,
  scale = 1,
  extra: Partial<BastionKitPlacement> = {},
): BastionKitPlacement => ({ piece, x, z, rot, scale, ...extra });

/** Kelp and wrack drifted over the mud and the wet stone (walk-through, low). */
function kelp(): BastionKitPlacement[] {
  const out: BastionKitPlacement[] = [];
  const b = FIELD.bounds;
  for (let z = b.minZ; z <= b.maxZ; z += 4.5) {
    for (let x = b.minX; x <= b.maxX; x += 4.5) {
      const jx = x + (bastionHash(x, z) - 0.5) * 4;
      const jz = z + (bastionHash(z, x) - 0.5) * 4;
      const s = authoredFieldSurfaceAt(FIELD, jx, jz);
      if (!s || (s.ground !== 'mud' && s.ground !== 'wetstone')) continue;
      // Clear of the lip (never half over a drop).
      const edge = [
        [0.9, 0],
        [-0.9, 0],
        [0, 0.9],
        [0, -0.9],
      ].some(([dx, dz]) => authoredFieldSurfaceAt(FIELD, jx + dx, jz + dz) !== s);
      if (edge) continue;
      const keep = s.ground === 'mud' ? 0.42 : 0.72;
      if (bastionHash(jx * 1.3, jz * 0.7) < keep) continue;
      out.push({
        piece: bastionHash(jz, jx * 2) < 0.6 ? 'Kit_Kelp' : 'Kit_Barnacles',
        x: jx,
        z: jz,
        rot: bastionHash(jx, jz) * 6.28,
        scale: 0.7 + bastionHash(jz, jx) * 0.7,
        cosmetic: true,
      });
    }
  }
  return out;
}

/** Old fish-weir stakes marching out of the flats into the sea (render only,
 *  standing in the water off the flats' edge). */
function stakeRows(): BastionKitPlacement[] {
  const out: BastionKitPlacement[] = [];
  const rows: [number, number, number, number][] = [
    [-96, -196, -112, -222],
    [80, -204, 104, -226],
    [-104, -150, -128, -160],
  ];
  rows.forEach(([x0, z0, x1, z1], r) => {
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 3.5);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t + (bastionHash(i, r) - 0.5) * 1.2;
      const z = z0 + (z1 - z0) * t + (bastionHash(r, i) - 0.5) * 1.2;
      if (ground(x, z) > FIELD.voidHeight + 0.5) continue;
      out.push(
        P('Kit_Stake', x, z, bastionHash(i, 9) * 6.28, 0.8 + bastionHash(i, 5) * 0.5, {
          y: SUNKEN_BASTION_SEA_LEVEL - 1.5,
          cosmetic: true,
        }),
      );
    }
  });
  return out;
}

/** Render-only set dressing (no colliders): gatehouses over the passages, the
 *  keep behind its court, the gaol cells in the cleft wall, the bartizans off
 *  the rampart towers, wreckage and the kelp. */
export const SUNKEN_BASTION_SET_DRESSING: readonly BastionKitPlacement[] = [
  ...kelp(),
  ...stakeRows(),
  // The Sea Gate: the gatehouse and its drum towers over the ramp (the towers
  // are solid: sb_gate_tower props). Its sea face looks south over the flats.
  P('Kit_SeaGate', 0, -130, Math.PI),
  // The drawbridge gatehouse on the ditch's far side (piers: sb_pier props).
  P('Kit_GatehouseArch', 57, -26, Math.PI),
  // The Rampart Door's arch over the bastion ramp (its piers rise out of the
  // headland rock either side of the ramp).
  P('Kit_GatehouseArch', 57, 100, Math.PI, 1, { y: 14.6 }),
  // The Gaol Grate's arch in the cleft neck and the Keep Stair Chain's.
  P('Kit_RockArch', -2, 50, Math.PI),
  P('Kit_RockArch', -27, 20, -Math.PI / 2, 0.75),
  // Bartizans corbelled off the rampart towers over the sea.
  P('Kit_Bartizan', 67.8, 36, Math.PI / 2, 1, { y: 14 }),
  P('Kit_Bartizan', 67.8, 72, Math.PI / 2, 1, { y: 14 }),
  P('Kit_Bartizan', 79, 130, Math.PI / 2, 1.1, { y: 16 }),
  // The Keep: its great hall and towers rise behind the court, on the rock.
  P('Kit_Keep', -97, 155, Math.PI / 2, 1, { y: 20 }),
  // The Sunken Gaol: cell rows cut into the cleft's west wall, and chains
  // strung high across the yard from wall to wall.
  P('Kit_GaolCells', -41.4, 66, Math.PI / 2),
  P('Kit_GaolCells', -41.4, 80, Math.PI / 2),
  P('Kit_GaolCells', -41.4, 94, Math.PI / 2),
  P('Kit_ChainSpan', 3, 70, 0, 1, { y: 19 }),
  P('Kit_ChainSpan', 3, 88, 0.12, 1, { y: 21 }),
  // Wreckage over the flats and the landing's moored boat.
  P('Kit_WreckDebris', -60, -160, 0.3, 1, { cosmetic: true }),
  P('Kit_WreckDebris', 30, -186, 2.2, 1, { cosmetic: true }),
  P('Kit_WreckDebris', -84, -184, 4.1, 0.8, { cosmetic: true }),
  P('Kit_Rowboat', 8, -234, 1.9, 1, { y: SUNKEN_BASTION_SEA_LEVEL - 0.35 }),
  // Barrels and nets on the landing quay.
  P('Kit_NetPile', -17, -234, 0.4, 1, { cosmetic: true }),
  // The bailey's drowned-garrison graves (knee-high markers, west yard).
  P('Kit_GraveMarkers', -66, -112, 0.3, 1, { cosmetic: true }),
  P('Kit_GraveMarkers', -40, -60, 2.1, 1, { cosmetic: true }),
  // The Breach Bastion's broken parapet: rubble on the bare rim between the
  // buttresses (knee-high, walk-through).
  ...[-68, -22, 22, 68, 112, 150, 200, 250].map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    return P('Kit_Rubble', 57 + Math.sin(a) * 20.2, 130 + Math.cos(a) * 20.2, a, 0.9, {
      cosmetic: i % 2 === 1,
    });
  }),
  // The Beacon Crown's fallen merlons (knee-high).
  P('Kit_Rubble', -24, 216, 1.2, 0.8, { cosmetic: true }),
  P('Kit_Rubble', 16, 198, 2.6, 0.8, { cosmetic: true }),
];

/** Pieces the island ring of lanterns stands on (the chapel's island). */
export const CHAPEL_ISLAND = BAILEY_CHAPEL;

/** Every kit placement of the fortress, in a stable order. */
export function planBastionKitPlacements(): BastionKitPlacement[] {
  const out: BastionKitPlacement[] = [];
  for (const p of FIELD.props) {
    const piece = bastionPieceForProp(p);
    if (piece) out.push({ piece, x: p.x, z: p.z, rot: p.rot, scale: p.scale ?? 1 });
  }
  for (const e of planBastionEdges()) {
    out.push({
      piece: BASTION_EDGE_PIECES[e.kind],
      x: e.x,
      z: e.z,
      rot: e.rot,
      scale: 1,
      y: e.y,
      stretch: e.stretch,
      shear: e.shear,
    });
  }
  out.push(...planBastionCurtain());
  out.push(...planBastionLightHolders());
  out.push(...SUNKEN_BASTION_SET_DRESSING);
  return out;
}

/** Every Kit_* piece the plan asks for (the Blender kit must build them all). */
export function bastionKitPieceNames(): string[] {
  const names = new Set(planBastionKitPlacements().map((p) => p.piece));
  // Olen's buttress states are instanced by his encounter visuals.
  for (const n of ['Kit_Buttress', 'Kit_ButtressCracked', 'Kit_ButtressBroken']) names.add(n);
  return [...names].sort();
}
