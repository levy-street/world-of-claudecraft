// How strongly to draw a weapon-skin VFX rig.
//
// A skin's rig is 6 to 10 additive transparent nodes riding the wearer's held
// weapon. Until now they answered to no lever at all: the `weapons` bucket in
// GFX_BUCKET_BANDS is pinned ungovernable at 1.0 on every tier, so a rig drew at
// its full authored strength whatever the scene was doing.
//
// WHAT THIS IS, AND IS NOT. It is a FADE, not a cull. `createWeaponVfx`'s
// applyTuning only stops drawing a part at a multiplier of 0.01 or less, and the
// smallest multiplier this can produce (MIN_DISTANCE_SCALE x GOVERNOR_FLOOR,
// against the smallest authored channel that ships) stays comfortably above
// that, on purpose. So nothing here removes a draw call, and dimming an additive
// transparent quad does not reduce its fill cost either. What removes the rig is
// the character LOD swap: past `showsStaticFarMesh` the whole articulated rig
// (weapon and rig included) is replaced by one baked mesh, somewhere between
// about 35 and 75 yards depending on crowd and tier.
//
// This exists so that removal is not a POP. Before it, a legendary skin drew at
// full authored strength right up to the swap and then vanished mid-stride. The
// fade is therefore product polish on purchased cosmetics, plus one genuine
// courtesy: a client under frame-budget pressure can turn other players' weapon
// glare down.
//
// TWO INPUTS, AND THE SPLIT IS THE FAIRNESS ARGUMENT
// (docs/design/graphics-settings-fairness.md):
//
//   - VIEWER DISTANCE (squared distance from the local player, the measure the
//     crowd LOD bands already rank rigs by), against the FIXED anchor
//     `CHARACTER_LOD_RANGE_SQ`. Deliberately the pre-scaling constant and not
//     the live band edge: the live edge reads a per-client, per-frame count of
//     visible rigs, so keying a fade to it would make a wearer's glow pulse as
//     unrelated players wander past, and would give two viewers standing in the
//     same spot different results. Against the constant, this arm is identical
//     for every player on every preset, so it can move no one's information
//     relative to anyone else's.
//   - The frame-budget governor's `vfx` bucket, the same lever the pooled
//     particle cloud and the ability VFX already answer to. It is the one input
//     that differs between two viewers, and it is floored at `GOVERNOR_FLOOR`
//     so it can only dim.
//
// Neither arm reaches zero, by construction. Nothing here can take a rig away;
// the LOD swap owns that, and it owns it on inputs the whole render path already
// shares. What is faded is decoration ON a weapon: the wearer, their nameplate,
// their cast bar, their auras, their position and the weapon model itself are
// untouched at every scale.
//
// Three/DOM-free and deterministic (a registered RENDER_PURE_CORE).

import { CHARACTER_LOD_RANGE_SQ } from './crowd_lod';
import type { WeaponVfxTuning } from './weapon_vfx';

/** Fraction of the anchor inside which the rig draws at its authored strength. */
const FULL_STRENGTH_FRACTION = 0.4;
/** Where the distance fade bottoms out, at and beyond the anchor. */
const MIN_DISTANCE_SCALE = 0.4;

/** The governor may dim a rig to this fraction of its authored strength and no
 *  further, so a low frame rate never changes what one viewer can make out. */
export const WEAPON_VFX_GOVERNOR_FLOOR = 0.35;

/** Scales are quantized to this step before they are applied, so the per-frame
 *  caller can elide the write whenever the plan has not really moved. At a 0.05
 *  step the fade advances in increments no eye resolves on a glow. */
const SCALE_STEP = 0.05;

/** Every tuning channel, so a scale reaches all of them and a new channel
 *  cannot silently escape the lever (pinned against `DEFAULT_TUNING`). */
export const WEAPON_VFX_TUNING_CHANNELS = [
  'glow',
  'bloom',
  'light',
  'core',
  'motes',
  'aurora',
  'mist',
  'sparkle',
  'shell',
  'pool',
] as const satisfies readonly (keyof WeaponVfxTuning)[];

const FULL_STRENGTH_SQ = CHARACTER_LOD_RANGE_SQ * FULL_STRENGTH_FRACTION * FULL_STRENGTH_FRACTION;

/**
 * The distance half of the fade: 1 inside `FULL_STRENGTH_FRACTION` of the
 * anchor, easing to `MIN_DISTANCE_SCALE` at the anchor and holding there.
 *
 * Eased rather than linear in the squared domain so the ramp reads evenly as the
 * viewer walks: distance-squared grows quadratically, and a linear fade over it
 * would dump most of the change into the last few yards.
 */
function distanceScale(distanceSq: number): number {
  if (!Number.isFinite(distanceSq) || distanceSq <= FULL_STRENGTH_SQ) return 1;
  if (distanceSq >= CHARACTER_LOD_RANGE_SQ) return MIN_DISTANCE_SCALE;
  const t =
    (Math.sqrt(distanceSq) - Math.sqrt(FULL_STRENGTH_SQ)) /
    (Math.sqrt(CHARACTER_LOD_RANGE_SQ) - Math.sqrt(FULL_STRENGTH_SQ));
  return 1 - t * (1 - MIN_DISTANCE_SCALE);
}

/**
 * The multiplier to fold onto a skin's authored tuning: 1 is the full authored
 * look. Never 0; see the header for why removal is not this module's job.
 *
 * `vfxLevel` is the frame-budget governor's vfx bucket level (1 when it is not
 * shedding). A non-finite level reads as "no pressure".
 */
export function weaponVfxShedScale(distanceSq: number, vfxLevel: number): number {
  const byDistance = distanceScale(Math.max(0, distanceSq));
  const level = Number.isFinite(vfxLevel) ? Math.min(1, Math.max(0, vfxLevel)) : 1;
  const byGovernor = WEAPON_VFX_GOVERNOR_FLOOR + (1 - WEAPON_VFX_GOVERNOR_FLOOR) * level;
  return Math.round((byDistance * byGovernor) / SCALE_STEP) * SCALE_STEP;
}

/** The floor of the whole lever: what a rig still draws at under the worst
 *  combination of distance and governor pressure. Exported so a test can prove
 *  it stays clear of the multiplier at which a part would stop drawing. */
export const WEAPON_VFX_MIN_SHED_SCALE = MIN_DISTANCE_SCALE * WEAPON_VFX_GOVERNOR_FLOOR;

/**
 * Fold `scale` onto the skin's authored tuning row into a caller-owned object
 * (an absent authored channel is the 1.0 default, exactly as `createWeaponVfx`
 * reads it). Returns `out` so the caller can hand it straight to `setTuning`.
 */
export function scaleWeaponVfxTuning(
  authored: Partial<WeaponVfxTuning>,
  scale: number,
  out: WeaponVfxTuning,
): WeaponVfxTuning {
  for (const channel of WEAPON_VFX_TUNING_CHANNELS) {
    out[channel] = (authored[channel] ?? 1) * scale;
  }
  return out;
}
