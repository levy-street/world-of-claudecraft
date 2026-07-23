// Deterministic open-world escort quests. A player starts an active escort by
// speaking to its traveler. The traveler follows the objective's authored path,
// pausing at authored ambushes until their attackers are defeated. Nearby players
// with the same active quest may join the run and receive shared completion credit.
//
// Runtime state stays on Sim and is exposed through SimContext. Runs are intentionally
// session-only: after a realm restart an active quest remains in the character log and
// its traveler is waiting at the start again. This module draws no shared rng.

import { MOBS, NPCS, QUESTS } from '../data';
import { createMob } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  dist2d,
  type Entity,
  type QuestObjective,
  type QuestProgress,
  questObjectiveRequired,
} from '../types';

type EscortObjective = Extract<QuestObjective, { type: 'escort' }>;

export interface QuestEscortRun {
  questId: string;
  objectiveIndex: number;
  npcEntityId: number;
  pathIndex: number;
  nextAmbushIndex: number;
  participants: Set<number>;
  waveIds: Set<number>;
  ambusherIds: Set<number>;
}

const ESCORT_SPEED = 4.5;
const ESCORT_WAYPOINT_RADIUS = 1.25;
const ESCORT_JOIN_RADIUS = 18;
const ESCORT_CREDIT_RADIUS = 55;
const AMBUSH_SPAWN_RADIUS = 5;

function escortObjective(questId: string, objectiveIndex: number): EscortObjective | undefined {
  const objective = QUESTS[questId]?.objectives[objectiveIndex];
  return objective?.type === 'escort' ? objective : undefined;
}

function activeProgress(
  meta: PlayerMeta,
  questId: string,
  objectiveIndex: number,
): QuestProgress | undefined {
  const progress = meta.questLog.get(questId);
  const quest = QUESTS[questId];
  if (progress?.state !== 'active' || !quest) return undefined;
  if (progress.counts[objectiveIndex] >= questObjectiveRequired(quest, progress, objectiveIndex)) {
    return undefined;
  }
  return progress;
}

function resetTraveler(ctx: SimContext, npc: Entity, objective: EscortObjective): void {
  const npcDef = NPCS[objective.targetNpcId];
  const start = objective.path[0] ?? npcDef?.pos;
  if (!start) return;
  const pos = ctx.groundPos(start.x, start.z);
  npc.pos = { ...pos };
  npc.prevPos = { ...pos };
  npc.spawnPos = { ...pos };
  npc.dead = false;
  npc.hp = npc.maxHp;
  npc.inCombat = false;
  npc.targetId = null;
  npc.aggroTargetId = null;
  if (npcDef) {
    npc.facing = npcDef.facing;
    npc.prevFacing = npcDef.facing;
  }
  npc.auras = [];
}

function cleanupRun(ctx: SimContext, key: string, run: QuestEscortRun): void {
  for (const id of run.ambusherIds) ctx.dropEntity(id);
  const npc = ctx.entities.get(run.npcEntityId);
  const objective = escortObjective(run.questId, run.objectiveIndex);
  if (npc && objective) resetTraveler(ctx, npc, objective);
  ctx.questEscortRuns.delete(key);
}

function spawnAmbush(
  ctx: SimContext,
  run: QuestEscortRun,
  npc: Entity,
  objective: EscortObjective,
): void {
  const ambush = objective.ambushes[run.nextAmbushIndex];
  if (!ambush) return;
  const template = MOBS[ambush.mobId];
  if (!template) return;
  for (let i = 0; i < ambush.count; i++) {
    const angle = (Math.PI * 2 * i) / Math.max(1, ambush.count) + run.nextAmbushIndex * 0.7;
    const pos = ctx.groundPos(
      npc.pos.x + Math.sin(angle) * AMBUSH_SPAWN_RADIUS,
      npc.pos.z + Math.cos(angle) * AMBUSH_SPAWN_RADIUS,
    );
    const mob = createMob(ctx.nextId++, template, template.maxLevel, pos);
    mob.facing = Math.atan2(npc.pos.x - mob.pos.x, npc.pos.z - mob.pos.z);
    mob.prevFacing = mob.facing;
    mob.aggroTargetId = npc.id;
    mob.aiState = 'chase';
    mob.inCombat = true;
    mob.threat.set(npc.id, 1);
    ctx.addEntity(mob);
    run.waveIds.add(mob.id);
    run.ambusherIds.add(mob.id);
  }
  run.nextAmbushIndex++;
}

function addNearbyParticipants(ctx: SimContext, run: QuestEscortRun, npc: Entity): void {
  for (const meta of ctx.players.values()) {
    if (!activeProgress(meta, run.questId, run.objectiveIndex)) continue;
    const player = ctx.entities.get(meta.entityId);
    if (player && !player.dead && dist2d(player.pos, npc.pos) <= ESCORT_JOIN_RADIUS) {
      run.participants.add(meta.entityId);
    }
  }
}

function finishEscort(
  ctx: SimContext,
  key: string,
  run: QuestEscortRun,
  npc: Entity,
  objective: EscortObjective,
): void {
  const quest = QUESTS[run.questId];
  for (const pid of run.participants) {
    const meta = ctx.players.get(pid);
    const player = ctx.entities.get(pid);
    if (!meta || !player || dist2d(player.pos, npc.pos) > ESCORT_CREDIT_RADIUS) continue;
    const progress = activeProgress(meta, run.questId, run.objectiveIndex);
    if (!progress) continue;
    const required = questObjectiveRequired(quest, progress, run.objectiveIndex);
    progress.counts[run.objectiveIndex] = required;
    meta.counters.questProgress++;
    ctx.emit({
      type: 'questProgress',
      questId: run.questId,
      objectiveIndex: run.objectiveIndex,
      current: required,
      required,
      text: `${objective.label}: ${required}/${required}`,
      pid,
    });
    ctx.checkQuestReady(progress, meta);
  }
  cleanupRun(ctx, key, run);
}

export function tryStartQuestEscort(ctx: SimContext, npc: Entity, meta: PlayerMeta): boolean {
  for (const progress of meta.questLog.values()) {
    if (progress.state !== 'active') continue;
    const quest = QUESTS[progress.questId];
    if (!quest) continue;
    for (const [objectiveIndex, objective] of quest.objectives.entries()) {
      if (objective.type !== 'escort' || objective.targetNpcId !== npc.templateId) continue;
      if (!activeProgress(meta, progress.questId, objectiveIndex)) continue;
      const key = `${progress.questId}:${objectiveIndex}`;
      let run = ctx.questEscortRuns.get(key);
      if (!run) {
        resetTraveler(ctx, npc, objective);
        run = {
          questId: progress.questId,
          objectiveIndex,
          npcEntityId: npc.id,
          pathIndex: Math.min(1, objective.path.length),
          nextAmbushIndex: 0,
          participants: new Set<number>(),
          waveIds: new Set<number>(),
          ambusherIds: new Set<number>(),
        };
        ctx.questEscortRuns.set(key, run);
      }
      run.participants.add(meta.entityId);
      return true;
    }
  }
  return false;
}

export function updateQuestEscorts(ctx: SimContext): void {
  for (const [key, run] of ctx.questEscortRuns) {
    const objective = escortObjective(run.questId, run.objectiveIndex);
    const npc = ctx.entities.get(run.npcEntityId);
    if (!objective || !npc || npc.kind !== 'npc' || npc.dead) {
      cleanupRun(ctx, key, run);
      continue;
    }

    for (const pid of run.participants) {
      const meta = ctx.players.get(pid);
      if (!meta || !activeProgress(meta, run.questId, run.objectiveIndex)) {
        run.participants.delete(pid);
      }
    }
    addNearbyParticipants(ctx, run, npc);
    if (run.participants.size === 0) {
      cleanupRun(ctx, key, run);
      continue;
    }

    let waveAlive = false;
    for (const id of run.waveIds) {
      const mob = ctx.entities.get(id);
      if (mob && !mob.dead) {
        waveAlive = true;
        continue;
      }
      ctx.dropEntity(id);
      run.waveIds.delete(id);
      run.ambusherIds.delete(id);
    }
    if (waveAlive) continue;

    if (run.pathIndex >= objective.path.length) {
      finishEscort(ctx, key, run, npc, objective);
      continue;
    }

    const waypointIndex = run.pathIndex;
    const waypoint = objective.path[waypointIndex];
    const destination = ctx.groundPos(waypoint.x, waypoint.z);
    // Authored routes already avoid terrain hazards. Ignore prop colliders so a
    // traveler cannot be permanently pinned by a camp tent, fence, or town crate.
    ctx.moveToward(npc, destination, ESCORT_SPEED, true);
    if (dist2d(npc.pos, destination) > ESCORT_WAYPOINT_RADIUS) continue;
    run.pathIndex++;

    const ambush = objective.ambushes[run.nextAmbushIndex];
    if (ambush?.atWaypoint === waypointIndex) spawnAmbush(ctx, run, npc, objective);
  }
}
