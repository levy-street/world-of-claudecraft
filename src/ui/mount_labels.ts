// Mount display labels: the name/description i18n key maps and the small text
// helpers that render a mount's identity. Split out of the retired mount picker,
// which owned them only because it was the biggest consumer.
//
// Reins are plain usable items now (click them to ride, see sim useItem ->
// summonMountItem), so the surfaces that need these labels are the bag tooltip
// for a reins item and the cast bar's summon line. Neither is a picker, and
// neither should have to import one.

import { MOUNT_SKINS, type MountSkinId } from '../sim/content/mount_skins';
import { MOUNTS } from '../sim/content/mounts';
import { type TranslationKey, t } from './i18n';

export const MOUNT_NAME_KEYS: Record<string, TranslationKey> = {
  valorsteed: 'hudChrome.mounts.name_valorsteed',
  grag_bear: 'hudChrome.mounts.name_grag_bear',
  stalkglider_snail: 'hudChrome.mounts.name_stalkglider_snail',
  aether_hover_cycle: 'hudChrome.mounts.name_aether_hover_cycle',
  shadowjump_toad: 'hudChrome.mounts.name_shadowjump_toad',
  stormfeather_griffin: 'hudChrome.mounts.name_stormfeather_griffin',
  thunderstrut_gobbler: 'hudChrome.mounts.name_thunderstrut_gobbler',
  drakemaw_raptor: 'hudChrome.mounts.name_drakemaw_raptor',
  lanternback_troll: 'hudChrome.mounts.name_lanternback_troll',
  terrorspark_groundshaker: 'hudChrome.mounts.name_terrorspark_groundshaker',
};

export const MOUNT_DESC_KEYS: Record<string, TranslationKey> = {
  valorsteed: 'hudChrome.mounts.desc_valorsteed',
  grag_bear: 'hudChrome.mounts.desc_grag_bear',
  stalkglider_snail: 'hudChrome.mounts.desc_stalkglider_snail',
  aether_hover_cycle: 'hudChrome.mounts.desc_aether_hover_cycle',
  shadowjump_toad: 'hudChrome.mounts.desc_shadowjump_toad',
  stormfeather_griffin: 'hudChrome.mounts.desc_stormfeather_griffin',
  thunderstrut_gobbler: 'hudChrome.mounts.desc_thunderstrut_gobbler',
  drakemaw_raptor: 'hudChrome.mounts.desc_drakemaw_raptor',
  lanternback_troll: 'hudChrome.mounts.desc_lanternback_troll',
  terrorspark_groundshaker: 'hudChrome.mounts.desc_terrorspark_groundshaker',
};

/** The localized mount name, falling back to the catalog's English label and
 *  finally the raw key so an unmapped mount can never render blank. */
export function mountDisplayName(key: string): string {
  const nameKey = MOUNT_NAME_KEYS[key];
  if (nameKey) return t(nameKey);
  // A mount PRESENTATION key (src/sim/content/mount_skins.ts mountPresentationKey)
  // can name a worn skin instead of a catalog mount: the cast bar's summon line
  // and the bag tooltip both label what the rider will see.
  const skinKey = (MOUNT_SKIN_NAME_KEYS as Record<string, TranslationKey | undefined>)[key];
  if (skinKey) return t(skinKey);
  return (MOUNTS as Record<string, { name: string }>)[key]?.name ?? key;
}

// Mount SKIN labels (src/sim/content/mount_skins.ts). The skins that used to
// be catalog mounts (the Mech Bird, the Chimeglass Tortoise, the Bonebound
// Rickshaw) keep the hudChrome.mounts.name_*/desc_* keys they shipped with, so
// no locale row moves; a brand-new skin adds its pair here.
export const MOUNT_SKIN_NAME_KEYS: Record<MountSkinId, TranslationKey> = {
  mech_bird: 'hudChrome.mounts.name_mech_bird',
  chimeglass_tortoise: 'hudChrome.mounts.name_chimeglass_tortoise',
  rickshaw_mount: 'hudChrome.mounts.name_rickshaw_mount',
};

export const MOUNT_SKIN_DESC_KEYS: Record<MountSkinId, TranslationKey> = {
  mech_bird: 'hudChrome.mounts.desc_mech_bird',
  chimeglass_tortoise: 'hudChrome.mounts.desc_chimeglass_tortoise',
  rickshaw_mount: 'hudChrome.mounts.desc_rickshaw_mount',
};

/** The localized mount-skin name, falling back to the catalog's English label
 *  and finally the raw id so an unmapped skin can never render blank. */
export function mountSkinDisplayName(id: string): string {
  const nameKey = (MOUNT_SKIN_NAME_KEYS as Record<string, TranslationKey | undefined>)[id];
  return nameKey
    ? t(nameKey)
    : ((MOUNT_SKINS as Record<string, { name: string } | undefined>)[id]?.name ?? id);
}

/** The localized mount-skin flavor line ('' for an unmapped id). */
export function mountSkinDescription(id: string): string {
  const descKey = (MOUNT_SKIN_DESC_KEYS as Record<string, TranslationKey | undefined>)[id];
  return descKey ? t(descKey) : '';
}

/** The specialty lines ("+40% extra mobility") for a mount.
 *  Speed is the only stat now; block and crit were removed in the mounts overhaul. */
export function mountSpecLines(row: { speedPct: number }): string[] {
  return [t('hudChrome.mounts.spec_speed', { pct: row.speedPct })];
}
