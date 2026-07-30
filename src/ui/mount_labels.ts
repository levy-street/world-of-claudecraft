// Mount display labels: the name/description i18n key maps and the small text
// helpers that render a mount's identity. Split out of the retired mount picker,
// which owned them only because it was the biggest consumer.
//
// Reins are plain usable items now (click them to ride, see sim useItem ->
// summonMountItem), so the surfaces that need these labels are the bag tooltip
// for a reins item and the cast bar's summon line. Neither is a picker, and
// neither should have to import one.

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
};

export const MOUNT_DESC_KEYS: Record<string, TranslationKey> = {
  valorsteed: 'hudChrome.mounts.desc_valorsteed',
  grag_bear: 'hudChrome.mounts.desc_grag_bear',
  stalkglider_snail: 'hudChrome.mounts.desc_stalkglider_snail',
  aether_hover_cycle: 'hudChrome.mounts.desc_aether_hover_cycle',
  shadowjump_toad: 'hudChrome.mounts.desc_shadowjump_toad',
  stormfeather_griffin: 'hudChrome.mounts.desc_stormfeather_griffin',
  thunderstrut_gobbler: 'hudChrome.mounts.desc_thunderstrut_gobbler',
};

/** The localized mount name, falling back to the catalog's English label and
 *  finally the raw key so an unmapped mount can never render blank. */
export function mountDisplayName(key: string): string {
  const nameKey = MOUNT_NAME_KEYS[key];
  return nameKey ? t(nameKey) : ((MOUNTS as Record<string, { name: string }>)[key]?.name ?? key);
}

/** The specialty lines ("+40% extra mobility") for a mount.
 *  Speed is the only stat now; block and crit were removed in the mounts overhaul. */
export function mountSpecLines(row: { speedPct: number }): string[] {
  return [t('hudChrome.mounts.spec_speed', { pct: row.speedPct })];
}
