// Pure placement plan for the Hollow Crypt kit: which Kit_* piece every sim
// prop draws, the cloister arcade derived from its columns, the cliff-edge
// dressing, the curtain walls, the light holders and the render-only set
// dressing, in one list the painter (crypt_kit.ts) instances and the support
// audit (tests/hollow_crypt_kit_support.test.ts) checks piece by piece against
// the real floor and against the pieces that carry it.
//
// The contract (docs/design/dungeon-rework/hollow_crypt.md, "Environment"):
// nothing floats. A piece stands on the floor under its own footprint, rests
// on the top of a piece that carries it (an arch on two capitals), hangs from
// one (a banner from a pillar), or rises from the chasm floor under the mist.
//
// Three-free, DOM-free, deterministic.

import {
  ARCADE_BAY,
  type ArcadeBayVariant,
  HOLLOW_CRYPT_FIELD,
  hollowCryptArcadeBays,
  isBrokenCloisterColumn,
} from '../../sim/content/hollow_crypt_layout';
import type { FieldProp } from '../../sim/instances/authored_field';
import { type EdgeDressing, HOLLOW_CRYPT_LIGHTS, planEdgeDressing } from './crypt_plan_core';
import { HOLLOW_CRYPT_SET_DRESSING, type KitPlacement } from './crypt_set_dressing_core';

function hash(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export { isBrokenCloisterColumn };

/** The kit node a sim prop kind draws (variants picked by position). */
export function kitPieceForProp(p: FieldProp): string {
  const h = hash(p.x, p.z);
  switch (p.kind) {
    case 'hc_lychgate':
      return 'Kit_Lychgate';
    case 'hc_mourner_statue':
      return 'Kit_MournerStatue';
    case 'hc_cloister_column':
      return isBrokenCloisterColumn(p) ? 'Kit_CloisterColumnBroken' : 'Kit_CloisterColumn';
    case 'hc_ossuary_monument':
      return 'Kit_OssuaryMonument';
    case 'hc_sarcophagus':
      return 'Kit_Sarcophagus';
    case 'hc_processional_pillar':
      return 'Kit_ShrinePillar';
    case 'hc_wing_arch':
      return 'Kit_WingArch';
    case 'hc_headstone':
      return `Kit_Headstone${'ABCD'[Math.floor(h * 4)]}`;
    case 'hc_lantern_post':
      return 'Kit_LanternPost';
    case 'hc_dead_tree':
      return 'Kit_DeadTree';
    case 'hc_bell_tower':
      return 'Kit_BellTower';
    case 'hc_web_column':
      return 'Kit_WebColumn';
    case 'hc_egg_cluster':
      return 'Kit_EggCluster';
    case 'hc_great_web':
      return 'Kit_GreatWeb';
    case 'hc_choir_pillar':
      return 'Kit_ChoirPillar';
    case 'hc_bone_organ':
      return 'Kit_BoneOrgan';
    case 'hc_tracery_window':
      return 'Kit_TraceryWindow';
    case 'hc_pew':
      return 'Kit_Pew';
    case 'hc_nave_column':
      return 'Kit_NaveColumn';
    case 'hc_remembrance_candle':
      return 'Kit_RemembranceCandle';
    case 'hc_rite_altar':
      return 'Kit_RiteAltar';
    case 'hc_sarcophagus_alcove':
      return 'Kit_SarcophagusAlcove';
    case 'hc_ring_stone':
      return 'Kit_RingStone';
    case 'hc_pier':
      // Collider only: the pier it makes solid is part of its gateway's piece.
      return '';
    default:
      return 'Kit_Rubble';
  }
}

export const EDGE_PIECES: Readonly<Record<EdgeDressing['kind'], string>> = {
  balustrade: 'Kit_Balustrade',
  merlon: 'Kit_Parapet',
  boneRail: 'Kit_BoneRail',
  rubble: 'Kit_Rubble',
};

const ARCADE_PIECES: Readonly<Record<ArcadeBayVariant, string>> = {
  whole: 'Kit_ArcadeArch',
  broken: 'Kit_ArcadeArchBroken',
  springer: 'Kit_ArcadeArchSpringer',
  fallen: 'Kit_ArcadeArchFallen',
};

/**
 * The cloister arcade (bays from the sim layout's hollowCryptArcadeBays): an
 * arch never hangs over a missing column. A springer is built on the piece's
 * local -X foot, so it turns to put that foot on the column still standing.
 */
export function planArcade(): KitPlacement[] {
  return hollowCryptArcadeBays().map((bay) => {
    let rot = bay.rot;
    if (bay.variant === 'springer' && bay.standing) {
      const ux = (bay.standing.x - bay.x) / (ARCADE_BAY / 2);
      const uz = (bay.standing.z - bay.z) / (ARCADE_BAY / 2);
      // local -X in world is (-cos, sin): the yaw that points it at the column.
      rot = Math.atan2(uz, -ux);
    }
    return { piece: ARCADE_PIECES[bay.variant], x: bay.x, z: bay.z, rot, scale: 1 };
  });
}

/** The holders the light plan stands for its own flames (braziers, posts). */
export function planLightHolders(): KitPlacement[] {
  return HOLLOW_CRYPT_LIGHTS.filter((l) => l.places && l.holder).map((l) => ({
    piece: l.holder as string,
    x: l.x,
    z: l.z,
    rot: l.rot,
    scale: 1,
  }));
}

/** The authored curtain walls tiled with wall segments. */
export function planCurtainWalls(): KitPlacement[] {
  const out: KitPlacement[] = [];
  for (const w of HOLLOW_CRYPT_FIELD.walls) {
    const n = Math.max(1, Math.round((w.hw * 2) / 6));
    const cos = Math.cos(w.rot);
    const sin = Math.sin(w.rot);
    for (let i = 0; i < n; i++) {
      const along = -w.hw + (w.hw * 2 * (i + 0.5)) / n;
      out.push({
        piece: hash(w.x + i, w.z) < 0.35 ? 'Kit_CurtainWallBroken' : 'Kit_CurtainWall',
        x: w.x + along * cos,
        z: w.z - along * sin,
        rot: w.rot,
        scale: 1,
        stretch: (w.hw * 2) / n / 6,
      });
    }
  }
  return out;
}

/** Every kit placement of the necropolis, in a stable order. */
export function planCryptKitPlacements(): KitPlacement[] {
  const out: KitPlacement[] = [];
  for (const p of HOLLOW_CRYPT_FIELD.props) {
    const piece = kitPieceForProp(p);
    if (piece) out.push({ piece, x: p.x, z: p.z, rot: p.rot, scale: p.scale ?? 1 });
  }
  out.push(...planArcade());
  for (const e of planEdgeDressing()) {
    out.push({
      piece: EDGE_PIECES[e.kind],
      x: e.x,
      z: e.z,
      rot: e.rot,
      scale: 1,
      y: e.y,
      stretch: e.stretch,
      shear: e.shear,
    });
  }
  out.push(...planCurtainWalls());
  out.push(...planLightHolders());
  out.push(...HOLLOW_CRYPT_SET_DRESSING);
  return out;
}

/**
 * How a piece is carried, for the support audit. `ground` (the default): every
 * contact patch of its base stands on the floor or on the top of another
 * piece. `hangs`: its top is fixed inside another piece (a banner on its
 * pillar). `rooted`: a rock column reaching down into the chasm floor.
 * `backdrop`: a far silhouette beyond the playable necropolis, rising
 * out of the mist sea.
 */
export type KitSupport = 'ground' | 'hangs' | 'rooted' | 'backdrop';

export const KIT_SUPPORT: Readonly<Record<string, KitSupport>> = {
  Kit_Banner: 'hangs',
  // A rock column whose origin is its levelled top: its foot is in the chasm.
  Kit_RockPillar: 'rooted',
  Kit_DistantSpire: 'backdrop',
};

/** Pieces a base may sink into (rough rock tops), and by how much. */
export const KIT_SINK_TOLERANCE: Readonly<Record<string, number>> = {
  Kit_RockPillar: 3,
};
