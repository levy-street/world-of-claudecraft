import type { WeaponSkinCollection, WeaponSkinDef } from '../sim/content/weapon_skins';
import type { WeaponSkinType } from '../sim/types';
import { type TranslationKey, t } from './i18n';
import type { ArmorySkinRow } from './woc_store_view';

export function weaponTypeLabel(type: WeaponSkinType): string {
  switch (type) {
    case 'sword':
      return t('hudChrome.wocStore.wtype.sword');
    case 'axe':
      return t('hudChrome.wocStore.wtype.axe');
    case 'mace':
      return t('hudChrome.wocStore.wtype.mace');
    case 'dagger':
      return t('hudChrome.wocStore.wtype.dagger');
    case 'staff':
      return t('hudChrome.wocStore.wtype.staff');
    case 'wand':
      return t('hudChrome.wocStore.wtype.wand');
    case 'bow':
      return t('hudChrome.wocStore.wtype.bow');
    case 'crossbow':
      return t('hudChrome.wocStore.wtype.crossbow');
  }
}

export function rarityLabel(rarity: ArmorySkinRow['skin']['rarity']): string {
  switch (rarity) {
    case 'uncommon':
      return t('hudChrome.wocStore.rarity.uncommon');
    case 'rare':
      return t('hudChrome.wocStore.rarity.rare');
    case 'epic':
      return t('hudChrome.wocStore.rarity.epic');
    case 'legendary':
      return t('hudChrome.wocStore.rarity.legendary');
  }
}

export function badgeLabel(badge: 'flagship' | 'hero'): string {
  return badge === 'flagship'
    ? t('hudChrome.wocStore.badge.flagship')
    : t('hudChrome.wocStore.badge.hero');
}

export function sceneLabel(scene: 'day' | 'dusk' | 'night'): string {
  switch (scene) {
    case 'day':
      return t('hudChrome.wocStore.scene.day');
    case 'dusk':
      return t('hudChrome.wocStore.scene.dusk');
    case 'night':
      return t('hudChrome.wocStore.scene.night');
  }
}

export function weaponSkinCollectionLabel(collection: WeaponSkinCollection): string {
  switch (collection) {
    case 'guildmark':
      return t('hudChrome.wocStore.collections.guildmark');
    case 'emberwrought':
      return t('hudChrome.wocStore.collections.emberwrought');
    case 'hoarfrost':
      return t('hudChrome.wocStore.collections.hoarfrost');
    case 'fallen_star':
      return t('hudChrome.wocStore.collections.fallen_star');
  }
}

export interface LocalizedWeaponSkin {
  name: string;
  collection: string;
  look: string;
  lore: string;
}

const ARMORY_SKIN_KEYS = {
  guildmark_arming_sword: {
    name: 'hudChrome.wocStore.skins.guildmark_arming_sword.name',
    look: 'hudChrome.wocStore.skins.guildmark_arming_sword.look',
    lore: 'hudChrome.wocStore.skins.guildmark_arming_sword.lore',
  },
  brasscap_axe: {
    name: 'hudChrome.wocStore.skins.brasscap_axe.name',
    look: 'hudChrome.wocStore.skins.brasscap_axe.look',
    lore: 'hudChrome.wocStore.skins.brasscap_axe.lore',
  },
  tempered_flanged_mace: {
    name: 'hudChrome.wocStore.skins.tempered_flanged_mace.name',
    look: 'hudChrome.wocStore.skins.tempered_flanged_mace.look',
    lore: 'hudChrome.wocStore.skins.tempered_flanged_mace.lore',
  },
  guildmark_dirk: {
    name: 'hudChrome.wocStore.skins.guildmark_dirk.name',
    look: 'hudChrome.wocStore.skins.guildmark_dirk.look',
    lore: 'hudChrome.wocStore.skins.guildmark_dirk.lore',
  },
  brasscrown_staff: {
    name: 'hudChrome.wocStore.skins.brasscrown_staff.name',
    look: 'hudChrome.wocStore.skins.brasscrown_staff.look',
    lore: 'hudChrome.wocStore.skins.brasscrown_staff.lore',
  },
  lacquered_wand: {
    name: 'hudChrome.wocStore.skins.lacquered_wand.name',
    look: 'hudChrome.wocStore.skins.lacquered_wand.look',
    lore: 'hudChrome.wocStore.skins.lacquered_wand.lore',
  },
  fletcher_s_guild_bow: {
    name: 'hudChrome.wocStore.skins.fletcher_s_guild_bow.name',
    look: 'hudChrome.wocStore.skins.fletcher_s_guild_bow.look',
    lore: 'hudChrome.wocStore.skins.fletcher_s_guild_bow.lore',
  },
  cinderbrand_sword: {
    name: 'hudChrome.wocStore.skins.cinderbrand_sword.name',
    look: 'hudChrome.wocStore.skins.cinderbrand_sword.look',
    lore: 'hudChrome.wocStore.skins.cinderbrand_sword.lore',
  },
  emberbite_axe: {
    name: 'hudChrome.wocStore.skins.emberbite_axe.name',
    look: 'hudChrome.wocStore.skins.emberbite_axe.look',
    lore: 'hudChrome.wocStore.skins.emberbite_axe.lore',
  },
  smoulderfall_mace: {
    name: 'hudChrome.wocStore.skins.smoulderfall_mace.name',
    look: 'hudChrome.wocStore.skins.smoulderfall_mace.look',
    lore: 'hudChrome.wocStore.skins.smoulderfall_mace.lore',
  },
  ashspark_dagger: {
    name: 'hudChrome.wocStore.skins.ashspark_dagger.name',
    look: 'hudChrome.wocStore.skins.ashspark_dagger.look',
    lore: 'hudChrome.wocStore.skins.ashspark_dagger.lore',
  },
  forgeheart_staff: {
    name: 'hudChrome.wocStore.skins.forgeheart_staff.name',
    look: 'hudChrome.wocStore.skins.forgeheart_staff.look',
    lore: 'hudChrome.wocStore.skins.forgeheart_staff.lore',
  },
  emberwrought_wand: {
    name: 'hudChrome.wocStore.skins.emberwrought_wand.name',
    look: 'hudChrome.wocStore.skins.emberwrought_wand.look',
    lore: 'hudChrome.wocStore.skins.emberwrought_wand.lore',
  },
  cinderlatch_crossbow: {
    name: 'hudChrome.wocStore.skins.cinderlatch_crossbow.name',
    look: 'hudChrome.wocStore.skins.cinderlatch_crossbow.look',
    lore: 'hudChrome.wocStore.skins.cinderlatch_crossbow.lore',
  },
  ice_fang_sword: {
    name: 'hudChrome.wocStore.skins.ice_fang_sword.name',
    look: 'hudChrome.wocStore.skins.ice_fang_sword.look',
    lore: 'hudChrome.wocStore.skins.ice_fang_sword.lore',
  },
  glaciersplit_axe: {
    name: 'hudChrome.wocStore.skins.glaciersplit_axe.name',
    look: 'hudChrome.wocStore.skins.glaciersplit_axe.look',
    lore: 'hudChrome.wocStore.skins.glaciersplit_axe.lore',
  },
  rimecrusher_mace: {
    name: 'hudChrome.wocStore.skins.rimecrusher_mace.name',
    look: 'hudChrome.wocStore.skins.rimecrusher_mace.look',
    lore: 'hudChrome.wocStore.skins.rimecrusher_mace.lore',
  },
  frostbite_dagger: {
    name: 'hudChrome.wocStore.skins.frostbite_dagger.name',
    look: 'hudChrome.wocStore.skins.frostbite_dagger.look',
    lore: 'hudChrome.wocStore.skins.frostbite_dagger.lore',
  },
  hoarfrost_vigil_staff: {
    name: 'hudChrome.wocStore.skins.hoarfrost_vigil_staff.name',
    look: 'hudChrome.wocStore.skins.hoarfrost_vigil_staff.look',
    lore: 'hudChrome.wocStore.skins.hoarfrost_vigil_staff.lore',
  },
  everwinter_wand: {
    name: 'hudChrome.wocStore.skins.everwinter_wand.name',
    look: 'hudChrome.wocStore.skins.everwinter_wand.look',
    lore: 'hudChrome.wocStore.skins.everwinter_wand.lore',
  },
  winterbite: {
    name: 'hudChrome.wocStore.skins.winterbite.name',
    look: 'hudChrome.wocStore.skins.winterbite.look',
    lore: 'hudChrome.wocStore.skins.winterbite.lore',
  },
  solheim_sword: {
    name: 'hudChrome.wocStore.skins.solheim_sword.name',
    look: 'hudChrome.wocStore.skins.solheim_sword.look',
    lore: 'hudChrome.wocStore.skins.solheim_sword.lore',
  },
  skyrender_axe: {
    name: 'hudChrome.wocStore.skins.skyrender_axe.name',
    look: 'hudChrome.wocStore.skins.skyrender_axe.look',
    lore: 'hudChrome.wocStore.skins.skyrender_axe.lore',
  },
  starfall_mace: {
    name: 'hudChrome.wocStore.skins.starfall_mace.name',
    look: 'hudChrome.wocStore.skins.starfall_mace.look',
    lore: 'hudChrome.wocStore.skins.starfall_mace.lore',
  },
  astravyr_dagger: {
    name: 'hudChrome.wocStore.skins.astravyr_dagger.name',
    look: 'hudChrome.wocStore.skins.astravyr_dagger.look',
    lore: 'hudChrome.wocStore.skins.astravyr_dagger.lore',
  },
  cosmarch_staff: {
    name: 'hudChrome.wocStore.skins.cosmarch_staff.name',
    look: 'hudChrome.wocStore.skins.cosmarch_staff.look',
    lore: 'hudChrome.wocStore.skins.cosmarch_staff.lore',
  },
  emberwish_wand: {
    name: 'hudChrome.wocStore.skins.emberwish_wand.name',
    look: 'hudChrome.wocStore.skins.emberwish_wand.look',
    lore: 'hudChrome.wocStore.skins.emberwish_wand.lore',
  },
  encore_bow: {
    name: 'hudChrome.wocStore.skins.encore_bow.name',
    look: 'hudChrome.wocStore.skins.encore_bow.look',
    lore: 'hudChrome.wocStore.skins.encore_bow.lore',
  },
  meteorlatch_crossbow: {
    name: 'hudChrome.wocStore.skins.meteorlatch_crossbow.name',
    look: 'hudChrome.wocStore.skins.meteorlatch_crossbow.look',
    lore: 'hudChrome.wocStore.skins.meteorlatch_crossbow.lore',
  },
} satisfies Record<string, { name: TranslationKey; look: TranslationKey; lore: TranslationKey }>;

function isArmorySkinId(id: string): id is keyof typeof ARMORY_SKIN_KEYS {
  return id in ARMORY_SKIN_KEYS;
}

/** Resolve every authored Armory field through the runtime locale table. */
export function localizeWeaponSkin(skin: WeaponSkinDef): LocalizedWeaponSkin {
  if (!isArmorySkinId(skin.id)) throw new Error(`Unknown Armory skin: ${skin.id}`);
  const keys = ARMORY_SKIN_KEYS[skin.id];
  return {
    name: t(keys.name),
    collection: weaponSkinCollectionLabel(skin.collection),
    look: t(keys.look),
    lore: t(keys.lore),
  };
}
