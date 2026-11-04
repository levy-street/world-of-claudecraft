// Pure plan of the Heart's Blender kit (phase 2J: docs/design/raid/kit/
// build_smith_heart_heart_kit.py, painted by heart_room_kit.ts): where every
// Kit_* piece of the separate final room stands.
//
//   - the Anvil of the World's walk and keel on the platform's centre, the
//     Arrival Terrace's on its own, the Heart Bridge from the terrace's
//     centre along the bridge's line (the deck at the field's own heights);
//   - the four altars on the layout's altar props (ids frozen), each facing
//     the platform's centre, and the four roots of the mountain in the same
//     frames (since phase 2M rising out of each quarter's wall landmark
//     behind its altar) to the mountain's crown (the chains of the blockout
//     are gone: the raid has no metal);
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
/** The field's own rock the kit's replaces: none under the Anvil, so nothing stands in a
 *  fallen quarter's hole (Mythic's hidden phase). */
export const HEART_KIT_NO_SKIRT: readonly string[] = ['heart_anvil'];
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
export const HEART_ROOT_LIFT = 6;
/** Phase 2M: each root rises out of its quarter's wall landmark, this far
 *  behind the altar (out from the platform's centre), never across it, so
 *  the landmark reads from above. */
export const HEART_ROOT_OUT = 18;

/** Where a root rises and which way it runs (phase 2M): straight out of the
 *  back of its landmark, but the Hammer's. South of the Heart the crown of
 *  rock falls away toward the Quench's chasm (no rock high enough within a
 *  root's reach straight out), so the Hammer's rises from its landmark's
 *  east shoulder, clear of the great hammer's head, and runs south-east into
 *  the crown where it stands high.
 *  `foot`: degrees round from the altar's bearing; `aim`: the root's world
 *  bearing (degrees clockwise from north), or null for straight out. */
export const HEART_ROOT_AIM: Readonly<
  Record<SmithHeartVein, { foot: number; aim: number | null }>
> = {
  breath: { foot: 0, aim: null },
  quench: { foot: 0, aim: null },
  hammer: { foot: -17, aim: 112 },
  heat: { foot: 0, aim: null },
};

/** A root's frame: its foot (instance-local) and its yaw (its local -Z, the
 *  piece's outward, along its run). */
export function heartRootFrame(vein: SmithHeartVein): { x: number; z: number; rot: number } {
  const f = heartAltarFrame(vein);
  const R = Math.hypot(f.x - HEART_ROOM.x, f.z - HEART_ROOM.z) + HEART_ROOT_OUT;
  const altarBearing = Math.atan2(f.x - HEART_ROOM.x, f.z - HEART_ROOM.z);
  const b = altarBearing + (HEART_ROOT_AIM[vein].foot * Math.PI) / 180;
  const aim = HEART_ROOT_AIM[vein].aim;
  // Outward is the piece's local -Z: (-sin rot, -cos rot) along the aim.
  const rot = aim === null ? f.rot : (aim * Math.PI) / 180 + Math.PI;
  return { x: HEART_ROOM.x + Math.sin(b) * R, z: HEART_ROOM.z + Math.cos(b) * R, rot };
}

/** The heart's bed is drawn this much larger than its piece: its crater
 *  reaches past the platform's lip, so a raid looking over the balustrade
 *  sees the heart's crystal glowing deep below (the core is never hidden
 *  under the platform). */
export const HEART_CORE_BED_SCALE = 3.3;

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

/** The roots' spine in a root's frame (yards: `out` away from the platform's
 *  centre, `up` over its lift): a quadratic Bezier from deep inside its
 *  landmark, under the walk's height, to the mountain's crown, the Blender
 *  piece's own points (heart_pieces.py ROOT_SPINE). A root has no free end: it
 *  plunges into the rock at both. */
export const HEART_ROOT_SPINE: readonly { out: number; up: number }[] = [
  { out: 2, up: -14 },
  { out: 18, up: 36 },
  { out: 50, up: 54 },
];

/** Where each root's arm clamps the platform's lip (the weak-spots pass's second
 *  round; heart_pieces.py ROOT_GRIP_X, ROOT_RIM_Y): in the root's frame, `across`
 *  its local +X and `out` along its outward run (negative: toward the platform).
 *  Chosen where the straight roots' lip and the Hammer's (turned by its foot and
 *  aim) cross, so the one Blender piece grips the rim under all four. */
export const HEART_ROOT_GRIP = { across: 5.8, out: -12.3 } as const;

/** The root's grip on the lip, instance-local (x, z). */
export function heartRootGripPoint(vein: SmithHeartVein): { x: number; z: number } {
  const f = heartRootFrame(vein);
  const { across, out } = HEART_ROOT_GRIP;
  // Local +X is (cos rot, -sin rot); outward (local -Z) is (-sin rot, -cos rot).
  return {
    x: f.x + Math.cos(f.rot) * across - Math.sin(f.rot) * out,
    z: f.z - Math.sin(f.rot) * across - Math.cos(f.rot) * out,
  };
}

/** A point `t` (0 at the altar, 1 at the crown) along a vein's root, in
 *  instance-local yards. */
export function heartRootPoint(
  vein: SmithHeartVein,
  t: number,
): { x: number; y: number; z: number } {
  const f = heartRootFrame(vein);
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
 *  apart, each with its vein's glow: `planHeartVeinPieces`; each quarter's own
 *  platform pieces apart too: heart_collapse_rig.ts). What is left of the Anvil
 *  here is what stays on the ring. */
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

/** One vein's own pieces: its altar and its root (behind it, out of its
 *  landmark), in the altar's frame. */
export function planHeartVeinPieces(vein: SmithHeartVein): HeartKitPlacement[] {
  const f = heartAltarFrame(vein);
  const root = heartRootFrame(vein);
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
      x: root.x,
      y: HEART_ROOM.h + HEART_ROOT_LIFT,
      z: root.z,
      rot: root.rot,
      noShadow: true,
    },
  ];
}
