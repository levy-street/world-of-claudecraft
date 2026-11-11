// The Book of Deeds card's line for a deed that pays a cosmetic beyond the Book's own titles
// and borders (the Smith's Heart's feats: a weapon appearance; its meta: a mount;
// src/sim/smith_heart_feat_rewards.ts). Resolved through the Armory's and the Mounts
// window's own localized names, so the card and those windows always agree.

import { WEAPON_SKINS } from '../sim/content/weapon_skins';
import { localizeWeaponSkin } from './armory_labels';
import { t } from './i18n';
import { mountDisplayName } from './mount_labels';

/** The localized reward line, or null for a deed that pays no such cosmetic. */
export function deedCosmeticRewardLine(entry: {
  rewardSkinId: string | null;
  rewardMountKey: string | null;
}): string | null {
  if (entry.rewardSkinId !== null && Object.hasOwn(WEAPON_SKINS, entry.rewardSkinId)) {
    const name = localizeWeaponSkin(WEAPON_SKINS[entry.rewardSkinId]).name;
    return t('hudChrome.deeds.rewardAppearance', { name });
  }
  if (entry.rewardMountKey !== null)
    return t('hudChrome.deeds.rewardMount', { name: mountDisplayName(entry.rewardMountKey) });
  return null;
}
