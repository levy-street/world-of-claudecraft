// Skin-driven attack-clip substitution: the clip set and time scale a
// DISPLAYED weapon skin swaps in for a visual's authored attack.
//
// The hunter's authored attack is 2H_Ranged_Shoot, a crossbow shoulder-aim
// (the class ranged visual is a crossbow). With a BOW skin displayed the shot
// plays the purpose-built Bow_Draw_Shot clip instead. The clip is assembled
// from KayKit donor poses and shipped to the hunter via the bow_anims.glb
// animUrls entry (scripts/build_bow_anims.mjs). Crossbow skins keep the
// authored shoulder-aim.
//
// Pure over the skin catalog: no DOM, no three, Node-tested directly
// (tests/weapon_skins.test.ts). CharacterVisual is the one consumer.

import { WEAPON_SKINS, type WeaponSkinDef } from '../../sim/content/weapon_skins';

export interface SkinAttackClips {
  clips: readonly string[];
  /** Omitted to keep the visual's own `attackTimeScale`. A substitution that
   *  names the clip a rig ALREADY authors (the ranged shot on the hunter) must
   *  not also re-time it, or applying a skin would change the shot's speed. */
  timeScale?: number;
}

/** Typed renderer-event correlation for player ranged attacks. The launch cue
 * starts whichever attack clip the live CharacterVisual selects (bow override
 * or authored crossbow/default); the matching impact marker prevents replay. */
export function playerRangedAttackStartsAtLaunch(
  sourceKind: string | undefined,
  attackAnimation: string | undefined,
): boolean {
  return sourceKind === 'player' && attackAnimation === 'ranged-shot';
}

export function playerRangedAttackAlreadyStarted(
  sourceKind: string | undefined,
  attackAnimationStarted: boolean | undefined,
): boolean {
  return sourceKind === 'player' && attackAnimationStarted === true;
}

const BOW_ATTACK: SkinAttackClips = {
  clips: ['Bow_Draw_Shot'],
  timeScale: 1.0,
};

// Crossbow handling (real crossbows and the bow-slot guns that aim like them)
// asks for the KayKit shoulder-aim by NAME rather than leaning on the rig's
// authored attack. On the hunter that IS the authored attack, so this resolves
// to the same clip at the same speed (timeScale omitted above). It matters on
// every OTHER body that can display a ranged skin: the Combat Mech authors a
// melee chop, and both rigs ship 2H_Ranged_Shoot in their GLB, so naming it
// here is what makes the mech shoulder the weapon instead of clubbing with it.
const RANGED_ATTACK: SkinAttackClips = {
  clips: ['2H_Ranged_Shoot'],
};

// Every clip a displayed weapon skin can substitute for the authored attack or
// cast pose.
// CharacterVisual binds these alongside the def's own clip names, which reaches
// clips the rig's ClipMap never names (Bow_Draw_Hold on the hunter,
// 2H_Ranged_Shoot on the mech). A rig that ships none simply binds no action,
// and the pick/base fallbacks keep its authored animation.
/** The static full-draw pose the cast state holds (bow_hold_anim.glb, built by
 *  scripts/build_bow_hold_anim.mjs by resampling the draw's own hold window). */
const BOW_CAST_CLIP = 'Bow_Draw_Hold';

export const SKIN_ATTACK_CLIP_NAMES: readonly string[] = [
  'Bow_Draw_Shot',
  BOW_CAST_CLIP,
  '2H_Ranged_Shoot',
];

/** How a ranged skin is held and fired: its weapon type, unless the def
 *  carries a `handling` override (a bow-slot gun aims like a crossbow). */
export function weaponSkinHandling(skin: WeaponSkinDef): string {
  return skin.handling ?? skin.weaponType;
}

/** The attack-clip override for a displayed weapon skin, or null to keep the
 *  visual's authored attack. Keyed off the skin's HANDLING, not its store
 *  slot: a bow-slot skin with crossbow handling keeps the shoulder-aim. Melee
 *  skins never substitute, so a sword skin swings whatever the rig authors. */
export function weaponSkinAttackClips(weaponSkinId: string | null): SkinAttackClips | null {
  const skin = weaponSkinId ? WEAPON_SKINS[weaponSkinId] : null;
  if (!skin) return null;
  const handling = weaponSkinHandling(skin);
  if (handling === 'bow') return BOW_ATTACK;
  return handling === 'crossbow' ? RANGED_ATTACK : null;
}

/** The substitution above, resolved against the clips a RIG actually bound.
 *  `has` answers whether a clip name resolved to a live action on this visual.
 *
 *  Only the hunter ships bow_anims.glb (the one animUrls entry in the
 *  manifest), so on any other rig displaying a bow skin, Bow_Draw_Shot is
 *  never bound. Substituting it there is worse than not substituting at all:
 *  the clip list REPLACES the authored attack, and playOneShot no-ops on a
 *  missing action, so the body plays nothing at all when it swings. The
 *  Combat Mech is the live case, being the one body that shows a hunter's
 *  equipped weapon. Returning null hands the caller back its authored attack.
 *
 *  All-or-nothing per skin: a partially-bound list would play a subset of an
 *  authored sequence, which is a different animation, not a degraded one. */
export function pickSkinAttackClips(
  weaponSkinId: string | null,
  has: (clip: string) => boolean,
): SkinAttackClips | null {
  const spec = weaponSkinAttackClips(weaponSkinId);
  if (!spec) return null;
  return spec.clips.every(has) ? spec : null;
}

/** The clip the CAST base state should hold while this skin is displayed, or
 *  null to keep the visual's authored cast.
 *
 *  Casting is a HELD state, not a one-shot, and every class takes `Spellcasting`
 *  from the shared kaykit() ClipMap. That is a caster's arm-circling gesture, so
 *  a hunter part-way through a cast-time shot (Long Draw, castTime 3.0) looked
 *  like a mage waving at a bow. A drawn bow holds the draw instead.
 *
 *  Keyed off HANDLING like the attack substitution: a crossbow (and a bow-slot
 *  gun, which aims like one) is shouldered rather than drawn, so it keeps the
 *  authored cast until a pose exists for it. */
export function weaponSkinCastClip(
  weaponSkinId: string | null,
  castingAbility: string | null,
): string | null {
  // Gated on the same drawn-shot allowlist the aim pin uses. Handling alone is
  // not enough: a bow skin is a bow during tame_beast too, and holding a full
  // draw through a six-second beast taming is the POSE half of the bug
  // isDrawnShotCast prevents. Reported by review on PR 2941.
  if (!isDrawnShotCast(castingAbility)) return null;
  const skin = weaponSkinId ? WEAPON_SKINS[weaponSkinId] : null;
  return skin && weaponSkinHandling(skin) === 'bow' ? BOW_CAST_CLIP : null;
}

/** Cast-time abilities that are a DRAWN SHOT, so a bow should be held aimed
 *  for their duration.
 *
 *  An allowlist rather than a derived rule, because every derivable signal is
 *  wrong somewhere: `casting` alone is true for tame_beast (6s) and revive_pet
 *  (3s), and `minRange` (the classic ranged dead zone) is also carried by the
 *  melee gap-closers charge and bear_charge. A hunter holding a bow aimed
 *  through a six-second beast taming is the bug this prevents.
 *
 *  `tests/weapon_skins.test.ts` scans the ability table and fails if a new
 *  cast-time shot lands without a row here, so the list cannot silently rot. */
const DRAWN_SHOT_CAST_IDS: ReadonlySet<string> = new Set(['aimed_shot']);

/** True when this cast is a drawn shot (see DRAWN_SHOT_CAST_IDS). */
export function isDrawnShotCast(abilityId: string | null | undefined): boolean {
  return !!abilityId && DRAWN_SHOT_CAST_IDS.has(abilityId);
}

/** What the rig's current one-shot IS, for callers that must tell a shot apart
 *  from every other one-shot. `null` means no one-shot is playing. */
export type OneShotKind = 'attack' | 'emote' | 'other' | null;

/**
 * Whether a displayed ranged skin should be presented AIMED right now.
 *
 * This answers "is this character shooting", which is NOT the same question as
 * "is some one-shot playing", the test that used to stand in for it. That
 * stand-in failed in both directions:
 *
 *  - A hit reaction is a one-shot and is not shooting, so a bow snapped upright
 *    through the flinch every time its owner took a hit.
 *  - A cast-time shot (Long Draw, castTime 3.0) is a held base state and not a
 *    one-shot at all, so the bow stayed at its resting grip for the entire
 *    three-second draw and only came up for the release. That is the exact
 *    moment the aim pose was written for.
 *
 * A non-attack one-shot beats a concurrent cast: whatever interrupted the draw
 * is what the body is actually playing, so the weapon should follow the hand.
 *
 * Both pin modes read this one answer, in opposite directions (a bow aims while
 * it is true, a bow-slot gun carries muzzle-forward while it is false), so the
 * flinch and the draw are fixed for both weapons at once.
 */
export function rangedSkinAiming(oneShot: OneShotKind, castingAbility: string | null): boolean {
  if (oneShot !== null) return oneShot === 'attack';
  return isDrawnShotCast(castingAbility);
}

export type SkinOrientPinMode = 'aimDuringShot' | 'carryOutsideShot';

/** The orientation pin a displayed skin takes (CharacterVisual
 *  applySkinOrientation): bows pin to the upright aim WHILE the shot one-shot
 *  plays (the string hand would roll them sideways mid-draw); bow-slot guns
 *  (crossbow handling) pin to a forward carry OUTSIDE the shot (the hanging
 *  idle arm points them at the ground) and follow the hand-tuned grip during
 *  the shouldered aim. True crossbow-slot skins take no pin. */
export function weaponSkinOrientPin(weaponSkinId: string | null): SkinOrientPinMode | null {
  const skin = weaponSkinId ? WEAPON_SKINS[weaponSkinId] : null;
  if (!skin) return null;
  const handling = weaponSkinHandling(skin);
  if (handling === 'bow') return 'aimDuringShot';
  if (skin.weaponType === 'bow' && handling === 'crossbow') return 'carryOutsideShot';
  return null;
}

/** The handslot a ranged skin occupies, by HANDLING. Bows sit in the LEFT
 *  hand: in the ranged animation set the left arm is the FRONT arm (it
 *  extends toward the target) and the right hand stays back at the shoulder
 *  as the string hand, so a bow glued to the right hand reads backwards.
 *  Crossbow handling (real crossbows, and guns that aim like them) keeps the
 *  class's authored right-hand attach (stock in the trigger hand). */
export function weaponSkinAttachBone(handling: string, baseBone: string): string {
  return handling === 'bow' ? baseBone.replace(/\.r$/, '.l') : baseBone;
}
