import type { SfxId } from '../game/sfx_manifest.generated';
import { ABILITIES, MOBS } from '../sim/data';
import type { Aura, Entity, SimEvent } from '../sim/types';
import { isAuraDebuff } from './auras_view';

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;
type SpellFxEvent = Extract<SimEvent, { type: 'spellfx' }>;
type AuraEvent = Extract<SimEvent, { type: 'aura' }>;
type MagicSchool = 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
export type MobVoiceAction = 'aggro' | 'attack' | 'death' | 'hurt' | 'idle';

const SCHOOL_CUES = {
  fire: { cast: 'cast_fire', projectile: 'proj_fire', impact: 'impact_fire' },
  frost: { cast: 'cast_frost', projectile: 'proj_frost', impact: 'impact_frost' },
  arcane: { cast: 'cast_arcane', projectile: 'proj_arcane', impact: 'impact_arcane' },
  shadow: { cast: 'cast_shadow', projectile: 'proj_shadow', impact: 'impact_shadow' },
  holy: { cast: 'cast_holy', projectile: 'proj_holy', impact: 'impact_holy' },
  nature: { cast: 'cast_nature', projectile: 'proj_nature', impact: 'impact_nature' },
} as const satisfies Record<MagicSchool, { cast: SfxId; projectile: SfxId; impact: SfxId }>;

// Wand auto-attack cues: distinct from a real spell cast's SCHOOL_CUES
// projectile so a passive auto-attack doesn't sound identical to an actual
// cast. Only the three wand-equipped classes (mage/arcane, priest/holy,
// warlock/shadow, see classes.ts ranged.wand) have a dedicated cue; any other
// school reaching here (should not happen) falls back to the real spell cue.
const WAND_CUES: Partial<Record<MagicSchool, SfxId>> = {
  arcane: 'wand_arcane',
  holy: 'wand_holy',
  shadow: 'wand_shadow',
};

// Exported (read-only, `as const`) purely so a test can pin its key set
// against SFX_MOB_EXTENSION_FAMILIES: a family added to one and forgotten in
// the other currently resolves at runtime to a key with no clip, which plays
// nothing and throws nowhere.
export const MOB_VOICE_CUES = {
  beast: {
    aggro: 'mob_beast_aggro',
    attack: 'mob_beast_attack',
    death: 'mob_beast_death',
    hurt: 'mob_beast_hurt',
    idle: 'mob_beast_idle',
  },
  boar: {
    aggro: 'mob_boar_aggro',
    attack: 'mob_boar_attack',
    death: 'mob_boar_death',
    hurt: 'mob_boar_hurt',
    idle: 'mob_boar_idle',
  },
  spider: {
    aggro: 'mob_spider_aggro',
    attack: 'mob_spider_attack',
    death: 'mob_spider_death',
    hurt: 'mob_spider_hurt',
    idle: 'mob_spider_idle',
  },
  mudfin: {
    aggro: 'mob_mudfin_aggro',
    attack: 'mob_mudfin_attack',
    death: 'mob_mudfin_death',
    hurt: 'mob_mudfin_hurt',
    idle: 'mob_mudfin_idle',
  },
  burrower: {
    aggro: 'mob_burrower_aggro',
    attack: 'mob_burrower_attack',
    death: 'mob_burrower_death',
    hurt: 'mob_burrower_hurt',
    idle: 'mob_burrower_idle',
  },
  humanoid: {
    aggro: 'mob_humanoid_aggro',
    attack: 'mob_humanoid_attack',
    death: 'mob_humanoid_death',
    hurt: 'mob_humanoid_hurt',
    idle: 'mob_humanoid_idle',
  },
  undead: {
    aggro: 'mob_undead_aggro',
    attack: 'mob_undead_attack',
    death: 'mob_undead_death',
    hurt: 'mob_undead_hurt',
    idle: 'mob_undead_idle',
  },
  troll: {
    aggro: 'mob_troll_aggro',
    attack: 'mob_troll_attack',
    death: 'mob_troll_death',
    hurt: 'mob_troll_hurt',
    idle: 'mob_troll_idle',
  },
  ogre: {
    aggro: 'mob_ogre_aggro',
    attack: 'mob_ogre_attack',
    death: 'mob_ogre_death',
    hurt: 'mob_ogre_hurt',
    idle: 'mob_ogre_idle',
  },
  elemental: {
    aggro: 'mob_elemental_aggro',
    attack: 'mob_elemental_attack',
    death: 'mob_elemental_death',
    hurt: 'mob_elemental_hurt',
    idle: 'mob_elemental_idle',
  },
  dragonkin: {
    aggro: 'mob_dragonkin_aggro',
    attack: 'mob_dragonkin_attack',
    death: 'mob_dragonkin_death',
    hurt: 'mob_dragonkin_hurt',
    idle: 'mob_dragonkin_idle',
  },
  demon: {
    aggro: 'mob_demon_aggro',
    attack: 'mob_demon_attack',
    death: 'mob_demon_death',
    hurt: 'mob_demon_hurt',
    idle: 'mob_demon_idle',
  },
  // deepfen_spearjaw (The Drowned Litany delve) is the family's first mob:
  // a velociraptor model, retagged from its former 'beast' mistag.
  reptile: {
    aggro: 'mob_reptile_aggro',
    attack: 'mob_reptile_attack',
    death: 'mob_reptile_death',
    hurt: 'mob_reptile_hurt',
    idle: 'mob_reptile_idle',
  },
} as const satisfies Record<string, Record<MobVoiceAction, SfxId>>;

type MobVoiceFamily = keyof typeof MOB_VOICE_CUES | 'water_elemental';
const NO_CUE = (): boolean => false;

// Templates that should share one recorded subfamily voice instead of each
// needing its own separate take, e.g. every wolf-shaped beast. Maps a
// templateId to the shared subfamily name used when building the specific
// cue in mobVoiceCue. A templateId not listed here keys off its own id.
const SUBFAMILY_ALIAS: Record<string, string> = {
  forest_wolf: 'wolf',
  ridge_stalker: 'wolf',
  mire_prowler: 'wolf',
  old_greyjaw: 'wolf',
};

function magicSchool(value: string | null | undefined): MagicSchool | null {
  return value && value in SCHOOL_CUES ? (value as MagicSchool) : null;
}

export function castCueForAbility(ability: string): SfxId | null {
  if (ability === 'lightning_bolt') return 'cast_lightning_bolt';
  const school = magicSchool(ABILITIES[ability]?.school);
  return school ? SCHOOL_CUES[school].cast : null;
}

export function materialImpactCue(target: Entity): SfxId {
  if (target.kind === 'player') {
    return target.templateId === 'warrior' || target.templateId === 'paladin'
      ? 'impact_metal'
      : 'impact_leather';
  }
  if (target.kind === 'mob' && MOBS[target.templateId]?.family === 'undead') return 'impact_bone';
  return 'impact_flesh';
}

export function impactCueForDamage(event: DamageEvent, target: Entity): SfxId | null {
  if (!event.school || event.school === 'physical') return materialImpactCue(target);
  const school = magicSchool(event.school);
  return school ? SCHOOL_CUES[school].impact : null;
}

export function spellFxCue(event: SpellFxEvent): { key: SfxId; anchorId: number } | null {
  if (event.fx === 'projectile') {
    if (event.school === 'physical') return { key: 'melee_bow', anchorId: event.sourceId };
    const school = magicSchool(event.school);
    if (!school) return null;
    const key = event.wand
      ? (WAND_CUES[school] ?? SCHOOL_CUES[school].projectile)
      : SCHOOL_CUES[school].projectile;
    return { key, anchorId: event.sourceId };
  }
  if (event.fx === 'nova') return { key: 'spell_nova', anchorId: event.targetId };
  return null;
}

export function auraApplyCue(event: AuraEvent, aura: Aura | null): SfxId | null {
  if (!event.gained || !aura) return null;
  return isAuraDebuff(aura) ? 'debuff_apply' : 'buff_apply';
}

export function weaponSwingCue(entity: Entity): SfxId {
  if (entity.auras.some((aura) => aura.kind === 'form_bear' || aura.kind === 'form_cat')) {
    return 'melee_unarmed';
  }
  switch (entity.templateId) {
    case 'rogue':
    case 'warlock':
      return 'melee_swing_light';
    case 'hunter':
      return 'melee_bow';
    case 'paladin':
    case 'mage':
    case 'priest':
    case 'druid':
      return 'melee_swing_heavy';
    default:
      return 'melee_swing_blade';
  }
}

export function playerSwingCueForDamage(event: DamageEvent, source: Entity | null): SfxId | null {
  if (
    source?.kind !== 'player' ||
    (event.school && event.school !== 'physical') ||
    event.ability === 'Auto Shot'
  ) {
    return null;
  }
  return weaponSwingCue(source);
}

export function mobVoiceFamily(templateId: string): MobVoiceFamily | null {
  if (templateId === 'water_elemental') return 'water_elemental';
  if (templateId === 'wild_boar' || templateId === 'elder_bristleback') return 'boar';
  const family = MOBS[templateId]?.family;
  return family && family in MOB_VOICE_CUES ? (family as MobVoiceFamily) : null;
}

export function mobVoiceCue(
  templateId: string,
  action: MobVoiceAction,
  hasCue: (key: string) => boolean = NO_CUE,
): string | null {
  const family = mobVoiceFamily(templateId);
  if (!family) return null;
  if (family === 'water_elemental') {
    // An owned summon: never an idle-bark candidate, and no idle buffer is
    // staged for it, so the idle sweep must get null rather than a cue id
    // that can never play.
    if (action === 'idle') return null;
    return `mob_water_elemental_${action === 'hurt' ? 'attack' : action}`;
  }
  const subfamily = SUBFAMILY_ALIAS[templateId] ?? templateId;
  const specific = `mob_${family}_${subfamily}_${action}`;
  return hasCue(specific) ? specific : MOB_VOICE_CUES[family][action];
}

/** Resolves the cue for `action`, but falls back to the `attack` cue when the
 *  resolved cue is not yet buffered. `attack` plays on every ordinary hit, so
 *  it is always warm; a rare action (e.g. `hurt`, triggered only on a crit)
 *  can otherwise lose the race to fetch and decode its clip in time to play
 *  on the very event that needed it. `isBuffered` is injected the same way
 *  `hasCue` is, so this stays host-agnostic and directly testable. */
export function mobVoiceCueWithFallback(
  templateId: string,
  action: MobVoiceAction,
  hasCue: (key: string) => boolean,
  isBuffered: (key: string) => boolean,
): string | null {
  const primary = mobVoiceCue(templateId, action, hasCue);
  if (primary && isBuffered(primary)) return primary;
  return mobVoiceCue(templateId, 'attack', hasCue);
}

/** Gates the generic `combat_crit` ding in hud.ts (played directly whenever
 *  this returns true). A boss gets none: a crit sting is a wrong emotional
 *  beat mid-boss-fight. The Training Dummy DOES still get the ding (2026-07-19
 *  follow-up to #2116: the dummy soaks hits for the damage meter and was
 *  never meant to react like a real fight with a pained hurt bark, but the
 *  plain crit ding is fine and expected feedback while testing rotations
 *  against it; see mobVoiceActionForDamage below for the hurt-bark-only
 *  exclusion). */
export function shouldPlayCritSfxForTarget(target: Entity): boolean {
  return target.kind !== 'mob' || !MOBS[target.templateId]?.boss;
}

/** The mob-voice action a damage event's target should react with, or null
 *  for anything that isn't a crit against a non-boss mob (a miss, an
 *  ordinary hit, a player target, a boss immune to crit stingers), OR the
 *  Training Dummy specifically: it still gets the plain combat_crit ding
 *  (shouldPlayCritSfxForTarget above), just never the pained hurt-bark
 *  vocalization, since it soaks hits for the damage meter and was never
 *  meant to react like a real fight. Callers still gate the actual play
 *  through shouldPlayMobVoiceSfxForEntity (the Nythraxis mute list) before
 *  using the resolved cue. */
export function mobVoiceActionForDamage(event: DamageEvent, target: Entity): MobVoiceAction | null {
  if (
    !event.crit ||
    target.kind !== 'mob' ||
    !shouldPlayCritSfxForTarget(target) ||
    MOBS[target.templateId]?.dummy
  ) {
    return null;
  }
  return 'hurt';
}

function isNythraxisBoss(entity: Entity): boolean {
  return entity.kind === 'mob' && entity.templateId === 'nythraxis_scourge_of_thornpeak';
}

export function shouldPlayCombatImpactForTarget(target: Entity): boolean {
  return !isNythraxisBoss(target);
}

export function shouldPlayMobVoiceSfxForEntity(entity: Entity): boolean {
  return (
    entity.kind === 'mob' &&
    entity.templateId !== 'nythraxis_scourge_of_thornpeak' &&
    entity.templateId !== 'nythraxis_skeleton_warrior'
  );
}
