// Ignivar raid encounter, first playable Normal-mode slice.
//
// The encounter state remains server-authoritative on the boss. Existing entity
// fields expose the cast bar and conduit template swaps to every client, while
// the renderer derives the cone, brand circles, and water zone from that state.

import { resetLongCooldownsForRaidWipe } from '../combat/raid_wipe_cooldowns';
import { MOBS } from '../data';
import { createMob } from '../entity';
import {
  IGNIVAR_CONDUITS,
  IGNIVAR_WATER_CONDUIT_TEMPLATES,
  type IgnivarConduitId,
  ignivarConduitHitByFrontal,
  ignivarConduitStateForTemplate,
  ignivarPointInFrontal,
  ignivarPointInRotatingRay,
} from '../ignivar_arena';
import {
  clearIgnivarForgeChainAura,
  IGNIVAR_FORGE_CHAINS_FIRST_SECONDS,
  updateIgnivarForgeChains,
} from '../ignivar_forge_chains';
import {
  IGNIVAR_JUDGMENT_ACTIVE_SECONDS,
  IGNIVAR_JUDGMENT_DURATION_SECONDS,
  IGNIVAR_JUDGMENT_HP_THRESHOLD,
  IGNIVAR_JUDGMENT_LAYOUT_SLOTS,
  IGNIVAR_JUDGMENT_PULSE_SECONDS,
  type IgnivarJudgmentShelterIndex,
  ignivarForgeLayoutFacing,
  ignivarForgeShelterPoints,
  ignivarJudgmentBurnDamageMaxHp,
  ignivarPointOnJudgmentFire,
} from '../ignivar_forge_judgment';
import {
  IGNIVAR_FIRST_FORGE_WAVE_SECONDS,
  IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS,
  IGNIVAR_FORGE_WAVE_EVERY,
  IGNIVAR_FORGE_WAVE_WINDUP_SECONDS,
  ignivarForgeWaveDamageMaxHp,
  ignivarForgeWaveKnockback,
  ignivarForgeWaveRadius,
  ignivarPointSweptByForgeWave,
} from '../ignivar_forge_wave';
import {
  IGNIVAR_FIRST_METEOR_SECONDS,
  IGNIVAR_METEOR_CAST_ID,
  IGNIVAR_METEOR_COUNT_HEROIC,
  IGNIVAR_METEOR_COUNT_NORMAL,
  IGNIVAR_METEOR_EVERY,
  IGNIVAR_METEOR_RADIUS,
  IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
  IGNIVAR_METEOR_TELEGRAPH_SECONDS,
  ignivarMeteorDamageMaxHp,
  ignivarMeteorPattern,
  ignivarMeteorTargetOrder,
  ignivarMeteorWarningId,
  pointInIgnivarMeteor,
} from '../ignivar_meteors';
import { applyDungeonMobTuning, mobTemplateForDungeonDifficulty } from '../instances/difficulty';
import {
  mobCombatProfile,
  mobEffectiveMeleeRange,
  tryMobMeleeSwingInRange,
} from '../mob/combat_profile';
import { updateMobTarget } from '../mob/targeting';
import { emitMobYell } from '../mob/yells';
import type { SimContext } from '../sim_context';
import {
  CAST_COMPLETE_EPS,
  DT,
  type DungeonDifficulty,
  dist2d,
  type Entity,
  IGNIVAR_BOSS_ID,
  type IgnivarEncounterState,
  steadyAngleTo,
} from '../types';
import { VARKHUL_FORGE_PORTAL_ABILITY_ID } from '../varkhul_forge_intermission';
import { resolveEncounterWipe } from './encounter_wipe';
import {
  IGNIVAR_DIALOGUE,
  IGNIVAR_DIALOGUE_GAP_SECONDS,
  ignivarDefeatYell,
} from './ignivar_dialogue';
import { walkEncounterActorTo } from './scripted_walk';

export const IGNIVAR_BRAND_AURA_ID = 'ignivar_brand_of_the_pyre';
export const IGNIVAR_FRONTAL_CAST_ID = 'Searing Torrent';
export const IGNIVAR_APOCALYPSE_ADD_ID = 'ignivar_heart_of_the_end';
export const IGNIVAR_APOCALYPSE_CAST_ID = 'Apocalypse';
export const IGNIVAR_APOCALYPSE_HP_THRESHOLD = 0.65;
export const IGNIVAR_APOCALYPSE_CAST_SECONDS = 20;
export const IGNIVAR_BRAND_TARGETS_NORMAL = 3;
export const IGNIVAR_BRAND_EVERY = 28;
export const IGNIVAR_BRAND_EVERY_LATE = 20;
export const IGNIVAR_BRAND_EVERY_FINAL = 12;
export const IGNIVAR_FINAL_FIRST_BRAND_SECONDS = 4;
export const IGNIVAR_BRAND_TICK_SECONDS = 2;
export const IGNIVAR_BRAND_MAX_STACKS = 3;
export const IGNIVAR_BRAND_RADIUS = 4.5;
export const IGNIVAR_CLEANSING_BACKLASH_ID = 'Cleansing Backlash';
export const IGNIVAR_CLEANSING_BACKLASH_DAMAGE_MAX_HP = 0.18;
export const IGNIVAR_FORGE_STRIKE_ID = 'Forge Strike';
export const IGNIVAR_FORGE_STRIKE_EVERY = 14;
export const IGNIVAR_FORGE_STRIKE_MAX_HP = 0.35;
export const IGNIVAR_FORGE_WAVE_CAST_ID = 'Forge Wave';
export const IGNIVAR_MOLTEN_ARMOR_AURA_ID = 'ignivar_molten_armor';
export const IGNIVAR_MOLTEN_ARMOR_DURATION = 26;
export const IGNIVAR_MOLTEN_ARMOR_PER_STACK = 0.35;
export const IGNIVAR_MOLTEN_ARMOR_MAX_STACKS = 3;
export const IGNIVAR_FRONTAL_EVERY = 28;
export const IGNIVAR_FRONTAL_CAST_SECONDS = 3;
export const IGNIVAR_FRONTAL_VFX_DISTANCE = 30;
export const IGNIVAR_CONDUIT_ACTIVE_SECONDS = 10;
export const IGNIVAR_WATER_CLEANSE_RADIUS = 3.25;
export const IGNIVAR_LAST_INFERNO_AURA_ID = 'ignivar_last_inferno';
export const IGNIVAR_LAST_INFERNO_HP_THRESHOLD = 0.2;
export const IGNIVAR_LAST_INFERNO_SECONDS = 45;
export const IGNIVAR_JUDGMENT_CAST_ID = 'Judgment of the Forge';
export const IGNIVAR_SKYFIRE_CAST_ID = 'Rain of Cinders';
export const IGNIVAR_SKYFIRE_CAST_SECONDS = 3;
export const IGNIVAR_SKYFIRE_EVERY = 20;
export const IGNIVAR_SKYFIRE_DAMAGE_MAX_HP = 0.6;
export const IGNIVAR_SKYFIRE_DAMAGE_MAX_HP_HEROIC = 0.9;
export const IGNIVAR_SKYFIRE_RANGE = 30;
export const IGNIVAR_SKYFIRE_HALF_ANGLE = Math.PI / 10;
export const IGNIVAR_SKYFIRE_CONE_COUNT = 3;
export const IGNIVAR_ROTATING_RAYS_CAST_ID = 'Revolving Inferno';
export const IGNIVAR_FIRST_ROTATING_RAYS_SECONDS = 30;
export const IGNIVAR_ROTATING_RAYS_EVERY = 44;
export const IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS = 2;
export const IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS = 8;
export const IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED = Math.PI / 10;
export const IGNIVAR_ROTATING_RAYS_PULSE_SECONDS = 0.5;
export const IGNIVAR_ROTATING_RAYS_DAMAGE_MAX_HP = 0.3;
export const IGNIVAR_ROTATING_RAYS_DAMAGE_MAX_HP_HEROIC = 0.5;
export const IGNIVAR_MAJOR_ABILITY_GAP_SECONDS = 6;
export const IGNIVAR_FINAL_METEOR_EVERY = 9;
export const IGNIVAR_FINAL_ROTATING_RAYS_EVERY = 24;
export const IGNIVAR_FINAL_ROTATING_RAYS_SPEED_MULTIPLIER = 1.6;
export const IGNIVAR_FINAL_FRONTAL_EVERY = 8;
export const IGNIVAR_FINAL_FIRST_METEOR_SECONDS = 2;
export const IGNIVAR_FINAL_FIRST_ROTATING_RAYS_SECONDS = 15;
export const IGNIVAR_FINAL_FIRST_FRONTAL_SECONDS = 6;
export const IGNIVAR_SOAK_AURA_ID = 'ignivar_shared_pyre';
export const IGNIVAR_SOAK_CAST_SECONDS = 6;
export const IGNIVAR_SOAK_EVERY = 34;
export const IGNIVAR_SOAK_REQUIRED_PLAYERS = 4;
export const IGNIVAR_SOAK_RADIUS = 5.5;
export const IGNIVAR_SOAK_SHARED_MAX_HP = 1.2;
export const IGNIVAR_DEATH_YELL = IGNIVAR_DIALOGUE.death;

const IGNIVAR_FIRST_BRAND_SECONDS = 2;
const IGNIVAR_FIRST_FORGE_STRIKE_SECONDS = 12;
const IGNIVAR_FIRST_FRONTAL_SECONDS = 8;
export const IGNIVAR_FIRST_SKYFIRE_SECONDS = 16;
export const IGNIVAR_FIRST_SOAK_SECONDS = 24;
const IGNIVAR_OVERLAP_PULSE_SECONDS = 1;
const IGNIVAR_BRAND_TICK_MAX_HP = 0.05;
const IGNIVAR_OVERLAP_MAX_HP = 0.06;
const IGNIVAR_FRONTAL_MAX_HP = 0.5;
const IGNIVAR_FRONTAL_MAX_HP_HEROIC = 0.85;
const IGNIVAR_APOCALYPSE_SPAWN_OFFSET_Z = 9;

export function ignivarFrontalDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic' ? IGNIVAR_FRONTAL_MAX_HP_HEROIC : IGNIVAR_FRONTAL_MAX_HP;
}

export function ignivarSkyfireDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? IGNIVAR_SKYFIRE_DAMAGE_MAX_HP_HEROIC
    : IGNIVAR_SKYFIRE_DAMAGE_MAX_HP;
}

export function ignivarRotatingRaysDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? IGNIVAR_ROTATING_RAYS_DAMAGE_MAX_HP_HEROIC
    : IGNIVAR_ROTATING_RAYS_DAMAGE_MAX_HP;
}

export function ignivarBrandCadence(hpFraction: number, lastInfernoTriggered: boolean): number {
  if (lastInfernoTriggered) return IGNIVAR_BRAND_EVERY_FINAL;
  return hpFraction <= IGNIVAR_JUDGMENT_HP_THRESHOLD
    ? IGNIVAR_BRAND_EVERY_LATE
    : IGNIVAR_BRAND_EVERY;
}

function encounterInstance(ctx: SimContext, boss: Entity) {
  return ctx.instances.find((instance) => instance.mobIds.includes(boss.id)) ?? null;
}

export function announceIgnivarDeath(ctx: SimContext, boss: Entity): void {
  if (!boss.ignivar) return;
  emitIgnivarYell(ctx, boss, IGNIVAR_DEATH_YELL);
}

function emitIgnivarYell(ctx: SimContext, boss: Entity, text: string): void {
  emitMobYell(ctx, boss, text);
  if (boss.ignivar) boss.ignivar.dialogueCooldownRemaining = IGNIVAR_DIALOGUE_GAP_SECONDS;
}

function playersInEncounter(ctx: SimContext, boss: Entity, includeDead = false): Entity[] {
  const instance = encounterInstance(ctx, boss);
  if (!instance || instance.exitId === null) return [];
  const players: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player?.kind !== 'player' || (!includeDead && player.dead)) continue;
    if (ctx.instanceClaimIdAt(player.pos) !== instance.exitId) continue;
    players.push(player);
  }
  players.sort((a, b) => a.id - b.id);
  return players;
}

function tankIds(ctx: SimContext): Set<number> {
  const result = new Set<number>();
  for (const meta of ctx.players.values()) {
    if (meta.talentMods.role === 'tank') result.add(meta.entityId);
  }
  return result;
}

function resolveLivingTarget(boss: Entity, players: readonly Entity[]): Entity | null {
  const current =
    boss.aggroTargetId === null
      ? null
      : (players.find((player) => player.id === boss.aggroTargetId && !player.dead) ?? null);
  const target = current ?? players.find((player) => !player.dead) ?? null;
  boss.aggroTargetId = target?.id ?? null;
  return target;
}

function conduitEntities(ctx: SimContext, boss: Entity): Map<IgnivarConduitId, Entity> {
  const result = new Map<IgnivarConduitId, Entity>();
  const instance = encounterInstance(ctx, boss);
  if (!instance) return result;
  const origin = ctx.instanceOriginOf(instance);
  for (const entityId of instance.objectIds) {
    const object = ctx.entities.get(entityId);
    if (object?.kind !== 'object' || !ignivarConduitStateForTemplate(object.templateId)) {
      continue;
    }
    let best: IgnivarConduitId | null = null;
    let bestDistance = 2;
    for (const conduit of IGNIVAR_CONDUITS) {
      const distance = Math.hypot(
        object.pos.x - origin.x - conduit.x,
        object.pos.z - origin.z - conduit.z,
      );
      if (distance >= bestDistance) continue;
      best = conduit.id;
      bestDistance = distance;
    }
    if (best) result.set(best, object);
  }
  return result;
}

function initIgnivarEncounter(boss: Entity): IgnivarEncounterState {
  if (!boss.ignivar) {
    boss.ignivar = {
      attemptParticipantIds: [],
      dialogueCooldownRemaining: 0,
      announcedDefeatedPlayerIds: [],
      finalBrandYellSpoken: false,
      brandTimer: IGNIVAR_FIRST_BRAND_SECONDS,
      forgeStrikeTimer: IGNIVAR_FIRST_FORGE_STRIKE_SECONDS,
      frontalTimer: IGNIVAR_FIRST_FRONTAL_SECONDS,
      frontalCastRemaining: 0,
      frontalFacing: boss.facing,
      skyfireTimer: IGNIVAR_FIRST_SKYFIRE_SECONDS,
      skyfireCastRemaining: 0,
      skyfireFacing: boss.facing,
      meteorTimer: IGNIVAR_FIRST_METEOR_SECONDS,
      meteorCastKey: 0,
      meteorImpactRemaining: 0,
      meteorPoints: [],
      forgeChainsTimer: IGNIVAR_FORGE_CHAINS_FIRST_SECONDS,
      forgeChainsRemaining: 0,
      forgeChainsAttachGraceRemaining: 0,
      forgeChainsStrainSeconds: [],
      forgeChainsPlayerIds: null,
      forgeChainsLastPositions: [],
      rotatingRaysTimer: IGNIVAR_FIRST_ROTATING_RAYS_SECONDS,
      rotatingRaysWindupRemaining: 0,
      rotatingRaysActiveRemaining: 0,
      rotatingRaysFacing: boss.facing,
      rotatingRaysBossFacing: boss.facing,
      rotatingRaysDirection: 1,
      rotatingRaysNextDirection: 1,
      rotatingRaysPulseTimer: 0,
      rotatingRaysHitCooldownByPlayerId: {},
      forgeWaveTimer: IGNIVAR_FIRST_FORGE_WAVE_SECONDS,
      forgeWaveWindupRemaining: 0,
      forgeWaveActiveRemaining: 0,
      forgeWaveFacing: boss.facing,
      forgeWaveRadius: 0,
      forgeWaveHitPlayerIds: [],
      soakTimer: IGNIVAR_FIRST_SOAK_SECONDS,
      soakTargetId: null,
      soakRemaining: 0,
      overlapTimer: IGNIVAR_OVERLAP_PULSE_SECONDS,
      conduitTimers: {},
      apocalypseTriggered: false,
      apocalypseAddId: null,
      apocalypseCastRemaining: 0,
      apocalypseResolved: false,
      forgeJudgmentPhase: 'idle',
      forgeJudgmentRemaining: 0,
      forgeJudgmentPulseTimer: 0,
      forgeJudgmentRotation: 0,
      forgeJudgmentSafeIndex: 0,
      lastInfernoTriggered: false,
      lastInfernoRemaining: 0,
      lastInfernoResolved: false,
      finalFrontalTimer: 0,
      finalNextFrontal: 'searing',
    };
  }
  const state = boss.ignivar;
  state.dialogueCooldownRemaining ??= 0;
  state.announcedDefeatedPlayerIds ??= [];
  state.finalBrandYellSpoken ??= false;
  return state;
}

function spawnApocalypseAdd(ctx: SimContext, boss: Entity, st: IgnivarEncounterState): void {
  const instance = encounterInstance(ctx, boss);
  const template = MOBS[IGNIVAR_APOCALYPSE_ADD_ID];
  if (!instance || !template) return;
  const origin = ctx.instanceOriginOf(instance);
  const difficulty = instance.difficulty ?? 'normal';
  const spawnTemplate = mobTemplateForDungeonDifficulty(template, instance.dungeonId, difficulty);
  const add = createMob(
    ctx.nextId++,
    spawnTemplate,
    spawnTemplate.maxLevel,
    ctx.groundPos(origin.x, origin.z + IGNIVAR_APOCALYPSE_SPAWN_OFFSET_Z),
  );
  applyDungeonMobTuning(add, instance.dungeonId, difficulty);
  add.spawnPos = { ...add.pos };
  add.tappedById = boss.tappedById;
  add.inCombat = true;
  add.aiState = 'attack';
  add.aggroTargetId = null;
  add.castingAbility = IGNIVAR_APOCALYPSE_CAST_ID;
  add.castTotal = IGNIVAR_APOCALYPSE_CAST_SECONDS;
  add.castRemaining = IGNIVAR_APOCALYPSE_CAST_SECONDS;
  add.castTargetId = null;
  add.castAim = null;
  add.channeling = true;
  ctx.addEntity(add);
  boss.summonedIds.push(add.id);
  instance.mobIds.push(add.id);
  st.apocalypseTriggered = true;
  st.apocalypseAddId = add.id;
  st.apocalypseCastRemaining = IGNIVAR_APOCALYPSE_CAST_SECONDS;
  emitIgnivarYell(ctx, boss, IGNIVAR_DIALOGUE.apocalypse);
  ctx.emit({
    type: 'spellfxAt',
    x: add.pos.x,
    z: add.pos.z,
    school: 'fire',
    fx: 'nova',
  });
  ctx.emit({
    type: 'spellfxAt',
    x: add.pos.x,
    z: add.pos.z,
    school: 'fire',
    fx: 'burst',
    sourceId: boss.id,
    radius: 4,
    duration: 2,
    ability: VARKHUL_FORGE_PORTAL_ABILITY_ID,
  });
}

function finishApocalypseAdd(add: Entity): void {
  add.castingAbility = null;
  add.castTotal = 0;
  add.castRemaining = 0;
  add.castTargetId = null;
  add.castAim = null;
  add.channeling = false;
}

function resolveApocalypseWipe(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
): void {
  st.apocalypseCastRemaining = 0;
  st.apocalypseResolved = true;
  const add = st.apocalypseAddId === null ? null : ctx.entities.get(st.apocalypseAddId);
  if (add) finishApocalypseAdd(add);
  resolveEncounterWipe(ctx, boss, players, IGNIVAR_APOCALYPSE_CAST_ID, add ?? boss);
}

function updateApocalypse(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
): boolean {
  if (!st.apocalypseTriggered) {
    if (boss.hp / Math.max(1, boss.maxHp) > IGNIVAR_APOCALYPSE_HP_THRESHOLD) return false;
    spawnApocalypseAdd(ctx, boss, st);
    return false;
  }
  if (st.apocalypseResolved || st.apocalypseAddId === null) return false;
  const add = ctx.entities.get(st.apocalypseAddId);
  if (!add || add.dead) {
    st.apocalypseCastRemaining = 0;
    st.apocalypseResolved = true;
    if (add) finishApocalypseAdd(add);
    return false;
  }
  st.apocalypseCastRemaining = Math.max(0, st.apocalypseCastRemaining - DT);
  add.pos = { ...add.spawnPos };
  add.prevPos = { ...add.spawnPos };
  add.vx = 0;
  add.vz = 0;
  add.inCombat = true;
  add.aiState = 'attack';
  add.aggroTargetId = null;
  add.castingAbility = IGNIVAR_APOCALYPSE_CAST_ID;
  add.castTotal = IGNIVAR_APOCALYPSE_CAST_SECONDS;
  add.castRemaining = st.apocalypseCastRemaining;
  add.castTargetId = null;
  add.castAim = null;
  add.channeling = true;
  if (st.apocalypseCastRemaining > 0) return false;
  resolveApocalypseWipe(ctx, boss, st, players);
  return true;
}

export function updateIgnivarApocalypseAdd(add: Entity): void {
  if (add.templateId !== IGNIVAR_APOCALYPSE_ADD_ID || add.dead) return;
  add.pos = { ...add.spawnPos };
  add.prevPos = { ...add.spawnPos };
  add.vx = 0;
  add.vz = 0;
  add.aggroTargetId = null;
  add.inCombat = true;
  add.aiState = 'attack';
}

function ignivarCanStartForgeJudgment(boss: Entity, st: IgnivarEncounterState): boolean {
  return (
    st.forgeJudgmentPhase === 'idle' &&
    st.apocalypseResolved &&
    boss.hp / Math.max(1, boss.maxHp) <= IGNIVAR_JUDGMENT_HP_THRESHOLD &&
    boss.castingAbility === null &&
    st.frontalCastRemaining <= 0 &&
    st.skyfireCastRemaining <= 0 &&
    st.rotatingRaysWindupRemaining <= 0 &&
    st.rotatingRaysActiveRemaining <= 0 &&
    st.forgeWaveWindupRemaining <= 0 &&
    st.forgeWaveActiveRemaining <= 0 &&
    st.meteorPoints.length === 0 &&
    st.soakTargetId === null
  );
}

function forgeJudgmentOrigin(ctx: SimContext, boss: Entity): { x: number; z: number } {
  const instance = encounterInstance(ctx, boss);
  return instance ? ctx.instanceOriginOf(instance) : boss.pos;
}

function settleIgnivarForJudgment(boss: Entity): void {
  boss.vx = 0;
  boss.vz = 0;
}

function startForgeJudgment(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
  heroic: boolean,
): void {
  const layoutSlot = Math.round(
    (st.forgeJudgmentRotation * IGNIVAR_JUDGMENT_LAYOUT_SLOTS) / (Math.PI * 2),
  );
  st.forgeJudgmentPhase = 'warning';
  st.forgeJudgmentRemaining = IGNIVAR_JUDGMENT_DURATION_SECONDS;
  st.forgeJudgmentPulseTimer = IGNIVAR_JUDGMENT_PULSE_SECONDS;
  st.rotatingRaysWindupRemaining = 0;
  st.rotatingRaysActiveRemaining = 0;
  st.rotatingRaysPulseTimer = 0;
  st.rotatingRaysHitCooldownByPlayerId = {};
  boss.facing = ignivarForgeLayoutFacing(layoutSlot, st.forgeJudgmentSafeIndex);
  boss.castingAbility = IGNIVAR_JUDGMENT_CAST_ID;
  boss.castTotal = IGNIVAR_JUDGMENT_DURATION_SECONDS;
  boss.castRemaining = IGNIVAR_JUDGMENT_DURATION_SECONDS;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = false;
  if (!heroic) {
    for (const player of players) clearIgnivarBrand(player, boss.id);
  }
  emitIgnivarYell(ctx, boss, IGNIVAR_DIALOGUE.forgeJudgment);
}

function activateForgeJudgment(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  origin: { x: number; z: number },
): void {
  const shelters = ignivarForgeShelterPoints(origin, st.forgeJudgmentRotation);
  for (let index = 0; index < shelters.length; index++) {
    if (index === st.forgeJudgmentSafeIndex) continue;
    const shelter = shelters[index];
    ctx.emit({
      type: 'spellfxAt',
      x: shelter.x,
      z: shelter.z,
      school: 'fire',
      fx: 'burst',
      ability: IGNIVAR_JUDGMENT_CAST_ID,
      sourceId: boss.id,
    });
  }
  st.forgeJudgmentPhase = 'active';
  st.forgeJudgmentPulseTimer = 0;
  st.rotatingRaysActiveRemaining = 0;
  st.rotatingRaysPulseTimer = 0;
  st.rotatingRaysHitCooldownByPlayerId = {};
  boss.channeling = true;
}

function finishForgeJudgment(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  origin: { x: number; z: number },
): void {
  for (const shelter of ignivarForgeShelterPoints(origin, st.forgeJudgmentRotation)) {
    ctx.emit({
      type: 'spellfxAt',
      x: shelter.x,
      z: shelter.z,
      school: 'fire',
      fx: 'burst',
      ability: IGNIVAR_JUDGMENT_CAST_ID,
      sourceId: boss.id,
    });
  }
  st.forgeJudgmentPhase = 'done';
  st.forgeJudgmentRemaining = 0;
  st.forgeJudgmentPulseTimer = 0;
  st.rotatingRaysActiveRemaining = 0;
  st.brandTimer = Math.min(st.brandTimer, 8);
  st.frontalTimer = Math.max(st.frontalTimer, 4);
  st.skyfireTimer = Math.max(st.skyfireTimer, 7);
  st.meteorTimer = Math.max(st.meteorTimer, 7);
  st.rotatingRaysTimer = Math.max(st.rotatingRaysTimer, 16);
  st.forgeWaveTimer = Math.max(st.forgeWaveTimer, 20);
  st.soakTimer = Math.max(st.soakTimer, 12);
  boss.knockbackResistance = 0;
  finishIgnivarCast(boss);
}

function updateForgeJudgment(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
  heroic: boolean,
): boolean {
  if (ignivarCanStartForgeJudgment(boss, st)) {
    const layoutSlot = ctx.rng.int(0, IGNIVAR_JUDGMENT_LAYOUT_SLOTS - 1);
    st.forgeJudgmentRotation = (layoutSlot * Math.PI * 2) / IGNIVAR_JUDGMENT_LAYOUT_SLOTS;
    st.forgeJudgmentSafeIndex = ctx.rng.int(0, 2) as IgnivarJudgmentShelterIndex;
    st.forgeJudgmentPhase = 'moving';
    boss.knockbackResistance = 1;
    finishIgnivarCast(boss);
  }
  if (st.forgeJudgmentPhase === 'moving') {
    const origin = forgeJudgmentOrigin(ctx, boss);
    const destination = ctx.groundPos(origin.x, origin.z);
    if (walkEncounterActorTo(ctx, boss, destination)) {
      settleIgnivarForJudgment(boss);
      startForgeJudgment(ctx, boss, st, players, heroic);
    }
    return true;
  }
  if (st.forgeJudgmentPhase !== 'warning' && st.forgeJudgmentPhase !== 'active') return false;

  // Heroic Brands persist through Judgment. Their ordinary proximity pulse
  // therefore keeps running inside the shared refuge instead of becoming an
  // unrelated raid-wide hit or pausing for the whole intermission.
  if (heroic) {
    st.overlapTimer = Math.max(0, st.overlapTimer - DT);
    if (st.overlapTimer <= CAST_COMPLETE_EPS) {
      updateBrandOverlap(ctx, boss, players);
      st.overlapTimer = IGNIVAR_OVERLAP_PULSE_SECONDS;
    }
  }

  const origin = forgeJudgmentOrigin(ctx, boss);
  settleIgnivarForJudgment(boss);
  boss.aiState = 'idle';
  st.forgeJudgmentRemaining = Math.max(0, st.forgeJudgmentRemaining - DT);
  boss.castingAbility = IGNIVAR_JUDGMENT_CAST_ID;
  boss.castTotal = IGNIVAR_JUDGMENT_DURATION_SECONDS;
  boss.castRemaining = st.forgeJudgmentRemaining;
  boss.castTargetId = null;
  boss.castAim = null;
  const layoutSlot = Math.round(
    (st.forgeJudgmentRotation * IGNIVAR_JUDGMENT_LAYOUT_SLOTS) / (Math.PI * 2),
  );
  if (st.forgeJudgmentPhase === 'warning') {
    boss.channeling = false;
    boss.facing = ignivarForgeLayoutFacing(layoutSlot, st.forgeJudgmentSafeIndex);
    if (st.forgeJudgmentRemaining <= IGNIVAR_JUDGMENT_ACTIVE_SECONDS + CAST_COMPLETE_EPS) {
      activateForgeJudgment(ctx, boss, st, origin);
    }
    return true;
  }

  boss.channeling = true;
  boss.facing = ignivarForgeLayoutFacing(layoutSlot, st.forgeJudgmentSafeIndex);
  st.forgeJudgmentPulseTimer = Math.max(0, st.forgeJudgmentPulseTimer - DT);
  if (st.forgeJudgmentPulseTimer <= CAST_COMPLETE_EPS) {
    for (const player of players) {
      if (
        !ignivarPointOnJudgmentFire(
          origin,
          st.forgeJudgmentRotation,
          st.forgeJudgmentSafeIndex,
          player.pos,
        )
      ) {
        continue;
      }
      ctx.dealDamage(
        boss,
        player,
        Math.ceil(player.maxHp * ignivarJudgmentBurnDamageMaxHp(heroic ? 'heroic' : 'normal')),
        false,
        'fire',
        IGNIVAR_JUDGMENT_CAST_ID,
        'hit',
        true,
        undefined,
        false,
        false,
        true,
      );
    }
    st.forgeJudgmentPulseTimer = IGNIVAR_JUDGMENT_PULSE_SECONDS;
  }
  if (st.forgeJudgmentRemaining <= CAST_COMPLETE_EPS) {
    finishForgeJudgment(ctx, boss, st, origin);
  }
  return true;
}

function castBrandOfThePyre(ctx: SimContext, boss: Entity, players: readonly Entity[]): void {
  const tanks = tankIds(ctx);
  const livingCount = players.filter((player) => !player.dead).length;
  const candidates = players.filter((player) => !player.dead && !tanks.has(player.id));
  const drawSlots = Math.min(IGNIVAR_BRAND_TARGETS_NORMAL, livingCount);
  for (let i = 0; i < drawSlots; i++) {
    // Brand historically paid one draw for each living target slot. Keep that
    // stream cost even when tank exclusion leaves a slot with nobody eligible.
    const roll = ctx.rng.next();
    if (candidates.length === 0) continue;
    const picked = Math.floor(roll * candidates.length);
    const player = candidates.splice(picked, 1)[0];
    const existing = player.auras.find(
      (aura) => aura.id === IGNIVAR_BRAND_AURA_ID && aura.sourceId === boss.id,
    );
    if (existing) {
      existing.remaining = existing.duration;
      ctx.emit({
        type: 'aura',
        targetId: player.id,
        name: existing.name,
        gained: true,
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: player.id,
        school: 'fire',
        fx: 'nova',
      });
      continue;
    }
    ctx.applyAura(player, {
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: Math.max(1, Math.ceil(player.maxHp * IGNIVAR_BRAND_TICK_MAX_HP)),
      tickInterval: IGNIVAR_BRAND_TICK_SECONDS,
      tickTimer: IGNIVAR_BRAND_TICK_SECONDS,
      stacks: 1,
      maxTickStacks: IGNIVAR_BRAND_MAX_STACKS,
      sourceId: boss.id,
      school: 'fire',
      finalDamage: true,
      encounterOwned: true,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: player.id,
      school: 'fire',
      fx: 'nova',
    });
  }
}

function castForgeStrike(ctx: SimContext, boss: Entity, target: Entity): boolean {
  if (dist2d(boss.pos, target.pos) > mobEffectiveMeleeRange(boss)) return false;
  const existing = target.auras.find(
    (aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID && aura.sourceId === boss.id,
  );
  ctx.dealDamage(
    boss,
    target,
    Math.ceil(target.maxHp * IGNIVAR_FORGE_STRIKE_MAX_HP),
    false,
    'fire',
    IGNIVAR_FORGE_STRIKE_ID,
    'hit',
    true,
    undefined,
    false,
    false,
    true,
  );
  if (!target.dead) {
    if (existing) {
      existing.stacks = Math.min(
        IGNIVAR_MOLTEN_ARMOR_MAX_STACKS,
        Math.max(1, existing.stacks ?? 1) + 1,
      );
      existing.value = existing.stacks * IGNIVAR_MOLTEN_ARMOR_PER_STACK;
      existing.remaining = IGNIVAR_MOLTEN_ARMOR_DURATION;
      ctx.emit({
        type: 'aura',
        targetId: target.id,
        name: existing.name,
        gained: true,
      });
    } else {
      ctx.applyAura(target, {
        id: IGNIVAR_MOLTEN_ARMOR_AURA_ID,
        name: 'Molten Armor',
        kind: 'vuln_source',
        remaining: IGNIVAR_MOLTEN_ARMOR_DURATION,
        duration: IGNIVAR_MOLTEN_ARMOR_DURATION,
        value: IGNIVAR_MOLTEN_ARMOR_PER_STACK,
        stacks: 1,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      });
    }
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: target.id,
    school: 'fire',
    fx: 'projectile',
  });
  return true;
}

function skyfireFacings(baseFacing: number): number[] {
  return Array.from(
    { length: IGNIVAR_SKYFIRE_CONE_COUNT },
    (_, index) => baseFacing + (index * Math.PI * 2) / IGNIVAR_SKYFIRE_CONE_COUNT,
  );
}

function pointInSkyfire(boss: Entity, baseFacing: number, player: Entity): boolean {
  const dx = player.pos.x - boss.pos.x;
  const dz = player.pos.z - boss.pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance > IGNIVAR_SKYFIRE_RANGE) return false;
  if (distance <= 0.001) return true;
  for (const facing of skyfireFacings(baseFacing)) {
    const forward = (dx * Math.sin(facing) + dz * Math.cos(facing)) / distance;
    if (forward >= Math.cos(IGNIVAR_SKYFIRE_HALF_ANGLE)) return true;
  }
  return false;
}

function startSkyfire(
  ctx: SimContext,
  boss: Entity,
  target: Entity,
  st: IgnivarEncounterState,
): void {
  st.skyfireFacing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  st.skyfireCastRemaining = IGNIVAR_SKYFIRE_CAST_SECONDS;
  st.skyfireTimer = IGNIVAR_SKYFIRE_EVERY;
  boss.facing = st.skyfireFacing;
  boss.castingAbility = IGNIVAR_SKYFIRE_CAST_ID;
  boss.castTotal = IGNIVAR_SKYFIRE_CAST_SECONDS;
  boss.castRemaining = IGNIVAR_SKYFIRE_CAST_SECONDS;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = false;
  emitIgnivarYell(ctx, boss, IGNIVAR_DIALOGUE.skyfire);
}

function startMeteorRain(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
  heroic: boolean,
): void {
  const instance = encounterInstance(ctx, boss);
  const arenaOrigin = instance ? ctx.instanceOriginOf(instance) : boss.pos;
  const castKey = (Math.imul(ctx.tickCount, 0x9e3779b1) ^ boss.id) >>> 0;
  const meteorCount = heroic ? IGNIVAR_METEOR_COUNT_HEROIC : IGNIVAR_METEOR_COUNT_NORMAL;
  const targets = ignivarMeteorTargetOrder(
    castKey,
    players
      .filter((player) => !player.dead)
      .map((player) => ({ id: player.id, x: player.pos.x, z: player.pos.z })),
    boss.aggroTargetId,
    meteorCount,
  );
  st.meteorCastKey = castKey;
  st.meteorPoints = ignivarMeteorPattern(
    castKey,
    arenaOrigin,
    heroic ? 'heroic' : 'normal',
    targets,
  );
  st.meteorImpactRemaining = IGNIVAR_METEOR_TELEGRAPH_SECONDS;
  st.meteorTimer = st.lastInfernoTriggered ? IGNIVAR_FINAL_METEOR_EVERY : IGNIVAR_METEOR_EVERY;
  for (let meteorIndex = 0; meteorIndex < st.meteorPoints.length; meteorIndex++) {
    const impact = st.meteorPoints[meteorIndex];
    ctx.emit({
      type: 'spellfxAt',
      x: impact.x,
      z: impact.z,
      school: 'fire',
      fx: 'meteorFall',
      ability: IGNIVAR_METEOR_CAST_ID,
      radius: IGNIVAR_METEOR_RADIUS,
      duration: IGNIVAR_METEOR_TELEGRAPH_SECONDS,
      warningLead: IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
      persistentId: ignivarMeteorWarningId(boss.id, castKey, meteorIndex),
      sourceId: boss.id,
    });
  }
}

function resolveMeteorImpacts(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
  heroic: boolean,
): void {
  for (const player of players) {
    if (!st.meteorPoints.some((meteor) => pointInIgnivarMeteor(meteor, player.pos))) continue;
    ctx.dealDamage(
      boss,
      player,
      Math.ceil(player.maxHp * ignivarMeteorDamageMaxHp(heroic ? 'heroic' : 'normal')),
      false,
      'fire',
      IGNIVAR_METEOR_CAST_ID,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
  for (let meteorIndex = 0; meteorIndex < st.meteorPoints.length; meteorIndex++) {
    const impact = st.meteorPoints[meteorIndex];
    ctx.emit({
      type: 'spellfxAt',
      x: impact.x,
      z: impact.z,
      school: 'fire',
      fx: 'meteorImpact',
      ability: IGNIVAR_METEOR_CAST_ID,
      persistentId: ignivarMeteorWarningId(boss.id, st.meteorCastKey, meteorIndex),
      sourceId: boss.id,
    });
  }
  st.meteorPoints = [];
  st.meteorImpactRemaining = 0;
}

function updateMeteorRain(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
  heroic: boolean,
): void {
  st.meteorTimer = Math.max(0, st.meteorTimer - DT);
  if (st.meteorImpactRemaining > 0) {
    st.meteorImpactRemaining = Math.max(0, st.meteorImpactRemaining - DT);
    if (st.meteorImpactRemaining <= CAST_COMPLETE_EPS) {
      resolveMeteorImpacts(ctx, boss, st, players, heroic);
    }
  }
  if (st.meteorTimer <= CAST_COMPLETE_EPS && st.meteorPoints.length === 0) {
    startMeteorRain(ctx, boss, st, players, heroic);
  }
}

function finishIgnivarCast(boss: Entity): void {
  boss.castingAbility = null;
  boss.castTotal = 0;
  boss.castRemaining = 0;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = false;
}

function spaceIgnivarMajorAbilities(st: IgnivarEncounterState): void {
  if (st.lastInfernoTriggered) {
    st.finalFrontalTimer = Math.max(st.finalFrontalTimer, IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
    st.rotatingRaysTimer = Math.max(st.rotatingRaysTimer, IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
    return;
  }
  st.frontalTimer = Math.max(st.frontalTimer, IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
  st.skyfireTimer = Math.max(st.skyfireTimer, IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
  st.rotatingRaysTimer = Math.max(st.rotatingRaysTimer, IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
  st.forgeWaveTimer = Math.max(st.forgeWaveTimer, IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
  st.soakTimer = Math.max(st.soakTimer, IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
  st.forgeChainsTimer = Math.max(st.forgeChainsTimer, IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
}

function ignivarMajorAbilityActive(st: IgnivarEncounterState): boolean {
  return (
    st.frontalCastRemaining > 0 ||
    st.skyfireCastRemaining > 0 ||
    st.rotatingRaysWindupRemaining > 0 ||
    st.rotatingRaysActiveRemaining > 0 ||
    st.forgeWaveWindupRemaining > 0 ||
    st.forgeWaveActiveRemaining > 0
  );
}

function startRotatingRays(
  ctx: SimContext,
  boss: Entity,
  target: Entity,
  st: IgnivarEncounterState,
): void {
  st.rotatingRaysFacing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  st.rotatingRaysBossFacing = st.rotatingRaysFacing;
  st.rotatingRaysDirection = st.rotatingRaysNextDirection;
  st.rotatingRaysNextDirection = st.rotatingRaysNextDirection === 1 ? -1 : 1;
  st.rotatingRaysWindupRemaining = IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS;
  st.rotatingRaysActiveRemaining = IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS;
  st.rotatingRaysPulseTimer = 0;
  st.rotatingRaysHitCooldownByPlayerId = {};
  st.rotatingRaysTimer = st.lastInfernoTriggered
    ? IGNIVAR_FINAL_ROTATING_RAYS_EVERY
    : IGNIVAR_ROTATING_RAYS_EVERY;
  boss.facing = st.rotatingRaysFacing;
  boss.castingAbility = IGNIVAR_ROTATING_RAYS_CAST_ID;
  boss.castTotal = IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS + IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS;
  boss.castRemaining = boss.castTotal;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = true;
  emitIgnivarYell(ctx, boss, IGNIVAR_DIALOGUE.rotatingRays);
}

function damagePlayersInRotatingRays(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
): void {
  const difficulty = encounterInstance(ctx, boss)?.difficulty ?? 'normal';
  if (!st.rotatingRaysHitCooldownByPlayerId) st.rotatingRaysHitCooldownByPlayerId = {};
  const hitCooldowns = st.rotatingRaysHitCooldownByPlayerId;
  for (const player of players) {
    const hitCooldown = Math.max(0, (hitCooldowns[player.id] ?? 0) - DT);
    if (hitCooldown > CAST_COMPLETE_EPS) {
      hitCooldowns[player.id] = hitCooldown;
      continue;
    }
    delete hitCooldowns[player.id];
    if (!ignivarPointInRotatingRay(boss.pos, st.rotatingRaysFacing, player.pos)) continue;
    ctx.dealDamage(
      boss,
      player,
      Math.ceil(player.maxHp * ignivarRotatingRaysDamageMaxHp(difficulty)),
      false,
      'fire',
      IGNIVAR_ROTATING_RAYS_CAST_ID,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
    hitCooldowns[player.id] = IGNIVAR_ROTATING_RAYS_PULSE_SECONDS;
  }
}

function tickIgnivarCastTimers(st: IgnivarEncounterState): void {
  if (st.lastInfernoTriggered) {
    st.finalFrontalTimer = Math.max(0, st.finalFrontalTimer - DT);
    st.rotatingRaysTimer = Math.max(0, st.rotatingRaysTimer - DT);
    return;
  }
  st.frontalTimer = Math.max(0, st.frontalTimer - DT);
  st.skyfireTimer = Math.max(0, st.skyfireTimer - DT);
  st.rotatingRaysTimer = Math.max(0, st.rotatingRaysTimer - DT);
  st.forgeWaveTimer = Math.max(0, st.forgeWaveTimer - DT);
}

function startForgeWave(ctx: SimContext, boss: Entity, st: IgnivarEncounterState): void {
  const facingSlot = ctx.rng.int(0, 7);
  st.forgeWaveFacing = (facingSlot * Math.PI) / 4;
  st.forgeWaveTimer = IGNIVAR_FORGE_WAVE_EVERY;
  st.forgeWaveWindupRemaining = IGNIVAR_FORGE_WAVE_WINDUP_SECONDS;
  st.forgeWaveActiveRemaining = 0;
  st.forgeWaveRadius = 0;
  st.forgeWaveHitPlayerIds = [];
  boss.facing = st.forgeWaveFacing;
  boss.castingAbility = IGNIVAR_FORGE_WAVE_CAST_ID;
  boss.castTotal = IGNIVAR_FORGE_WAVE_WINDUP_SECONDS;
  boss.castRemaining = IGNIVAR_FORGE_WAVE_WINDUP_SECONDS;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = false;
}

function releaseForgeWave(ctx: SimContext, boss: Entity, st: IgnivarEncounterState): void {
  st.forgeWaveWindupRemaining = 0;
  st.forgeWaveActiveRemaining = IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS;
  st.forgeWaveRadius = 0;
  st.forgeWaveHitPlayerIds = [];
  boss.castingAbility = IGNIVAR_FORGE_WAVE_CAST_ID;
  boss.castTotal = IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS;
  boss.castRemaining = IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = true;
  ctx.emit({
    type: 'spellfxAt',
    x: boss.pos.x,
    z: boss.pos.z,
    school: 'fire',
    fx: 'burst',
    ability: IGNIVAR_FORGE_WAVE_CAST_ID,
    sourceId: boss.id,
  });
}

function updateForgeWave(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
): void {
  tickIgnivarCastTimers(st);
  boss.facing = st.forgeWaveFacing;
  boss.castingAbility = IGNIVAR_FORGE_WAVE_CAST_ID;
  if (st.forgeWaveWindupRemaining > 0) {
    st.forgeWaveWindupRemaining = Math.max(
      0,
      Math.round((st.forgeWaveWindupRemaining - DT) / DT) * DT,
    );
    boss.castRemaining = st.forgeWaveWindupRemaining;
    if (st.forgeWaveWindupRemaining <= CAST_COMPLETE_EPS) releaseForgeWave(ctx, boss, st);
    return;
  }

  const previousRadius = st.forgeWaveRadius;
  st.forgeWaveActiveRemaining = Math.max(
    0,
    Math.round((st.forgeWaveActiveRemaining - DT) / DT) * DT,
  );
  st.forgeWaveRadius = ignivarForgeWaveRadius(st.forgeWaveActiveRemaining);
  boss.castRemaining = st.forgeWaveActiveRemaining;
  const difficulty = encounterInstance(ctx, boss)?.difficulty ?? 'normal';
  const knockback = ignivarForgeWaveKnockback(difficulty);
  const alreadyHit = new Set(st.forgeWaveHitPlayerIds);
  for (const player of players) {
    if (alreadyHit.has(player.id)) continue;
    if (
      !ignivarPointSweptByForgeWave(
        boss.pos,
        st.forgeWaveFacing,
        previousRadius,
        st.forgeWaveRadius,
        player.pos,
      )
    ) {
      continue;
    }
    ctx.dealDamage(
      boss,
      player,
      Math.ceil(player.maxHp * ignivarForgeWaveDamageMaxHp(difficulty)),
      false,
      'fire',
      IGNIVAR_FORGE_WAVE_CAST_ID,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
    if (!player.dead) ctx.applyKnockback(boss, player, knockback);
    alreadyHit.add(player.id);
    st.forgeWaveHitPlayerIds.push(player.id);
  }
  if (st.forgeWaveActiveRemaining <= CAST_COMPLETE_EPS) {
    st.forgeWaveActiveRemaining = 0;
    spaceIgnivarMajorAbilities(st);
    finishIgnivarCast(boss);
  }
}

function updateRotatingRays(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
): void {
  tickIgnivarCastTimers(st);
  boss.castingAbility = IGNIVAR_ROTATING_RAYS_CAST_ID;
  if (st.rotatingRaysWindupRemaining > 0) {
    st.rotatingRaysWindupRemaining = Math.max(0, st.rotatingRaysWindupRemaining - DT);
    boss.facing = st.rotatingRaysFacing;
    boss.castRemaining = st.rotatingRaysWindupRemaining + st.rotatingRaysActiveRemaining;
    return;
  }

  st.rotatingRaysActiveRemaining = Math.max(0, st.rotatingRaysActiveRemaining - DT);
  const speedMultiplier = st.lastInfernoTriggered
    ? IGNIVAR_FINAL_ROTATING_RAYS_SPEED_MULTIPLIER
    : 1;
  st.rotatingRaysFacing +=
    st.rotatingRaysDirection * IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED * speedMultiplier * DT;
  boss.facing = st.rotatingRaysFacing;
  boss.castRemaining = st.rotatingRaysActiveRemaining;
  st.rotatingRaysPulseTimer = Math.max(0, st.rotatingRaysPulseTimer - DT);
  if (st.rotatingRaysPulseTimer <= CAST_COMPLETE_EPS) {
    st.rotatingRaysPulseTimer = IGNIVAR_ROTATING_RAYS_PULSE_SECONDS;
  }
  damagePlayersInRotatingRays(ctx, boss, st, players);
  if (st.rotatingRaysActiveRemaining <= CAST_COMPLETE_EPS) {
    st.rotatingRaysActiveRemaining = 0;
    boss.facing = st.rotatingRaysBossFacing;
    spaceIgnivarMajorAbilities(st);
    finishIgnivarCast(boss);
  }
}

function releaseSkyfire(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
): void {
  for (const facing of skyfireFacings(st.skyfireFacing)) {
    ctx.emit({
      type: 'spellfxAt',
      x: boss.pos.x + Math.sin(facing) * IGNIVAR_SKYFIRE_RANGE,
      z: boss.pos.z + Math.cos(facing) * IGNIVAR_SKYFIRE_RANGE,
      school: 'fire',
      fx: 'burst',
      ability: IGNIVAR_SKYFIRE_CAST_ID,
      sourceId: boss.id,
    });
  }
  for (const player of players) {
    if (!pointInSkyfire(boss, st.skyfireFacing, player)) continue;
    ctx.dealDamage(
      boss,
      player,
      Math.ceil(
        player.maxHp *
          ignivarSkyfireDamageMaxHp(encounterInstance(ctx, boss)?.difficulty ?? 'normal'),
      ),
      false,
      'fire',
      IGNIVAR_SKYFIRE_CAST_ID,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
  spaceIgnivarMajorAbilities(st);
  finishIgnivarCast(boss);
}

function clearSoakMark(player: Entity | undefined, bossId: number): void {
  if (!player) return;
  player.auras = player.auras.filter(
    (aura) => aura.id !== IGNIVAR_SOAK_AURA_ID || aura.sourceId !== bossId,
  );
}

function clearLegacySharedPyreState(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
): void {
  const target = st.soakTargetId === null ? undefined : ctx.entities.get(st.soakTargetId);
  clearSoakMark(target, boss.id);
  st.soakTargetId = null;
  st.soakRemaining = 0;
}

function updateLastInferno(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
): boolean {
  if (!st.lastInfernoTriggered) {
    if (st.forgeJudgmentPhase !== 'done') return false;
    if (boss.hp / Math.max(1, boss.maxHp) > IGNIVAR_LAST_INFERNO_HP_THRESHOLD) return false;
    if (st.soakTargetId !== null || ignivarMajorAbilityActive(st)) return false;
    st.lastInfernoTriggered = true;
    st.lastInfernoRemaining = IGNIVAR_LAST_INFERNO_SECONDS;
    st.brandTimer = IGNIVAR_FINAL_FIRST_BRAND_SECONDS;
    st.finalFrontalTimer = IGNIVAR_FINAL_FIRST_FRONTAL_SECONDS;
    st.finalNextFrontal = 'searing';
    st.meteorTimer = Math.min(st.meteorTimer, IGNIVAR_FINAL_FIRST_METEOR_SECONDS);
    st.rotatingRaysTimer = Math.min(
      st.rotatingRaysTimer,
      IGNIVAR_FINAL_FIRST_ROTATING_RAYS_SECONDS,
    );
    boss.enraged = true;
    ctx.applyAura(boss, {
      id: IGNIVAR_LAST_INFERNO_AURA_ID,
      name: 'Last Inferno',
      kind: 'buff_haste',
      remaining: IGNIVAR_LAST_INFERNO_SECONDS,
      duration: IGNIVAR_LAST_INFERNO_SECONDS,
      value: 1.2,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    emitIgnivarYell(ctx, boss, IGNIVAR_DIALOGUE.lastInferno);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'fire',
      fx: 'nova',
    });
    return false;
  }
  if (st.lastInfernoResolved) return false;
  st.lastInfernoRemaining = Math.max(0, st.lastInfernoRemaining - DT);
  const aura = boss.auras.find((entry) => entry.id === IGNIVAR_LAST_INFERNO_AURA_ID);
  if (aura) aura.remaining = st.lastInfernoRemaining;
  if (st.lastInfernoRemaining > CAST_COMPLETE_EPS) return false;
  st.lastInfernoRemaining = 0;
  st.lastInfernoResolved = true;
  resolveEncounterWipe(ctx, boss, players, 'Last Inferno');
  return true;
}

function updateBrandOverlap(ctx: SimContext, boss: Entity, players: readonly Entity[]): void {
  const branded = players.filter((player) =>
    player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID),
  );
  const overlapping = new Set<Entity>();
  for (const carrier of branded) {
    for (const player of players) {
      if (player.id === carrier.id) continue;
      if (
        Math.hypot(carrier.pos.x - player.pos.x, carrier.pos.z - player.pos.z) >
        IGNIVAR_BRAND_RADIUS
      ) {
        continue;
      }
      overlapping.add(carrier);
      overlapping.add(player);
    }
  }
  for (const player of overlapping) {
    ctx.dealDamage(
      boss,
      player,
      Math.ceil(player.maxHp * IGNIVAR_OVERLAP_MAX_HP),
      false,
      'fire',
      'Brand of the Pyre',
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
}

function cleansePlayersAtActiveConduits(
  ctx: SimContext,
  boss: Entity,
  players: readonly Entity[],
  conduits: ReadonlyMap<IgnivarConduitId, Entity>,
  heroic: boolean,
): void {
  let heroicCleanses = 0;
  for (const conduit of conduits.values()) {
    if (conduit.templateId !== IGNIVAR_WATER_CONDUIT_TEMPLATES.active) continue;
    for (const player of players) {
      if (player.dead) continue;
      if (
        Math.hypot(player.pos.x - conduit.pos.x, player.pos.z - conduit.pos.z) >
        IGNIVAR_WATER_CLEANSE_RADIUS
      ) {
        continue;
      }
      const before = player.auras.length;
      player.auras = player.auras.filter((aura) => aura.id !== IGNIVAR_BRAND_AURA_ID);
      if (player.auras.length === before) continue;
      ctx.emit({
        type: 'spellfx',
        sourceId: conduit.id,
        targetId: player.id,
        school: 'frost',
        fx: 'nova',
      });
      if (heroic) heroicCleanses++;
    }
  }
  for (let cleanse = 0; cleanse < heroicCleanses; cleanse++) {
    for (const target of players) {
      if (target.dead) continue;
      ctx.emit({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: target.id,
        school: 'fire',
        fx: 'nova',
      });
      ctx.dealDamage(
        boss,
        target,
        Math.ceil(target.maxHp * IGNIVAR_CLEANSING_BACKLASH_DAMAGE_MAX_HP),
        false,
        'fire',
        IGNIVAR_CLEANSING_BACKLASH_ID,
        'hit',
        true,
        undefined,
        false,
        false,
        true,
      );
    }
  }
}

function updateConduitStates(
  st: IgnivarEncounterState,
  conduits: ReadonlyMap<IgnivarConduitId, Entity>,
): void {
  for (const [id, conduit] of conduits) {
    const state = ignivarConduitStateForTemplate(conduit.templateId);
    if (state !== 'active') {
      delete st.conduitTimers[id];
      continue;
    }
    const remaining = (st.conduitTimers[id] ?? IGNIVAR_CONDUIT_ACTIVE_SECONDS) - DT;
    if (remaining > 0) {
      st.conduitTimers[id] = remaining;
      continue;
    }
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown;
    delete st.conduitTimers[id];
  }
}

function startFrontal(boss: Entity, target: Entity, st: IgnivarEncounterState): void {
  st.frontalFacing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  st.frontalCastRemaining = IGNIVAR_FRONTAL_CAST_SECONDS;
  st.frontalTimer = IGNIVAR_FRONTAL_EVERY;
  boss.facing = st.frontalFacing;
  boss.castingAbility = IGNIVAR_FRONTAL_CAST_ID;
  boss.castTotal = IGNIVAR_FRONTAL_CAST_SECONDS;
  boss.castRemaining = IGNIVAR_FRONTAL_CAST_SECONDS;
  boss.castTargetId = target.id;
  boss.castAim = { ...target.pos };
  boss.channeling = false;
}

function trackFrontalTarget(
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
  fallback: Entity,
): void {
  const target = players.find((player) => player.id === boss.castTargetId) ?? fallback;
  const dx = target.pos.x - boss.pos.x;
  const dz = target.pos.z - boss.pos.z;
  if (Math.hypot(dx, dz) > 1e-4) st.frontalFacing = Math.atan2(dx, dz);
  boss.facing = st.frontalFacing;
  boss.castTargetId = target.id;
  boss.castAim = { ...target.pos };
}

function releaseFrontal(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
  conduits: ReadonlyMap<IgnivarConduitId, Entity>,
): void {
  const instance = encounterInstance(ctx, boss);
  if (!instance) return;
  const origin = ctx.instanceOriginOf(instance);
  const localBoss = { x: boss.pos.x - origin.x, z: boss.pos.z - origin.z };
  ctx.emit({
    type: 'spellfxAt',
    x: boss.pos.x + Math.sin(st.frontalFacing) * IGNIVAR_FRONTAL_VFX_DISTANCE,
    z: boss.pos.z + Math.cos(st.frontalFacing) * IGNIVAR_FRONTAL_VFX_DISTANCE,
    school: 'fire',
    fx: 'burst',
    ability: IGNIVAR_FRONTAL_CAST_ID,
    sourceId: boss.id,
  });
  for (const player of players) {
    const localPlayer = {
      x: player.pos.x - origin.x,
      z: player.pos.z - origin.z,
    };
    if (!ignivarPointInFrontal(localBoss, st.frontalFacing, localPlayer)) continue;
    ctx.dealDamage(
      boss,
      player,
      Math.ceil(
        player.maxHp *
          ignivarFrontalDamageMaxHp(encounterInstance(ctx, boss)?.difficulty ?? 'normal'),
      ),
      false,
      'fire',
      'Searing Torrent',
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
  const ready = new Set<IgnivarConduitId>();
  for (const [id, conduit] of conduits) {
    if (conduit.templateId === IGNIVAR_WATER_CONDUIT_TEMPLATES.ready) ready.add(id);
  }
  const hit = ignivarConduitHitByFrontal(localBoss, st.frontalFacing, ready);
  if (hit) {
    const conduit = conduits.get(hit);
    if (conduit) {
      conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
      st.conduitTimers[hit] = IGNIVAR_CONDUIT_ACTIVE_SECONDS;
      ctx.emit({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: conduit.id,
        school: 'frost',
        fx: 'nova',
      });
      emitIgnivarYell(ctx, boss, IGNIVAR_DIALOGUE.conduitActivated);
    }
  }
  boss.castingAbility = null;
  boss.castTotal = 0;
  boss.castRemaining = 0;
  boss.castTargetId = null;
  boss.castAim = null;
  spaceIgnivarMajorAbilities(st);
}

export function resetIgnivarEncounter(ctx: SimContext, boss: Entity): void {
  const rotatingRaysBossFacing =
    boss.ignivar &&
    (boss.ignivar.rotatingRaysWindupRemaining > 0 || boss.ignivar.rotatingRaysActiveRemaining > 0)
      ? boss.ignivar.rotatingRaysBossFacing
      : null;
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player?.kind !== 'player') continue;
    clearIgnivarEncounterAuras(player, boss.id);
  }
  for (const conduit of conduitEntities(ctx, boss).values()) {
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.ready;
  }
  ctx.despawnSummonedAdds(boss);
  boss.ignivar = undefined;
  if (rotatingRaysBossFacing !== null) boss.facing = rotatingRaysBossFacing;
  boss.enraged = false;
  boss.auras = boss.auras.filter((aura) => aura.id !== IGNIVAR_LAST_INFERNO_AURA_ID);
  boss.castingAbility = null;
  boss.castTotal = 0;
  boss.castRemaining = 0;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = false;
  boss.knockbackResistance = 0;
}

export function clearIgnivarBrand(player: Entity, sourceId?: number): void {
  player.auras = player.auras.filter(
    (aura) =>
      aura.id !== IGNIVAR_BRAND_AURA_ID || (sourceId !== undefined && aura.sourceId !== sourceId),
  );
}

export function clearIgnivarEncounterAuras(player: Entity, sourceId?: number): void {
  clearIgnivarForgeChainAura(player, sourceId);
  player.auras = player.auras.filter(
    (aura) =>
      (aura.id !== IGNIVAR_BRAND_AURA_ID &&
        aura.id !== IGNIVAR_MOLTEN_ARMOR_AURA_ID &&
        aura.id !== IGNIVAR_SOAK_AURA_ID) ||
      (sourceId !== undefined && aura.sourceId !== sourceId),
  );
}

function tickIgnivarDialogue(st: IgnivarEncounterState): void {
  st.dialogueCooldownRemaining = Math.max(0, (st.dialogueCooldownRemaining ?? 0) - DT);
}

function ignivarDialogueHasSafeWindow(boss: Entity, st: IgnivarEncounterState): boolean {
  const hpFraction = boss.hp / Math.max(1, boss.maxHp);
  if (!st.apocalypseTriggered && hpFraction <= IGNIVAR_APOCALYPSE_HP_THRESHOLD) return false;
  if (
    st.apocalypseResolved &&
    st.forgeJudgmentPhase === 'idle' &&
    hpFraction <= IGNIVAR_JUDGMENT_HP_THRESHOLD
  ) {
    return false;
  }
  if (
    !st.lastInfernoTriggered &&
    st.forgeJudgmentPhase === 'done' &&
    hpFraction <= IGNIVAR_LAST_INFERNO_HP_THRESHOLD
  ) {
    return false;
  }
  const upcoming = st.lastInfernoTriggered
    ? [
        st.finalFrontalTimer,
        st.rotatingRaysTimer,
        st.finalBrandYellSpoken ? Number.POSITIVE_INFINITY : st.brandTimer,
      ]
    : [st.frontalTimer, st.skyfireTimer, st.rotatingRaysTimer];
  return upcoming.every((remaining) => remaining > IGNIVAR_DIALOGUE_GAP_SECONDS);
}

function announceDefeatedEncounterPlayer(
  ctx: SimContext,
  boss: Entity,
  st: IgnivarEncounterState,
  players: readonly Entity[],
): void {
  if (
    (st.dialogueCooldownRemaining ?? 0) > CAST_COMPLETE_EPS ||
    boss.castingAbility !== null ||
    ignivarMajorAbilityActive(st) ||
    !ignivarDialogueHasSafeWindow(boss, st)
  ) {
    return;
  }
  const announced = st.announcedDefeatedPlayerIds ?? [];
  const defeated = players.find(
    (player) =>
      player.dead &&
      (st.attemptParticipantIds?.includes(player.id) ?? false) &&
      !announced.includes(player.id),
  );
  if (!defeated) return;
  const yell = ignivarDefeatYell(announced.length);
  announced.push(defeated.id);
  announced.sort((a, b) => a - b);
  st.announcedDefeatedPlayerIds = announced;
  emitIgnivarYell(ctx, boss, yell);
}

export function updateIgnivarEncounter(ctx: SimContext, boss: Entity, pursueTarget = false): void {
  if (boss.templateId !== IGNIVAR_BOSS_ID || boss.dead) return;
  const allPlayers = playersInEncounter(ctx, boss, true);
  let players = allPlayers.filter((player) => !player.dead);
  if (players.length === 0) {
    boss.aiState = 'evade';
    for (const playerId of boss.ignivar?.attemptParticipantIds ?? []) {
      const player = ctx.entities.get(playerId);
      const meta = ctx.players.get(playerId);
      if (player?.kind === 'player' && meta) resetLongCooldownsForRaidWipe(player, meta.known);
    }
    resetIgnivarEncounter(ctx, boss);
    ctx.resetEvadingMob(boss);
    return;
  }
  const freshPull = boss.ignivar === undefined;
  const st = initIgnivarEncounter(boss);
  tickIgnivarDialogue(st);
  if (freshPull && boss.hp / Math.max(1, boss.maxHp) > IGNIVAR_APOCALYPSE_HP_THRESHOLD) {
    emitIgnivarYell(ctx, boss, IGNIVAR_DIALOGUE.engage);
  }
  for (const player of players) {
    if (!st.attemptParticipantIds?.includes(player.id)) st.attemptParticipantIds?.push(player.id);
  }
  st.attemptParticipantIds?.sort((a, b) => a - b);
  announceDefeatedEncounterPlayer(ctx, boss, st, allPlayers);
  // Shared Pyre now belongs to Varkhul. Clear an in-flight legacy mark from an
  // older snapshot instead of letting it block Ignivar's remaining phases.
  clearLegacySharedPyreState(ctx, boss, st);
  const conduits = conduitEntities(ctx, boss);
  updateMobTarget(ctx, boss);
  let target = resolveLivingTarget(boss, players);
  if (!target) return;
  boss.aggroTargetId = target.id;
  boss.inCombat = true;
  boss.aiState = 'attack';

  const heroic = encounterInstance(ctx, boss)?.difficulty === 'heroic';
  if (heroic && st.forgeChainsPlayerIds !== null) {
    // Active Chains owns the ordinary encounter tick, but water remains usable:
    // players must still be able to cleanse and pay the Heroic raid backlash.
    updateConduitStates(st, conduits);
    cleansePlayersAtActiveConduits(ctx, boss, players, conduits, heroic);
    const chains = updateIgnivarForgeChains(ctx, boss, st, players, false);
    if (chains === 'resolved') spaceIgnivarMajorAbilities(st);
    return;
  }
  if (updateApocalypse(ctx, boss, st, players)) return;
  if (updateForgeJudgment(ctx, boss, st, players, heroic)) return;
  updateConduitStates(st, conduits);
  cleansePlayersAtActiveConduits(ctx, boss, players, conduits, heroic);
  if (updateLastInferno(ctx, boss, st, players)) return;
  const finalPhase = st.lastInfernoTriggered;
  if (heroic && !finalPhase) {
    const chains = updateIgnivarForgeChains(
      ctx,
      boss,
      st,
      players,
      !ignivarMajorAbilityActive(st) && st.meteorPoints.length === 0,
    );
    if (chains !== 'idle') {
      if (chains === 'resolved') spaceIgnivarMajorAbilities(st);
      return;
    }
  }
  // Keep the legacy fields inert so old snapshots and developer fixtures remain readable.
  const sharedPyreBusy = false;
  updateMeteorRain(ctx, boss, st, players, heroic);
  players = playersInEncounter(ctx, boss);
  target = resolveLivingTarget(boss, players);
  if (!target) return;

  if (st.frontalCastRemaining > 0) {
    tickIgnivarCastTimers(st);
    st.frontalCastRemaining = Math.max(0, st.frontalCastRemaining - DT);
    trackFrontalTarget(boss, st, players, target);
    boss.castingAbility = IGNIVAR_FRONTAL_CAST_ID;
    boss.castRemaining = st.frontalCastRemaining;
    if (st.frontalCastRemaining <= 0) releaseFrontal(ctx, boss, st, players, conduits);
    return;
  }

  if (st.skyfireCastRemaining > 0) {
    tickIgnivarCastTimers(st);
    st.skyfireCastRemaining = Math.max(0, st.skyfireCastRemaining - DT);
    boss.facing = st.skyfireFacing;
    boss.castingAbility = IGNIVAR_SKYFIRE_CAST_ID;
    boss.castRemaining = st.skyfireCastRemaining;
    if (st.skyfireCastRemaining <= 0) releaseSkyfire(ctx, boss, st, players);
    return;
  }

  if (st.rotatingRaysWindupRemaining > 0 || st.rotatingRaysActiveRemaining > 0) {
    updateRotatingRays(ctx, boss, st, players);
    return;
  }

  if (st.forgeWaveWindupRemaining > 0 || st.forgeWaveActiveRemaining > 0) {
    updateForgeWave(ctx, boss, st, players);
    return;
  }

  if (sharedPyreBusy) return;

  st.brandTimer -= DT;
  if (st.brandTimer <= CAST_COMPLETE_EPS) {
    if (
      st.lastInfernoTriggered &&
      !st.finalBrandYellSpoken &&
      (st.dialogueCooldownRemaining ?? 0) <= DT + CAST_COMPLETE_EPS
    ) {
      emitIgnivarYell(ctx, boss, IGNIVAR_DIALOGUE.finalBrand);
      st.finalBrandYellSpoken = true;
    }
    castBrandOfThePyre(ctx, boss, players);
    st.brandTimer = ignivarBrandCadence(boss.hp / Math.max(1, boss.maxHp), st.lastInfernoTriggered);
  }

  st.overlapTimer -= DT;
  if (st.overlapTimer <= 0) {
    updateBrandOverlap(ctx, boss, players);
    st.overlapTimer = IGNIVAR_OVERLAP_PULSE_SECONDS;
    players = playersInEncounter(ctx, boss);
    target = resolveLivingTarget(boss, players);
    if (!target) return;
  }

  if (!finalPhase) {
    st.forgeStrikeTimer -= DT;
    if (st.forgeStrikeTimer <= 0 && castForgeStrike(ctx, boss, target)) {
      st.forgeStrikeTimer = IGNIVAR_FORGE_STRIKE_EVERY;
      players = playersInEncounter(ctx, boss);
      target = resolveLivingTarget(boss, players);
      if (!target) return;
    }
  }

  if (finalPhase) {
    st.finalFrontalTimer = Math.max(0, st.finalFrontalTimer - DT);
    st.rotatingRaysTimer = Math.max(0, st.rotatingRaysTimer - DT);
    if (st.rotatingRaysTimer <= CAST_COMPLETE_EPS) {
      startRotatingRays(ctx, boss, target, st);
      return;
    }
    if (st.finalFrontalTimer <= CAST_COMPLETE_EPS) {
      if (st.finalNextFrontal === 'searing') {
        startFrontal(boss, target, st);
        st.finalNextFrontal = 'skyfire';
      } else {
        const candidates = players.filter((player) => player.id !== boss.aggroTargetId);
        const aimed =
          candidates.length > 0 ? candidates[ctx.rng.int(0, candidates.length - 1)] : target;
        startSkyfire(ctx, boss, aimed, st);
        st.finalNextFrontal = 'searing';
      }
      st.finalFrontalTimer = IGNIVAR_FINAL_FRONTAL_EVERY;
      return;
    }
  } else {
    st.frontalTimer -= DT;
    st.skyfireTimer -= DT;
    st.rotatingRaysTimer -= DT;
    st.forgeWaveTimer -= DT;
    if (st.frontalTimer <= 0) {
      startFrontal(boss, target, st);
      return;
    }
    if (st.skyfireTimer <= 0) {
      const candidates = players.filter((player) => player.id !== boss.aggroTargetId);
      const aimed =
        candidates.length > 0 ? candidates[ctx.rng.int(0, candidates.length - 1)] : target;
      startSkyfire(ctx, boss, aimed, st);
      return;
    }
    if (st.rotatingRaysTimer <= 0) {
      startRotatingRays(ctx, boss, target, st);
      return;
    }
    if (st.forgeWaveTimer <= CAST_COMPLETE_EPS) {
      startForgeWave(ctx, boss, st);
      return;
    }
  }

  boss.swingTimer = Math.max(0, boss.swingTimer - DT);
  tryMobMeleeSwingInRange(ctx, boss, target);
  if (!pursueTarget) return;
  const profile = mobCombatProfile(boss);
  if (dist2d(boss.pos, target.pos) > profile.desiredRange) {
    if (!ctx.isRooted(boss)) {
      ctx.moveToward(
        boss,
        target.pos,
        boss.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(boss),
      );
    } else {
      boss.facing = steadyAngleTo(boss.pos, target.pos, boss.facing);
    }
  } else {
    boss.facing = steadyAngleTo(boss.pos, target.pos, boss.facing);
  }
  tryMobMeleeSwingInRange(ctx, boss, target);
  boss.aiState = dist2d(boss.pos, target.pos) <= profile.meleeRange ? 'attack' : 'chase';
}
