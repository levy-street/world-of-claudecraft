// The Last Bell scenario sequencer: ordered stages with party-wide progress,
// the spine every story instance runs on. A scenario is data-as-code
// (ScenarioDef in src/sim/content/scenarios/), one per story quest; a RUN is
// per instance claim, so grouped players share one scenario while strangers
// in their own claims never collide.
//
// Division of labor (the load-bearing decision): the QUEST pipeline stays
// the single source of truth for objective progress. Kill, collect, and
// interact objectives already credit inside instances through
// quests/quest_credit.ts, so a stage declares WHICH quest objective it
// tracks and completes when a participant's count fills (party kill credit
// is already shared). The sequencer owns everything around that: stage
// spawns (rng-free rings, fixed levels, the escort pattern), stage ground
// objects, squad directives, scene hooks, reach/survive/scene stages that
// have no quest counter, wipe-retry, and advancing the world when a stage
// ends. It never invents a parallel objective system.
//
// Failure: combat stages retry from stage start. A wipe (no living player
// left inside the claim) despawns the stage's spawns and re-arms the stage,
// so ghosts running back meet the stage fresh, never a full-campaign reset.
//
// Determinism: stage transitions are tick-driven; spawn placement is
// even-ring rng-free; levels are fixed by the def. A scenario draws shared
// rng only through ordinary combat once its mobs fight, which exists only
// inside new-content instances, so the existing world's draw order never
// moves.

import { DUNGEONS, MOBS, QUESTS } from '../data';
import { createGroundObject, createMob } from '../entity';
import { instanceOriginOf } from '../instances/dungeons';
import { enterStoryInstance, storyInstanceKeyFor } from '../instances/story_instances';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { despawnSquad, type SquadDirective, setSquadDirective, spawnSquad } from '../squad/squad';
import { addThreat } from '../threat';
import { dist2d, type Entity, questObjectiveRequired } from '../types';

export interface ScenarioSpawnDef {
  mobId: string;
  count: number;
  /** Instance-local ring center. */
  x: number;
  z: number;
  radius?: number;
  /** Fixed level (defaults to the template's minLevel: rng-free either way). */
  level?: number;
  /** Seed threat onto the nearest player so the wave commits (escort pattern). */
  aggro?: boolean;
}

export interface ScenarioObjectDef {
  templateId: string;
  name: string;
  /** Instance-local. */
  x: number;
  z: number;
}

export type ScenarioStageObjective =
  | { kind: 'quest'; objectiveIndex: number }
  | { kind: 'killSpawned' }
  | { kind: 'reach'; x: number; z: number; radius: number }
  | { kind: 'survive'; seconds: number }
  // Completes when the stage's cued scene finishes (or was skipped); a
  // stage without a live playback completes immediately.
  | { kind: 'scene' };

export interface ScenarioStageDef {
  id: string;
  objective: ScenarioStageObjective;
  spawns?: readonly ScenarioSpawnDef[];
  objects?: readonly ScenarioObjectDef[];
  directives?: readonly { actorId: string; directive: SquadDirective }[];
  /** Scene script to play at stage start (scene system, src/sim/scenes/). */
  sceneId?: string;
  /** Combat stages retry from stage start on a wipe (the default for any
   * stage that spawns); set false for stages that must never re-arm. */
  retryOnWipe?: boolean;
}

export interface ScenarioDef {
  id: string;
  dungeonId: string;
  questId: string;
  squad?: { actorIds: readonly string[]; floorEnabled?: boolean };
  stages: readonly ScenarioStageDef[];
  /** Despawn the squad when the run completes (default true). */
  despawnSquadOnComplete?: boolean;
}

export interface ScenarioRun {
  scenarioId: string;
  claimId: number;
  dungeonId: string;
  stageIndex: number;
  /** Entity ids spawned by the CURRENT stage (cleared on advance/retry). */
  stageSpawnIds: number[];
  stageObjectIds: number[];
  /** Sim-time the current stage armed (survive/scene timers). */
  stageStartedAt: number;
  stageArmed: boolean;
  done: boolean;
}

// Content registry: scenario defs register at module load (content modules
// call registerScenario). Kept as a plain module table like ESCORTS/QUESTS.
const SCENARIOS: Record<string, ScenarioDef> = {};

export function registerScenario(def: ScenarioDef): void {
  SCENARIOS[def.id] = def;
}

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS[id];
}

export function scenarioRunFor(ctx: SimContext, claimId: number): ScenarioRun | undefined {
  return ctx.scenarioRuns.get(claimId);
}

function claimFor(ctx: SimContext, dungeonId: string, pid: number): InstanceSlot | undefined {
  const key = storyInstanceKeyFor(ctx, pid, dungeonId);
  return ctx.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === key);
}

// Enter the scenario's story space (claiming if needed) and arm a run for
// the claim. Re-entry into a live run is a plain teleport (disconnect-resume
// rides the claim exactly like dungeons). Returns false when ineligible.
export function startScenario(ctx: SimContext, scenarioId: string, pid?: number): boolean {
  const def = SCENARIOS[scenarioId];
  const r = ctx.resolve(pid);
  if (!def || !r) return false;
  const quest = QUESTS[def.questId];
  if (!quest) return false;
  // Entry gate: the quest must be active (or already carried by a partymate
  // sharing the claim: the leader starts, members walk in after).
  const qp = r.meta.questLog.get(def.questId);
  const existing = claimFor(ctx, def.dungeonId, r.meta.entityId);
  const existingRun =
    existing?.exitId !== null && existing !== undefined
      ? ctx.scenarioRuns.get(existing.exitId ?? -1)
      : undefined;
  if (!existingRun && qp?.state !== 'active') {
    ctx.error(r.meta.entityId, 'You are not ready for this.');
    return false;
  }
  if (!enterStoryInstance(ctx, def.dungeonId, r.meta.entityId)) return false;
  const claim = claimFor(ctx, def.dungeonId, r.meta.entityId);
  if (!claim || claim.exitId === null) return false;
  if (ctx.scenarioRuns.has(claim.exitId)) return true; // rejoin the live run
  const run: ScenarioRun = {
    scenarioId,
    claimId: claim.exitId,
    dungeonId: def.dungeonId,
    stageIndex: 0,
    stageSpawnIds: [],
    stageObjectIds: [],
    stageStartedAt: ctx.time,
    stageArmed: false,
    done: false,
  };
  ctx.scenarioRuns.set(claim.exitId, run);
  if (def.squad) {
    const dungeon = DUNGEONS[def.dungeonId];
    const origin = instanceOriginOf(claim);
    spawnSquad(ctx, {
      claimId: claim.exitId,
      dungeonId: def.dungeonId,
      anchor: { x: origin.x + dungeon.entry.x, z: origin.z + dungeon.entry.z },
      actorIds: def.squad.actorIds,
      humanCount: playersInClaim(ctx, run).length || 1,
      floorEnabled: def.squad.floorEnabled,
    });
  }
  return true;
}

function runOrigin(ctx: SimContext, run: ScenarioRun): { x: number; z: number } | null {
  const inst = ctx.instances.find((i) => i.dungeonId === run.dungeonId && i.exitId === run.claimId);
  return inst ? instanceOriginOf(inst) : null;
}

// Players physically inside this run's claim footprint (participants).
function playersInClaim(ctx: SimContext, run: ScenarioRun): Entity[] {
  const origin = runOrigin(ctx, run);
  if (!origin) return [];
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    if (Math.abs(p.pos.x - origin.x) < 120 && Math.abs(p.pos.z - origin.z) < 250) out.push(p);
  }
  return out;
}

function armStage(ctx: SimContext, def: ScenarioDef, run: ScenarioRun): void {
  const stage = def.stages[run.stageIndex];
  const origin = runOrigin(ctx, run);
  if (!stage || !origin) return;
  run.stageArmed = true;
  run.stageStartedAt = ctx.time;
  const players = playersInClaim(ctx, run);
  for (const spawn of stage.spawns ?? []) {
    const template = MOBS[spawn.mobId];
    if (!template) continue;
    const radius = spawn.radius ?? 5;
    for (let i = 0; i < spawn.count; i++) {
      // Evenly spaced ring, rng-free (escort ambush pattern).
      const angle = (i / spawn.count) * Math.PI * 2;
      const pos = ctx.groundPos(
        origin.x + spawn.x + Math.sin(angle) * radius,
        origin.z + spawn.z + Math.cos(angle) * radius,
      );
      const mob = createMob(ctx.nextId++, template, spawn.level ?? template.minLevel, pos);
      ctx.addEntity(mob);
      run.stageSpawnIds.push(mob.id);
      if (spawn.aggro && players.length > 0) {
        let nearest = players[0];
        for (const p of players) {
          if (dist2d(p.pos, mob.pos) < dist2d(nearest.pos, mob.pos)) nearest = p;
        }
        mob.aiState = 'chase';
        mob.aggroTargetId = nearest.id;
        mob.inCombat = true;
        mob.leashAnchor = { ...mob.pos };
        addThreat(mob, nearest.id, 1);
      }
    }
  }
  for (const objDef of stage.objects ?? []) {
    const obj = createGroundObject(
      ctx.nextId++,
      '',
      objDef.name,
      ctx.groundPos(origin.x + objDef.x, origin.z + objDef.z),
    );
    obj.templateId = objDef.templateId;
    obj.objectItemId = null;
    obj.lootable = true;
    ctx.addEntity(obj);
    run.stageObjectIds.push(obj.id);
  }
  for (const d of stage.directives ?? []) {
    // Directive coordinates are instance-local in content; resolve to world.
    const directive =
      d.directive.kind === 'follow'
        ? d.directive
        : { ...d.directive, x: origin.x + d.directive.x, z: origin.z + d.directive.z };
    setSquadDirective(ctx, run.claimId, d.actorId, directive);
  }
  if (stage.sceneId) ctx.playScene(run.claimId, stage.sceneId);
}

function clearStageEntities(ctx: SimContext, run: ScenarioRun): void {
  for (const id of run.stageSpawnIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead) ctx.dropEntity(id);
  }
  run.stageSpawnIds = [];
  for (const id of run.stageObjectIds) {
    if (ctx.entities.has(id)) ctx.dropEntity(id);
  }
  run.stageObjectIds = [];
}

function stageComplete(
  ctx: SimContext,
  def: ScenarioDef,
  run: ScenarioRun,
  players: Entity[],
): boolean {
  const stage = def.stages[run.stageIndex];
  if (!stage) return true;
  const objective = stage.objective;
  switch (objective.kind) {
    case 'quest': {
      const quest = QUESTS[def.questId];
      for (const p of players) {
        const qp = ctx.players.get(p.id)?.questLog.get(def.questId);
        // A filled final objective flips the quest to 'ready' (turn-in
        // pending), which still counts as this stage's completion.
        if (!qp || (qp.state !== 'active' && qp.state !== 'ready')) continue;
        const required = questObjectiveRequired(quest, qp, objective.objectiveIndex);
        if ((qp.counts[objective.objectiveIndex] ?? 0) >= required) return true;
      }
      return false;
    }
    case 'killSpawned': {
      for (const id of run.stageSpawnIds) {
        const e = ctx.entities.get(id);
        if (e && !e.dead) return false;
      }
      return run.stageSpawnIds.length > 0;
    }
    case 'reach': {
      const origin = runOrigin(ctx, run);
      if (!origin) return false;
      const wx = origin.x + objective.x;
      const wz = origin.z + objective.z;
      return players.some(
        (p) => !p.dead && Math.hypot(p.pos.x - wx, p.pos.z - wz) <= objective.radius,
      );
    }
    case 'survive':
      return ctx.time - run.stageStartedAt >= objective.seconds;
    case 'scene':
      return !ctx.scenePlaybacks.has(run.claimId);
  }
}

// Advance one run one tick. Wipe rule: with the stage armed, a claim whose
// players are all dead or gone re-arms the stage (retry from stage start).
function updateRun(ctx: SimContext, run: ScenarioRun): void {
  const def = SCENARIOS[run.scenarioId];
  if (!def || run.done) return;
  const players = playersInClaim(ctx, run);
  if (!run.stageArmed) {
    // Arm only with a living participant present, so a stage never plays to
    // an empty room (and a retry waits for the ghosts to run back).
    if (players.some((p) => !p.dead)) armStage(ctx, def, run);
    return;
  }
  const stage = def.stages[run.stageIndex];
  if (!stage) {
    run.done = true;
    return;
  }
  const anyAlive = players.some((p) => !p.dead);
  if (!anyAlive && (stage.retryOnWipe ?? (stage.spawns?.length ?? 0) > 0)) {
    clearStageEntities(ctx, run);
    run.stageArmed = false;
    return;
  }
  if (!stageComplete(ctx, def, run, players)) return;
  // Stage done: leave corpses where they fell, drop leftover objects, move on.
  run.stageSpawnIds = [];
  for (const id of run.stageObjectIds) {
    if (ctx.entities.has(id)) ctx.dropEntity(id);
  }
  run.stageObjectIds = [];
  run.stageIndex++;
  run.stageArmed = false;
  if (run.stageIndex >= def.stages.length) {
    run.done = true;
    if (def.despawnSquadOnComplete ?? true) despawnSquad(ctx, run.claimId);
  }
}

// Per-tick driver, called from the Sim tick body after squads. Zero work
// (and zero rng) while no run is live. Runs whose claim was recycled by the
// idle sweep are reaped here.
export function updateScenarios(ctx: SimContext): void {
  for (const [claimId, run] of ctx.scenarioRuns) {
    const claimAlive = ctx.instances.some(
      (i) => i.dungeonId === run.dungeonId && i.exitId === claimId,
    );
    if (!claimAlive) {
      despawnSquad(ctx, claimId);
      ctx.scenarioRuns.delete(claimId);
      continue;
    }
    updateRun(ctx, run);
  }
}
