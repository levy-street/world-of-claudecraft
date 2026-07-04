// Escort runs: "walk the charge along its route and keep it alive". An
// EscortRouteDef (content) plants a world-owned ally (src/sim/ally.ts) at its
// route start; when a player with the linked quest ACTIVE comes close, the
// escortee sets out along fixed waypoints (the ally brain walks the directive;
// combat always preempts walking, which is the pause-in-combat behavior for
// free). Scripted ambushes spawn at declared waypoints, pre-aggroed onto the
// escortee. Reaching the end completes the 'escort' objective for every
// accumulated participant; the escortee dying fails and resets the route
// after a cooldown. If every quest-holder falls behind, the escortee waits.
//
// Determinism: waypoints, ambush composition, offsets, and levels are fixed
// data; this module draws NO rng.

import { type AllyDirective, spawnAllyAt } from '../ally';
import { ESCORT_ROUTES, MOBS, QUESTS } from '../data';
import { createMob } from '../entity';
import { checkQuestReady } from '../quests/quest_credit';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import { DT, dist2d, type Entity, type EscortRouteDef } from '../types';

const WAYPOINT_ARRIVE = 1.2; // yards: close enough to advance the route

export interface EscortRunState {
  routeId: string;
  escorteeEntityId: number;
  phase: 'waiting' | 'walking' | 'paused' | 'cooldown';
  wpIndex: number;
  timer: number;
  ambushMobIds: number[];
  participants: Set<number>;
}

function directiveFor(
  route: EscortRouteDef,
  moveTo: { x: number; z: number } | null,
): AllyDirective {
  return {
    // the post follows the escortee's progress so the ally leash never yanks
    // it home mid-route; refreshed every waypoint
    post: { x: route.start.x, y: 0, z: route.start.z },
    engageRadius: 14,
    moveTo: moveTo ? { x: moveTo.x, y: 0, z: moveTo.z } : null,
  };
}

/** Sim-ctor spawner: plant every route's escortee at its start. No rng. */
export function spawnEscortRoutes(ctx: SimContext): void {
  for (const route of Object.values(ESCORT_ROUTES)) {
    const ally = spawnAllyAt(
      ctx,
      route.escorteeTemplateId,
      route.escorteeLevel,
      route.start.x,
      route.start.z,
      0,
      directiveFor(route, null),
    );
    ctx.escortRuns.set(route.id, {
      routeId: route.id,
      escorteeEntityId: ally.id,
      phase: 'waiting',
      wpIndex: 0,
      timer: 0,
      ambushMobIds: [],
      participants: new Set(),
    });
  }
}

function questHoldersNear(
  ctx: SimContext,
  route: EscortRouteDef,
  around: { x: number; z: number },
): PlayerMeta[] {
  const out: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    if (meta.questLog.get(route.questId)?.state !== 'active') continue;
    if (dist2d(e.pos, { x: around.x, y: 0, z: around.z }) > route.engageRange) continue;
    out.push(meta);
  }
  return out;
}

function setParticipantCounts(ctx: SimContext, route: EscortRouteDef, count: number): void {
  const state = ctx.escortRuns.get(route.id);
  if (!state) return;
  const obj = QUESTS[route.questId].objectives[route.objectiveIndex];
  for (const pid of state.participants) {
    const meta = ctx.players.get(pid);
    const qp = meta?.questLog.get(route.questId);
    if (!meta || !qp || qp.state !== 'active') continue;
    if (qp.counts[route.objectiveIndex] === count) continue;
    qp.counts[route.objectiveIndex] = count;
    meta.counters.questProgress++;
    ctx.emit({
      type: 'questProgress',
      questId: route.questId,
      text: `${obj.label}: ${count}/${obj.count}`,
      pid,
    });
    checkQuestReady(ctx, qp, meta);
  }
}

function emitToParticipants(ctx: SimContext, state: EscortRunState, ev: object): void {
  for (const pid of state.participants) {
    ctx.emit({ ...(ev as Record<string, unknown>), pid } as never);
  }
}

function spawnAmbush(ctx: SimContext, route: EscortRouteDef, state: EscortRunState): void {
  const wp = route.waypoints[state.wpIndex];
  if (!wp?.ambush) return;
  const escortee = ctx.entities.get(state.escorteeEntityId);
  for (const spawn of wp.ambush) {
    const mob = createMob(
      ctx.nextId++,
      MOBS[spawn.mobId],
      spawn.level,
      ctx.groundPos(wp.x + spawn.dx, wp.z + spawn.dz),
    );
    ctx.addEntity(mob);
    if (escortee && !escortee.dead) {
      addThreat(mob, escortee.id, 1);
      mob.aggroTargetId = escortee.id;
      mob.aiState = 'chase';
      mob.inCombat = true;
    }
    state.ambushMobIds.push(mob.id);
  }
}

function cleanupAmbush(ctx: SimContext, state: EscortRunState): void {
  for (const id of state.ambushMobIds) {
    const m = ctx.entities.get(id);
    if (!m) continue;
    if (m.dead) m.respawnTimer = Number.POSITIVE_INFINITY;
    else ctx.dropEntity(id);
  }
  state.ambushMobIds = [];
}

/** Ally-death fan-out target: the escortee falling fails the run. */
export function onAllyDeathForEscort(ctx: SimContext, ally: Entity): void {
  for (const route of Object.values(ESCORT_ROUTES)) {
    const state = ctx.escortRuns.get(route.id);
    if (!state || state.escorteeEntityId !== ally.id) continue;
    if (state.phase === 'walking' || state.phase === 'paused') {
      cleanupAmbush(ctx, state);
      setParticipantCounts(ctx, route, 0);
      emitToParticipants(ctx, state, {
        type: 'escortProgress',
        routeId: route.id,
        state: 'failed',
      });
    }
    state.phase = 'cooldown';
    state.timer = route.cooldownSeconds;
  }
}

/** Per-tick driver (end-of-tick block, beside the defense events). Idle routes
 *  only scan for a nearby quest-holder; nothing else moves. */
export function updateEscorts(ctx: SimContext): void {
  for (const route of Object.values(ESCORT_ROUTES)) {
    const state = ctx.escortRuns.get(route.id);
    if (!state) continue;
    const escortee = ctx.entities.get(state.escorteeEntityId);

    if (state.phase === 'cooldown') {
      state.timer -= DT;
      if (state.timer > 0) continue;
      if (escortee) ctx.dropEntity(escortee.id);
      const fresh = spawnAllyAt(
        ctx,
        route.escorteeTemplateId,
        route.escorteeLevel,
        route.start.x,
        route.start.z,
        0,
        directiveFor(route, null),
      );
      state.escorteeEntityId = fresh.id;
      state.phase = 'waiting';
      state.wpIndex = 0;
      state.participants.clear();
      continue;
    }
    if (!escortee || escortee.dead) continue; // death hook owns the transition

    if (state.phase === 'waiting') {
      const holders = questHoldersNear(ctx, route, {
        x: escortee.pos.x,
        z: escortee.pos.z,
      });
      if (holders.length === 0) continue;
      state.phase = 'walking';
      state.wpIndex = 0;
      for (const m of holders) state.participants.add(m.entityId);
      setParticipantCounts(ctx, route, 0);
      ctx.allyDirectives.set(escortee.id, directiveFor(route, route.waypoints[0]));
      emitToParticipants(ctx, state, {
        type: 'escortProgress',
        routeId: route.id,
        state: 'started',
      });
      continue;
    }

    // walking/paused: escort pauses while nobody holding the quest keeps up
    const holders = questHoldersNear(ctx, route, { x: escortee.pos.x, z: escortee.pos.z });
    if (state.phase === 'walking' && holders.length === 0) {
      state.phase = 'paused';
      ctx.allyDirectives.set(escortee.id, directiveFor(route, null));
      // keep the pause anchor where the escortee stands, not the route start
      const dir = ctx.allyDirectives.get(escortee.id);
      if (dir) dir.post = { ...escortee.pos };
      emitToParticipants(ctx, state, {
        type: 'escortProgress',
        routeId: route.id,
        state: 'paused',
      });
      continue;
    }
    if (state.phase === 'paused') {
      if (holders.length === 0) continue;
      for (const m of holders) state.participants.add(m.entityId);
      state.phase = 'walking';
      ctx.allyDirectives.set(escortee.id, directiveFor(route, route.waypoints[state.wpIndex]));
      const dir = ctx.allyDirectives.get(escortee.id);
      if (dir) dir.post = { ...escortee.pos };
      emitToParticipants(ctx, state, {
        type: 'escortProgress',
        routeId: route.id,
        state: 'resumed',
      });
      continue;
    }

    // walking: advance waypoints as the escortee arrives
    for (const m of holders) state.participants.add(m.entityId);
    const wp = route.waypoints[state.wpIndex];
    const dir = ctx.allyDirectives.get(escortee.id);
    if (dir) {
      // anchor the leash to the escortee so a fight never yanks it to start
      dir.post = { ...escortee.pos };
      dir.moveTo = escortee.inCombat ? dir.moveTo : { x: wp.x, y: 0, z: wp.z };
    }
    if (dist2d(escortee.pos, { x: wp.x, y: 0, z: wp.z }) > WAYPOINT_ARRIVE) continue;
    spawnAmbush(ctx, route, state);
    state.wpIndex++;
    if (state.wpIndex < route.waypoints.length) {
      ctx.allyDirectives.set(escortee.id, directiveFor(route, route.waypoints[state.wpIndex]));
      const nd = ctx.allyDirectives.get(escortee.id);
      if (nd) nd.post = { ...escortee.pos };
      continue;
    }
    // route complete
    setParticipantCounts(ctx, route, 1);
    emitToParticipants(ctx, state, { type: 'escortProgress', routeId: route.id, state: 'done' });
    cleanupAmbush(ctx, state);
    state.phase = 'cooldown';
    state.timer = route.cooldownSeconds;
  }
}
