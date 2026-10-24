// The Mirefen mudfin huts: the five built-in `PROPS.mudHuts` on the Deepfen
// shallows west of Fenbridge (`FENBRIDGE_LAYOUT.preservedProps.mudHuts`, the camp
// "Back to the Shallows" (q_deepfen_purge) torches) stand as the two painted
// mudfin hut models instead of the shared Kenney mushroom the Eastbrook and Palm
// Reach huts still draw. This table is the ONE source for which model stands at
// which hut, how big it is drawn, which way its door faces and how wide its wall
// is: src/render/props.ts places the mesh from it and colliders.ts builds the
// solid wall from it (the huts are not walk-in), so the drawn hut and its
// collision cannot drift (the decoration_dims.ts contract). The hut fire the
// renderer plays when one is torched sizes itself from it too, and idle wander
// (mob/locomotion.ts) skips a pick inside a wall through it. Pure leaf.
import type { Collider } from './collider_shapes';
import { FENBRIDGE_LAYOUT } from './fenbridge_layout';
import { propPlacementRoll } from './prop_layout';

export type MudfinHutModel = 'a' | 'b';

/** Ground-object template id of the torchable hut at each mudfin hut
 *  (`ground_${HUT_OBJECT_ID}`, interactions/firebottle_hut.ts). */
export const MUDFIN_HUT_TEMPLATE_ID = 'ground_murloc_hut';

export interface MudfinHutModelSpec {
  /** Solid wall radius in yards (the thatch eaves overhang it). */
  readonly radius: number;
  /** Drawn height in yards: the camera clamp top and the occluder fade top.
   *  The GLBs are baked at exactly this height, so props.ts draws them at
   *  scale 1 (pinned by tests/mudfin_hut_models.test.ts). */
  readonly height: number;
}

// Measured off the source models: hut A (the round hut, 5.3 yd across the
// eaves) has its mud wall 2.31 yd out; hut B (the bent spire, an oval 4.9 by
// 5.7 yd with its awning) has its wall 2.34 yd out on average. The heights
// stand both doors a little over a player's head, and are as big as the
// fixed spots allow: the two closest huts (5.8 yd apart) still leave a body's
// width to walk between their walls.
export const MUDFIN_HUT_MODELS: Readonly<Record<MudfinHutModel, MudfinHutModelSpec>> = {
  a: { radius: 2.31, height: 4.75 },
  b: { radius: 2.34, height: 6 },
};

/** The model at each hut, in `FENBRIDGE_LAYOUT.preservedProps.mudHuts` order:
 *  both designs in each camp, never the same one side by side. */
const MODEL_ORDER: readonly MudfinHutModel[] = ['a', 'b', 'a', 'b', 'a'];

/** Huts closer than this share a camp, and their doors face away from its
 *  middle: the huts stand too close for a door to face a neighbour's wall, so
 *  each opens onto the open shallows a player walks up from. */
const CAMP_LINK_YD = 15;
/** A small per-hut turn off the camp's outward line, so the doors do not line up. */
const YAW_JITTER_RAD = 0.35;
/** The shared Kenney mushroom the other mud huts draw: stem and camera top. */
const MUSHROOM_HUT_STEM_RADIUS = 1.1;
const MUSHROOM_HUT_CAMERA_TOP = 12.5;

export interface MudfinHut {
  readonly x: number;
  readonly z: number;
  readonly model: MudfinHutModel;
  /** Door direction: the model's front (+Z) turned by this yaw faces out of its camp. */
  readonly yaw: number;
}

function buildHuts(): readonly MudfinHut[] {
  const spots = FENBRIDGE_LAYOUT.preservedProps.mudHuts;
  return Object.freeze(
    spots.map(([x, z], i): MudfinHut => {
      const camp = spots.filter(([ox, oz]) => Math.hypot(ox - x, oz - z) < CAMP_LINK_YD);
      const cx = camp.reduce((sum, [ox]) => sum + ox, 0) / camp.length;
      const cz = camp.reduce((sum, [, oz]) => sum + oz, 0) / camp.length;
      const jitter = (propPlacementRoll(x, z, 21) - 0.5) * 2 * YAW_JITTER_RAD;
      return {
        x,
        z,
        model: MODEL_ORDER[i % MODEL_ORDER.length],
        yaw: Math.atan2(x - cx, z - cz) + jitter,
      };
    }),
  );
}

/** Every mudfin hut, in `preservedProps.mudHuts` order. */
export const MUDFIN_HUTS: readonly MudfinHut[] = buildHuts();

/** The mudfin hut standing at exactly (x, z), or null for any other mud hut. */
export function mudfinHutAt(x: number, z: number): MudfinHut | null {
  return MUDFIN_HUTS.find((hut) => hut.x === x && hut.z === z) ?? null;
}

/** The mudfin hut nearest (x, z) within `within` yards, or null: the lookup for a
 *  position that crossed the wire (an event), which need not match the table to
 *  the last bit. The closest pair stands 5.8 yd apart, so it is never ambiguous. */
export function mudfinHutNear(x: number, z: number, within = 0.75): MudfinHut | null {
  let best: MudfinHut | null = null;
  let bestDistance = within;
  for (const hut of MUDFIN_HUTS) {
    const distance = Math.hypot(hut.x - x, hut.z - z);
    if (distance <= bestDistance) {
      best = hut;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether (x, z) is inside a mudfin hut's wall or within `clearance` of it: a
 *  spot no body of that radius can stand on. An idle mob only re-rolls its wander
 *  pick on arrival or after a 30 s timeout (mob/locomotion.ts), so a pick in here
 *  held it at the wall for the whole timeout; locomotion skips such a pick. */
export function insideMudfinHutWall(x: number, z: number, clearance: number): boolean {
  for (const hut of MUDFIN_HUTS) {
    const reach = MUDFIN_HUT_MODELS[hut.model].radius + clearance;
    const dx = x - hut.x;
    const dz = z - hut.z;
    if (Math.abs(dx) >= reach || Math.abs(dz) >= reach) continue;
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  return false;
}

/** The static collider of the mud hut at (x, z): a mudfin hut's solid wall at
 *  its drawn size, or the Kenney mushroom's stem everywhere else (as before).
 *  `top(h)` lifts a height above the ground at the hut (colliders.ts topY). */
export function mudHutCollider(x: number, z: number, top: (height: number) => number): Collider {
  const hut = mudfinHutAt(x, z);
  const spec = hut ? MUDFIN_HUT_MODELS[hut.model] : null;
  return {
    type: 'circle',
    x,
    z,
    r: spec ? spec.radius : MUSHROOM_HUT_STEM_RADIUS,
    cameraTopY: top(spec ? spec.height : MUSHROOM_HUT_CAMERA_TOP),
    underY: top(0),
  };
}
