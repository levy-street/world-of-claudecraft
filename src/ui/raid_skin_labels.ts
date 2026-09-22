// Display names for the Inner Crucible raid-reward skins
// (sim/content/crucible_skins.ts), one t() key per catalog id. A closed table:
// an id with no key answers null so a caller can fail closed, never a
// humanized id.
import type { SkinCatalog } from '../sim/types';
import { type TranslationKey, t } from './i18n';

const RAID_SKIN_NAME_KEYS: Readonly<Partial<Record<SkinCatalog, TranslationKey>>> = {
  magmaraith: 'hudChrome.cosmetics.raidName_magmaraith',
  ashen_dawn: 'hudChrome.cosmetics.raidName_ashen_dawn',
  craterstalker: 'hudChrome.cosmetics.raidName_craterstalker',
  cinder_thorn: 'hudChrome.cosmetics.raidName_cinder_thorn',
  ember_vestal: 'hudChrome.cosmetics.raidName_ember_vestal',
  basalt_maw: 'hudChrome.cosmetics.raidName_basalt_maw',
  emberstone: 'hudChrome.cosmetics.raidName_emberstone',
  brimstone_pact: 'hudChrome.cosmetics.raidName_brimstone_pact',
  emberbark: 'hudChrome.cosmetics.raidName_emberbark',
};

export function raidSkinName(catalog: SkinCatalog): string {
  const key = Object.hasOwn(RAID_SKIN_NAME_KEYS, catalog)
    ? RAID_SKIN_NAME_KEYS[catalog]
    : undefined;
  return key ? t(key) : '';
}
