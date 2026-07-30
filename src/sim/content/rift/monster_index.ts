// Searchable metadata index for every creature the Rift generator may use.
// Combat still resolves through the static MOBS table: the index is selection
// metadata, never an avenue for unvalidated runtime MobTemplate code.

import type { MobTemplate } from '../../types';
import { RIFT_MOBS } from './mobs';

export type RiftMonsterRole =
  | 'minion'
  | 'bruiser'
  | 'tank'
  | 'skirmisher'
  | 'caster'
  | 'controller'
  | 'support'
  | 'boss';
export type RiftMonsterRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface RiftMonsterIndexEntry {
  id: string;
  templateId: string;
  name: string;
  family: MobTemplate['family'];
  role: RiftMonsterRole;
  rarity: RiftMonsterRarity;
  themes: readonly string[];
  biomes: readonly string[];
  abilities: readonly string[];
  lore: string;
  stats: {
    hpBase: number;
    hpPerLevel: number;
    damageBase: number;
    damagePerLevel: number;
    armorPerLevel: number;
    attackSpeed: number;
    moveSpeed: number;
  };
}

const THEME_ROSTERS: Readonly<Record<string, readonly string[]>> = {
  frost: ['rift_frost_revenant', 'rift_rime_elemental', 'rift_boss_frost'],
  ember: ['rift_ember_fiend', 'rift_magma_brute', 'rift_boss_ember'],
  venom: ['rift_venom_weaver', 'rift_thornback', 'rift_boss_venom'],
  bone: ['rift_boneclad', 'rift_marrow_troll', 'rift_boss_necro', 'rift_bonewalker'],
  brute: ['rift_stone_ogre', 'rift_marrow_troll', 'rift_boss_brute'],
  void: ['rift_void_acolyte', 'rift_dread_stalker', 'rift_boss_arcane', 'rift_spawnling'],
  storm: ['rift_storm_caller', 'rift_stormscale', 'rift_boss_storm'],
  tide: ['rift_tide_thrall', 'rift_deep_lurker', 'rift_boss_tide'],
  infernal_citadel: [
    'rift_hellguard',
    'rift_pact_acolyte',
    'rift_boss_ritualist',
    'rift_boss_pitlord',
    'rift_spawnling',
  ],
};

const THEME_BIOMES: Readonly<Record<string, readonly string[]>> = {
  frost: ['frost', 'gale'],
  ember: ['ember', 'amber'],
  venom: ['fen', 'jungle', 'garden'],
  bone: ['haunt', 'night', 'dusk'],
  brute: ['ember', 'gale', 'amber'],
  void: ['night', 'dusk', 'haunt'],
  storm: ['gale', 'frost'],
  tide: ['jungle', 'fen', 'vale'],
  infernal_citadel: ['ember', 'night', 'dusk'],
};

const ABILITY_KEYS = [
  'aoePulse',
  'bigCast',
  'summonAdds',
  'enrage',
  'desperateHeal',
  'rampage',
  'chillOnHit',
  'frostbite',
  'cinder',
  'smolder',
  'venom',
  'ensnare',
  'bleed',
  'frenzyOnHit',
  'cleave',
  'manaBurn',
  'arcaneRot',
  'soulrot',
  'stomp',
  'knockback',
] as const;

function roleFor(template: MobTemplate): RiftMonsterRole {
  const mob = template as MobTemplate & Record<string, unknown>;
  if (template.boss) return 'boss';
  if (!template.elite) return 'minion';
  if (mob.desperateHeal) return 'support';
  if (mob.bigCast || mob.manaBurn || mob.arcaneRot || mob.soulrot) return 'caster';
  if (mob.ensnare || mob.chillOnHit || mob.knockback) return 'controller';
  if (template.armorPerLevel >= 20 || template.hpPerLevel >= 22) return 'tank';
  if (template.moveSpeed >= 8) return 'skirmisher';
  return 'bruiser';
}

function rarityFor(template: MobTemplate): RiftMonsterRarity {
  if (template.boss) return 'legendary';
  if (template.rare) return 'epic';
  if (template.elite) return 'rare';
  return 'common';
}

function abilitiesFor(template: MobTemplate): string[] {
  const mob = template as MobTemplate & Record<string, unknown>;
  return ABILITY_KEYS.filter((key) => mob[key] !== undefined);
}

function themesFor(templateId: string): string[] {
  return Object.entries(THEME_ROSTERS)
    .filter(([, ids]) => ids.includes(templateId))
    .map(([theme]) => theme);
}

function makeEntry(template: MobTemplate): RiftMonsterIndexEntry {
  const themes = themesFor(template.id);
  const biomes = [...new Set(themes.flatMap((theme) => THEME_BIOMES[theme] ?? []))];
  const role = roleFor(template);
  return {
    id: template.id,
    templateId: template.id,
    name: template.name,
    family: template.family,
    role,
    rarity: rarityFor(template),
    themes,
    biomes,
    abilities: abilitiesFor(template),
    lore: `${template.name} is a ${role} shaped by unstable Rift energy, drawn from the ${template.family} lineage.`,
    stats: {
      hpBase: template.hpBase,
      hpPerLevel: template.hpPerLevel,
      damageBase: template.dmgBase,
      damagePerLevel: template.dmgPerLevel,
      armorPerLevel: template.armorPerLevel,
      attackSpeed: template.attackSpeed,
      moveSpeed: template.moveSpeed,
    },
  };
}

export const RIFT_MONSTER_INDEX: readonly RiftMonsterIndexEntry[] = Object.values(RIFT_MOBS)
  .map(makeEntry)
  .sort((a, b) => a.id.localeCompare(b.id));

export const RIFT_MONSTER_BY_ID: Readonly<Record<string, RiftMonsterIndexEntry>> =
  Object.fromEntries(RIFT_MONSTER_INDEX.map((entry) => [entry.id, entry]));

export interface RiftMonsterQuery {
  themeId?: string;
  biome?: string;
  role?: RiftMonsterRole;
  rarity?: RiftMonsterRarity;
  bosses?: boolean;
}

export function queryRiftMonsters(query: RiftMonsterQuery): RiftMonsterIndexEntry[] {
  return RIFT_MONSTER_INDEX.filter((entry) => {
    if (query.themeId && !entry.themes.includes(query.themeId)) return false;
    if (query.biome && !entry.biomes.includes(query.biome)) return false;
    if (query.role && entry.role !== query.role) return false;
    if (query.rarity && entry.rarity !== query.rarity) return false;
    if (query.bosses !== undefined && (entry.role === 'boss') !== query.bosses) return false;
    return true;
  });
}

export function riftMonsterCompatible(templateId: string, themeId: string): boolean {
  return RIFT_MONSTER_BY_ID[templateId]?.themes.includes(themeId) ?? false;
}
