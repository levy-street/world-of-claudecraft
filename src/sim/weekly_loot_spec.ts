import { SEASON2_SETS } from './content/pvp_honor_season2';
import { TALENTS } from './content/talents';
import { type TrinketUse, trinketSpec } from './content/trinkets';
import { occupiesHand } from './equipment_rules';
import type { ItemDef, PlayerClass } from './types';

type LootRole = 'physical' | 'caster' | 'healer' | 'tank' | 'utility';
interface LootProfile {
  roles: readonly LootRole[];
  sets: readonly string[];
  weapons?: 'onehand' | 'twohand';
  /** Holy/melee hybrids can use physical gear carrying additional spell stats. */
  mixedSpellStats?: true;
}

// Production loot policy, independent of equipped talents and developer-kit scores.
// Feral contains both Cat and Bruin; Warspirit contains the Stonebound tank build.
export const WEEKLY_LOOT_PROFILES: Readonly<
  Record<PlayerClass, Readonly<Record<string, LootProfile>>>
> = {
  warrior: {
    arms: { roles: ['physical'], sets: ['slagbreaker'], weapons: 'twohand' },
    fury: { roles: ['physical'], sets: ['emberfury'] },
    prot: { roles: ['tank'], sets: ['forgewall'], weapons: 'onehand' },
  },
  paladin: {
    holy: { roles: ['healer'], sets: ['dawnforged'] },
    protection: { roles: ['tank'], sets: ['oathpyre'], weapons: 'onehand', mixedSpellStats: true },
    retribution: { roles: ['physical'], sets: ['zealfire'], mixedSpellStats: true },
  },
  hunter: {
    beast_mastery: { roles: ['physical'], sets: ['packlord_emberhide'] },
    marksmanship: { roles: ['physical'], sets: ['coldsight_trackers'] },
    survival: { roles: ['physical'], sets: ['slagsnare'] },
  },
  rogue: {
    assassination: { roles: ['physical'], sets: ['cinderfang'], weapons: 'onehand' },
    combat: { roles: ['physical'], sets: ['smolderstrike'], weapons: 'onehand' },
    subtlety: { roles: ['physical'], sets: ['ashveil'], weapons: 'onehand' },
  },
  priest: {
    discipline: { roles: ['healer'], sets: ['emberscreed'] },
    holy: { roles: ['healer'], sets: ['benison_dawnweave'] },
    shadow: { roles: ['caster'], sets: ['vesperash'] },
  },
  shaman: {
    elemental: { roles: ['caster'], sets: ['stormkindled'] },
    enhancement: {
      roles: ['physical', 'tank'],
      sets: ['warspirit_emberscale', 'stonehearth'],
      mixedSpellStats: true,
    },
    restoration: { roles: ['healer'], sets: ['springmender'] },
  },
  mage: {
    arcane: { roles: ['healer'], sets: ['chronoweave'] },
    fire: { roles: ['caster'], sets: ['pyroclast'] },
    frost: { roles: ['caster'], sets: ['frostquench'] },
  },
  warlock: {
    affliction: { roles: ['caster'], sets: ['hexthread'] },
    demonology: { roles: ['caster'], sets: ['gravebrand'] },
    destruction: { roles: ['caster'], sets: ['ruincaller'] },
  },
  druid: {
    balance: { roles: ['caster'], sets: ['moonscorch'] },
    feral: { roles: ['physical', 'tank'], sets: ['wildfang_emberhide', 'cinderbark'] },
    restoration: { roles: ['healer'], sets: ['grovespring'] },
  },
};

// Fixed production content, indexed once so filtering each candidate is constant
// work. This contains no character state or dynamically supplied world tables.
const SET_OWNERS: ReadonlyMap<string, { cls: string; spec: string }> = (() => {
  const owners = new Map<string, { cls: string; spec: string }>();
  for (const [cls, profiles] of Object.entries(WEEKLY_LOOT_PROFILES)) {
    for (const [spec, profile] of Object.entries(profiles)) {
      for (const set of profile.sets) owners.set(set, { cls, spec });
    }
  }
  for (const set of SEASON2_SETS) owners.set(set.setId, { cls: set.cls, spec: set.spec });
  return owners;
})();

// These authored role differences are not recoverable from primary stats: both
// tank and damage pieces carry Strength/Agility, Stamina, and offensive ratings.
export const WEEKLY_LOOT_ITEM_ROLES: Readonly<Record<string, LootRole>> = {
  cinderbark_cinch: 'tank',
  ashenbark_treads: 'tank',
  forgewall_girdle: 'tank',
  anvilstance_sabatons: 'tank',
  pendant_of_the_first_tempering: 'tank',
  seal_of_the_forgewall: 'tank',
  anvilguard_blade: 'tank',
  bulwark_of_the_inner_crucible: 'tank',
  slagstalker_belt: 'physical',
  ashrunner_boots: 'physical',
  warforged_waistguard: 'physical',
  furnace_march_greaves: 'physical',
  ignivars_ember_choker: 'physical',
  band_of_marked_strikes: 'physical',
  forgefathers_warhammer: 'physical',
  cinderfang_kris: 'physical',
  slagrender_cleaver: 'physical',
  heart_of_the_end_greatblade: 'physical',
};

// Exhaustive over the actual effect vocabulary: a new effect requires a policy.
// Echo can repeat heals. Spell-damage procs do not support a healing focus.
const TRINKET_ROLES: Record<TrinketUse['kind'], readonly LootRole[]> = {
  retaliate: ['tank'],
  anchor: ['tank'],
  hourglass: ['healer'],
  wellspring: ['healer'],
  bleedEdge: ['physical'],
  tallyStrike: ['physical'],
  stormjar: ['caster'],
  echo: ['caster', 'healer'],
  gamble: ['utility'],
  blink: ['utility'],
  sprint: ['utility'],
  defiance: ['utility'],
  brand: ['utility'],
  temper: ['physical'],
  kindlingOrb: ['caster'],
  pierce: ['physical'],
  lantern: ['healer'],
  heartNova: ['tank'],
};

const KNOWN_SPEC_IDS: ReadonlySet<string> = new Set(
  Object.values(TALENTS).flatMap((tree) => tree.specs.map((spec) => spec.id)),
);

/** Save-boundary allowlist; repeated spec ids such as holy are class-checked later. */
export function sanitizeWeeklyLootSpec(raw: unknown): string | undefined {
  return typeof raw === 'string' && KNOWN_SPEC_IDS.has(raw) ? raw : undefined;
}

export function weeklyLootSpecForClass(cls: PlayerClass, raw: unknown): string | undefined {
  return typeof raw === 'string' && TALENTS[cls].specs.some((s) => s.id === raw) ? raw : undefined;
}

function statsFit(profile: LootProfile, item: ItemDef): boolean {
  const physical = (item.stats?.str ?? 0) > 0 || (item.stats?.agi ?? 0) > 0;
  const spell = (item.stats?.int ?? 0) > 0 || (item.spellPower ?? 0) > 0;
  const healing = (item.healPower ?? 0) > 0;
  if (profile.roles.includes('healer')) return !physical;
  if (profile.roles.includes('caster')) return !physical && !healing;
  if (healing) return false;
  // Ordinary leveling items with neutral stats remain shared. For Holy/melee
  // hybrids, mixed physical/spell gear is useful, pure caster gear is not.
  return !spell || (profile.mixedSpellStats === true && physical);
}

/** Additional focus restriction. Callers must also apply weeklyRewardFitsClass. */
export function weeklyLootSpecFitsItem(
  cls: PlayerClass,
  spec: string | undefined,
  item: ItemDef,
): boolean {
  if (spec === undefined) return true;
  if (weeklyLootSpecForClass(cls, spec) !== spec) return false;
  const profile = WEEKLY_LOOT_PROFILES[cls][spec];
  if (!profile) return false;

  if (item.kind === 'weapon') {
    if (profile.weapons === 'onehand' && item.hand === 'twohand') return false;
    if (profile.weapons === 'twohand' && item.hand !== 'twohand') return false;
  }
  if (item.slot === 'offhand' && occupiesHand(item)) {
    const shield = item.kind === 'armor' && 'shield' in item && item.shield;
    if (profile.roles.length === 1 && profile.roles[0] === 'tank' && !shield) return false;
    if (profile.roles.includes('physical') && !profile.roles.includes('tank')) return false;
    if (profile.roles.includes('tank') && !shield) return false;
  }

  if (item.set) {
    const owner = SET_OWNERS.get(item.set);
    if (owner) return owner.cls === cls && owner.spec === spec;
  }

  const baseId = item.heroicOf ?? item.id;
  const role = WEEKLY_LOOT_ITEM_ROLES[baseId];
  if (role && !profile.roles.includes(role)) return false;
  if (item.slot === 'trinket') {
    const effect = trinketSpec(baseId);
    // Unknown trinket mechanics need classification before entering focused loot.
    if (!effect) return false;
    const roles = TRINKET_ROLES[effect.use.kind];
    if (!roles.includes('utility') && !roles.some((r) => profile.roles.includes(r))) return false;
  }
  return statsFit(profile, item);
}
