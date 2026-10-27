// Pure plan of the Heart's Blender kit (phase 2J: docs/design/raid/kit/
// build_smith_heart_heart_kit.py, painted by heart_room_kit.ts): where every
// Kit_* piece of the separate final room stands.
//
//   - the Anvil of the World's walk and keel on the platform's centre, the
//     Arrival Terrace's on its own, the Heart Bridge from the terrace's
//     centre along the bridge's line (the deck at the field's own heights);
//   - the four altars on the layout's altar props (ids frozen), each facing
//     the platform's centre, and the four roots of the mountain in the same
//     frames, rising out of each altar's crown to the mountain's crown (the
//     chains of the blockout are gone: the raid has no metal);
//   - the heart's bed deep in the chasm under the platform.
// Once the kit has landed the field omits the tops the kit draws
// (`HEART_KIT_OMIT_TOPS`), keeps only a shallow keel under the bridge (its
// arch stands there, `HEART_KIT_SHALLOW`) and the lathe keels of the
// platform and the terrace give way to the kit's (`HEART_KIT_KEELS`).
//
// The roots' spine (`HEART_ROOT_SPINE`, the Blender piece's own three
// points) is shared with the pours of light that run down each root.
//
// Three-free, DOM-free, deterministic.

import {
  HEART_ALTARS,
  HEART_ROOM,
  HEART_TERRACE,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import type { HeartKitPlacement } from './heart_kit_core';
import { HEART_CORE } from './heart_room_core';

/** The layout's prop kinds the Heart kit draws in place of the placeholders. */
export const HEART_KIT_KINDS: ReadonlySet<string> = new Set(
  HEART_ALTARS.map((a) => `sh_altar_${a.vein}`),
);

/** The field tops the kit's paving replaces once it has landed. */
export const HEART_KIT_OMIT_TOPS: readonly string[] = [
  'heart_anvil',
  'heart_terrace',
  'heart_bridge',
];
/** The bridge stands on the kit's arch: the field keeps a shallow keel there. */
export const HEART_KIT_SHALLOW: readonly string[] = ['heart_bridge'];
/** The lathe keels (heart_room.ts) the kit's own keels replace. */
export const HEART_KIT_KEELS: readonly string[] = ['heart_anvil', 'heart_terrace'];

/** The kit piece of each vein's altar. */
export const HEART_ALTAR_PIECES: Readonly<Record<SmithHeartVein, string>> = {
  hammer: 'Kit_AltarHammer',
  breath: 'Kit_AltarBreath',
  quench: 'Kit_AltarQuench',
  heat: 'Kit_AltarHeat',
};

/** The altars' rise (a placement's `rise`: taller, never wider than their
 *  colliders) and the roots' lift to grip their crowns. */
export const HEART_ALTAR_RISE = 1.4;
export const HEART_ROOT_LIFT = 4.4;

/** The heart's bed is drawn this much larger than its piece: its crater
 *  reaches past the platform's lip, so a raid looking over the balustrade
 *  sees the heart's crystal glowing deep below (the core is never hidden
 *  under the platform). */
export const HEART_CORE_BED_SCALE = 2.4;

/** How far the heart's bed sits under the platform (its hollow's rim). */
export const HEART_CORE_BED_Y = HEART_CORE.y + 2;

/** Facing from (x, z) toward (tx, tz) (three's rotation.y: front +Z). */
function face(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

/** The bridge's yaw: its local +X along the line from the terrace to the
 *  platform's centre. */
export function heartBridgeYaw(): number {
  const dx = HEART_ROOM.x - HEART_TERRACE.x;
  const dz = HEART_ROOM.z - HEART_TERRACE.z;
  // Local +X turns to (cos rot, -sin rot).
  return Math.atan2(-dz, dx);
}

/** An altar's frame: its foot and its yaw (front to the platform's centre). */
export function heartAltarFrame(vein: SmithHeartVein): { x: number; z: number; rot: number } {
  const a = HEART_ALTARS.find((q) => q.vein === vein);
  if (!a) throw new Error(`no altar for ${vein}`);
  return { x: a.x, z: a.z, rot: face(a.x, a.z, HEART_ROOM.x, HEART_ROOM.z) };
}

/** The roots' spine in an altar's frame (yards: `out` away from the
 *  platform's centre, `up` over the floor): a quadratic Bezier from the
 *  altar's crown to the mountain's crown, the Blender piece's own points
 *  (heart_pieces.py ROOT_SPINE). */
export const HEART_ROOT_SPINE: readonly { out: number; up: number }[] = [
  { out: 2, up: 6.3 },
  { out: 22, up: 40 },
  { out: 50, up: 52 },
];

/** A point `t` (0 at the altar, 1 at the crown) along a vein's root, in
 *  instance-local yards. */
export function heartRootPoint(
  vein: SmithHeartVein,
  t: number,
): { x: number; y: number; z: number } {
  const f = heartAltarFrame(vein);
  const [a, b, c] = HEART_ROOT_SPINE;
  const u = 1 - t;
  const out = u * u * a.out + 2 * u * t * b.out + t * t * c.out;
  const up = u * u * a.up + 2 * u * t * b.up + t * t * c.up;
  // Outward is the altar's back: its local -Z.
  return {
    x: f.x - Math.sin(f.rot) * out,
    y: HEART_ROOM.h + HEART_ROOT_LIFT + up,
    z: f.z - Math.cos(f.rot) * out,
  };
}

/** Every static Heart kit placement (the altars and the roots are painted
 *  apart, each with its vein's glow: `planHeartVeinPieces`). */
export function planHeartRoomKit(): HeartKitPlacement[] {
  return [
    { piece: 'Kit_AnvilFloor', x: HEART_ROOM.x, y: HEART_ROOM.h, z: HEART_ROOM.z, rot: 0 },
    {
      piece: 'Kit_AnvilKeel',
      x: HEART_ROOM.x,
      y: HEART_ROOM.h,
      z: HEART_ROOM.z,
      rot: 0,
      noShadow: true,
    },
    {
      piece: 'Kit_TerraceFloor',
      x: HEART_TERRACE.x,
      y: HEART_TERRACE.h,
      z: HEART_TERRACE.z,
      rot: 0,
    },
    {
      piece: 'Kit_TerraceKeel',
      x: HEART_TERRACE.x,
      y: HEART_TERRACE.h,
      z: HEART_TERRACE.z,
      rot: 0,
      noShadow: true,
    },
    {
      piece: 'Kit_HeartBridge',
      x: HEART_TERRACE.x,
      y: HEART_ROOM.h,
      z: HEART_TERRACE.z,
      rot: heartBridgeYaw(),
    },
  ];
}

/** The heart's bed (painted apart: its crystal dims as the heart dies). */
export function planHeartCoreBed(): HeartKitPlacement {
  return {
    piece: 'Kit_CoreBed',
    x: HEART_ROOM.x,
    y: HEART_CORE_BED_Y,
    z: HEART_ROOM.z,
    rot: 0,
    scale: HEART_CORE_BED_SCALE,
    noShadow: true,
  };
}

/** One vein's own pieces: its altar and its root, in the altar's frame. */
export function planHeartVeinPieces(vein: SmithHeartVein): HeartKitPlacement[] {
  const f = heartAltarFrame(vein);
  return [
    {
      piece: HEART_ALTAR_PIECES[vein],
      x: f.x,
      y: HEART_ROOM.h,
      z: f.z,
      rot: f.rot,
      rise: HEART_ALTAR_RISE,
    },
    {
      piece: 'Kit_HeartRoot',
      x: f.x,
      y: HEART_ROOM.h + HEART_ROOT_LIFT,
      z: f.z,
      rot: f.rot,
      noShadow: true,
    },
  ];
}
