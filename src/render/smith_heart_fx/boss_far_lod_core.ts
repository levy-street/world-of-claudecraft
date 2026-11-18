// The Smith's Heart bosses never draw as the static far LOD (Jose's playtest
// of 2026-11-18: "sometimes when you enter, the bosses are visible from far
// away as if standing there; you get closer, they disappear and then play
// their entrance"). Every boss of the raid holds a SCRIPTED pose before its
// fight: the Breath gathered into nothing, the Hammer Council fused in the
// quarry's rock and asleep in its crystal, the Quench lying under the lake's
// ice, the Heat a cold coal giant, the Masterless Strength a kneeling statue
// (each a clip its entrance painter sends through the gesture seam). The far
// LOD is one mesh baked in a stock pose, so past the articulated band
// (crowd_lod.ts CHARACTER_LOD_RANGE, 58 yd: also every entrance's wake reach)
// a boss still waiting for its entrance stood there in the open, and the
// moment the raid came in range the rig took over, its scripted clip hid or
// laid it down and the entrance began. A boss of the raid keeps its
// articulated rig at every distance it is drawn, so whatever pose its script
// holds is the pose seen from afar. One or two bodies in view: the cost is a
// rig's handful of draws, never a crowd's.
//
// Pure (RENDER_PURE_CORES): the far LOD latch (far_lod_latch.ts) asks it.

import { SMITH_HEART_FINAL_BOSS, SMITH_HEART_GUARDIANS } from '../../sim/content/smith_heart';
import { COUNCIL_TEMPLATE_IDS } from '../../sim/encounters/smith_heart/council_ids';

/** Every Smith's Heart boss body (template ids): the four guardians, the
 *  Hammer Council's two members and the final boss. */
export const SMITH_HEART_SCRIPTED_POSE_BOSSES: ReadonlySet<string> = new Set([
  ...Object.values(SMITH_HEART_GUARDIANS),
  ...COUNCIL_TEMPLATE_IDS,
  SMITH_HEART_FINAL_BOSS,
]);

/** Does `templateId`'s body keep its articulated rig at every distance (never
 *  the static far LOD)? */
export function keepsArticulatedRig(templateId: string | undefined): boolean {
  return templateId !== undefined && SMITH_HEART_SCRIPTED_POSE_BOSSES.has(templateId);
}
