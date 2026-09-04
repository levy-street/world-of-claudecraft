// The orange (promoted legendary) world-space identity: whether a worn set
// earns the forge-mote drift, and how strongly to emit it at a viewer distance.
//
// THE PREDICATE IS A PURE FUNCTION OF THE FOUR ALLOWLISTED WIRE FIELDS ONLY
// (signer/enchant/rolled/name, the server's eqi projection in server/game.ts).
// It keys on `rolled?.quality === 'legendary'`, nothing else. The `perfected`
// stamp is deliberately OFF the peer wire while the OFFLINE entity mirror
// carries it in full, so any read of it here would render differently per host
// and per self/peer; the strict promoted conjunction is therefore not
// computable for a peer, and this module must never try.
//
// 2026-08-29: keying on the honest roll means legacy masterwork-bumped
// legendary-rolled copies glow too, by D13-4's display doctrine (display
// follows the honest roll: legacy legendary-rolled copies keep their legendary
// display, exactly as the bags window colors those names orange today), and a
// moderation name-stripped promoted copy (D13-5) keeps glowing for the same
// reason. Def-level legendary DROPS (ITEMS[id].quality === 'legendary', only
// reachable via equippedItems) are deliberately OUT of scope: this is the
// crafted-promotion mark, and widening it to drops is a maintainer option,
// not a default.
//
// The emit scale is the weapon_vfx_shed_core distance arm: 1 inside a
// full-strength fraction of the FIXED CHARACTER_LOD_RANGE_SQ anchor (never the
// live crowd band edge, whose per-client per-frame reads would pulse one
// wearer's glow with unrelated crowd churn and give co-located viewers
// different results), eased to a floor at the anchor, quantized, never 0:
// removal belongs to the entity-loop hysteresis cull
// (characterViewOutsideHysteresis) and the off-screen presentation skip the
// entity loop already applies (the far-LOD swap does not stop this emitter:
// the motes are world-space pooled particles, not rig children). The governor
// lever stays the pooled cloud's own floored quality mult inside emitCount;
// no preset, tier, or governor read lands here.
//
// The quantized curve is CACHED once, at module load, as the squared distances
// at which it steps down (STEP_DOWN_SQ): the per-frame call per glowing
// on-screen player then walks at most a dozen compares and takes no square
// root at all, where the reference form paid three per call. Derived from the
// same constants, so there is no staleness surface (nothing here can move at
// runtime), and the reference form is kept beside it for the equivalence pin.
//
// Three/DOM-free and deterministic (a registered RENDER_PURE_CORE).

import type { ItemInstancePayload } from '../sim/types';
import { CHARACTER_LOD_RANGE_SQ } from './crowd_lod';

/** The legendary quality orange (QUALITY_COLOR.legendary, TIERS.legendary.hex). */
export const LEGENDARY_REGALIA_COLOR = 0xff8000;
/** The molten-gold secondary mote (weapon_vfx.ts STAR.gold). */
export const LEGENDARY_REGALIA_GOLD = 0xffb347;
/** Sparse on purpose: one or two visible sparks a second, far below the
 *  formAura ambients (24 to 48/s); identity, not a pillar of fire. */
export const LEGENDARY_REGALIA_RATE_PER_SEC = 1.8;

/** Fraction of the anchor inside which the drift emits at its full rate. */
const FULL_STRENGTH_FRACTION = 0.4;
/** Where the distance fade bottoms out, at and beyond the anchor. */
const MIN_DISTANCE_SCALE = 0.4;
/** Scales quantize to this step so tiny camera moves keep the value stable. */
const SCALE_STEP = 0.05;

const FULL_STRENGTH_SQ = CHARACTER_LOD_RANGE_SQ * FULL_STRENGTH_FRACTION * FULL_STRENGTH_FRACTION;

// The two constant square roots of the eased ramp, hoisted out of the call.
const FULL_STRENGTH_YD = Math.sqrt(FULL_STRENGTH_SQ);
const ANCHOR_YD = Math.sqrt(CHARACTER_LOD_RANGE_SQ);
/** The quantized levels: `STEPS_TOTAL * SCALE_STEP` is the full rate, and the
 *  curve steps down one notch at a time to `STEPS_MIN * SCALE_STEP`, the floor. */
const STEPS_TOTAL = Math.round(1 / SCALE_STEP);
const STEPS_MIN = Math.round(MIN_DISTANCE_SCALE / SCALE_STEP);

/**
 * The squared distance past which the quantized scale has dropped to or below
 * each level, ascending: beyond `STEP_DOWN_SQ[i]` the scale is at most
 * `(STEPS_TOTAL - 1 - i) * SCALE_STEP`. Inverted once from the reference curve
 * (legendaryRegaliaEmitScaleReference): Math.round(v) leaves level n + 1 when
 * v + 0.5 < n + 1, that is when the eased t exceeds
 * (STEPS_TOTAL - n - 0.5) / (STEPS_TOTAL - STEPS_MIN), and t maps back to
 * yards as FULL_STRENGTH_YD + t * (ANCHOR_YD - FULL_STRENGTH_YD).
 */
const STEP_DOWN_SQ: readonly number[] = (() => {
  const thresholds: number[] = [];
  const span = ANCHOR_YD - FULL_STRENGTH_YD;
  const levels = STEPS_TOTAL - STEPS_MIN;
  for (let n = STEPS_TOTAL - 1; n >= STEPS_MIN; n--) {
    const t = (STEPS_TOTAL - n - 0.5) / levels;
    const yd = FULL_STRENGTH_YD + t * span;
    thresholds.push(yd * yd);
  }
  return thresholds;
})();

/** True while any worn slot carries a legendary-rolled payload. */
export function legendaryRegaliaActive(
  instances: Partial<Record<string, ItemInstancePayload>>,
): boolean {
  for (const slot in instances) {
    if (instances[slot]?.rolled?.quality === 'legendary') return true;
  }
  return false;
}

/**
 * The distance arm of the shed, folded onto the emit dt: 1 in close, easing to
 * `MIN_DISTANCE_SCALE` at the anchor and holding there. Eased in the sqrt
 * domain so the ramp reads evenly as the viewer walks (a linear fade over the
 * squared distance dumps most of the change into the last few yards). This is
 * the cached form: a walk down STEP_DOWN_SQ, no square root per call. It
 * answers exactly what legendaryRegaliaEmitScaleReference answers (pinned).
 */
export function legendaryRegaliaEmitScale(distanceSq: number): number {
  const d2 = Math.max(0, distanceSq);
  if (!Number.isFinite(d2) || d2 <= FULL_STRENGTH_SQ) return 1;
  if (d2 >= CHARACTER_LOD_RANGE_SQ) return MIN_DISTANCE_SCALE;
  let level = STEPS_TOTAL;
  for (let i = 0; i < STEP_DOWN_SQ.length; i++) {
    if (d2 <= STEP_DOWN_SQ[i]) break;
    level--;
  }
  return level * SCALE_STEP;
}

/**
 * The reference curve the cache is derived from, in the arithmetic the shed
 * was first written in (two constant square roots plus one per call). Kept
 * ONLY for the equivalence pin in tests/legendary_regalia.test.ts; the
 * renderer never calls it.
 */
export function legendaryRegaliaEmitScaleReference(distanceSq: number): number {
  const d2 = Math.max(0, distanceSq);
  if (!Number.isFinite(d2) || d2 <= FULL_STRENGTH_SQ) return 1;
  if (d2 >= CHARACTER_LOD_RANGE_SQ) return MIN_DISTANCE_SCALE;
  const t =
    (Math.sqrt(d2) - Math.sqrt(FULL_STRENGTH_SQ)) /
    (Math.sqrt(CHARACTER_LOD_RANGE_SQ) - Math.sqrt(FULL_STRENGTH_SQ));
  return Math.round((1 - t * (1 - MIN_DISTANCE_SCALE)) / SCALE_STEP) * SCALE_STEP;
}

/**
 * The whole emit decision for one wearer on one frame, as the renderer's
 * presentation loop asks it: the dt the pooled emitter should advance by, or 0
 * when nothing may emit. `active` is the view's cached legendaryRegaliaActive
 * answer; `reducedMotion` is the viewer's prefers-reduced-motion setting (the
 * lich-aura precedent: an accessibility choice by the viewer, never a graphics
 * shed), which suppresses the drift outright, whatever the distance. The
 * distance shed applies only to an emit that happens at all.
 */
export function legendaryRegaliaEmitDt(
  active: boolean | undefined,
  reducedMotion: boolean,
  dt: number,
  distanceSq: number,
): number {
  if (!active || reducedMotion || !(dt > 0)) return 0;
  return dt * legendaryRegaliaEmitScale(distanceSq);
}
