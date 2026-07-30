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
  timeScale: number;
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

// Every clip a displayed weapon skin can substitute for the authored attack.
// CharacterVisual binds these alongside the def's own clip names; a rig that
// does not ship them (no animUrls entry) simply skips the absent names, so
// only the hunter pays the extra action.
export const SKIN_ATTACK_CLIP_NAMES: readonly string[] = ['Bow_Draw_Shot'];

/** How a ranged skin is held and fired: its weapon type, unless the def
 *  carries a `handling` override (a bow-slot gun aims like a crossbow). */
export function weaponSkinHandling(skin: WeaponSkinDef): string {
  return skin.handling ?? skin.weaponType;
}

/** The attack-clip override for a displayed weapon skin, or null to keep the
 *  visual's authored attack. Keyed off the skin's HANDLING, not its store
 *  slot: a bow-slot skin with crossbow handling keeps the shoulder-aim. */
export function weaponSkinAttackClips(weaponSkinId: string | null): SkinAttackClips | null {
  const skin = weaponSkinId ? WEAPON_SKINS[weaponSkinId] : null;
  return skin && weaponSkinHandling(skin) === 'bow' ? BOW_ATTACK : null;
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
