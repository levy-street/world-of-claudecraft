// Pure placement plan for the Drowned Temple kit: which Kit_* piece every sim
// prop draws, the balustrades and kerbs along the terrace edges, and the
// render-only dressing standing in the lagoon (temple_plan_core.ts), in one
// list the painter (temple_kit.ts) instances.
//
// The contract: nothing floats and nothing tall stands on a walkable floor
// without a sim collider under it. A piece stands on the floor under its own
// footprint, or rises out of the water.
//
// Three-free, DOM-free, deterministic.

import {
  DROWNED_TEMPLE_FIELD,
  DROWNED_TEMPLE_WATER_LEVEL,
} from '../../sim/content/drowned_temple_layout';
import { authoredFieldHeight, type FieldProp } from '../../sim/instances/authored_field';
import { type FieldEdgeKind, planFieldEdgePieces } from '../authored_field/field_edge_plan_core';
import { planCraterSpires, planTempleDressing, templeHash } from './temple_plan_core';

export interface TempleKitPlacement {
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

const FIELD = DROWNED_TEMPLE_FIELD;
const ground = (x: number, z: number): number => authoredFieldHeight(FIELD, x, z);

/** The kit node a sim prop kind draws ('' for a collider-only prop). */
export function templePieceForProp(p: FieldProp): string {
  const h = templeHash(Math.round(p.x * 7), Math.round(p.z * 3));
  switch (p.kind) {
    case 'dt_moongate':
      return 'Kit_Moongate';
    case 'dt_brazier':
      return 'Kit_Brazier';
    case 'dt_wayshrine':
      return 'Kit_Wayshrine';
    case 'dt_statue_fallen':
      return 'Kit_StatueFallen';
    case 'dt_obelisk':
      return 'Kit_Obelisk';
    case 'dt_column':
      return 'Kit_Column';
    case 'dt_column_broken':
      return h < 0.5 ? 'Kit_ColumnBroken' : 'Kit_Column';
    case 'dt_lamp_pillar':
      return 'Kit_LampPillar';
    case 'dt_tidepool_basin':
      return 'Kit_TidepoolBasin';
    case 'dt_coral_cluster':
      return 'Kit_CoralCluster';
    case 'dt_prism_plinth':
      return 'Kit_PrismPlinth';
    case 'dt_moon_altar':
      return 'Kit_MoonAltar';
    case 'dt_standing_stone':
      return 'Kit_StandingStone';
    default:
      return 'Kit_Pearls';
  }
}

export const TEMPLE_BALUSTRADE: FieldEdgeKind = {
  piece: 'Kit_Balustrade',
  inset: 0.35,
  halfLength: 2.0,
  halfDepth: 0.35,
};
const KERB: FieldEdgeKind = { piece: 'Kit_Kerb', inset: 0.4, halfLength: 2.0, halfDepth: 0.4 };

/** Arenas whose rim stays open (the fight reads the whole disc). */
const BARE = new Set(['choir_court', 'prism_terrace', 'moon_altar', 'hydra_moon_pool']);

/** Every edge piece: balustrades on the temple terraces and stairs, kerbs on
 *  the causeways and the rock ledges (every other stretch left bare). */
export function planTempleEdges(): TempleKitPlacement[] {
  return planFieldEdgePieces(FIELD, {
    bare: BARE,
    minDrop: 1.5,
    kindFor: (run, i) => {
      if (run.style === 'balustrade') return TEMPLE_BALUSTRADE;
      if (run.style === 'masonry') return KERB;
      return templeHash(i, 5) < 0.45 ? KERB : null;
    },
  }).map((e) => ({
    piece: e.piece,
    x: e.x,
    z: e.z,
    rot: e.rot,
    scale: 1,
    y: e.y,
    stretch: e.stretch,
    shear: e.shear,
  }));
}

/** Every kit placement of the temple. */
export function planTempleKitPlacements(): TempleKitPlacement[] {
  const out: TempleKitPlacement[] = [];
  for (const p of FIELD.props) {
    const piece = templePieceForProp(p);
    if (!piece) continue;
    const onFloor = ground(p.x, p.z) > FIELD.voidHeight + 1;
    out.push({
      piece,
      x: p.x,
      z: p.z,
      rot: p.rot,
      scale: p.scale ?? 1,
      ...(onFloor ? {} : { y: DROWNED_TEMPLE_WATER_LEVEL - 1 }),
    });
  }
  out.push(...planTempleEdges());
  for (const d of planTempleDressing()) {
    const small = /LilyPads|Reeds|CoralCluster|Shells/.test(d.piece);
    out.push({
      piece: d.piece,
      x: d.x,
      z: d.z,
      rot: d.rot,
      scale: d.scale,
      y: d.y,
      cosmetic: small,
    });
  }
  for (const d of planCraterSpires()) {
    out.push({
      piece: d.piece,
      x: d.x,
      z: d.z,
      rot: d.rot,
      scale: d.scale,
      y: d.y,
      cosmetic: true,
    });
  }
  return out;
}
