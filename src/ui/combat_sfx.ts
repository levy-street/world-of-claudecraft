import type { SfxId } from '../game/sfx_manifest.generated';
import { ABILITIES, MOBS } from '../sim/data';
import type { Aura, Entity, SimEvent } from '../sim/types';
import { isAuraDebuff } from './auras_view';

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;
type SpellFxEvent = Extract<SimEvent, { type: 'spellfx' }>;
type AuraEvent = Extract<SimEvent, { type: 'aura' }>;
type MagicSchool = 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
export type MobVoiceAction = 'aggro' | 'attack' | 'death';

const SCHOOL_CUES = {
  fire: { cast: 'cast_fire', projectile: 'proj_fire', impact: 'impact_fire' },
  frost: { cast: 'cast_frost', projectile: 'proj_frost', impact: 'impact_frost' },
  arcane: { cast: 'cast_arcane', projectile: 'proj_arcane', impact: 'impact_arcane' },
  shadow: { cast: 'cast_shadow', projectile: 'proj_shadow', impact: 'impact_shadow' },
  holy: { cast: 'cast_holy', projectile: 'proj_holy', impact: 'impact_holy' },
  nature: { cast: 'cast_nature', projectile: 'proj_nature', impact: 'impact_nature' },
} as const satisfies Record<MagicSchool, { cast: SfxId; projectile: SfxId; impact: SfxId }>;

const MOB_VOICE_CUES = {
  beast: { aggro: 'mob_beast_aggro', attack: 'mob_beast_attack', death: 'mob_beast_death' },
  boar: { aggro: 'mob_boar_aggro', attack: 'mob_boar_attack', death: 'mob_boar_death' },
  spider: { aggro: 'mob_spider_aggro', attack: 'mob_spider_attack', death: 'mob_spider_death' },
  mudfin: { aggro: 'mob_mudfin_aggro', attack: 'mob_mudfin_attack', death: 'mob_mudfin_death' },
  burrower: {
    aggro: 'mob_burrower_aggro',
    attack: 'mob_burrower_attack',
    death: 'mob_burrower_death',
  },
  humanoid: {
    aggro: 'mob_humanoid_aggro',
    attack: 'mob_humanoid_attack',
    death: 'mob_humanoid_death',
  },
  undead: { aggro: 'mob_undead_aggro', attack: 'mob_undead_attack', death: 'mob_undead_death' },
  troll: { aggro: 'mob_troll_aggro', attack: 'mob_troll_attack', death: 'mob_troll_death' },
  ogre: { aggro: 'mob_ogre_aggro', attack: 'mob_ogre_attack', death: 'mob_ogre_death' },
  elemental: {
    aggro: 'mob_elemental_aggro',
    attack: 'mob_elemental_attack',
    death: 'mob_elemental_death',
  },
  dragonkin: {
    aggro: 'mob_dragonkin_aggro',
    attack: 'mob_dragonkin_attack',
    death: 'mob_dragonkin_death',
  },
  demon: { aggro: 'mob_demon_aggro', attack: 'mob_demon_attack', death: 'mob_demon_death' },
} as const satisfies Record<string, Record<MobVoiceAction, SfxId>>;

type MobVoiceFamily = keyof typeof MOB_VOICE_CUES;
const NO_CUE = (): boolean => false;

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
    return school ? { key: SCHOOL_CUES[school].projectile, anchorId: event.sourceId } : null;
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
  const specific = `mob_${family}_${templateId}_${action}`;
  return hasCue(specific) ? specific : MOB_VOICE_CUES[family][action];
}

export function shouldPlayCritSfxForTarget(target: Entity): boolean {
  return target.kind !== 'mob' || !MOBS[target.templateId]?.boss;
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
