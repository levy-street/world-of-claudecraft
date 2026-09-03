// Nythraxis raid encounter (N1), extracted from the Sim monolith.
//
// This module owns the Nythraxis multi-phase raid script: the per-tick encounter
// driver, the dialogue/yell scheduler, the Gravebreaker / Raise Fallen / Soul Rend
// / Deathless Rage mechanics, the Aldric transition + wardstone channels, the
// skeleton-warrior add AI, the CC-immunity predicates, the raid lockout grant, and
// the crypt relic / grave-vision quest chain. It is the LAST slice: every AI /
// damage / aura / threat / locomotion callback it leans on already exists on
// SimContext, so it consumes a fully-grown seam.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or
// to a sibling function in this module. Statement order, branch order, the
// guard/early-return ladder, and EVERY rng draw position are preserved exactly so the
// parity gate's full-state trace AND rng draw-order log stay byte-identical. The two
// shared-stream rng draws live in updateNythraxisGravebreaker (ctx.rng.range over the
// boss weapon) and castNythraxisSoulRend (ctx.rng.int picking the marks); both keep
// their global stream position because the per-tick guard ladder in
// updateNythraxisEncounter is moved unchanged. The in-place Entity/PlayerMeta mutation
// (and the delayedEvents closures that capture the LIVE `boss.nythraxis` state via the
// dialogue token) is intentional under the refactor's immutability waiver.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). data/types/entity/threat/cc are imported
// directly (already pure); everything that touches not-yet-owned Sim state routes
// through the seam.

import { isBlocked } from '../colliders';
import { isStunned, isUnbreakableControlAura } from '../combat/cc';
import { resetLongCooldownsForRaidWipe } from '../combat/raid_wipe_cooldowns';
import { resurrectionArrivalAnchor } from '../combat/resurrection_offer';
import { ITEMS, MOBS, NPCS, QUESTS } from '../data';
import * as deedsMod from '../deeds';
import { dungeonInstanceAt } from '../dungeon_floor';
import { createMob, createNpc } from '../entity';
import { applyDungeonMobTuning, mobTemplateForDungeonDifficulty } from '../instances/difficulty';
import { heroicLockoutId, instanceLockoutMetas } from '../instances/dungeons';
import {
  NYTHRAXIS_ASCENSION_AURA_ID,
  NYTHRAXIS_ASCENSION_AURA_NAME,
  NYTHRAXIS_ASCENSION_EVERY,
  NYTHRAXIS_ASCENSION_HASTE_AURA_ID,
  NYTHRAXIS_BOUND_AURA_ID,
  NYTHRAXIS_BOUND_AURA_NAME,
  NYTHRAXIS_BOUND_STUN_AURA_ID,
  NYTHRAXIS_BOUND_VULNERABILITY,
  NYTHRAXIS_SIGIL_CAST_ID,
  NYTHRAXIS_SIGIL_FIRST_SECONDS,
  NYTHRAXIS_SIGIL_FLARE_SECONDS,
  NYTHRAXIS_SIGIL_FLOOR_CLEARANCE,
  NYTHRAXIS_UNBOUND_AURA_ID,
  NYTHRAXIS_UNBOUND_AURA_NAME,
  NYTHRAXIS_UNBOUND_AURA_SECONDS,
  NYTHRAXIS_UNBOUND_CAST_ID,
  type NythraxisSigilFloor,
  nythraxisAscensionPerStack,
  nythraxisBossOnSigil,
  nythraxisBoundSeconds,
  nythraxisBoundStunSeconds,
  nythraxisSigilBindSeconds,
  nythraxisSigilCadence,
  nythraxisSigilMayLandInFire,
  nythraxisSigilPlacement,
  nythraxisSigilRadius,
  nythraxisUnboundDamageBonus,
  nythraxisUnboundHitMaxHp,
} from '../nythraxis_binding_sigil';
import {
  isNythraxisImpaled,
  NYTHRAXIS_BONE_SPIKE_CAST_ID,
  NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS,
  NYTHRAXIS_BONE_SPIKE_ID,
  NYTHRAXIS_IMPALED_AURA_ID,
  NYTHRAXIS_IMPALED_AURA_NAME,
  NYTHRAXIS_IMPALED_TICK_SECONDS,
  nythraxisBoneSpikeCadence,
  nythraxisBoneSpikeCandidates,
  nythraxisBoneSpikeVictims,
  nythraxisImpaledAuraFor,
  nythraxisImpaledTickMaxHp,
  pinNythraxisBoneSpike,
} from '../nythraxis_bone_spike';
import {
  beginNythraxisBoneStorm,
  NYTHRAXIS_BONE_SLAM_CAST_ID,
  NYTHRAXIS_BONE_STORM_AURA_ID,
  NYTHRAXIS_BONE_STORM_AURA_NAME,
  NYTHRAXIS_BONE_STORM_CAST_ID,
  NYTHRAXIS_BONE_STORM_FIRST_SECONDS,
  NYTHRAXIS_BONE_STORM_GRAVEBREAKER_REARM_SECONDS,
  NYTHRAXIS_BONE_STORM_SPEED_MULT,
  NYTHRAXIS_BONE_STORM_WHIRL_TICK_SECONDS,
  nythraxisBoneSlamDamageMaxHp,
  nythraxisBoneStormCadence,
  nythraxisBoneStormChargeIndex,
  nythraxisBoneStormChargeTarget,
  nythraxisBoneStormDone,
  nythraxisBoneStormReached,
  nythraxisBoneStormSpikeDue,
  nythraxisBoneStormWhirlTickMaxHp,
  pointInNythraxisBoneStorm,
} from '../nythraxis_bone_storm';
import {
  castNythraxisDreadCurse,
  NYTHRAXIS_DREAD_CURSE_AURA_ID,
  NYTHRAXIS_DREAD_CURSE_EVERY,
} from '../nythraxis_dread_curse';
import {
  NYTHRAXIS_CROWN_ENDURES_AURA_ID,
  NYTHRAXIS_CROWN_ENDURES_AURA_NAME,
  NYTHRAXIS_CROWN_ENDURES_HASTE_AURA_ID,
  NYTHRAXIS_ENRAGE_CALLOUT,
  NYTHRAXIS_ENRAGE_HASTE_BONUS,
  NYTHRAXIS_ENRAGE_WARN_CALLOUT,
  nythraxisEnrageDamageBonus,
  nythraxisEnrageStacks,
  nythraxisEnrageStarts,
  nythraxisEnrageWarnCrossed,
} from '../nythraxis_enrage_clock';
import {
  igniteNythraxisGraveFlames,
  NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
  NYTHRAXIS_GRAVE_ERUPTION_FIRST_SECONDS,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  NYTHRAXIS_GRAVE_FLAME_CAST_ID,
  NYTHRAXIS_GRAVE_FLAME_TICK_SECONDS,
  nythraxisGraveEruptionCadence,
  nythraxisGraveEruptionCount,
  nythraxisGraveEruptionDamageMaxHp,
  nythraxisGraveEruptionId,
  nythraxisGraveEruptionPattern,
  nythraxisGraveEruptionTargetOrder,
  nythraxisGraveFlameSeconds,
  nythraxisGraveFlameTickMaxHp,
  pointInNythraxisCircle,
  pointInNythraxisGraveCircle,
} from '../nythraxis_grave_eruption';
import {
  igniteNythraxisGravefire,
  NYTHRAXIS_GRAVEFIRE_CAST_ID,
  NYTHRAXIS_GRAVEFIRE_FIRST_SECONDS,
  NYTHRAXIS_GRAVEFIRE_TICK_SECONDS,
  nythraxisGravefireBurnSeconds,
  nythraxisGravefireCadence,
  nythraxisGravefireExtent,
  nythraxisGravefireTickMaxHp,
  pointInNythraxisGravefire,
} from '../nythraxis_gravefire';
import {
  NYTHRAXIS_KINGS_WRATH_AURA_ID,
  NYTHRAXIS_KINGS_WRATH_AURA_NAME,
  type NythraxisMajorsInFlight,
  nythraxisAnyMajorInFlight,
  nythraxisKingsWrathDamageBonus,
  nythraxisPhaseThreeReady,
  nythraxisWrathCadence,
  nythraxisWrathGraveEruptionEvery,
  nythraxisWrathGravefireEvery,
} from '../nythraxis_kings_wrath';
import {
  igniteNythraxisSoulfire,
  NYTHRAXIS_SOULFIRE_CAST_ID,
  nythraxisSoulfireSeconds,
  nythraxisSoulfireTickMaxHp,
} from '../nythraxis_soulfire';
import {
  hasInteractObjectCredit,
  interactObjectCreditKey,
  recordInteractObjectCredit,
} from '../quests/interact_object_credit';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { addThreat, clearThreat, SUMMONED_ADD_THREAT_SEED, threatEntries } from '../threat';
import {
  type AuraKind,
  angleTo,
  armorReduction,
  DT,
  type DungeonDifficulty,
  dist2d,
  type Entity,
  INTERACT_RANGE,
  NYTHRAXIS_ADD_ID,
  NYTHRAXIS_BOSS_ID,
  NYTHRAXIS_ROOM_RADIUS,
  type NythraxisBoneSpike,
  normAngle,
  OBJECT_RESPAWN,
  questObjectiveRequired,
  type SimEvent,
  type Vec3,
  YELL_RANGE,
} from '../types';

type NythraxisCallout = Extract<SimEvent, { type: 'nythraxisCallout' }>['call'];

type NythraxisState = NonNullable<Entity['nythraxis']>;
type NythraxisMechanicField =
  | 'dreadCurseTimer'
  | 'boneSpikeTimer'
  | 'boneSpikes'
  | 'eruptionTimer'
  | 'eruptionCastKey'
  | 'eruptionImpactRemaining'
  | 'eruptionPoints'
  | 'graveFlames'
  | 'graveFlameSeq'
  | 'gravefireTimer'
  | 'gravefires'
  | 'gravefireSeq'
  | 'sigilTimer'
  | 'sigil'
  | 'majorGapTimer'
  | 'enrageElapsed'
  | 'enrageStacks'
  | 'boneStormTimer'
  | 'boneStorm';
type NythraxisMechanicState = NythraxisState &
  Required<Pick<NythraxisState, NythraxisMechanicField>>;

/** Seconds the body-owning majors (Deathless Rage, the sigil drag) keep apart. */
const NYTHRAXIS_MAJOR_GAP_SECONDS = 6;

/**
 * The redo's mechanic fields are optional on the type (tests build state
 * literals by hand); this backfills any missing one with its pull-start
 * default IN PLACE and returns the same object narrowed, so every reader below
 * sees a complete state. initNythraxisEncounter sets all of them explicitly.
 */
export function nythraxisMechanicState(st: NythraxisState): NythraxisMechanicState {
  st.dreadCurseTimer ??= NYTHRAXIS_DREAD_CURSE_EVERY;
  st.boneSpikeTimer ??= NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS;
  st.boneSpikes ??= [];
  st.eruptionTimer ??= NYTHRAXIS_GRAVE_ERUPTION_FIRST_SECONDS;
  st.eruptionCastKey ??= 0;
  st.eruptionImpactRemaining ??= 0;
  st.eruptionPoints ??= [];
  st.graveFlames ??= [];
  st.graveFlameSeq ??= 0;
  st.gravefireTimer ??= NYTHRAXIS_GRAVEFIRE_FIRST_SECONDS;
  st.gravefires ??= [];
  st.gravefireSeq ??= 0;
  st.sigilTimer ??= NYTHRAXIS_SIGIL_FIRST_SECONDS;
  st.sigil ??= null;
  st.majorGapTimer ??= 0;
  st.enrageElapsed ??= 0;
  st.enrageStacks ??= 0;
  st.boneStormTimer ??= NYTHRAXIS_BONE_STORM_FIRST_SECONDS;
  st.boneStorm ??= null;
  return st as NythraxisMechanicState;
}

import { summonQuestMob } from './quest_summon';

const NYTHRAXIS_RELIC_SUMMONS: Record<string, string> = {
  captains_crest: 'fallen_captain_aldren',
  priests_sigil: 'corrupted_priest_malric',
  royal_seal: 'deathstalker_voss',
};
const _NYTHRAXIS_CRYPT_QUESTS = new Set(['q_nythraxis_sealed_crypt', 'q_nythraxis_bound_guardian']);
// NYTHRAXIS_BOSS_ID / NYTHRAXIS_ADD_ID / NYTHRAXIS_ROOM_RADIUS live in types.ts
// (shared with mob/locomotion.ts and deeds.ts; the dungeon raid-door seal in
// instances/dungeons.ts also reads NYTHRAXIS_BOSS_ID).
const NYTHRAXIS_ALDRIC_ID = 'brother_aldric_raid';
const _NYTHRAXIS_FINAL_QUEST_ID = 'q_nythraxis_scourges_end';
const NYTHRAXIS_WARDSTONE_ITEM_ID = 'bastion_ward_stone';
// How far a wardstone may sit from the boss spawn and still belong to this
// encounter. The three arena wards form a wide forward triangle (~54yd out), so
// this must comfortably exceed that; far above any cross-instance false match.
const NYTHRAXIS_WARDSTONE_RANGE = 100;
export const NYTHRAXIS_GRAVEBREAKER_EVERY = 12;
export const NYTHRAXIS_GRAVEBREAKER_RANGE = 11;
export const NYTHRAXIS_GRAVEBREAKER_HALF_ARC = Math.PI / 3;
export const NYTHRAXIS_GRAVEBREAKER_SPLASH_MULT = 1.5;
const NYTHRAXIS_OPENER_SECOND_YELL_DELAY = 4;
const NYTHRAXIS_DIALOGUE_LINE_SECONDS = 2.6;
// Raise Fallen add-wave cadence, both difficulties (heroic scales the ADDS,
// not the cadence). Was 45s; tightened to 30s so the waves stay pressure the
// raid must answer all fight.
export const NYTHRAXIS_RAISE_FALLEN_EVERY = 30;
export const NYTHRAXIS_PHASE_TWO_HP = 0.7;
const NYTHRAXIS_SOUL_REND_EVERY = 30;
export const NYTHRAXIS_SOUL_REND_DURATION = 8;
export const NYTHRAXIS_SOUL_REND_STACK_RANGE = 5;
// Soul Rend mark counts. Heroic doubles the marked players (6 of the raid must
// collapse onto the stack point inside 8s); the extra rng picks draw ONLY on a
// heroic claim, so the normal trace and the parity golden are unchanged.
export const NYTHRAXIS_SOUL_REND_MARKS = 3;
export const NYTHRAXIS_SOUL_REND_MARKS_HEROIC = 6;
// Heroic non-compliance punishers. Soul Rend deals maxHp x mult / stacked, so
// on heroic an unstacked mark takes 150% of max hp (a guaranteed kill through
// any topped-off health bar) and even a pair splitting takes 75% each.
// Deathless Rage on a FAILED wardstone channel hits for 115% of max hp on
// heroic (a raid wipe) versus 82% on normal. Both are percentage math with no
// rng, so the normal trace and parity golden are unchanged. Both dealDamage
// calls below pass alreadyFinal for their calibrated-lethal heroic case, so a
// source-side damage-done reduction on the boss (Direhowl) cannot pull either
// hit back under 100%. Deathless Rage also suppresses the matching Veilbound
// Mark reduction around its final heroic hit, because that source-side fold
// applies before dealDamage reaches the alreadyFinal-guarded folds.
export const NYTHRAXIS_SOUL_REND_HEROIC_MULT = 1.5;
export const NYTHRAXIS_DEATHLESS_PCT = 0.82;
export const NYTHRAXIS_DEATHLESS_PCT_HEROIC = 1.15;
const VEILBOUND_MARK_ID = 'veilbound_mark';

// Whether this boss's claimed instance is heroic (the arena instance is found
// the same way the add spawns find it: by mobIds membership).
function isHeroicNythraxis(ctx: SimContext, boss: Entity): boolean {
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  return inst?.difficulty === 'heroic';
}
export const NYTHRAXIS_DEATHLESS_EVERY = 45;
export const NYTHRAXIS_DEATHLESS_CAST = 10;
export const NYTHRAXIS_DEATHLESS_CHANNEL = 5;
export const NYTHRAXIS_DEATHLESS_STUN = 5;
const NYTHRAXIS_HEROIC_SUMMON_CHANNEL = 3;
const NYTHRAXIS_DEATHLESS_SOUL_REND_LOCKOUT = 15;
const NYTHRAXIS_PHASE_TWO_SETTLE_DELAY = 5;
const NYTHRAXIS_TRANSITION_DURATION = 21;
const NYTHRAXIS_TRANSITION_CONTROL_GRACE = 0.5;
// Brother Aldric enters on the door side of the arena (the raid's side, lower z
// than the boss spawn) and walks toward the boss. Distances are yards in front
// of the boss spawn: appears 50yd out, walks up to 30yd out (between door + boss).
const NYTHRAXIS_ALDRIC_SPAWN_DIST = 50;
const NYTHRAXIS_ALDRIC_WALK_DIST = 30;
const NYTHRAXIS_PARTY_INTERACT_RANGE = 30;
const NYTHRAXIS_VISION_LINE_DELAY = 5;
const NYTHRAXIS_HEROIC_ADD_IDS = [
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
] as const;

function isNythraxisRaidAddTemplate(templateId: string): boolean {
  return (
    templateId === NYTHRAXIS_ADD_ID ||
    NYTHRAXIS_HEROIC_ADD_IDS.includes(templateId as (typeof NYTHRAXIS_HEROIC_ADD_IDS)[number])
  );
}

// True while any member of the heroic court (Aldren / Malric / Voss) is still
// alive OR a summon channel is in flight. The phase-2 re-summon is gated on this
// so a raid that does not clear the court inside a Deathless Rage cycle does NOT
// stack a second (then third) set of adds, which would be unwinnable and grow the
// entity count without bound.
function nythraxisHeroicCourtPending(
  ctx: SimContext,
  st: NonNullable<Entity['nythraxis']>,
): boolean {
  if ((st.heroicSummonChannelRemaining ?? 0) > 0) return true;
  for (const e of ctx.entities.values()) {
    if (
      e.kind === 'mob' &&
      !e.dead &&
      NYTHRAXIS_HEROIC_ADD_IDS.includes(e.templateId as (typeof NYTHRAXIS_HEROIC_ADD_IDS)[number])
    )
      return true;
  }
  return false;
}

// ----- CC-immunity predicates (consumed by the hot applyAura path on Sim) ---------

export function isNythraxisControlAura(ctx: SimContext, kind: AuraKind): boolean {
  return kind === 'slow' || ctx.isControlAura(kind);
}

export function isNythraxisRaidEnemy(target: Entity): boolean {
  return (
    target.kind === 'mob' &&
    (target.templateId === NYTHRAXIS_BOSS_ID || isNythraxisRaidAddTemplate(target.templateId))
  );
}

// The two Nythraxis adds the raid is MEANT to control (their templates carry
// ccImmune: false): Malric the priest (stun/silence to break his heal channel)
// and Voss the stalker (untauntable, so root/stun him off the healers). The
// scripted control-immunity gate exempts both; the warrior add stays CC-immune.
export function isNythraxisControllableAdd(target: Entity): boolean {
  return (
    target.kind === 'mob' &&
    (target.templateId === 'nythraxis_heroic_priest_add' ||
      target.templateId === 'nythraxis_heroic_rogue_add')
  );
}

// ----- skeleton-warrior add AI (consumed by mob retarget on Sim) ------------------

export function findNythraxisBossForAdd(ctx: SimContext, add: Entity): Entity | null {
  if (add.kind !== 'mob' || !isNythraxisRaidAddTemplate(add.templateId)) return null;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob' || e.templateId !== NYTHRAXIS_BOSS_ID || e.dead) continue;
    if (e.summonedIds.includes(add.id) || dist2d(e.spawnPos, add.spawnPos) < 1) return e;
  }
  return null;
}

export function nythraxisAddFallbackTarget(ctx: SimContext, add: Entity): Entity | null {
  const boss = findNythraxisBossForAdd(ctx, add);
  if (!boss?.inCombat || boss.aiState === 'idle' || boss.aiState === 'evade') return null;
  const target = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : null;
  return target && !target.dead && target.kind === 'player' ? target : null;
}

export function scheduleNythraxisAddDespawnIfBossReset(ctx: SimContext, add: Entity): boolean {
  const boss = findNythraxisBossForAdd(ctx, add);
  if (!boss || (boss.inCombat && boss.aiState !== 'idle' && boss.aiState !== 'evade')) return false;
  add.aggroTargetId = null;
  add.aiState = 'idle';
  add.inCombat = false;
  add.hostile = false;
  add.despawnTimer = add.despawnTimer ?? 10;
  clearThreat(add);
  return true;
}

// ----- boss-death dialogue hook (fired from updateMob's dead-branch via ctx) -------

export function onBossDeath(ctx: SimContext, mob: Entity): void {
  if (mob.templateId !== NYTHRAXIS_BOSS_ID || !mob.nythraxis) return;
  if (mob.nythraxis.deathSpoken) return;
  clearNythraxisTransitionControl(ctx, mob);
  shatterNythraxisBoneSpikes(ctx, mob);
  clearNythraxisGraveHazards(mob);
  clearNythraxisSigil(mob);
  clearNythraxisBoneStorm(mob);
  mob.nythraxis.deathSpoken = true;
  mob.nythraxis.phase = 'dead';
  nythraxisDialogueSet(ctx, mob, [
    { speaker: 'nythraxis', text: 'Malric...', delay: 0 },
    {
      speaker: 'nythraxis',
      text: 'What have you done',
      delay: NYTHRAXIS_DIALOGUE_LINE_SECONDS,
    },
  ]);
}

// ----- encounter lifecycle --------------------------------------------------------

export function initNythraxisEncounter(boss: Entity): NonNullable<Entity['nythraxis']> {
  if (!boss.nythraxis) {
    boss.nythraxis = {
      phase: 1,
      introSpoken: false,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: NYTHRAXIS_GRAVEBREAKER_EVERY,
      gravebreakerCasts: 0,
      gravebreakerCharged: false,
      raiseFallenTimer: NYTHRAXIS_RAISE_FALLEN_EVERY,
      soulRendTimer: NYTHRAXIS_SOUL_REND_EVERY,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: NYTHRAXIS_DEATHLESS_EVERY,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      dreadCurseTimer: NYTHRAXIS_DREAD_CURSE_EVERY,
      boneSpikeTimer: NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS,
      boneSpikes: [],
      eruptionTimer: NYTHRAXIS_GRAVE_ERUPTION_FIRST_SECONDS,
      eruptionCastKey: 0,
      eruptionImpactRemaining: 0,
      eruptionPoints: [],
      graveFlames: [],
      graveFlameSeq: 0,
      gravefireTimer: NYTHRAXIS_GRAVEFIRE_FIRST_SECONDS,
      gravefires: [],
      gravefireSeq: 0,
      sigilTimer: NYTHRAXIS_SIGIL_FIRST_SECONDS,
      sigil: null,
      majorGapTimer: 0,
      enrageElapsed: 0,
      enrageStacks: 0,
      boneStormTimer: NYTHRAXIS_BONE_STORM_FIRST_SECONDS,
      boneStorm: null,
      wardChannels: [],
      deathSpoken: false,
      attemptParticipantIds: [],
    };
  }
  return boss.nythraxis;
}

export function resetNythraxisEncounter(ctx: SimContext, boss: Entity): void {
  shatterNythraxisBoneSpikes(ctx, boss);
  clearNythraxisGraveHazards(boss);
  clearNythraxisSigil(boss);
  clearNythraxisBoneStorm(boss);
  clearNythraxisWrathAuras(boss);
  for (const p of playersInNythraxisRoom(ctx, boss)) {
    p.auras = p.auras.filter(
      (a) =>
        a.id !== 'nythraxis_soul_rend' &&
        a.id !== 'nythraxis_transition_stun' &&
        a.id !== NYTHRAXIS_DREAD_CURSE_AURA_ID &&
        a.id !== NYTHRAXIS_IMPALED_AURA_ID,
    );
    clearNythraxisWardChannelCast(p);
  }
  clearNythraxisTransitionControl(ctx, boss);
  const aldric = findNythraxisAldric(ctx, boss);
  if (aldric) ctx.dropEntity(aldric.id);
  for (const ward of nythraxisDeathlessChannelObjects(ctx, boss)) {
    ward.auras = ward.auras.filter((a) => a.id !== 'nythraxis_wardstone_lit');
  }
  boss.nythraxis = undefined;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
  boss.channeling = false;
}

// Full wipe: every player in the arena is dead. Send Nythraxis home at full
// health, clear his adds/Aldric/wards/auras, and drop combat so the sealed
// doors reopen and the raid can run back in for another attempt.
export function wipeNythraxisEncounter(ctx: SimContext, boss: Entity): void {
  for (const playerId of boss.nythraxis?.attemptParticipantIds ?? []) {
    const player = ctx.entities.get(playerId);
    const meta = ctx.players.get(playerId);
    if (player?.kind === 'player' && meta) resetLongCooldownsForRaidWipe(player, meta.known);
  }
  boss.pos = { ...boss.spawnPos };
  boss.prevPos = { ...boss.spawnPos };
  ctx.rebucket(boss);
  ctx.resetEvadingMob(boss); // restores hp, clears threat/auras/adds + resetNythraxisEncounter
}

export function updateNythraxisEncounter(ctx: SimContext, boss: Entity): void {
  const st = initNythraxisEncounter(boss);
  const room = playersInNythraxisRoom(ctx, boss);
  for (const player of room) {
    if (!st.attemptParticipantIds?.includes(player.id)) st.attemptParticipantIds?.push(player.id);
  }
  st.attemptParticipantIds?.sort((a, b) => a - b);
  if (!st.introSpoken) {
    st.introSpoken = true;
    nythraxisDialogueSet(ctx, boss, [
      { speaker: 'nythraxis', text: 'Another kingdom comes to challenge me', delay: 0 },
      {
        speaker: 'nythraxis',
        text: 'You will join the rest',
        delay: NYTHRAXIS_OPENER_SECOND_YELL_DELAY,
      },
    ]);
  }

  // Wipe-or-kill is the only reset: if every player in the arena is dead the
  // encounter resets for a retry; otherwise keep the boss locked onto a live
  // target so kiting him out of melee never sends him home.
  if (room.length === 0) {
    wipeNythraxisEncounter(ctx, boss);
    return;
  }
  const tgt = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : null;
  if (
    !tgt ||
    tgt.dead ||
    tgt.kind !== 'player' ||
    dist2d(tgt.pos, boss.spawnPos) > NYTHRAXIS_ROOM_RADIUS
  ) {
    const topId = threatEntries(boss, 1)[0]?.[0] ?? null;
    const top = topId !== null ? ctx.entities.get(topId) : null;
    const next = top && !top.dead && top.kind === 'player' ? top : room[0];
    boss.aggroTargetId = next.id;
    boss.inCombat = true;
    if (boss.aiState === 'idle' || boss.aiState === 'evade') boss.aiState = 'chase';
  }
  if (boss.aggroTargetId !== null && (boss.aiState === 'idle' || boss.aiState === 'evade')) {
    boss.inCombat = true;
    boss.aiState = 'chase';
  }

  if (st.soulRendLockout > 0) st.soulRendLockout = Math.max(0, st.soulRendLockout - DT);
  // The Crown Endures clock runs from the first encounter tick through every
  // script-locked window (a Rage cast, a Bound stun, a storm), and pauses
  // only for the 70% transition: Brother Aldric's entrance is not the raid's
  // time (owner decision 2026-09-04).
  if (st.phase !== 'dead' && st.phase !== 'transition') updateNythraxisEnrageClock(ctx, boss, st);
  updateNythraxisSoulRend(ctx, boss, st);
  if (st.phase === 'transition') {
    updateNythraxisTransition(ctx, boss, st);
    return;
  }
  if (st.phase === 'dead') return;
  // Live hazards keep running through every script-locked window below (a
  // Deathless Rage cast, its stun, the court summon): a spike keeps draining
  // until it is shattered and a burning patch keeps burning. Only NEW casts
  // hold, which is what makes the Rage window the raid's calm window.
  {
    // The gap between body-owning majors counts down first, so a gap a
    // resolution sets later this tick keeps its full length.
    const ms = nythraxisMechanicState(st);
    if (ms.majorGapTimer > 0) ms.majorGapTimer = Math.max(0, ms.majorGapTimer - DT);
  }
  updateNythraxisBoneSpikes(ctx, boss, st);
  updateNythraxisGraveHazards(ctx, boss, st, room);
  updateNythraxisGravefires(ctx, boss, st, room);
  updateNythraxisSigil(ctx, boss, st, room);
  // A storming boss is not swinging at his target, so the Curse holds too.
  const storming = updateNythraxisBoneStorm(ctx, boss, st, room);
  if (!storming) updateNythraxisDreadCurse(ctx, boss, st);

  const hpFrac = boss.hp / Math.max(1, boss.maxHp);
  if (st.phase === 1 && hpFrac <= NYTHRAXIS_PHASE_TWO_HP) {
    startNythraxisTransition(ctx, boss, st);
    return;
  }
  if (st.phase === 2 && nythraxisPhaseThreeReady(hpFrac, nythraxisMajorsInFlight(st))) {
    startNythraxisKingsWrath(ctx, boss, st);
  }
  // Bone Storm owns the boss's body (he runs): like the Rage cast, no new cast
  // starts until it ends, except the mid-storm spike the storm casts itself.
  if (storming) return;

  if (st.deathlessStunRemaining > 0) {
    st.deathlessStunRemaining = Math.max(0, st.deathlessStunRemaining - DT);
    // Interrupted Deathless Rage: the court rises again once the boss shakes off
    // the wardstone stun, but only if the previous court has fallen.
    if (
      st.deathlessStunRemaining <= 0 &&
      isHeroicNythraxis(ctx, boss) &&
      !nythraxisHeroicCourtPending(ctx, st)
    ) {
      startNythraxisHeroicSummon(ctx, boss, st);
    }
    return;
  }
  if ((st.heroicSummonChannelRemaining ?? 0) > 0) {
    updateNythraxisHeroicSummon(ctx, boss, st);
    return;
  }
  if (st.deathlessCastRemaining > 0) {
    updateNythraxisDeathlessRage(ctx, boss, st);
    return;
  }

  // Bound: the wards hold him for the stun, so no new cast starts either (the
  // Rage interrupt stun above holds the same way). Live hazards kept running.
  if (boss.auras.some((a) => a.id === NYTHRAXIS_BOUND_STUN_AURA_ID)) return;

  updateNythraxisGravebreaker(ctx, boss, st);
  updateNythraxisBoneSpikeCast(ctx, boss, st, room);
  updateNythraxisGraveEruptionCast(ctx, boss, st, room);
  updateNythraxisSigilCast(ctx, boss, st, room);
  if (st.phase === 1) updateNythraxisRaiseFallen(ctx, boss, st);
  if (st.phase === 3) updateNythraxisBoneStormCast(ctx, boss, st, room);
  if (st.phase === 2 || st.phase === 3) {
    updateNythraxisGravefireCast(ctx, boss, st, room);
    st.soulRendTimer -= DT;
    if (st.soulRendTimer <= 0) {
      if (canCastNythraxisSoulRend(st)) castNythraxisSoulRend(ctx, boss, st);
      else st.soulRendTimer = 1;
    }
    st.deathlessTimer -= DT;
    if (st.deathlessTimer <= 0) {
      // Deathless Rage owns the boss's body for its cast, so it waits out a
      // live sigil drag and the gap after the last major, the way it already
      // waits for live Soul Rend marks.
      const ms = nythraxisMechanicState(st);
      if (
        st.soulRendMarks.length === 0 &&
        st.soulRendLockout <= 0 &&
        ms.sigil === null &&
        ms.majorGapTimer <= 0
      )
        startNythraxisDeathlessRage(ctx, boss, st);
      else st.deathlessTimer = 1;
    }
  }
}

// ----- dialogue / yell scheduling -------------------------------------------------

export function reserveNythraxisDialogue(
  ctx: SimContext,
  boss: Entity,
  duration: number,
  critical = false,
  queue = false,
): { st: NonNullable<Entity['nythraxis']>; token: number } | null {
  const st = initNythraxisEncounter(boss);
  const busyUntil = st.dialogueBusyUntil ?? 0;
  if (!critical && busyUntil > ctx.time && !queue) return null;
  const delay = !critical && queue && busyUntil > ctx.time ? busyUntil - ctx.time : 0;
  const token = (st.dialogueToken ?? 0) + 1;
  st.dialogueToken = token;
  st.dialogueBusyUntil = ctx.time + delay + duration;
  return { st, token };
}

export function nythraxisDialogueSet(
  ctx: SimContext,
  boss: Entity,
  lines: { speaker: 'nythraxis' | 'aldric'; text: string; delay: number }[],
  critical = false,
  queue = false,
): boolean {
  if (lines.length === 0) return true;
  const duration = Math.max(...lines.map((line) => line.delay)) + NYTHRAXIS_DIALOGUE_LINE_SECONDS;
  const busyUntil = boss.nythraxis?.dialogueBusyUntil ?? 0;
  const startDelay = !critical && queue && busyUntil > ctx.time ? busyUntil - ctx.time : 0;
  const reservation = reserveNythraxisDialogue(ctx, boss, duration, critical, queue);
  if (!reservation) return false;
  const { st, token } = reservation;
  for (const line of lines) {
    const delay = startDelay + line.delay;
    if (delay <= 0) {
      emitNythraxisYell(ctx, boss, line.speaker, line.text);
      continue;
    }
    ctx.delayedEvents.push({
      at: ctx.time + delay,
      event: nythraxisYellEvent(ctx, boss, line.speaker, line.text),
      guard: () => critical || st.dialogueToken === token,
    });
  }
  return true;
}

export function nythraxisSay(
  ctx: SimContext,
  boss: Entity,
  speaker: 'nythraxis' | 'aldric',
  text: string,
  critical = false,
): boolean {
  const reservation = reserveNythraxisDialogue(
    ctx,
    boss,
    NYTHRAXIS_DIALOGUE_LINE_SECONDS,
    critical,
  );
  if (!reservation) return false;
  emitNythraxisYell(ctx, boss, speaker, text);
  return true;
}

export function nythraxisYellEvent(
  ctx: SimContext,
  boss: Entity,
  speaker: 'nythraxis' | 'aldric',
  text: string,
): SimEvent {
  const actor = speaker === 'aldric' ? findNythraxisAldric(ctx, boss) : boss;
  const from = actor?.name ?? (speaker === 'aldric' ? 'Brother Aldric' : boss.name);
  const fromPid = actor?.id ?? boss.id;
  return { type: 'chat', fromPid, from, text, channel: 'yell', entityId: actor?.id ?? boss.id };
}

export function emitNythraxisYell(
  ctx: SimContext,
  boss: Entity,
  speaker: 'nythraxis' | 'aldric',
  text: string,
): void {
  const event = nythraxisYellEvent(ctx, boss, speaker, text);
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, boss.pos) > YELL_RANGE) continue;
    ctx.emit({ ...event, pid: meta.entityId });
  }
}

// ----- room / participant queries -------------------------------------------------

export function findNythraxisAldric(ctx: SimContext, boss: Entity): Entity | null {
  for (const e of ctx.entities.values()) {
    if (
      e.templateId === NYTHRAXIS_ALDRIC_ID &&
      !e.dead &&
      dist2d(e.spawnPos, boss.spawnPos) < NYTHRAXIS_ROOM_RADIUS
    )
      return e;
  }
  return null;
}

export function playersInNythraxisRoom(ctx: SimContext, boss: Entity): Entity[] {
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !p.dead && dist2d(p.pos, boss.spawnPos) <= NYTHRAXIS_ROOM_RADIUS) out.push(p);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function nythraxisTransitionStunTargets(ctx: SimContext, boss: Entity): Entity[] {
  return [...ctx.entities.values()].filter(
    (e) =>
      (e.kind === 'player' ||
        (e.kind === 'mob' && (isNythraxisRaidAddTemplate(e.templateId) || e.ownerId !== null))) &&
      willBeInNythraxisRoomAfterResurrection(ctx, boss, e),
  );
}

function willBeInNythraxisRoomAfterResurrection(
  ctx: SimContext,
  boss: Entity,
  entity: Entity,
): boolean {
  if (dist2d(entity.pos, boss.spawnPos) <= NYTHRAXIS_ROOM_RADIUS) return true;
  if (entity.kind !== 'player' || !entity.dead) return false;
  const offer = ctx.pendingResurrections.get(entity.id);
  if (!offer || ctx.time >= offer.expiresAt) return false;
  // The one arrival-destination rule lives in resurrection_offer.ts: the live
  // caster anchors only while within the offer's reach of the body, else the
  // cast-time fallback. Deriving it here keeps this prediction in lockstep with
  // where the accept will actually place the player.
  const destination =
    resurrectionArrivalAnchor(ctx, offer, entity)?.pos ?? offer.fallbackDestination;
  return dist2d(destination, boss.spawnPos) <= NYTHRAXIS_ROOM_RADIUS;
}

export function nythraxisRoomMetas(ctx: SimContext, boss: Entity): PlayerMeta[] {
  // Membership (the lockout roster), so the circle is clipped to the boss
  // slot's own z band, the same clip the deed task window applies: arena
  // slots sit 500 apart in z with the spawn skewed high, so the raw circle
  // reaches into the next slot's band. The in-room combat queries above keep
  // the raw circle (their cross-slot reach is behind arena walls the movement
  // resolver enforces, and they never confer credit or a lockout).
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  const origin = inst ? ctx.instanceOriginOf(inst) : null;
  const out: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    if (meta.leaving) continue;
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, boss.spawnPos) > NYTHRAXIS_ROOM_RADIUS) continue;
    if (origin !== null && Math.abs(p.pos.z - origin.z) >= 250) continue;
    out.push(meta);
  }
  out.sort((a, b) => a.entityId - b.entityId);
  return out;
}

export function grantNythraxisLockout(ctx: SimContext, boss: Entity): void {
  // Daily raid reset: lock until the next reset boundary the host supplies through the
  // lockout seam (the authoritative server uses its realm-local 3 AM daily reset, so a
  // realm's raids share one boundary; offline/headless fall back to a flat 24h day).
  const until = ctx.raidResetMs(ctx.lockoutNowMs());
  // Difficulty-scoped: a heroic kill locks the :heroic key only, so the raid
  // can still run the normal difficulty the same day (and vice versa).
  const lockId = isHeroicNythraxis(ctx, boss)
    ? heroicLockoutId('nythraxis_boss_arena')
    : 'nythraxis_boss_arena';
  // The kill locks the UNION of the room and the claim sweep. The claim sweep
  // (instanceLockoutMetas) covers the whole owning raid group plus anyone
  // inside the generic instance footprint: a raider who released, camped the
  // entrance, or never zoned in must not stay unlocked, or one unlocked member
  // re-claims the arena for the locked raid. The room metas stay in the union
  // because the arena interior is WIDER than the generic 120-yd footprint
  // (walls at roughly +/-230 local x): a raider who left the raid while parked
  // in a side wing sits outside both claim arms yet can still hold the tap and
  // its rewards, so the 260-yd boss room must keep locking them.
  const roomMetas = nythraxisRoomMetas(ctx, boss);
  const lockoutMetas = new Map<number, PlayerMeta>();
  for (const meta of roomMetas) lockoutMetas.set(meta.entityId, meta);
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  if (inst) {
    for (const meta of instanceLockoutMetas(ctx, inst)) lockoutMetas.set(meta.entityId, meta);
  }
  for (const meta of lockoutMetas.values()) {
    meta.raidLockouts.set(lockId, until);
  }
  // Raid deed credit stays scoped to the boss room roster.
  deedsMod.onNythraxisKillForDeeds(ctx, boss, roomMetas);
}

function nythraxisDifficulty(ctx: SimContext, boss: Entity): DungeonDifficulty {
  return isHeroicNythraxis(ctx, boss) ? 'heroic' : 'normal';
}

function nythraxisClaimedInstance(ctx: SimContext, boss: Entity) {
  return ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
}

function isNythraxisWardChanneler(st: NonNullable<Entity['nythraxis']>, pid: number): boolean {
  return st.wardChannels.some((c) => c.playerId === pid && !c.complete);
}

// ----- structured raid warnings -------------------------------------------------

/**
 * The text-free center-screen callout (the Varkhul callout's sibling): one
 * pid-routed event per living-or-dead raider in the room, or a single personal
 * one when `onlyPid` is given. The client owns the localized copy.
 */
export function emitNythraxisCallout(
  ctx: SimContext,
  boss: Entity,
  call: NythraxisCallout,
  onlyPid?: number,
  excludePids?: ReadonlySet<number>,
): void {
  if (onlyPid !== undefined) {
    ctx.emit({ type: 'nythraxisCallout', pid: onlyPid, sourceId: boss.id, call });
    return;
  }
  for (const meta of ctx.players.values()) {
    if (excludePids?.has(meta.entityId)) continue;
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, boss.spawnPos) > NYTHRAXIS_ROOM_RADIUS) continue;
    ctx.emit({ type: 'nythraxisCallout', pid: meta.entityId, sourceId: boss.id, call });
  }
}

// ----- Dread Curse: the tank swap (both difficulties) --------------------------

export function updateNythraxisDreadCurse(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const ms = nythraxisMechanicState(st);
  const target = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : null;
  if (!target || target.dead || target.kind !== 'player') return;
  ms.dreadCurseTimer -= DT;
  if (ms.dreadCurseTimer > 0) return;
  const outcome = castNythraxisDreadCurse(ctx, boss, target, nythraxisDifficulty(ctx, boss));
  if (outcome === 'outOfReach') {
    // Out of melee reach (kited, knocked, mid-drag): hold, re-check shortly.
    ms.dreadCurseTimer = 1;
    return;
  }
  ms.dreadCurseTimer = NYTHRAXIS_DREAD_CURSE_EVERY;
  if (outcome === 'swapCall') emitNythraxisCallout(ctx, boss, 'dreadCurseSwap');
}

// ----- Bone Spike: impale raiders, the raid shatters the spikes ------------------

export function updateNythraxisBoneSpikeCast(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): void {
  const ms = nythraxisMechanicState(st);
  ms.boneSpikeTimer -= DT;
  if (ms.boneSpikeTimer > 0) return;
  const difficulty = nythraxisDifficulty(ctx, boss);
  const victims = castNythraxisBoneSpike(ctx, boss, st, room, difficulty);
  // Nobody eligible (everyone but the aggro holder is marked, impaled, or
  // dead): retry shortly instead of skipping a whole cycle, the Soul Rend hold.
  ms.boneSpikeTimer = victims.length === 0 ? 3 : nythraxisBoneSpikeCadence(difficulty);
}

/**
 * Impale NYTHRAXIS_BONE_SPIKE_VICTIMS raiders: one shared-stream rng.int per
 * victim (the Soul Rend pick idiom), a stationary spike mob at each victim's
 * feet, the unbreakable impale aura pointing at it, and the callouts. Returns
 * the victims so tests can pin the roster.
 */
export function castNythraxisBoneSpike(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
  difficulty: DungeonDifficulty,
): Entity[] {
  const ms = nythraxisMechanicState(st);
  const marked = new Set(st.soulRendMarks.map((mark) => mark.playerId));
  const candidates = nythraxisBoneSpikeCandidates(room, boss.id, boss.aggroTargetId, marked);
  const victims: Entity[] = [];
  const count = nythraxisBoneSpikeVictims(difficulty);
  while (victims.length < count && candidates.length > 0) {
    const idx = ctx.rng.int(0, candidates.length - 1);
    victims.push(candidates.splice(idx, 1)[0]);
  }
  if (victims.length === 0) return victims;
  const template = MOBS[NYTHRAXIS_BONE_SPIKE_ID];
  if (!template) return [];
  const inst = nythraxisClaimedInstance(ctx, boss);
  const dungeonId = inst?.dungeonId ?? '';
  const spawnTemplate = mobTemplateForDungeonDifficulty(template, dungeonId, difficulty);
  nythraxisSay(ctx, boss, 'nythraxis', 'Bone and marrow, rise!');
  const victimIds = new Set<number>();
  for (const victim of victims) {
    const spike = createMob(
      ctx.nextId++,
      spawnTemplate,
      spawnTemplate.maxLevel,
      ctx.groundPos(victim.pos.x, victim.pos.z),
    );
    applyDungeonMobTuning(spike, dungeonId, difficulty);
    spike.spawnPos = { ...spike.pos };
    spike.facing = victim.facing;
    spike.prevFacing = victim.facing;
    spike.tappedById = boss.tappedById;
    spike.lootable = false;
    spike.loot = null;
    pinNythraxisBoneSpike(spike);
    ctx.addEntity(spike);
    boss.summonedIds.push(spike.id);
    inst?.mobIds.push(spike.id);
    ms.boneSpikes.push({
      spikeId: spike.id,
      playerId: victim.id,
      tickTimer: NYTHRAXIS_IMPALED_TICK_SECONDS,
    });
    ctx.applyAura(victim, nythraxisImpaledAuraFor(boss.id, spike.id));
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: victim.id,
      school: 'shadow',
      fx: 'nova',
    });
    emitNythraxisCallout(ctx, boss, 'youAreImpaled', victim.id);
    victimIds.add(victim.id);
  }
  emitNythraxisCallout(ctx, boss, 'impaled', undefined, victimIds);
  return victims;
}

/**
 * Drop a spike (alive or corpse) and forget it everywhere the spawn recorded
 * it, so a long pull never accumulates spike corpses in the entity map, the
 * grid, the boss's summon list, or the instance roster.
 */
function crumbleNythraxisBoneSpike(ctx: SimContext, boss: Entity, spikeId: number): void {
  if (ctx.entities.has(spikeId)) {
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e?.targetId === spikeId) e.targetId = null;
    }
    ctx.dropEntity(spikeId);
  }
  boss.summonedIds = boss.summonedIds.filter((id) => id !== spikeId);
  const inst = nythraxisClaimedInstance(ctx, boss);
  if (inst) inst.mobIds = inst.mobIds.filter((id) => id !== spikeId);
}

/**
 * Drain every impaled raider once a second and free the ones whose spike has
 * died. A spike whose victim is gone (dead, left, aura stripped) crumbles: it
 * has nothing left to hold. The impale aura is unbreakable control, which
 * death cleanup deliberately KEEPS (resurrection.ts aurasSurvivingDeath), so a
 * victim who dies impaled is freed here explicitly; otherwise the corpse would
 * resurrect still pinned.
 */
export function updateNythraxisBoneSpikes(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const ms = nythraxisMechanicState(st);
  if (ms.boneSpikes.length === 0) return;
  const tickFrac = nythraxisImpaledTickMaxHp(nythraxisDifficulty(ctx, boss));
  const kept: NythraxisBoneSpike[] = [];
  for (const pair of ms.boneSpikes) {
    const spike = ctx.entities.get(pair.spikeId);
    const victim = ctx.entities.get(pair.playerId);
    if (!spike || spike.dead || spike.kind !== 'mob') {
      if (victim) freeNythraxisImpaled(ctx, boss, victim, true);
      crumbleNythraxisBoneSpike(ctx, boss, pair.spikeId);
      continue;
    }
    if (
      !victim ||
      victim.dead ||
      victim.kind !== 'player' ||
      !isNythraxisImpaled(victim, boss.id)
    ) {
      if (victim) freeNythraxisImpaled(ctx, boss, victim, false);
      crumbleNythraxisBoneSpike(ctx, boss, pair.spikeId);
      continue;
    }
    pair.tickTimer -= DT;
    if (pair.tickTimer <= 0) {
      pair.tickTimer += NYTHRAXIS_IMPALED_TICK_SECONDS;
      // alreadyFinal, like every max-hp fraction the newer raids deal (Ignivar's
      // Forge Strike, Varkhul's Maker's Brand): the percentage IS the mechanic,
      // so a damage-done debuff on the boss does not shrink it.
      ctx.dealDamage(
        boss,
        victim,
        Math.ceil(victim.maxHp * tickFrac),
        false,
        'shadow',
        NYTHRAXIS_BONE_SPIKE_CAST_ID,
        'hit',
        true,
        undefined,
        false,
        false,
        true,
      );
    }
    kept.push(pair);
  }
  ms.boneSpikes = kept;
}

function freeNythraxisImpaled(
  ctx: SimContext,
  boss: Entity,
  victim: Entity,
  announce: boolean,
): void {
  const held = victim.auras.some(
    (a) => a.id === NYTHRAXIS_IMPALED_AURA_ID && a.sourceId === boss.id,
  );
  if (!held) return;
  victim.auras = victim.auras.filter(
    (a) => !(a.id === NYTHRAXIS_IMPALED_AURA_ID && a.sourceId === boss.id),
  );
  ctx.emit({ type: 'aura', targetId: victim.id, name: NYTHRAXIS_IMPALED_AURA_NAME, gained: false });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: victim.id,
    school: 'physical',
    fx: 'nova',
  });
  if (announce) emitNythraxisCallout(ctx, boss, 'spikeBroken');
}

/**
 * Free every impaled raider and crumble every spike (transition, reset, kill).
 * Ends with an entity-wide sweep of this boss's impale aura, dead bodies
 * included, the same belt-and-braces clearNythraxisTransitionControl applies:
 * the aura is unbreakable control, so nothing else will ever remove it.
 */
export function shatterNythraxisBoneSpikes(ctx: SimContext, boss: Entity): void {
  if (boss.nythraxis) {
    const ms = nythraxisMechanicState(boss.nythraxis);
    for (const pair of ms.boneSpikes) {
      const victim = ctx.entities.get(pair.playerId);
      if (victim) freeNythraxisImpaled(ctx, boss, victim, false);
      crumbleNythraxisBoneSpike(ctx, boss, pair.spikeId);
    }
    ms.boneSpikes = [];
  }
  for (const entity of ctx.entities.values()) {
    if (entity.kind === 'player') freeNythraxisImpaled(ctx, boss, entity, false);
  }
}

// ----- Grave Eruption and Grave Flame: the floor the raid must keep moving off --

export function updateNythraxisGraveEruptionCast(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): void {
  const ms = nythraxisMechanicState(st);
  ms.eruptionTimer -= DT;
  if (ms.eruptionTimer > 0 || ms.eruptionPoints.length > 0) return;
  startNythraxisGraveEruption(ctx, boss, st, room);
}

/**
 * Telegraph the next eruption: hash-placed under distinct raiders who can
 * still move (never an impaled raider or a wardstone channeler; the aggro
 * holder sorts last), no shared rng spent. The warning rows ride the snapshot
 * through activeNythraxisGraveEruptions; the events carry the same ids.
 */
export function startNythraxisGraveEruption(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): void {
  const ms = nythraxisMechanicState(st);
  const difficulty = nythraxisDifficulty(ctx, boss);
  const castKey = (Math.imul(ctx.tickCount, 0x9e3779b1) ^ boss.id) >>> 0;
  const count = nythraxisGraveEruptionCount(difficulty);
  const eligible = room.filter(
    (p) => !p.dead && !isNythraxisImpaled(p, boss.id) && !isNythraxisWardChanneler(st, p.id),
  );
  const targets = nythraxisGraveEruptionTargetOrder(
    castKey,
    eligible.map((p) => ({ id: p.id, x: p.pos.x, z: p.pos.z })),
    boss.aggroTargetId,
    count,
  );
  ms.eruptionCastKey = castKey;
  ms.eruptionPoints = nythraxisGraveEruptionPattern(
    castKey,
    { x: boss.spawnPos.x, z: boss.spawnPos.z },
    count,
    targets,
  );
  ms.eruptionImpactRemaining = NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS;
  ms.eruptionTimer = nythraxisWrathCadence(
    st.phase === 3,
    nythraxisGraveEruptionCadence(difficulty),
    nythraxisWrathGraveEruptionEvery(difficulty),
  );
  ms.eruptionPoints.forEach((point, index) => {
    ctx.emit({
      type: 'spellfxAt',
      x: point.x,
      z: point.z,
      school: 'shadow',
      fx: 'meteorFall',
      ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
      radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
      duration: NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
      warningLead: NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
      persistentId: nythraxisGraveEruptionId(boss.id, castKey, index),
      sourceId: boss.id,
    });
  });
}

/** The armed eruption lands, then its circles keep burning as Grave Flame. */
export function updateNythraxisGraveHazards(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[] = playersInNythraxisRoom(ctx, boss),
): void {
  const ms = nythraxisMechanicState(st);
  const difficulty = nythraxisDifficulty(ctx, boss);
  if (ms.eruptionImpactRemaining > 0) {
    ms.eruptionImpactRemaining = Math.max(0, ms.eruptionImpactRemaining - DT);
    if (ms.eruptionImpactRemaining <= 1e-6)
      resolveNythraxisGraveEruption(ctx, boss, ms, difficulty, room);
  }
  if (ms.graveFlames.length === 0) return;
  const graveTick = nythraxisGraveFlameTickMaxHp(difficulty);
  const soulTick = nythraxisSoulfireTickMaxHp(difficulty);
  const kept: typeof ms.graveFlames = [];
  for (const flame of ms.graveFlames) {
    flame.remaining -= DT;
    if (flame.remaining <= 0) continue;
    flame.tickTimer -= DT;
    if (flame.tickTimer <= 0) {
      flame.tickTimer += NYTHRAXIS_GRAVE_FLAME_TICK_SECONDS;
      const soul = flame.kind === 'soul';
      const tickFrac = soul ? soulTick : graveTick;
      for (const p of room) {
        if (p.dead || !pointInNythraxisCircle(flame, flame.radius, p.pos)) continue;
        ctx.dealDamage(
          boss,
          p,
          Math.ceil(p.maxHp * tickFrac),
          false,
          'shadow',
          soul ? NYTHRAXIS_SOULFIRE_CAST_ID : NYTHRAXIS_GRAVE_FLAME_CAST_ID,
          'hit',
          true,
          undefined,
          false,
          false,
          true,
        );
      }
    }
    kept.push(flame);
  }
  ms.graveFlames = kept;
}

function resolveNythraxisGraveEruption(
  ctx: SimContext,
  boss: Entity,
  st: NythraxisMechanicState,
  difficulty: DungeonDifficulty,
  room: readonly Entity[],
): void {
  const damage = nythraxisGraveEruptionDamageMaxHp(difficulty);
  for (const p of room) {
    if (p.dead) continue;
    if (!st.eruptionPoints.some((circle) => pointInNythraxisGraveCircle(circle, p.pos))) continue;
    ctx.dealDamage(
      boss,
      p,
      Math.ceil(p.maxHp * damage),
      false,
      'shadow',
      NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
  st.eruptionPoints.forEach((point, index) => {
    ctx.emit({
      type: 'spellfxAt',
      x: point.x,
      z: point.z,
      school: 'shadow',
      fx: 'meteorImpact',
      ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
      radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
      persistentId: nythraxisGraveEruptionId(boss.id, st.eruptionCastKey, index),
      sourceId: boss.id,
    });
  });
  st.graveFlameSeq = igniteNythraxisGraveFlames(
    st.graveFlames,
    st.eruptionPoints,
    st.graveFlameSeq,
    nythraxisGraveFlameSeconds(difficulty),
  );
  st.eruptionPoints = [];
  st.eruptionImpactRemaining = 0;
}

/** Drop every armed eruption and burning patch (transition, reset, kill). */
export function clearNythraxisGraveHazards(boss: Entity): void {
  if (!boss.nythraxis) return;
  const ms = nythraxisMechanicState(boss.nythraxis);
  ms.eruptionPoints = [];
  ms.eruptionImpactRemaining = 0;
  ms.graveFlames = [];
  ms.gravefires = [];
}

// ----- Gravefire: the traveling line the ranged must sidestep --------------------

/** Who a Gravefire may run at: living, not the aggro holder, not pinned, not channeling. */
function nythraxisGravefireCandidates(
  room: readonly Entity[],
  boss: Entity,
  st: NythraxisState,
): Entity[] {
  return room.filter(
    (p) =>
      !p.dead &&
      p.id !== boss.aggroTargetId &&
      !isNythraxisImpaled(p, boss.id) &&
      !isNythraxisWardChanneler(st, p.id),
  );
}

export function updateNythraxisGravefireCast(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): void {
  const ms = nythraxisMechanicState(st);
  ms.gravefireTimer -= DT;
  if (ms.gravefireTimer > 0) return;
  const difficulty = nythraxisDifficulty(ctx, boss);
  const candidates = nythraxisGravefireCandidates(room, boss, st);
  if (candidates.length === 0) {
    ms.gravefireTimer = 3;
    return;
  }
  ms.gravefireTimer = nythraxisWrathCadence(
    st.phase === 3,
    nythraxisGravefireCadence(difficulty),
    nythraxisWrathGravefireEvery(difficulty),
  );
  // The one shared-stream draw of the mechanic: which raider the line runs at.
  const target = candidates[ctx.rng.int(0, candidates.length - 1)];
  castNythraxisGravefire(ctx, boss, st, target);
}

/** Ignite a line from the boss's feet toward the target's current position. */
export function castNythraxisGravefire(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  target: Entity,
): void {
  const ms = nythraxisMechanicState(st);
  ms.gravefireSeq = igniteNythraxisGravefire(
    ms.gravefires,
    { x: boss.pos.x, z: boss.pos.z },
    { x: target.pos.x, z: target.pos.z },
    ms.gravefireSeq,
  );
  nythraxisSay(ctx, boss, 'nythraxis', 'Burn in the light of the grave');
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'beam',
    ability: NYTHRAXIS_GRAVEFIRE_CAST_ID,
  });
  emitNythraxisCallout(ctx, boss, 'gravefireTarget', target.id);
}

/** Advance every line: the lit window slides along it and burns whoever stands inside. */
export function updateNythraxisGravefires(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): void {
  const ms = nythraxisMechanicState(st);
  if (ms.gravefires.length === 0) return;
  const difficulty = nythraxisDifficulty(ctx, boss);
  const burn = nythraxisGravefireBurnSeconds(difficulty);
  const tickFrac = nythraxisGravefireTickMaxHp(difficulty);
  const kept: typeof ms.gravefires = [];
  for (const line of ms.gravefires) {
    line.elapsed += DT;
    const extent = nythraxisGravefireExtent(line.elapsed, burn);
    if (!extent) continue;
    line.tickTimer -= DT;
    if (line.tickTimer <= 0) {
      line.tickTimer += NYTHRAXIS_GRAVEFIRE_TICK_SECONDS;
      for (const p of room) {
        if (p.dead || !pointInNythraxisGravefire(line, extent, p.pos)) continue;
        ctx.dealDamage(
          boss,
          p,
          Math.ceil(p.maxHp * tickFrac),
          false,
          'shadow',
          NYTHRAXIS_GRAVEFIRE_CAST_ID,
          'hit',
          true,
          undefined,
          false,
          false,
          true,
        );
      }
    }
    kept.push(line);
  }
  ms.gravefires = kept;
}

// ----- Binding Sigil: the tank drags him onto the old wards ----------------------

/**
 * The floor facts the sigil placement needs. Open floor is the crypt hall
 * inside its walls with a clearance, minus anything the interior colliders
 * (pillars, tombs, the dais lip) would block; wardstones and live fire are
 * read off the encounter.
 */
function nythraxisSigilFloor(
  ctx: SimContext,
  boss: Entity,
  st: NythraxisMechanicState,
): NythraxisSigilFloor {
  const seed = ctx.cfg.seed;
  return {
    openFloor: (point) => {
      const frame = dungeonInstanceAt(point.x, point.z);
      if (!frame) return false;
      const localX = point.x - frame.ox;
      const localZ = point.z - frame.oz;
      const { layout } = frame;
      const halfX = layout.floorHalfX ?? layout.wallX ?? Number.POSITIVE_INFINITY;
      if (Math.abs(localX) > halfX - NYTHRAXIS_SIGIL_FLOOR_CLEARANCE) return false;
      if (
        localZ < layout.zMin + NYTHRAXIS_SIGIL_FLOOR_CLEARANCE ||
        localZ > layout.zMax - NYTHRAXIS_SIGIL_FLOOR_CLEARANCE
      )
        return false;
      return !isBlocked(seed, point.x, point.z, NYTHRAXIS_SIGIL_FLOOR_CLEARANCE);
    },
    wardstones: nythraxisWardstones(ctx, boss).map((w) => ({ x: w.pos.x, z: w.pos.z })),
    fires: st.graveFlames.map((f) => ({ x: f.x, z: f.z, radius: f.radius })),
  };
}

export function updateNythraxisSigilCast(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): void {
  const ms = nythraxisMechanicState(st);
  // The cadence is cast to cast: the timer keeps running while a sigil is up,
  // so a long drag does not push the next sigil out.
  ms.sigilTimer -= DT;
  if (ms.sigilTimer > 0 || ms.sigil !== null) return;
  // A sigil owns the boss's body (the drag), so it waits out the gap after the
  // last major and never starts with nobody to drag him.
  if (ms.majorGapTimer > 0 || room.length === 0) {
    ms.sigilTimer = 1;
    return;
  }
  ms.sigilTimer = nythraxisSigilCadence(nythraxisDifficulty(ctx, boss));
  startNythraxisSigil(ctx, boss, st);
}

/** Flare a sigil near the boss and begin his Deathless Ascension. */
export function startNythraxisSigil(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const ms = nythraxisMechanicState(st);
  const difficulty = nythraxisDifficulty(ctx, boss);
  const castKey = (Math.imul(ctx.tickCount, 0x9e3779b1) ^ boss.id ^ 0x5161) >>> 0;
  const point = nythraxisSigilPlacement(
    castKey,
    { x: boss.pos.x, z: boss.pos.z },
    nythraxisSigilRadius(difficulty),
    nythraxisSigilFloor(ctx, boss, ms),
    nythraxisSigilMayLandInFire(difficulty),
  );
  ms.sigil = {
    castKey,
    x: point.x,
    z: point.z,
    remaining: nythraxisSigilBindSeconds(difficulty),
    ascensionTimer: NYTHRAXIS_ASCENSION_EVERY,
    ascensionStacks: 0,
  };
  nythraxisSay(ctx, boss, 'nythraxis', 'The old wards cannot hold me', true);
  ctx.emit({
    type: 'spellfxAt',
    x: point.x,
    z: point.z,
    school: 'arcane',
    fx: 'runeCircle',
    ability: NYTHRAXIS_SIGIL_CAST_ID,
    radius: nythraxisSigilRadius(difficulty),
    duration: NYTHRAXIS_SIGIL_FLARE_SECONDS,
    sourceId: boss.id,
  });
  emitNythraxisCallout(ctx, boss, 'sigilAppears');
}

function applyNythraxisAscension(
  ctx: SimContext,
  boss: Entity,
  stacks: number,
  perStack: number,
): void {
  const bonus = stacks * perStack;
  ctx.applyAura(boss, {
    id: NYTHRAXIS_ASCENSION_AURA_ID,
    name: NYTHRAXIS_ASCENSION_AURA_NAME,
    kind: 'buff_dmg_done',
    remaining: 600,
    duration: 600,
    value: bonus,
    stacks,
    sourceId: boss.id,
    school: 'shadow',
    encounterOwned: true,
  });
  ctx.applyAura(boss, {
    id: NYTHRAXIS_ASCENSION_HASTE_AURA_ID,
    name: NYTHRAXIS_ASCENSION_AURA_NAME,
    kind: 'buff_haste',
    remaining: 600,
    duration: 600,
    value: 1 + bonus,
    stacks,
    sourceId: boss.id,
    school: 'shadow',
    encounterOwned: true,
  });
}

function clearNythraxisAscension(boss: Entity): void {
  boss.auras = boss.auras.filter(
    (a) => a.id !== NYTHRAXIS_ASCENSION_AURA_ID && a.id !== NYTHRAXIS_ASCENSION_HASTE_AURA_ID,
  );
}

/** Tick the live sigil: the Ascension climbs until he is dragged onto it or the window ends. */
export function updateNythraxisSigil(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): void {
  const ms = nythraxisMechanicState(st);
  const sigil = ms.sigil;
  if (!sigil) return;
  const difficulty = nythraxisDifficulty(ctx, boss);
  if (nythraxisBossOnSigil(boss.pos, sigil, nythraxisSigilRadius(difficulty))) {
    resolveNythraxisSigilBound(ctx, boss, ms, difficulty);
    return;
  }
  sigil.remaining -= DT;
  sigil.ascensionTimer -= DT;
  if (sigil.ascensionTimer <= 0) {
    sigil.ascensionTimer += NYTHRAXIS_ASCENSION_EVERY;
    sigil.ascensionStacks += 1;
    applyNythraxisAscension(
      ctx,
      boss,
      sigil.ascensionStacks,
      nythraxisAscensionPerStack(difficulty),
    );
  }
  if (sigil.remaining <= 0) resolveNythraxisSigilUnbound(ctx, boss, ms, difficulty, room);
}

function resolveNythraxisSigilBound(
  ctx: SimContext,
  boss: Entity,
  ms: NythraxisMechanicState,
  difficulty: DungeonDifficulty,
): void {
  clearNythraxisAscension(boss);
  boss.auras = boss.auras.filter((a) => a.id !== NYTHRAXIS_UNBOUND_AURA_ID);
  const stun = nythraxisBoundStunSeconds(difficulty);
  ctx.applyAura(boss, {
    id: NYTHRAXIS_BOUND_STUN_AURA_ID,
    name: NYTHRAXIS_BOUND_AURA_NAME,
    kind: 'stun',
    remaining: stun,
    duration: stun,
    value: 0,
    sourceId: boss.id,
    school: 'arcane',
    unbreakableControl: true,
    encounterOwned: true,
  });
  ctx.applyAura(boss, {
    id: NYTHRAXIS_BOUND_AURA_ID,
    name: NYTHRAXIS_BOUND_AURA_NAME,
    kind: 'vulnerability',
    remaining: nythraxisBoundSeconds(difficulty),
    duration: nythraxisBoundSeconds(difficulty),
    value: NYTHRAXIS_BOUND_VULNERABILITY,
    // The burn window rides the aura so the tooltip reads the tier's number.
    value2: nythraxisBoundSeconds(difficulty),
    sourceId: boss.id,
    school: 'arcane',
    encounterOwned: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'nova',
  });
  nythraxisSay(ctx, boss, 'nythraxis', 'The wards... bind me still', true);
  emitNythraxisCallout(ctx, boss, 'sigilBound');
  ms.sigil = null;
  ms.majorGapTimer = NYTHRAXIS_MAJOR_GAP_SECONDS;
}

function resolveNythraxisSigilUnbound(
  ctx: SimContext,
  boss: Entity,
  ms: NythraxisMechanicState,
  difficulty: DungeonDifficulty,
  room: readonly Entity[],
): void {
  clearNythraxisAscension(boss);
  const hit = nythraxisUnboundHitMaxHp(difficulty);
  for (const p of room) {
    if (p.dead) continue;
    ctx.dealDamage(
      boss,
      p,
      Math.ceil(p.maxHp * hit),
      false,
      'shadow',
      NYTHRAXIS_UNBOUND_CAST_ID,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
  ctx.applyAura(boss, {
    id: NYTHRAXIS_UNBOUND_AURA_ID,
    name: NYTHRAXIS_UNBOUND_AURA_NAME,
    kind: 'buff_dmg_done',
    remaining: NYTHRAXIS_UNBOUND_AURA_SECONDS,
    duration: NYTHRAXIS_UNBOUND_AURA_SECONDS,
    value: nythraxisUnboundDamageBonus(difficulty),
    sourceId: boss.id,
    school: 'shadow',
    encounterOwned: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
    ability: NYTHRAXIS_UNBOUND_CAST_ID,
  });
  nythraxisSay(ctx, boss, 'nythraxis', 'Nothing binds a king', true);
  emitNythraxisCallout(ctx, boss, 'sigilUnbound');
  ms.sigil = null;
  ms.majorGapTimer = NYTHRAXIS_MAJOR_GAP_SECONDS;
}

/** Drop the live sigil and every sigil aura on the boss (transition, reset, kill). */
export function clearNythraxisSigil(boss: Entity): void {
  if (boss.nythraxis) {
    const ms = nythraxisMechanicState(boss.nythraxis);
    ms.sigil = null;
    ms.majorGapTimer = 0;
  }
  clearNythraxisAscension(boss);
  boss.auras = boss.auras.filter(
    (a) =>
      a.id !== NYTHRAXIS_BOUND_AURA_ID &&
      a.id !== NYTHRAXIS_BOUND_STUN_AURA_ID &&
      a.id !== NYTHRAXIS_UNBOUND_AURA_ID,
  );
}

// ----- phase three: The King's Wrath, Bone Storm, The Crown Endures ----------------

/** The body-owning majors as the phase gate and the storm cast read them. */
function nythraxisMajorsInFlight(st: NythraxisState): NythraxisMajorsInFlight {
  const ms = nythraxisMechanicState(st);
  return {
    deathlessCasting: st.deathlessCastRemaining > 0,
    deathlessStunned: st.deathlessStunRemaining > 0,
    courtSummoning: (st.heroicSummonChannelRemaining ?? 0) > 0,
    sigilUp: ms.sigil !== null,
    storming: ms.boneStorm !== null,
  };
}

/** 30%: he roars, gains the permanent Wrath bonus, and the floor cadences tighten. */
export function startNythraxisKingsWrath(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const ms = nythraxisMechanicState(st);
  st.phase = 3;
  ms.boneStormTimer = NYTHRAXIS_BONE_STORM_FIRST_SECONDS;
  ctx.applyAura(boss, {
    id: NYTHRAXIS_KINGS_WRATH_AURA_ID,
    name: NYTHRAXIS_KINGS_WRATH_AURA_NAME,
    kind: 'buff_dmg_done',
    remaining: 600,
    duration: 600,
    value: nythraxisKingsWrathDamageBonus(nythraxisDifficulty(ctx, boss)),
    sourceId: boss.id,
    school: 'shadow',
    encounterOwned: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
    ability: NYTHRAXIS_KINGS_WRATH_AURA_NAME,
  });
  nythraxisSay(ctx, boss, 'nythraxis', 'I built a kingdom. I will not lose it again', true);
  emitNythraxisCallout(ctx, boss, 'kingsWrath');
}

/** Tick the enrage clock: the three warnings, the enrage, and its ramp. */
export function updateNythraxisEnrageClock(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const ms = nythraxisMechanicState(st);
  const difficulty = nythraxisDifficulty(ctx, boss);
  const previous = ms.enrageElapsed;
  ms.enrageElapsed = previous + DT;
  const warn = nythraxisEnrageWarnCrossed(previous, ms.enrageElapsed, difficulty);
  if (warn !== null) {
    nythraxisSay(ctx, boss, 'nythraxis', NYTHRAXIS_ENRAGE_WARN_YELLS[warn], true);
    emitNythraxisCallout(ctx, boss, NYTHRAXIS_ENRAGE_WARN_CALLOUT[warn]);
  }
  if (nythraxisEnrageStarts(previous, ms.enrageElapsed, difficulty)) {
    ctx.applyAura(boss, {
      id: NYTHRAXIS_CROWN_ENDURES_HASTE_AURA_ID,
      name: NYTHRAXIS_CROWN_ENDURES_AURA_NAME,
      kind: 'buff_haste',
      remaining: 600,
      duration: 600,
      value: 1 + NYTHRAXIS_ENRAGE_HASTE_BONUS,
      sourceId: boss.id,
      school: 'shadow',
      encounterOwned: true,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'nova',
      ability: NYTHRAXIS_CROWN_ENDURES_AURA_NAME,
    });
    nythraxisSay(ctx, boss, 'nythraxis', 'The crown endures. You do not', true);
    emitNythraxisCallout(ctx, boss, NYTHRAXIS_ENRAGE_CALLOUT);
  }
  const stacks = nythraxisEnrageStacks(ms.enrageElapsed, difficulty);
  if (stacks > 0 && stacks !== ms.enrageStacks) {
    ms.enrageStacks = stacks;
    ctx.applyAura(boss, {
      id: NYTHRAXIS_CROWN_ENDURES_AURA_ID,
      name: NYTHRAXIS_CROWN_ENDURES_AURA_NAME,
      kind: 'buff_dmg_done',
      remaining: 600,
      duration: 600,
      value: nythraxisEnrageDamageBonus(stacks),
      stacks,
      sourceId: boss.id,
      school: 'shadow',
      encounterOwned: true,
    });
  }
}

const NYTHRAXIS_ENRAGE_WARN_YELLS = {
  60: 'Your time runs short, little kings',
  30: 'The grave is patient. I am not',
  10: 'Kneel, or be buried',
} as const;

function clearNythraxisWrathAuras(boss: Entity): void {
  boss.auras = boss.auras.filter(
    (a) =>
      a.id !== NYTHRAXIS_KINGS_WRATH_AURA_ID &&
      a.id !== NYTHRAXIS_CROWN_ENDURES_AURA_ID &&
      a.id !== NYTHRAXIS_CROWN_ENDURES_HASTE_AURA_ID,
  );
}

/** Phase 3 cadence: a storm starts once no other major owns his body. */
export function updateNythraxisBoneStormCast(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): void {
  const ms = nythraxisMechanicState(st);
  ms.boneStormTimer -= DT;
  if (ms.boneStormTimer > 0) return;
  if (nythraxisAnyMajorInFlight(nythraxisMajorsInFlight(st)) || ms.majorGapTimer > 0) {
    ms.boneStormTimer = 1;
    return;
  }
  if (nythraxisBoneStormEligible(room, boss, st).length === 0) {
    ms.boneStormTimer = 3;
    return;
  }
  ms.boneStormTimer = nythraxisBoneStormCadence(nythraxisDifficulty(ctx, boss));
  startNythraxisBoneStorm(ctx, boss, st);
}

/** Who a storm may charge: living raiders who can still run. */
function nythraxisBoneStormEligible(
  room: readonly Entity[],
  boss: Entity,
  st: NythraxisState,
): Entity[] {
  return room.filter(
    (p) => !p.dead && !isNythraxisImpaled(p, boss.id) && !isNythraxisWardChanneler(st, p.id),
  );
}

export function startNythraxisBoneStorm(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const ms = nythraxisMechanicState(st);
  const castKey = (Math.imul(ctx.tickCount, 0x9e3779b1) ^ boss.id ^ 0xb04e) >>> 0;
  ms.boneStorm = beginNythraxisBoneStorm(castKey);
  st.gravebreakerCharged = false;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
  ctx.applyAura(boss, {
    id: NYTHRAXIS_BONE_STORM_AURA_ID,
    name: NYTHRAXIS_BONE_STORM_AURA_NAME,
    kind: 'buff_speed',
    remaining: 600,
    duration: 600,
    value: 0,
    // The whirl tick rides the aura so the tooltip reads the tier's number.
    value2: nythraxisBoneStormWhirlTickMaxHp(nythraxisDifficulty(ctx, boss)),
    sourceId: boss.id,
    school: 'physical',
    encounterOwned: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'physical',
    fx: 'nova',
    ability: NYTHRAXIS_BONE_STORM_CAST_ID,
  });
  nythraxisSay(ctx, boss, 'nythraxis', 'BONE STORM', true);
  emitNythraxisCallout(ctx, boss, 'boneStormBegins');
}

/**
 * Drive the live storm: the whirl tick, the charge windows (one hash-ranked
 * target each, the boss runs at it and Bone Slams on arrival), the mid-storm
 * spike, and the pickup when it ends. Returns true while a storm is live.
 */
export function updateNythraxisBoneStorm(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
): boolean {
  const ms = nythraxisMechanicState(st);
  const storm = ms.boneStorm;
  if (!storm) return false;
  storm.elapsed += DT;
  // The whirl: everyone inside the radius takes the tick, every second.
  storm.whirlTickTimer -= DT;
  if (storm.whirlTickTimer <= 0) {
    storm.whirlTickTimer += NYTHRAXIS_BONE_STORM_WHIRL_TICK_SECONDS;
    const whirl = nythraxisBoneStormWhirlTickMaxHp(nythraxisDifficulty(ctx, boss));
    for (const p of room) {
      if (p.dead || !pointInNythraxisBoneStorm(boss.pos, p.pos)) continue;
      ctx.dealDamage(
        boss,
        p,
        Math.ceil(p.maxHp * whirl),
        false,
        'physical',
        NYTHRAXIS_BONE_STORM_CAST_ID,
        'hit',
        true,
        undefined,
        false,
        false,
        true,
      );
    }
  }
  // Charge windows.
  const window = nythraxisBoneStormChargeIndex(storm.elapsed);
  if (window !== storm.chargeIndex) {
    storm.chargeIndex = window;
    storm.chargeTargetId = null;
    storm.slammed = false;
  }
  if (storm.chargeTargetId === null && !storm.slammed) {
    const pick = nythraxisBoneStormChargeTarget(
      storm.castKey,
      storm.chargeIndex,
      nythraxisBoneStormEligible(room, boss, st),
      storm.chargedIds,
    );
    if (pick !== null) {
      storm.chargeTargetId = pick;
      storm.chargedIds.push(pick);
      emitNythraxisCallout(ctx, boss, 'boneStormCharge', pick);
    }
  }
  if (storm.chargeTargetId !== null && !storm.slammed) {
    const target = ctx.entities.get(storm.chargeTargetId);
    if (!target || target.dead) {
      // The runner fell: he slams where he stands and looks for the next.
      slamNythraxisBoneStorm(ctx, boss, st, room, boss.pos);
    } else {
      boss.aggroTargetId = target.id;
      boss.facing = angleTo(boss.pos, target.pos);
      ctx.moveToward(boss, target.pos, boss.moveSpeed * NYTHRAXIS_BONE_STORM_SPEED_MULT);
      if (nythraxisBoneStormReached(boss.pos, target.pos)) {
        slamNythraxisBoneStorm(ctx, boss, st, room, target.pos);
      }
    }
  }
  // One Bone Spike lands mid-storm on both difficulties.
  if (!storm.spikeCast && nythraxisBoneStormSpikeDue(storm.elapsed)) {
    storm.spikeCast = true;
    castNythraxisBoneSpike(ctx, boss, st, room, nythraxisDifficulty(ctx, boss));
  }
  if (nythraxisBoneStormDone(storm.elapsed)) endNythraxisBoneStorm(ctx, boss, st);
  return true;
}

/** Bone Slam: the burst around him, and a Gravefire line on down the charge. */
function slamNythraxisBoneStorm(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
  room: readonly Entity[],
  toward: Vec3,
): void {
  const ms = nythraxisMechanicState(st);
  const storm = ms.boneStorm;
  if (!storm) return;
  storm.slammed = true;
  const slam = nythraxisBoneSlamDamageMaxHp(nythraxisDifficulty(ctx, boss));
  for (const p of room) {
    if (p.dead || !pointInNythraxisBoneStorm(boss.pos, p.pos)) continue;
    ctx.dealDamage(
      boss,
      p,
      Math.ceil(p.maxHp * slam),
      false,
      'physical',
      NYTHRAXIS_BONE_SLAM_CAST_ID,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'physical',
    fx: 'nova',
    ability: NYTHRAXIS_BONE_SLAM_CAST_ID,
  });
  // The line runs on in the charge direction; a slam in place runs +z, the
  // same fallback the Gravefire leaf uses for a zero-length direction.
  const dx = toward.x - boss.pos.x;
  const dz = toward.z - boss.pos.z;
  const len = Math.hypot(dx, dz);
  const far =
    len > 1e-6
      ? { x: boss.pos.x + (dx / len) * 10, z: boss.pos.z + (dz / len) * 10 }
      : { x: boss.pos.x, z: boss.pos.z + 10 };
  ms.gravefireSeq = igniteNythraxisGravefire(
    ms.gravefires,
    { x: boss.pos.x, z: boss.pos.z },
    far,
    ms.gravefireSeq,
  );
}

/** The storm ends: threat table intact, the top-threat tank picks him up. */
function endNythraxisBoneStorm(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const ms = nythraxisMechanicState(st);
  ms.boneStorm = null;
  ms.majorGapTimer = NYTHRAXIS_MAJOR_GAP_SECONDS;
  st.gravebreakerTimer = NYTHRAXIS_BONE_STORM_GRAVEBREAKER_REARM_SECONDS;
  st.gravebreakerCharged = false;
  boss.auras = boss.auras.filter((a) => a.id !== NYTHRAXIS_BONE_STORM_AURA_ID);
  const topId = threatEntries(boss, 1)[0]?.[0] ?? null;
  const top = topId !== null ? ctx.entities.get(topId) : null;
  if (top && !top.dead && top.kind === 'player') boss.aggroTargetId = top.id;
  emitNythraxisCallout(ctx, boss, 'boneStormEnds');
}

/** Drop a live storm and its aura (reset, kill); the threat table is untouched. */
export function clearNythraxisBoneStorm(boss: Entity): void {
  if (boss.nythraxis) nythraxisMechanicState(boss.nythraxis).boneStorm = null;
  boss.auras = boss.auras.filter((a) => a.id !== NYTHRAXIS_BONE_STORM_AURA_ID);
}

// ----- phase-one mechanics --------------------------------------------------------

// Gravebreaker is a CHARGED AUTO-ATTACK: this cadence only ARMS it. The next
// melee swing the boss actually LANDS releases the splash (the on-swing hook
// below, reached from runMobSwingAffixes), so it can never stack on top of a
// separate swing, the tank-facing hit goes through the normal hit table, and
// avoidance (dodge/parry/miss) holds the charge for the next swing. The old
// free-standing cast fired its first arc at 1.5s on the pull, stacking with
// the opening swing into a tank-killing burst no heal could beat.
export function updateNythraxisGravebreaker(
  _ctx: SimContext,
  _boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.gravebreakerTimer -= DT;
  if (st.gravebreakerTimer > 0) return;
  st.gravebreakerTimer = NYTHRAXIS_GRAVEBREAKER_EVERY;
  st.gravebreakerCharged = true;
}

// Release a charged Gravebreaker off a LANDED boss swing. `rawDmg` is the
// swing's own pre-armor roll (crit/enrage already folded in by the mobSwing
// shell), so the release draws NO extra rng. The swing target takes only the
// swing itself; everyone else inside the 11yd frontal arc takes the splash at
// 1.5x, armor-mitigated per victim. The splash never crits: a critting swing
// doubles the primary hit only, so the un-crit basis is restored here.
export function nythraxisGravebreakerOnMobSwing(
  ctx: SimContext,
  boss: Entity,
  target: Entity,
  rawDmg: number,
  crit: boolean,
): void {
  const st = boss.nythraxis;
  if (!st?.gravebreakerCharged) return;
  st.gravebreakerCharged = false;
  st.gravebreakerCasts = (st.gravebreakerCasts ?? 0) + 1;
  if (st.gravebreakerCasts % 3 === 0)
    nythraxisSay(ctx, boss, 'nythraxis', 'Kneel before your king');
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'physical',
    fx: 'nova',
  });
  const splashBasis = crit ? rawDmg / 2 : rawDmg;
  for (const p of playersInNythraxisRoom(ctx, boss)) {
    if (p.id === target.id) continue;
    const d = dist2d(p.pos, boss.pos);
    if (d > NYTHRAXIS_GRAVEBREAKER_RANGE) continue;
    const delta = Math.abs(normAngle(angleTo(boss.pos, p.pos) - boss.facing));
    if (delta > NYTHRAXIS_GRAVEBREAKER_HALF_ARC) continue;
    const mitigated =
      splashBasis *
      NYTHRAXIS_GRAVEBREAKER_SPLASH_MULT *
      (1 - armorReduction(ctx.effectiveArmor(p), boss.level));
    ctx.dealDamage(
      boss,
      p,
      Math.max(1, Math.round(mitigated)),
      false,
      'physical',
      'Gravebreaker',
      'hit',
      true,
    );
    // Every splash victim is off-target by construction: the arc hit taints
    // the positioning task exactly as before.
    deedsMod.onBossSplashHitForDeeds(ctx, boss);
  }
}

export function updateNythraxisRaiseFallen(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.raiseFallenTimer -= DT;
  if (st.raiseFallenTimer > 0) return;
  st.raiseFallenTimer = NYTHRAXIS_RAISE_FALLEN_EVERY;
  nythraxisDialogueSet(ctx, boss, [
    { speaker: 'nythraxis', text: 'Rise once more', delay: 0 },
    {
      speaker: 'nythraxis',
      text: 'Your king commands it',
      delay: NYTHRAXIS_DIALOGUE_LINE_SECONDS,
    },
  ]);
  spawnNythraxisAdds(ctx, boss);
}

export function spawnNythraxisAdds(ctx: SimContext, boss: Entity): void {
  const template = MOBS[NYTHRAXIS_ADD_ID];
  if (!template) return;
  // Raise the guards from BEHIND the boss (toward the back wall), so they rise
  // up behind him and march out around him, not between the boss and the raid.
  // Behind the dais; the back wall is 20 yd behind the spawn.
  const back = boss.spawnPos.z + 12;
  const spawnPoints = [
    ctx.groundPos(boss.spawnPos.x - 12, back),
    ctx.groundPos(boss.spawnPos.x + 12, back),
  ];
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  // Add waves inherit the claimed instance's difficulty exactly like
  // claimInstance spawns (the heroic transform is a no-op for normal; no rng
  // is drawn here, so the parity full-pull golden is unaffected).
  const difficulty = inst?.difficulty ?? 'normal';
  const spawnTemplate = mobTemplateForDungeonDifficulty(
    template,
    inst?.dungeonId ?? '',
    difficulty,
  );
  const victimId = boss.aggroTargetId ?? threatEntries(boss, 1)[0]?.[0] ?? null;
  const victim = victimId !== null ? ctx.entities.get(victimId) : null;
  for (const pos of spawnPoints) {
    const add = createMob(ctx.nextId++, spawnTemplate, spawnTemplate.maxLevel, pos);
    applyDungeonMobTuning(add, inst?.dungeonId ?? '', difficulty);
    add.spawnPos = { ...boss.spawnPos };
    add.tappedById = boss.tappedById;
    ctx.addEntity(add);
    boss.summonedIds.push(add.id);
    inst?.mobIds.push(add.id);
    if (victim && !victim.dead && victim.kind === 'player') {
      ctx.aggroMob(add, victim, false);
      // The same real tank lead spawnBossAdds seeds (aggroMob only planted 1
      // point): without it the first heal peeled every wave onto the healer.
      addThreat(add, victim.id, SUMMONED_ADD_THREAT_SEED - 1);
    }
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
}

export function startNythraxisHeroicSummon(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.heroicSummonChannelRemaining = NYTHRAXIS_HEROIC_SUMMON_CHANNEL;
  boss.castingAbility = 'nythraxis_heroic_summon';
  boss.castTotal = NYTHRAXIS_HEROIC_SUMMON_CHANNEL;
  boss.castRemaining = NYTHRAXIS_HEROIC_SUMMON_CHANNEL;
  boss.castTargetId = null;
  boss.channeling = true;
  nythraxisSay(ctx, boss, 'nythraxis', 'My court rises again', true);
}

export function updateNythraxisHeroicSummon(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.heroicSummonChannelRemaining = Math.max(0, (st.heroicSummonChannelRemaining ?? 0) - DT);
  boss.castingAbility = 'nythraxis_heroic_summon';
  boss.castTotal = NYTHRAXIS_HEROIC_SUMMON_CHANNEL;
  boss.castRemaining = st.heroicSummonChannelRemaining;
  boss.castTargetId = null;
  boss.channeling = true;
  if ((st.heroicSummonChannelRemaining ?? 0) > 0) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
  boss.channeling = false;
  nythraxisMechanicState(st).majorGapTimer = NYTHRAXIS_MAJOR_GAP_SECONDS;
  spawnNythraxisHeroicAdds(ctx, boss);
}

export function spawnNythraxisHeroicAdds(ctx: SimContext, boss: Entity): void {
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  const spawnPoints = [
    ctx.groundPos(boss.pos.x - 8, boss.pos.z + 8),
    ctx.groundPos(boss.pos.x, boss.pos.z + 10),
    ctx.groundPos(boss.pos.x + 8, boss.pos.z + 8),
  ];
  const victimId = boss.aggroTargetId ?? threatEntries(boss, 1)[0]?.[0] ?? null;
  const victim = victimId !== null ? ctx.entities.get(victimId) : null;
  NYTHRAXIS_HEROIC_ADD_IDS.forEach((templateId, index) => {
    const template = MOBS[templateId];
    if (!template) return;
    const spawnTemplate = mobTemplateForDungeonDifficulty(
      template,
      inst?.dungeonId ?? '',
      inst?.difficulty ?? 'heroic',
    );
    const add = createMob(ctx.nextId++, spawnTemplate, spawnTemplate.maxLevel, spawnPoints[index]);
    applyDungeonMobTuning(add, inst?.dungeonId ?? '', inst?.difficulty ?? 'heroic');
    add.spawnPos = { ...boss.spawnPos };
    add.tappedById = boss.tappedById;
    ctx.addEntity(add);
    boss.summonedIds.push(add.id);
    inst?.mobIds.push(add.id);
    if (victim && !victim.dead && victim.kind === 'player') {
      ctx.aggroMob(add, victim, false);
      // The same real tank lead spawnBossAdds seeds (aggroMob only planted 1
      // point): without it the first heal peeled every wave onto the healer.
      addThreat(add, victim.id, SUMMONED_ADD_THREAT_SEED - 1);
    }
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
}

// ----- transition (phase 1 -> 2) --------------------------------------------------

export function startNythraxisTransition(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.phase = 'transition';
  st.transitionStarted = true;
  const queuedDialogueDelay = Math.max(0, (st.dialogueBusyUntil ?? 0) - ctx.time);
  st.transitionTimer = NYTHRAXIS_TRANSITION_DURATION + queuedDialogueDelay;
  st.transitionReleased = false;
  st.soulRendMarks = [];
  st.deathlessCastRemaining = 0;
  // The stomp shatters every spike and snuffs the floor: phase 2 opens clean.
  shatterNythraxisBoneSpikes(ctx, boss);
  clearNythraxisGraveHazards(boss);
  clearNythraxisSigil(boss);
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
  const transitionLines = [
    { speaker: 'nythraxis' as const, text: 'Another priest...', delay: 0 },
    { speaker: 'aldric' as const, text: 'Your kingdom is gone, Nythraxis', delay: 3.0 },
    { speaker: 'aldric' as const, text: 'Yet you still cling to it', delay: 5.7 },
    { speaker: 'aldric' as const, text: 'Champions, listen carefully!', delay: 8.4 },
    { speaker: 'aldric' as const, text: 'The wardstones still bind his soul.', delay: 11.2 },
    { speaker: 'aldric' as const, text: 'When the time comes, do not ignore them.', delay: 14.1 },
    { speaker: 'aldric' as const, text: 'Fail and we all perish', delay: 17.1 },
  ];
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'physical',
    fx: 'nova',
  });
  applyNythraxisTransitionControl(ctx, boss, st);
  const transitionControlDuration = st.transitionTimer + NYTHRAXIS_TRANSITION_CONTROL_GRACE;
  ctx.applyAura(boss, {
    id: 'nythraxis_transition_pause',
    name: 'Shuddering Stomp',
    kind: 'stun',
    remaining: transitionControlDuration,
    duration: transitionControlDuration,
    value: 0,
    sourceId: boss.id,
    school: 'physical',
  });
  spawnNythraxisAldric(ctx, boss);
  lightNythraxisWardstones(ctx, boss);
  nythraxisDialogueSet(ctx, boss, transitionLines, false, true);
  st.transitionCues = [];
}

function applyNythraxisTransitionControl(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const transitionControlDuration = st.transitionTimer + NYTHRAXIS_TRANSITION_CONTROL_GRACE;
  for (const e of nythraxisTransitionStunTargets(ctx, boss)) {
    if (
      e.auras.some(
        (aura) =>
          aura.id === 'nythraxis_transition_stun' &&
          aura.kind === 'stun' &&
          aura.sourceId === boss.id &&
          aura.remaining > st.transitionTimer &&
          isUnbreakableControlAura(aura),
      )
    )
      continue;
    // Generic aura application recalculates player stats; for a dead ghost that
    // temporarily zeros the full grey display pools established on release.
    // This control has no stat payload, so preserve those display-only values.
    const ghostDisplay = e.kind === 'player' && e.dead && e.ghost ? [e.hp, e.resource] : null;
    ctx.applyAura(e, {
      id: 'nythraxis_transition_stun',
      name: 'Shuddering Stomp',
      kind: 'stun',
      remaining: transitionControlDuration,
      duration: transitionControlDuration,
      value: 0,
      sourceId: boss.id,
      school: 'physical',
      unbreakableControl: true,
    });
    if (ghostDisplay) [e.hp, e.resource] = ghostDisplay;
  }
}

function clearNythraxisTransitionControl(ctx: SimContext, boss: Entity): void {
  for (const entity of ctx.entities.values()) {
    entity.auras = entity.auras.filter(
      (aura) => aura.id !== 'nythraxis_transition_stun' || aura.sourceId !== boss.id,
    );
  }
}

export function spawnNythraxisAldric(ctx: SimContext, boss: Entity): void {
  if (findNythraxisAldric(ctx, boss)) return;
  // Brother Aldric is a friendly quest NPC, not a mob: modeling him as an NPC
  // lets the online client mirror his questIds and open the turn-in dialog
  // (createMob produced a friendly mob the client could never interact with).
  const def = NPCS[NYTHRAXIS_ALDRIC_ID];
  if (!def) return;
  const aldric = createNpc(
    ctx.nextId++,
    def,
    ctx.groundPos(boss.spawnPos.x, boss.spawnPos.z - NYTHRAXIS_ALDRIC_SPAWN_DIST),
  );
  aldric.level = boss.level; // createNpc defaults to 10; match the boss's level for the nameplate
  aldric.hostile = false;
  aldric.facing = 0;
  aldric.prevFacing = 0;
  aldric.spawnPos = { ...aldric.pos };
  ctx.addEntity(aldric);
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  inst?.mobIds.push(aldric.id);
}

export function updateNythraxisTransition(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  applyNythraxisTransitionControl(ctx, boss, st);
  const aldric = findNythraxisAldric(ctx, boss);
  if (aldric) {
    const dest = ctx.groundPos(boss.spawnPos.x, boss.spawnPos.z - NYTHRAXIS_ALDRIC_WALK_DIST);
    ctx.moveToward(aldric, dest, aldric.moveSpeed);
  }
  st.transitionTimer -= DT;
  if (st.transitionTimer > 0) return;
  st.phase = 2;
  st.transitionReleased = true;
  st.gravebreakerTimer = 3;
  st.soulRendTimer = NYTHRAXIS_PHASE_TWO_SETTLE_DELAY;
  st.deathlessTimer = NYTHRAXIS_PHASE_TWO_SETTLE_DELAY + 15;
  // Gravefire is a phase-2 mechanic: its first line runs a few seconds after
  // the settle delay, staggered off Soul Rend and Deathless Rage.
  nythraxisMechanicState(st).gravefireTimer = NYTHRAXIS_GRAVEFIRE_FIRST_SECONDS;
  // The sigil re-arms to its pull-start lead as well, so phase 2 opens with the
  // same calm the settle delay gives Soul Rend and Deathless Rage.
  nythraxisMechanicState(st).sigilTimer = NYTHRAXIS_SIGIL_FIRST_SECONDS;
  boss.auras = boss.auras.filter((a) => a.id !== 'nythraxis_transition_pause');
  clearNythraxisTransitionControl(ctx, boss);
}

export function lightNythraxisWardstones(ctx: SimContext, boss: Entity): void {
  for (const ward of nythraxisDeathlessChannelObjects(ctx, boss)) {
    ctx.applyAura(ward, {
      id: 'nythraxis_wardstone_lit',
      name: 'Soul Ward',
      kind: 'absorb',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'arcane',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: ward.id,
      targetId: boss.id,
      school: 'arcane',
      fx: 'projectile',
    });
  }
}

// ----- phase-two mechanics: Soul Rend ---------------------------------------------

export function canCastNythraxisSoulRend(st: NonNullable<Entity['nythraxis']>): boolean {
  return st.deathlessCastRemaining <= 0 && st.deathlessStunRemaining <= 0;
}

export function castNythraxisSoulRend(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  // Never the aggro holder, and never an impaled raider: one personal mechanic
  // per raider (the Bone Spike pick skips live Soul Rend marks the same way),
  // and an impaled body cannot reach the stack point.
  const candidates = playersInNythraxisRoom(ctx, boss).filter(
    (p) => p.id !== boss.aggroTargetId && !isNythraxisImpaled(p, boss.id),
  );
  if (candidates.length === 0) {
    st.soulRendTimer = 3;
    return;
  }
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  const markCount =
    inst?.difficulty === 'heroic' ? NYTHRAXIS_SOUL_REND_MARKS_HEROIC : NYTHRAXIS_SOUL_REND_MARKS;
  const picked: Entity[] = [];
  while (picked.length < markCount && candidates.length > 0) {
    const idx = ctx.rng.int(0, candidates.length - 1);
    picked.push(candidates.splice(idx, 1)[0]);
  }
  st.soulRendMarks = picked.map((p) => ({
    playerId: p.id,
    remaining: NYTHRAXIS_SOUL_REND_DURATION,
  }));
  st.soulRendTimer = NYTHRAXIS_SOUL_REND_EVERY;
  nythraxisSay(ctx, boss, 'nythraxis', 'Your spirit belongs to me', true);
  for (const p of picked) {
    ctx.applyAura(p, {
      id: 'nythraxis_soul_rend',
      name: 'Soul Rend',
      kind: 'vulnerability',
      remaining: NYTHRAXIS_SOUL_REND_DURATION,
      duration: NYTHRAXIS_SOUL_REND_DURATION,
      value: 0,
      sourceId: boss.id,
      school: 'shadow',
      encounterOwned: true,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: p.id,
      school: 'shadow',
      fx: 'projectile',
    });
  }
}

export function updateNythraxisSoulRend(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  if (st.soulRendMarks.length === 0) return;
  for (const mark of st.soulRendMarks) mark.remaining -= DT;
  if (st.soulRendMarks.some((m) => m.remaining > 0)) return;
  const marked = st.soulRendMarks
    .map((m) => ctx.entities.get(m.playerId))
    .filter((e): e is Entity => !!e && e.kind === 'player' && !e.dead);
  const rendMult = isHeroicNythraxis(ctx, boss) ? NYTHRAXIS_SOUL_REND_HEROIC_MULT : 1;
  for (const p of marked) {
    const stacked = marked.filter(
      (other) => dist2d(other.pos, p.pos) <= NYTHRAXIS_SOUL_REND_STACK_RANGE,
    ).length;
    const share = Math.max(1, stacked);
    ctx.dealDamage(
      boss,
      p,
      Math.ceil((p.maxHp * rendMult) / share),
      false,
      'shadow',
      'Soul Rend',
      'hit',
      true,
      undefined,
      true,
      false,
      // alreadyFinal, but only for the same reason and under the same
      // condition as Deathless Rage above: an unstacked heroic mark
      // (rendMult / share > 1) is the guaranteed kill "through any
      // topped-off health bar" this file's own comment promises; a stacked
      // split is not, and keeps taking every source-side reduction it
      // always did.
      rendMult / share > 1,
    );
    p.auras = p.auras.filter((a) => a.id !== 'nythraxis_soul_rend');
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: p.id,
      school: 'shadow',
      fx: 'nova',
    });
  }
  // Every detonation leaves Soulfire where the mark stood (never beside a
  // wardstone), so the stack point has to rotate: the pool burns as part of
  // the shared flame list the hazard tick above drains.
  const ms = nythraxisMechanicState(st);
  ms.graveFlameSeq = igniteNythraxisSoulfire(
    ms.graveFlames,
    marked.map((p) => ({ x: p.pos.x, z: p.pos.z })),
    nythraxisWardstones(ctx, boss).map((w) => ({ x: w.pos.x, z: w.pos.z })),
    ms.graveFlameSeq,
    nythraxisSoulfireSeconds(nythraxisDifficulty(ctx, boss)),
  );
  st.soulRendMarks = [];
}

// ----- phase-two mechanics: Deathless Rage + wardstone channels --------------------

export function startNythraxisDeathlessRage(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.deathlessTimer = NYTHRAXIS_DEATHLESS_EVERY;
  st.deathlessCastRemaining = NYTHRAXIS_DEATHLESS_CAST;
  st.soulRendLockout = NYTHRAXIS_DEATHLESS_SOUL_REND_LOCKOUT;
  st.wardChannels = nythraxisDeathlessChannelObjects(ctx, boss).map((ward) => ({
    objectId: ward.id,
    playerId: null,
    remaining: NYTHRAXIS_DEATHLESS_CHANNEL,
    complete: false,
  }));
  boss.castingAbility = 'nythraxis_deathless_rage';
  boss.castTotal = NYTHRAXIS_DEATHLESS_CAST;
  boss.castRemaining = NYTHRAXIS_DEATHLESS_CAST;
  boss.castTargetId = null;
  boss.channeling = false;
  nythraxisSay(ctx, boss, 'nythraxis', 'Witness true eternity!', true);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
}

export function updateNythraxisDeathlessRage(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.deathlessCastRemaining = Math.max(0, st.deathlessCastRemaining - DT);
  boss.castingAbility = 'nythraxis_deathless_rage';
  boss.castTotal = NYTHRAXIS_DEATHLESS_CAST;
  boss.castRemaining = st.deathlessCastRemaining;
  boss.castTargetId = null;
  updateNythraxisWardChannels(ctx, boss, st);
  if (nythraxisWardstoneInterruptReady(st)) {
    st.deathlessCastRemaining = 0;
    boss.castingAbility = null;
    boss.castRemaining = 0;
    boss.castTotal = 0;
    boss.castTargetId = null;
    st.deathlessStunRemaining = NYTHRAXIS_DEATHLESS_STUN;
    nythraxisMechanicState(st).majorGapTimer = NYTHRAXIS_MAJOR_GAP_SECONDS;
    ctx.applyAura(boss, {
      id: 'nythraxis_deathless_stun',
      name: 'Deathless Rage Interrupted',
      kind: 'stun',
      remaining: NYTHRAXIS_DEATHLESS_STUN,
      duration: NYTHRAXIS_DEATHLESS_STUN,
      value: 0,
      sourceId: boss.id,
      school: 'arcane',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'arcane',
      fx: 'nova',
    });
    return;
  }
  if (st.deathlessCastRemaining > 0) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
  nythraxisSay(ctx, boss, 'nythraxis', 'You cannot stop what was promised..', true);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
  const ragePct = isHeroicNythraxis(ctx, boss)
    ? NYTHRAXIS_DEATHLESS_PCT_HEROIC
    : NYTHRAXIS_DEATHLESS_PCT;
  // The cast resolved uninterrupted: the wardens task fails for this attempt.
  deedsMod.onDeathlessRageResolvedForDeeds(ctx, boss);
  nythraxisMechanicState(st).majorGapTimer = NYTHRAXIS_MAJOR_GAP_SECONDS;
  for (const p of playersInNythraxisRoom(ctx, boss)) {
    dealNythraxisDeathlessRageHit(ctx, boss, p, ragePct);
  }
  // Heroic: an uninterrupted Deathless Rage (the pillar cast) raises the court
  // right after it lands, and it repeats each Deathless Rage cycle in phase 2 -
  // but only once the previous court has fallen, so the adds never stack.
  if (isHeroicNythraxis(ctx, boss) && !nythraxisHeroicCourtPending(ctx, st)) {
    startNythraxisHeroicSummon(ctx, boss, st);
  }
}

function dealNythraxisDeathlessRageHit(
  ctx: SimContext,
  boss: Entity,
  target: Entity,
  ragePct: number,
): void {
  const alreadyFinal = ragePct > 1;
  const suppressedVeilboundMarks = alreadyFinal
    ? boss.auras.filter((aura) => aura.id === VEILBOUND_MARK_ID && aura.sourceId === target.id)
    : [];
  for (const aura of suppressedVeilboundMarks) aura.id = `${VEILBOUND_MARK_ID}_suppressed`;
  try {
    ctx.dealDamage(
      boss,
      target,
      Math.ceil(target.maxHp * ragePct),
      false,
      'shadow',
      'Deathless Rage',
      'hit',
      true,
      undefined,
      true,
      false,
      // alreadyFinal, but only when ragePct exceeds 100%: on heroic this hit
      // is calibrated above max hp specifically so a failed channel is an
      // unconditional wipe, and skipping the source-output fold there stops a
      // damage-done debuff on the boss (Direhowl's aoeAttackPower pct form)
      // from pulling it back under the raid's health pool. Normal's 82% was
      // never a guaranteed kill by design, so it keeps taking every source-
      // side reduction it always did (Direhowl included). The matching
      // Veilbound Mark on the boss is suppressed for the same final heroic
      // hit because that source-side reduction is applied before alreadyFinal
      // in dealDamage.
      alreadyFinal,
    );
  } finally {
    for (const aura of suppressedVeilboundMarks) aura.id = VEILBOUND_MARK_ID;
  }
}

export function nythraxisWardstoneInterruptReady(st: NonNullable<Entity['nythraxis']>): boolean {
  if (
    st.wardChannels.length === 0 ||
    !st.wardChannels.every((c) => c.complete && c.playerId !== null)
  )
    return false;
  return new Set(st.wardChannels.map((c) => c.playerId)).size === st.wardChannels.length;
}

export function updateNythraxisWardChannels(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  for (const channel of st.wardChannels) {
    if (channel.complete || channel.playerId === null) continue;
    const ward = ctx.entities.get(channel.objectId);
    const p = ctx.entities.get(channel.playerId);
    if (!ward || !p || p.dead || isStunned(p) || dist2d(p.pos, ward.pos) > INTERACT_RANGE + 1) {
      if (p) clearNythraxisWardChannelCast(p);
      channel.playerId = null;
      channel.remaining = NYTHRAXIS_DEATHLESS_CHANNEL;
      continue;
    }
    channel.remaining = Math.max(0, channel.remaining - DT);
    p.castingAbility = 'nythraxis_ward_channel';
    p.channeling = true;
    p.castTotal = NYTHRAXIS_DEATHLESS_CHANNEL;
    p.castRemaining = channel.remaining;
    p.castTargetId = null;
    ctx.emit({
      type: 'spellfx',
      sourceId: ward.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'beam',
    });
    if (channel.remaining <= 0) {
      channel.complete = true;
      clearNythraxisWardChannelCast(p);
      ctx.emit({
        type: 'spellfx',
        sourceId: ward.id,
        targetId: boss.id,
        school: 'arcane',
        fx: 'nova',
      });
    }
  }
}

export function clearNythraxisWardChannelCast(p: Entity): void {
  if (p.castingAbility !== 'nythraxis_ward_channel') return;
  p.castingAbility = null;
  p.channeling = false;
  p.castRemaining = 0;
  p.castTotal = 0;
  p.castTargetId = null;
  // this force-clear never reaches updateCasting's completion path, so a cast
  // queued in the ward-channel's tail (#1360) must not survive to misfire later
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
}

export function nythraxisWardstones(ctx: SimContext, boss: Entity): Entity[] {
  const wards = [...ctx.entities.values()].filter(
    (e) =>
      e.kind === 'object' &&
      e.objectItemId === NYTHRAXIS_WARDSTONE_ITEM_ID &&
      dist2d(e.pos, boss.spawnPos) < NYTHRAXIS_WARDSTONE_RANGE,
  );
  wards.sort((a, b) => a.id - b.id);
  return wards;
}

export function nythraxisDeathlessChannelObjects(ctx: SimContext, boss: Entity): Entity[] {
  return nythraxisWardstones(ctx, boss);
}

export function tryStartNythraxisWardChannel(
  ctx: SimContext,
  ward: Entity,
  player: Entity,
): boolean {
  if (ward.objectItemId !== NYTHRAXIS_WARDSTONE_ITEM_ID) return false;
  const boss = [...ctx.entities.values()].find(
    (e) =>
      e.kind === 'mob' &&
      e.templateId === NYTHRAXIS_BOSS_ID &&
      !e.dead &&
      dist2d(e.spawnPos, ward.pos) < NYTHRAXIS_WARDSTONE_RANGE,
  );
  // No Nythraxis boss in range: this is not a raid wardstone but the overworld
  // "Sunken Bastion" quest ward stone (same item id). Fall through so the normal
  // quest pickup runs, instead of swallowing the interaction.
  if (!boss) return false;
  if (!boss.nythraxis || boss.nythraxis.deathlessCastRemaining <= 0) return true;
  const channel = boss.nythraxis.wardChannels.find((c) => c.objectId === ward.id);
  if (!channel || channel.complete) return true;
  if (channel.playerId === player.id) return true;
  if (channel.playerId !== null && channel.playerId !== player.id) return true;
  channel.playerId = player.id;
  channel.remaining = NYTHRAXIS_DEATHLESS_CHANNEL;
  player.castingAbility = 'nythraxis_ward_channel';
  player.channeling = true;
  player.castTotal = NYTHRAXIS_DEATHLESS_CHANNEL;
  player.castRemaining = NYTHRAXIS_DEATHLESS_CHANNEL;
  player.castTargetId = null;
  ctx.emit({
    type: 'spellfx',
    sourceId: ward.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'beam',
  });
  return true;
}

// ----- crypt relic / grave-vision quest chain -------------------------------------

export function activateNythraxisRelic(ctx: SimContext, obj: Entity, meta: PlayerMeta): boolean {
  if (!obj.objectItemId) return false;
  const mobId = NYTHRAXIS_RELIC_SUMMONS[obj.objectItemId];
  if (!mobId) return false;
  const qp = meta.questLog.get('q_nythraxis_sealed_crypt');
  if (qp?.state !== 'active') {
    const def = ITEMS[obj.objectItemId];
    ctx.error(meta.entityId, def?.pickupDeny ?? 'The relic is bound by the sealed crypt.');
    return true;
  }
  const quest = QUESTS.q_nythraxis_sealed_crypt;
  const objectiveIndex = quest.objectives.findIndex(
    (o) => o.type === 'collect' && o.itemId === obj.objectItemId,
  );
  if (
    objectiveIndex >= 0 &&
    ctx.countItem(obj.objectItemId, meta.entityId) >= quest.objectives[objectiveIndex].count
  ) {
    const def = ITEMS[obj.objectItemId];
    ctx.error(meta.entityId, def?.pickupEnough ?? 'You have already recovered this relic.');
    return true;
  }
  summonQuestMob(ctx, mobId, obj.pos, meta.entityId);
  obj.lootable = false;
  obj.respawnTimer = OBJECT_RESPAWN;
  return true;
}

export function interactObjectForQuests(ctx: SimContext, obj: Entity, meta: PlayerMeta): boolean {
  if (!obj.objectItemId) return false;
  let handled = false;
  for (const qp of meta.questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    quest.objectives.forEach((objective, objectiveIndex) => {
      if (objective.type !== 'interact' || objective.targetObjectItemId !== obj.objectItemId)
        return;
      handled = true;
      const isRitual = obj.objectItemId === 'crypt_ritual_circle';
      if (isRitual && !ctx.countItem('crypt_keystone', meta.entityId)) {
        ctx.error(meta.entityId, 'The ritual circle is silent without the Crypt Keystone.');
        return;
      }
      // Re-summon the Bound Guardian whenever the player still owes the kill.
      // The interact objective is one-shot, but a guardian lost to the idle
      // despawn (leash, wipe) must stay reachable or the kill/collect/signet
      // dead-ends with no way to retry. summonQuestMob no-ops if one is alive.
      if (isRitual) {
        const killIdx = quest.objectives.findIndex(
          (o) => o.type === 'kill' && o.targetMobId === 'bound_guardian',
        );
        if (killIdx >= 0 && qp.counts[killIdx] < questObjectiveRequired(quest, qp, killIdx)) {
          summonQuestMob(ctx, 'bound_guardian', obj.pos, meta.entityId);
        }
      }
      // The interact objective itself (and its one-time vision) only credits once.
      if (qp.counts[objectiveIndex] >= questObjectiveRequired(quest, qp, objectiveIndex)) return;
      // ...and only once per DISTINCT object. The objective is keyed on the item
      // id and this path leaves the object lootable on purpose (party sharing +
      // the ritual circle's guardian re-summon above), so without this ledger one
      // object satisfies a multi-count objective by itself: pressing interact
      // three times on the nearest watchbell finished "The Three Bells" without
      // walking the coast. Checked after the re-summon so a lost Bound Guardian
      // stays reachable.
      const creditKey = interactObjectCreditKey(objectiveIndex, obj.pos);
      if (hasInteractObjectCredit(qp, creditKey)) {
        ctx.error(meta.entityId, 'You have already done this one.');
        return;
      }
      const shared = sharedNythraxisObjectParticipants(ctx, meta, obj, qp.questId, objectiveIndex);
      for (const member of shared) {
        const memberQp = member.questLog.get(qp.questId);
        if (memberQp?.state !== 'active') continue;
        const required = questObjectiveRequired(quest, memberQp, objectiveIndex);
        if (memberQp.counts[objectiveIndex] >= required) continue;
        // A party member who already took this object's credit does not take it
        // twice, even when a groupmate re-triggers the shared interact.
        if (hasInteractObjectCredit(memberQp, creditKey)) continue;
        recordInteractObjectCredit(memberQp, creditKey);
        memberQp.counts[objectiveIndex]++;
        member.counters.questProgress++;
        ctx.emit({
          type: 'questProgress',
          questId: memberQp.questId,
          objectiveIndex,
          current: memberQp.counts[objectiveIndex],
          required,
          text: `${objective.label}: ${memberQp.counts[objectiveIndex]}/${required}`,
          pid: member.entityId,
        });
        ctx.checkQuestReady(memberQp, member);
      }
      const visionId = summonQuestVision(ctx, obj.objectItemId, obj.pos);
      emitQuestObjectVision(
        ctx,
        obj.objectItemId,
        shared.map((m) => m.entityId),
        visionId,
      );
    });
  }
  return handled;
}

export function sharedNythraxisObjectParticipants(
  ctx: SimContext,
  actor: PlayerMeta,
  obj: Entity,
  questId: string,
  objectiveIndex: number,
): PlayerMeta[] {
  if (
    obj.objectItemId !== 'grave_sir_aldren' &&
    obj.objectItemId !== 'grave_high_priest_malric' &&
    obj.objectItemId !== 'grave_captain_voss' &&
    obj.objectItemId !== 'crypt_ritual_circle'
  ) {
    return [actor];
  }
  const quest = QUESTS[questId];
  const objective = quest.objectives[objectiveIndex];
  const party = ctx.partyOf(actor.entityId);
  const members = party ? party.members : [actor.entityId];
  const eligible: PlayerMeta[] = [];
  for (const pid of members) {
    const member = ctx.players.get(pid);
    const entity = ctx.entities.get(pid);
    const memberQp = member?.questLog.get(questId);
    if (!member || !entity || entity.dead || !memberQp || memberQp.state !== 'active') continue;
    if (memberQp.counts[objectiveIndex] >= objective.count) continue;
    if (dist2d(entity.pos, obj.pos) > NYTHRAXIS_PARTY_INTERACT_RANGE) continue;
    eligible.push(member);
  }
  return eligible.some((member) => member.entityId === actor.entityId) ? eligible : [actor];
}

export function emitQuestObjectVision(
  ctx: SimContext,
  itemId: string,
  pids: number[],
  entityId?: number | null,
): void {
  const lines =
    itemId === 'grave_sir_aldren'
      ? ['My king was a good man.', 'I swore my blade to him.', 'I would do so again.']
      : itemId === 'grave_high_priest_malric'
        ? ['There had to be another way.', 'I could not let him die.', 'I only wanted to save him.']
        : itemId === 'grave_captain_voss'
          ? [
              'The king was already dead.',
              'Malric refused to accept it.',
              'We should have let him rest.',
              'If you find the crypt... end this.',
            ]
          : itemId === 'crypt_ritual_circle'
            ? ['The Crypt Keystone turns cold as the seal breaks.']
            : null;
  if (!lines) return;
  for (let i = 0; i < lines.length; i++) {
    for (const pid of pids) {
      const event: SimEvent = {
        type: 'log',
        text: lines[i],
        color: '#b8d7ff',
        pid,
        entityId: entityId ?? undefined,
      };
      if (i === 0) ctx.emit(event);
      else ctx.delayedEvents.push({ at: ctx.time + i * NYTHRAXIS_VISION_LINE_DELAY, event });
    }
  }
}

export function summonQuestVision(ctx: SimContext, itemId: string, pos: Vec3): number | null {
  const templateId =
    itemId === 'grave_sir_aldren'
      ? 'vision_aldren_warrior'
      : itemId === 'grave_high_priest_malric'
        ? 'vision_malric_mage'
        : itemId === 'grave_captain_voss'
          ? 'vision_deathstalker_voss'
          : null;
  if (!templateId) return null;
  const existing = [...ctx.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === templateId && !e.dead && dist2d(e.pos, pos) < 10,
  );
  if (existing) return existing.id;
  const template = MOBS[templateId];
  if (!template) return null;
  const mob = createMob(
    ctx.nextId++,
    template,
    template.maxLevel,
    ctx.groundPos(pos.x + 2.4, pos.z + 2.4),
  );
  mob.hostile = false;
  mob.aiState = 'idle';
  mob.lootable = false;
  mob.loot = null;
  mob.despawnTimer = 22;
  mob.facing = Math.PI;
  mob.prevFacing = mob.facing;
  mob.swingTimer = Infinity;
  ctx.addEntity(mob);
  return mob.id;
}

// summonQuestMob and emitQuestMobDialogue moved to quest_summon.ts (shared
// with the Proving Shore's tide-pool summon); re-exported for existing
// importers.
export { emitQuestMobDialogue, summonQuestMob } from './quest_summon';
