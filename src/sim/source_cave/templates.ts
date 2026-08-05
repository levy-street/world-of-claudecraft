// Source Cave mob templates: one in-memory MobTemplate per contributor. These are
// NEVER added to the flat MOBS table (they are per-Sim, roster-derived); the cave
// claim path hands them straight to createMob, mirroring how spawnDelveModule uses
// a resolved template. The contributor login stays anchored in the synthetic
// template id; Entity.name is a customizable display name.

import type { MobTemplate } from '../types';
import { sourceCaveMobCustomAttributesForLogin } from './custom_attributes';
import { sourceCaveMobProfileForMergedPrs, sourceCaveMobProfileForTier } from './tier_profiles';
import type { SourceCaveMobSpec } from './types';

// Tier-identity mainhand weapons (render-only via wire `mh`; the sim never
// reads the held item for gameplay). Architects all carry the Commit Blade;
// runesmiths split between the Bug Squasher and the Keystroke by a hash of
// their login, so a given contributor always carries the same weapon on every
// host and seed. The runesmith split also re-paces the swing (same dps, hammer
// slow and heavy, keyboard fast and light) via the weapon's own speed below.
const ARCHITECT_WEAPON_ID = 'commit_blade';
const RUNESMITH_WEAPONS = [
  { itemId: 'bug_squasher', attackSpeed: 2.6 },
  { itemId: 'mech_keyboard', attackSpeed: 2.2 },
] as const;

/** FNV-1a over the login: a stable, host-agnostic bucket (no rng draw). */
function loginHash(login: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < login.length; i++) {
    h ^= login.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Tier combat affixes (the second half of the raid difficulty pass): each rung
// past the swarm tiers earns one mob-swing mechanic, resolved through
// mob/mob_template.ts's mobTemplateOf so the cascade sees these synthetic
// templates. Values are cited from same-formula carriers, never invented:
// bleed copies ridge_stalker's Rending Claws (zone3.ts), arcaneRot copies the
// Profane Rune carrier (zone2.ts:542), cleave copies Reaping Arc
// (dungeons.ts:221), rampage copies Mounting Rage (zone3.ts:328), and the boss
// enrage copies zone3.ts:717's 0.25/1.45/1.25 curve. The two DoT names are
// registered in src/ui/sim_i18n.ts (AURA_NAME_KEY); cleave/rampage names ride
// the combat log unregistered, exactly like their cited carriers.
const ARTIFICER_BLEED = {
  chance: 0.25,
  perTick: 5,
  interval: 3,
  duration: 9,
  name: 'Merge Conflict',
  school: 'physical',
} as const;
// perTick scaled down from the cited 7 for density (six simultaneous
// carriers where the citation pulls solo), same reasoning as the cleave.
const RUNESMITH_ARCANE_ROT = {
  chance: 0.3,
  perTick: 5,
  interval: 3,
  duration: 12,
  name: 'Tech Debt',
  school: 'arcane',
} as const;
// Cited from Reaping Arc (radius 8, mult 0.6) then scaled DOWN for density:
// the citation's carrier pulls solo or in pairs, while the pre-cap architect
// playtest fielded six cleavers and measured the cited numbers
// zone-killing the melee stack (~310 raw splash dps) even for a spread raid.
const ARCHITECT_CLEAVE = { radius: 6, mult: 0.45, name: 'Sweeping Refactor' } as const;
const WORLDWRIGHT_RAMPAGE = {
  ap: 20,
  maxStacks: 5,
  duration: 10,
  name: 'Feature Creep',
  school: 'physical',
} as const;
const BOSS_ENRAGE = { belowHpPct: 0.25, dmgMult: 1.45, hasteMult: 1.25 } as const;

/** The rung's swing mechanic (plus the boss's enrage), keyed like the weapons. */
function tierAffixOverrides(
  tierKey: string,
  boss: boolean,
  attackSpeed: number,
): Partial<Pick<MobTemplate, 'bleed' | 'arcaneRot' | 'cleave' | 'rampage' | 'enrage'>> {
  const out: Partial<Pick<MobTemplate, 'bleed' | 'arcaneRot' | 'cleave' | 'rampage' | 'enrage'>> =
    {};
  if (tierKey === 'artificer') out.bleed = ARTIFICER_BLEED;
  else if (tierKey === 'runesmith') {
    // Weapon visuals may swing at 2.2 or 2.6 by login. Normalize the per-swing
    // proc to elapsed time so identity rotation cannot change Tech Debt pressure.
    out.arcaneRot = {
      ...RUNESMITH_ARCANE_ROT,
      chance: RUNESMITH_ARCANE_ROT.chance * (attackSpeed / SOURCE_CAVE_ARCHETYPE.attackSpeed),
    };
  } else if (tierKey === 'architect') out.cleave = ARCHITECT_CLEAVE;
  else if (tierKey === 'worldwright') out.rampage = WORLDWRIGHT_RAMPAGE;
  if (boss) out.enrage = BOSS_ENRAGE;
  return out;
}

export interface SourceCaveTierWeapon {
  itemId: string;
  attackSpeed: number;
}

/**
 * The held weapon a tier assigns to a login, or null for the unarmed rungs.
 * Exported so tests (and any display surface) share the assignment instead of
 * re-deriving the hash split.
 */
export function sourceCaveTierWeaponForLogin(
  tierKey: string,
  login: string,
): SourceCaveTierWeapon | null {
  if (tierKey === 'architect') {
    return { itemId: ARCHITECT_WEAPON_ID, attackSpeed: SOURCE_CAVE_ARCHETYPE.attackSpeed };
  }
  if (tierKey !== 'runesmith') return null;
  return RUNESMITH_WEAPONS[loginHash(login) % RUNESMITH_WEAPONS.length];
}

// Base stat block copied verbatim from Gravewyrm Sanctum's level-19 elite archetype
// (src/sim/content/dungeons.ts sanctum_boneguard: the same level band Phase 1's spec
// derives from). Contributor tier profiles apply the per-mob multipliers and
// visual identity on top of this shared archetype. Family is 'humanoid'
// (contributors are people, not the skeletons the numbers came from). Mobs drop
// no loot of their own (loot: []); the cave's reward is entirely the Phase 4
// chest (source_cave/loot.ts).
const SOURCE_CAVE_ARCHETYPE = {
  family: 'humanoid',
  hpBase: 64,
  hpPerLevel: 23,
  dmgBase: 12,
  dmgPerLevel: 2.7,
  attackSpeed: 2.3,
  armorPerLevel: 22,
  moveSpeed: 6.5,
  aggroRadius: 12,
  scale: 1.15,
  color: 0xcfc8b0,
} as const;

/**
 * The tier's held weapon and, for runesmiths, the re-paced swing. Re-pacing
 * keeps dps constant: dmgBase/dmgPerLevel scale by (speed / archetype speed),
 * so the hammer lands slower, heavier hits and the keyboard faster, lighter
 * ones under the same tier dmgMult.
 */
function tierWeaponOverrides(
  tierKey: string,
  login: string,
): Partial<Pick<MobTemplate, 'mainhandItemId' | 'attackSpeed' | 'dmgBase' | 'dmgPerLevel'>> {
  const weapon = sourceCaveTierWeaponForLogin(tierKey, login);
  if (!weapon) return {};
  const pace = weapon.attackSpeed / SOURCE_CAVE_ARCHETYPE.attackSpeed;
  return {
    mainhandItemId: weapon.itemId,
    attackSpeed: weapon.attackSpeed,
    dmgBase: SOURCE_CAVE_ARCHETYPE.dmgBase * pace,
    dmgPerLevel: SOURCE_CAVE_ARCHETYPE.dmgPerLevel * pace,
  };
}

/** Synthesize the runtime template for one placed contributor mob. */
export function sourceCaveMobTemplate(mob: SourceCaveMobSpec): MobTemplate {
  const combatProfile = mob.combatTier
    ? sourceCaveMobProfileForTier(mob.combatTier, mob.boss)
    : sourceCaveMobProfileForMergedPrs(mob.mergedPrs, mob.boss);
  const identityProfile = sourceCaveMobProfileForMergedPrs(mob.mergedPrs, mob.boss);
  const { mainhandItemId: _combatMainhand, ...combatWeaponOverrides } = tierWeaponOverrides(
    combatProfile.key,
    mob.login,
  );
  const identityWeapon = sourceCaveTierWeaponForLogin(identityProfile.key, mob.login);
  const attackSpeed = combatWeaponOverrides.attackSpeed ?? SOURCE_CAVE_ARCHETYPE.attackSpeed;
  const custom = sourceCaveMobCustomAttributesForLogin(mob.login);
  return {
    ...SOURCE_CAVE_ARCHETYPE,
    id: `source_cave_${mob.login}`,
    name: mob.login,
    minLevel: mob.level,
    maxLevel: mob.level,
    elite: mob.elite,
    boss: mob.boss,
    hpMult: combatProfile.hpMult,
    dmgMult: combatProfile.dmgMult,
    scale: combatProfile.scale,
    loot: [],
    ...(identityProfile.visualKey ? { visualKey: identityProfile.visualKey } : {}),
    ...(identityProfile.color !== undefined ? { color: identityProfile.color } : {}),
    ...(identityWeapon
      ? { mainhandItemId: identityWeapon.itemId }
      : identityProfile.mainhandItemId
        ? { mainhandItemId: identityProfile.mainhandItemId }
        : {}),
    ...combatWeaponOverrides,
    ...tierAffixOverrides(combatProfile.key, mob.boss, attackSpeed),
    ...(custom ?? {}),
  };
}
