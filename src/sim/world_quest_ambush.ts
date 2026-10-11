// Portal ambushes for World Quests: a telegraphed rift on the work site that
// pours out two waves of raiders and a promoted leader once a player's progress
// crosses a threshold. The first consumer is the Farshore salvage (the wreck
// draws raiders when half the debris is gone); a second activity adds a def.
//
// Shared world entities, on purpose: a world quest is a shared site, so every
// player on the strand fights the same waves and anyone may kill the leader.
// The player whose pickup opened the portal earns the leader purse if still on
// the site. Spawn placement is an rng-free ring (the escort wave rule): no
// shared rng draw, so goldens and seeded tests stay byte-stable.
//
// Wave mobs are summoned adds scoped to the ambush: they never respawn in place
// (mob.runScoped) and unravel with their corpse decay (mob.summonedAdd), exactly
// like an escort wave. An ambush nobody stays for is torn down after a grace
// period so an abandoned pack never haunts the beach.
//
// State is keyed by SimContext in a module WeakMap, transient by design: a
// server restart simply forgets an open ambush (the cooldown with it), the same
// way an interrupted escort run is forgotten.

import { MOBS } from './data';
import { createMob } from './entity';
import { applyDungeonSpawnMinibossTuning } from './instances/dungeon_spawn_miniboss';
import { emitMobYell } from './mob/yells';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { addThreat } from './threat';
import type { Entity, WorldQuestBannerId } from './types';
import { awardWorldQuestBonusCopper, worldQuestBonusCopper } from './world_quest_bonus';

export interface WorldQuestAmbushWave {
  mobId: string;
  count: number;
  level: number;
}

export interface WorldQuestAmbushDef {
  questId: string;
  /** Where the rift opens; waves ring it. */
  portal: { x: number; z: number };
  /** Progress count that opens the portal (once per cooldown). */
  triggerCount: number;
  waves: readonly WorldQuestAmbushWave[];
  leader: { mobId: string; level: number; healthMultiplier: number; scale: number };
  /** What the captain shouts as he steps through (content text, relocalized by the client). */
  leaderYell: string;
  /** Purse for the player who opened the portal, paid when the leader falls. */
  purse: { base: number; perLevel: number };
  /** Seconds the rift telegraphs before a wave steps out. */
  telegraphSeconds: number;
  /** Seconds after the leader falls (or the site is abandoned) before it can reopen. */
  cooldownSeconds: number;
  /** Nobody within this many yards of the portal for abandonSeconds tears it down. */
  abandonYards: number;
  abandonSeconds: number;
  /** Spawn ring radius around the portal. */
  ringYards: number;
}

export const WORLD_QUEST_AMBUSH_PORTAL_ABILITY_ID = 'Raider Rift';

/** The wreck's raiders: half the debris recovered and the strand is contested. */
export const FARSHORE_SALVAGE_AMBUSH: WorldQuestAmbushDef = {
  questId: 'wq_farshore_salvage',
  // Dry approach south of Gull Mere; the whole authored scatter stays within
  // abandonYards, so collecting its eastern pieces cannot abandon the battle.
  portal: { x: 340, z: 100 },
  triggerCount: 4,
  waves: [
    { mobId: 'vale_bandit', count: 3, level: 5 },
    { mobId: 'vale_bandit', count: 4, level: 5 },
  ],
  leader: { mobId: 'vale_bandit', level: 7, healthMultiplier: 4, scale: 1.3 },
  leaderYell: 'You will not have our plunder! Take the beach, lads!',
  purse: { base: 1_200, perLevel: 90 },
  telegraphSeconds: 2,
  cooldownSeconds: 180,
  abandonYards: 60,
  abandonSeconds: 45,
  ringYards: 3,
};

export type WorldQuestAmbushPhase = 'portal' | 'wave' | 'leader' | 'done';

export interface WorldQuestAmbushState {
  phase: WorldQuestAmbushPhase;
  /** Index of the wave the current phase spawned (or is about to). */
  wave: number;
  /** Sim time the current phase began. */
  since: number;
  mobIds: number[];
  leaderId: number | null;
  openedBy: number;
  lastSeenPlayerAt: number;
  cooldownUntil: number;
  lastTick: number;
}

const STATES = new WeakMap<SimContext, Map<string, WorldQuestAmbushState>>();

function states(ctx: SimContext): Map<string, WorldQuestAmbushState> {
  let map = STATES.get(ctx);
  if (!map) {
    map = new Map();
    STATES.set(ctx, map);
  }
  return map;
}

/** Test and HUD-side read: the live ambush for a def, if any. */
export function worldQuestAmbushState(
  ctx: SimContext,
  def: WorldQuestAmbushDef,
): WorldQuestAmbushState | undefined {
  return states(ctx).get(def.questId);
}

function playersNear(ctx: SimContext, def: WorldQuestAmbushDef, yards: number): PlayerMeta[] {
  const out: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    if (Math.hypot(e.pos.x - def.portal.x, e.pos.z - def.portal.z) <= yards) out.push(meta);
  }
  return out;
}

function tellNearby(ctx: SimContext, def: WorldQuestAmbushDef, banner: WorldQuestBannerId): void {
  for (const meta of playersNear(ctx, def, def.abandonYards))
    ctx.emit({ type: 'worldQuestBanner', banner, pid: meta.entityId });
}

function telegraph(ctx: SimContext, def: WorldQuestAmbushDef, seconds: number): void {
  ctx.emit({
    type: 'spellfxAt',
    x: def.portal.x,
    z: def.portal.z,
    school: 'arcane',
    fx: 'burst',
    sourceId: 0,
    radius: 4,
    duration: seconds,
    ability: WORLD_QUEST_AMBUSH_PORTAL_ABILITY_ID,
  });
}

function spawnRing(
  ctx: SimContext,
  def: WorldQuestAmbushDef,
  state: WorldQuestAmbushState,
  wave: WorldQuestAmbushWave,
  promote: WorldQuestAmbushDef['leader'] | null,
): void {
  const template = MOBS[wave.mobId];
  if (!template) return;
  const opener = ctx.entities.get(state.openedBy);
  for (let i = 0; i < wave.count; i++) {
    const angle = (i / wave.count) * Math.PI * 2;
    const pos = ctx.groundPos(
      def.portal.x + Math.sin(angle) * def.ringYards,
      def.portal.z + Math.cos(angle) * def.ringYards,
    );
    const mob = createMob(ctx.nextId++, template, wave.level, pos);
    mob.summonedAdd = true;
    mob.runScoped = true;
    if (promote)
      applyDungeonSpawnMinibossTuning(mob, {
        healthMultiplier: promote.healthMultiplier,
        scale: promote.scale,
      });
    ctx.addEntity(mob);
    mob.leashAnchor = { ...mob.pos };
    if (opener && !opener.dead) {
      // Commit the wave to whoever opened the rift; anyone who hits it pulls
      // it over through the ordinary threat rules.
      mob.aiState = 'chase';
      mob.aggroTargetId = opener.id;
      mob.inCombat = true;
      addThreat(mob, opener.id, 1);
    }
    state.mobIds.push(mob.id);
    if (promote) state.leaderId = mob.id;
  }
}

function allDead(ctx: SimContext, ids: readonly number[]): boolean {
  return ids.every((id) => {
    const e = ctx.entities.get(id);
    return !e || e.dead;
  });
}

function tearDown(ctx: SimContext, state: WorldQuestAmbushState): void {
  for (const id of state.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead) continue;
    for (const meta of ctx.players.values()) {
      const p = ctx.entities.get(meta.entityId);
      if (p?.targetId === id) p.targetId = null;
    }
    ctx.dropEntity(id);
  }
  state.mobIds = [];
  state.leaderId = null;
}

/** Called from the credit path: opens the rift when the trigger count is reached. */
export function triggerWorldQuestAmbush(
  ctx: SimContext,
  def: WorldQuestAmbushDef,
  meta: PlayerMeta,
  count: number,
): boolean {
  if (count !== def.triggerCount) return false;
  const map = states(ctx);
  const existing = map.get(def.questId);
  if (existing && (existing.phase !== 'done' || ctx.time < existing.cooldownUntil)) return false;
  map.set(def.questId, {
    phase: 'portal',
    wave: 0,
    since: ctx.time,
    mobIds: [],
    leaderId: null,
    openedBy: meta.entityId,
    lastSeenPlayerAt: ctx.time,
    cooldownUntil: 0,
    lastTick: -1,
  });
  telegraph(ctx, def, def.telegraphSeconds);
  tellNearby(ctx, def, 'riftOpens');
  return true;
}

/** Once per tick (any caller may invoke it more often): drives the wave machine. */
export function updateWorldQuestAmbush(ctx: SimContext, def: WorldQuestAmbushDef): void {
  const state = states(ctx).get(def.questId);
  if (!state || state.phase === 'done' || state.lastTick === ctx.tickCount) return;
  state.lastTick = ctx.tickCount;
  if (playersNear(ctx, def, def.abandonYards).length > 0) state.lastSeenPlayerAt = ctx.time;
  else if (ctx.time - state.lastSeenPlayerAt >= def.abandonSeconds) {
    tearDown(ctx, state);
    state.phase = 'done';
    state.cooldownUntil = ctx.time + def.cooldownSeconds;
    return;
  }
  const elapsed = ctx.time - state.since;
  if (state.phase === 'portal') {
    if (elapsed < def.telegraphSeconds) return;
    const wave = def.waves[state.wave];
    if (!wave) return;
    spawnRing(ctx, def, state, wave, null);
    state.phase = 'wave';
    state.since = ctx.time;
    return;
  }
  if (state.phase === 'wave') {
    if (!allDead(ctx, state.mobIds)) return;
    state.mobIds = [];
    state.wave++;
    const next = def.waves[state.wave];
    if (next) {
      // The next wave steps through on a shorter telegraph.
      state.phase = 'portal';
      state.since = ctx.time - def.telegraphSeconds / 2;
      telegraph(ctx, def, def.telegraphSeconds / 2);
      return;
    }
    spawnRing(
      ctx,
      def,
      state,
      { mobId: def.leader.mobId, count: 1, level: def.leader.level },
      def.leader,
    );
    state.phase = 'leader';
    state.since = ctx.time;
    telegraph(ctx, def, def.telegraphSeconds / 2);
    tellNearby(ctx, def, 'captainSteps');
    const captain = state.leaderId === null ? undefined : ctx.entities.get(state.leaderId);
    if (captain) emitMobYell(ctx, captain, def.leaderYell);
    return;
  }
  if (state.phase === 'leader') {
    if (!allDead(ctx, state.mobIds)) return;
    state.phase = 'done';
    state.cooldownUntil = ctx.time + def.cooldownSeconds;
    state.mobIds = [];
    state.leaderId = null;
    tellNearby(ctx, def, 'riftRouted');
    const opener = ctx.players.get(state.openedBy);
    const openerEntity = opener && ctx.entities.get(opener.entityId);
    if (
      opener &&
      openerEntity &&
      !openerEntity.dead &&
      Math.hypot(openerEntity.pos.x - def.portal.x, openerEntity.pos.z - def.portal.z) <=
        def.abandonYards
    ) {
      awardWorldQuestBonusCopper(
        ctx,
        opener,
        worldQuestBonusCopper(def.purse.base, def.purse.perLevel, openerEntity.level),
      );
    }
  }
}

/** Test-only: forget every ambush on this context. */
export function resetWorldQuestAmbushesForTest(ctx: SimContext): void {
  STATES.delete(ctx);
}

export type { Entity as WorldQuestAmbushEntity };
