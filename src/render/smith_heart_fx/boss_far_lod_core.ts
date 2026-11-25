// The Smith's Heart bosses never draw as the static far LOD (Jose's playtest
// of 2026-11-18: "sometimes when you enter, the bosses are visible from far
// away as if standing there; you get closer, they disappear and then play
// their entrance"). Every boss of the raid holds a SCRIPTED pose before its
// fight: the Breath gathered into nothing, the Hammer Council fused in the
// quarry's rock and asleep in its crystal, the Quench lying under the lake's
// ice, the Heat a cold coal giant, the Masterless Strength a kneeling statue
// (each a clip its entrance painter sends through the gesture seam). The far
// LOD is one mesh baked in a stock pose, so past the articulated band
// (crowd_lod.ts CHARACTER_LOD_RANGE, 58 yd: then every entrance's wake reach)
// a boss still waiting for its entrance stood there in the open, and the
// moment the raid came in range the rig took over, its scripted clip hid or
// laid it down and the entrance began. A boss of the raid keeps its
// articulated rig at every distance it is drawn, so whatever pose its script
// holds is the pose seen from afar. One or two bodies in view: the cost is a
// rig's handful of draws, never a crowd's. Its mixer never drops past the mid
// cadence either (crowd_lod.ts animCadenceFrames `keepsRig`): the Breath wakes
// from across its chasm, past the band (2026-11-25).
//
// Pure (RENDER_PURE_CORES): the far LOD latch (far_lod_latch.ts) and the
// renderer's first-frame gate (below) ask it. The gate's memory is a WeakMap
// keyed by the caller's view record; no clock of its own.

import { SMITH_HEART_FINAL_BOSS, SMITH_HEART_GUARDIANS } from '../../sim/content/smith_heart';
import { BREATH_AURAS } from '../../sim/encounters/smith_heart/breath_ids';
import { COUNCIL_AURAS, COUNCIL_TEMPLATE_IDS } from '../../sim/encounters/smith_heart/council_ids';
import { HEAT_AURAS } from '../../sim/encounters/smith_heart/heat_ids';
import { QUENCH_AURAS } from '../../sim/encounters/smith_heart/quench_ids';

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

// ---- the first frame -------------------------------------------------------------

// Jose's playtest of 2026-11-18, live: the Guardian of the Breath still flickered
// up for a moment as the raid came up the slope, then vanished and played its
// entrance. A body first built (entering draw range, or rebuilt) draws its rig's
// stock stance until its entrance painter next sends the scripted one through the
// gesture seam (every few tenths of a second, and the painters' module loads
// lazily), and the clip then fades in. So a boss whose scripted pose matters is
// kept hidden from its view's first frame until a gesture has reached that very
// rig and had SCRIPTED_POSE_SETTLE to settle (renderer.ts reads
// `scriptedPoseHidden`). The gate's memory is keyed by the RIG (the view's
// active visual), never the view record: a view kept while out of range
// rebuilds its rig on the way back in, and that new rig waits again.

/** The entrance auras the guardians and the Hammer Council wear until their
 *  entrance has played (dormant, or waking with the scene's clock). */
export const SMITH_HEART_INTRO_AURAS: ReadonlySet<string> = new Set([
  BREATH_AURAS.intro,
  COUNCIL_AURAS.intro,
  QUENCH_AURAS.intro,
  HEAT_AURAS.intro,
]);

/** Seconds a scripted gesture is given to settle (its clip's fade in) before
 *  the body shows. */
export const SCRIPTED_POSE_SETTLE = 0.3;

/** Does this body draw only once a scripted gesture has reached its view: a
 *  boss waiting for its entrance (its intro aura), or the Masterless Strength,
 *  whose body painter names its stance (the kneeling statue before its
 *  arrival) on every pass? */
export function awaitsScriptedPose(e: {
  templateId: string;
  auras: readonly { id: string }[];
}): boolean {
  if (e.templateId === SMITH_HEART_FINAL_BOSS) return true;
  if (!SMITH_HEART_SCRIPTED_POSE_BOSSES.has(e.templateId)) return false;
  for (const a of e.auras) if (SMITH_HEART_INTRO_AURAS.has(a.id)) return true;
  return false;
}

const firstGesture = new WeakMap<object, number>();

/** A gesture reached `rig` at clock `now` (seconds): the first one is kept. */
export function noteScriptedGesture(rig: object, now: number): void {
  if (!firstGesture.has(rig)) firstGesture.set(rig, now);
}

/** Must the body drawn by `rig` (of entity `e`) stay hidden at clock `now`:
 *  it awaits a scripted pose that has not yet reached that rig and settled? */
export function scriptedPoseHidden(
  rig: object,
  e: { templateId: string; auras: readonly { id: string }[] },
  now: number,
): boolean {
  if (!awaitsScriptedPose(e)) return false;
  const at = firstGesture.get(rig);
  return at === undefined || now - at < SCRIPTED_POSE_SETTLE;
}
