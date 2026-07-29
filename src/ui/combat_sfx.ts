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

// A 'nova' fx event normally plays the shared spell_nova cue (every
// self-centered or ground-targeted burst: Frost Nova, Arcane Explosion,
// Ring of Frost, ...). A few abilities get their own distinct cast cue
// instead, keyed off the casting ability id the event already carries: the
// three AoE fear shouts (priest Psychic Scream, warlock Howl of Terror,
// warrior Intimidating Shout, all archetype aoeFear), Frost Nova, and
// Flamestrike (also archetype 'nova': a ground-targeted fire burst).
const NOVA_ABILITY_CUES: Partial<Record<string, SfxId>> = {
  psychic_scream: 'fear_shout',
  howl_of_terror: 'fear_shout',
  intimidating_shout: 'fear_shout',
  frost_nova: 'frost_nova',
  flamestrike: 'flamestrike',
};

// Shared by both nova-shaped events: the caster-anchored fx:'spellfx' nova
// (self-centered/entity-anchored bursts) AND the world-anchored
// fx:'spellfxAt' nova (ground-targeted bursts like Flamestrike, which always
// takes the castAim branch and never the entity-anchored one). Exported so
// hud.ts's spellfxAt handler can resolve the same override instead of
// hardcoding 'spell_nova' regardless of ability (review finding, PR #2861:
// the Flamestrike entry above could never fire on a real cast without this).
export function novaAbilityCue(ability: string | undefined): SfxId {
  return (ability && NOVA_ABILITY_CUES[ability]) || 'spell_nova';
}

// A damage-landing archetype (bolt/burst/strike/nova/beam/dot) always
// resolves the shared impact_<school> cue (impactCueForDamage below). A few
// abilities get their own distinct impact instead, keyed off
// DamageEvent.abilityId, the stable content id only the PRIMARY direct hit
// carries (DoT ticks omit it, so garrote's 18s bleed never replays this).
// Every other fire spell (Fireball, the rest of the bolt/burst family)
// keeps the shared impact_fire.
const IMPACT_ABILITY_CUES: Partial<Record<string, SfxId>> = {
  scorch: 'scorch',
  pyroblast: 'pyroblast',
  frozen_orb: 'frozen_orb',
  glacial_spike: 'glacial_spike',
  arcane_surge: 'arcane_blast',
  ambush: 'ambush',
  backstab: 'backstab',
  garrote: 'garrote',
  sinister_strike: 'sinister_strike',
  eviscerate: 'eviscerate',
};

// A DoT's periodic damage tick shares the ordinary IMPACT_ABILITY_CUES/school
// lookup above (impactCueForDamage runs on every 'damage' event, ticks
// included), which would repeat a dedicated recording every interval for the
// whole duration and read as spammy (see the HoT precedent, #2271: same
// problem, heal side). Rupture is deliberately absent from IMPACT_ABILITY_CUES
// above for exactly that reason; its dedicated cue instead plays once, off the
// one-shot fx:'dotApply' event effect_dispatch.ts emits at ctx.applyAura time.
const DOT_APPLY_ABILITY_CUES: Partial<Record<string, SfxId>> = {
  rupture: 'eviscerate',
};

// A landed cc (stun/root/incapacitate) has no recording by default (see
// ability_sfx_coverage.ts's RECORDED_IMPACT_ARCHETYPES, which deliberately
// excludes 'cc'); these four now have one, keyed off the casting ability
// id the fx:'ccImpact' event carries (effect_dispatch.ts gates the emit to
// exactly this set, so no other stun/root/incapacitate fires the event at
// all).
const CC_IMPACT_ABILITY_CUES: Partial<Record<string, SfxId>> = {
  hammer_of_justice: 'hammer_of_justice',
  entangling_roots: 'entangling_roots',
  blind: 'blind',
  cheap_shot: 'cheap_shot',
  sap: 'sap',
};

// fx:'blinkStep' fires from effect_dispatch.ts's blinkForward case, shared by
// every dash-style teleport (Blink, Shadowstep); no recording covers it by
// default (archetype 'dash', see ability_sfx_coverage.ts). Both now have one.
const BLINK_STEP_ABILITY_CUES: Partial<Record<string, SfxId>> = {
  blink: 'blink',
  shadowstep: 'shadowstep',
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
  // Keyed off the stable abilityId, not the display-label `ability` field:
  // a display rename (Scald/Pyrelance/Aether Surge/Dirt Nap/Wicked Slash/
  // Craven Thrust/Lurker's Strike/Throat Wire all differ from their id)
  // would otherwise silently break every entry in IMPACT_ABILITY_CUES
  // (review finding, PR #2861). abilityId is not populated by every
  // dealDamage caller, so a missing one just falls through below.
  if (event.abilityId) {
    const override = IMPACT_ABILITY_CUES[event.abilityId];
    if (override) return override;
  }
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
  if (event.fx === 'nova') {
    return { key: novaAbilityCue(event.ability), anchorId: event.targetId };
  }
  if (event.fx === 'fearImpact') return { key: 'fear', anchorId: event.targetId };
  if (event.fx === 'ccImpact') {
    const key = event.ability && CC_IMPACT_ABILITY_CUES[event.ability];
    return key ? { key, anchorId: event.targetId } : null;
  }
  // blinkStep fires for every blinkForward-effect ability (Blink, Shadowstep);
  // only Blink has a recording so far, keyed the same way as the cc trio.
  if (event.fx === 'blinkStep') {
    const key = event.ability && BLINK_STEP_ABILITY_CUES[event.ability];
    return key ? { key, anchorId: event.targetId } : null;
  }
  if (event.fx === 'dotApply') {
    const key = event.ability && DOT_APPLY_ABILITY_CUES[event.ability];
    return key ? { key, anchorId: event.targetId } : null;
  }
  return null;
}

// Per-ability overrides for a buff's apply moment: normally every buff plays
// the shared buff_apply chime, keyed off Aura.id (the ability that applied
// it). Ice Block (Cold Coffin), Cloak of Shadows (Shadecloak, an absorb
// aura, same apply path), Vanish (Smokestep, a toggle stealth selfBuff, same
// apply path too), and Stealth (Duskveil, the opening rogue stealth toggle,
// identical selfBuff shape) get their own distinct cue instead.
const BUFF_APPLY_ABILITY_CUES: Partial<Record<string, SfxId>> = {
  ice_block: 'ice_block',
  cloak_of_shadows: 'cloak_of_shadows',
  vanish: 'vanish',
  stealth: 'stealth',
};

export function auraApplyCue(event: AuraEvent, aura: Aura | null): SfxId | null {
  if (!event.gained || !aura) return null;
  if (isAuraDebuff(aura)) return 'debuff_apply';
  return BUFF_APPLY_ABILITY_CUES[aura.id] ?? 'buff_apply';
}

type HealEvent = Extract<SimEvent, { type: 'heal' }>;

// A potion, eat, or drink heal (items.ts / combat/auras.ts) plays its own
// dedicated cue instead of the generic heal_impact every other heal source
// falls through to. A potion is always a one-shot (fires every time); eat/drink
// only fires on its designated sfxTick (see consume_sfx.ts), independent of
// whether hp/mana actually landed that tick.
export function consumeHealCue(event: HealEvent): SfxId | null {
  switch (event.source) {
    case 'potion':
      return 'player_drink_potion';
    case 'food':
      return event.sfxTick ? 'player_eat_food' : null;
    case 'drink':
      return event.sfxTick ? 'player_drink_water' : null;
    default:
      return null;
  }
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
