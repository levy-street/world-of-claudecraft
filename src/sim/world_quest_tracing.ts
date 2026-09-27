import {
  WORLD_QUEST_CALLIGRAPHY_NPC_IDS,
  WORLD_QUEST_CALLIGRAPHY_NPCS,
} from './content/world_quest_calligraphy';
import { createNpc } from './entity';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { type Entity, INTERACT_RANGE, type WorldQuestDef, type WorldQuestProgress } from './types';
import { beginWorldQuestPractice } from './world_quest_practice';
import { emitWorldQuestScore } from './world_quest_score_events';
import { createWorldQuestTrace, stepWorldQuestTrace } from './world_quest_trace_geometry';
import { scoreWorldQuestTraceLesson, scoreWorldQuestTraceRound } from './world_quest_trace_score';
import { emitWorldQuestTraceRoundSpeech } from './world_quest_trace_speech';
import { worldQuestTraceShape, worldQuestTraceVariantForCycle } from './world_quest_trace_variants';

export const WORLD_QUEST_TRACE_RESULT_SECONDS = 3;

/** Stable session fixtures do not change the old allocator or draw any RNG. */
export function ensureWorldQuestTraceInstructors(ctx: SimContext): void {
  for (const def of Object.values(WORLD_QUEST_CALLIGRAPHY_NPCS)) {
    const id = WORLD_QUEST_CALLIGRAPHY_NPC_IDS[def.id];
    if (ctx.entities.has(id)) continue;
    if (ctx.cfg.world && !ctx.cfg.world.npcs[def.id]) continue;
    const npc = createNpc(id, def, ctx.groundPos(def.pos.x, def.pos.z));
    if (def.id !== 'calligraphy_instructor') npc.scale = 0.8;
    ctx.addEntity(npc);
  }
}

/** Called only after the world-quest owner revalidates rotation and active credit. */
export function startWorldQuestTracing(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  npc: Entity,
  quest: WorldQuestDef,
  progress: WorldQuestProgress,
): void {
  if (quest.objective.type !== 'tracing') return;
  const def = WORLD_QUEST_CALLIGRAPHY_NPCS[quest.objective.instructorNpcId];
  if (!def || npc.id !== WORLD_QUEST_CALLIGRAPHY_NPC_IDS[def.id] || npc.kind !== 'npc' || npc.dead)
    return;
  if (npc.templateId !== def.id || Math.hypot(npc.pos.x - def.pos.x, npc.pos.z - def.pos.z) > 0.1)
    return;
  if (
    player.dead ||
    player.inCombat ||
    player.mountKey ||
    player.chargeTargetId !== null ||
    player.leap ||
    player.climb ||
    player.valkyrsCalling
  )
    return;
  if (
    Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z) > INTERACT_RANGE + 2 ||
    Math.abs(player.pos.y - npc.pos.y) > INTERACT_RANGE + 2
  )
    return;
  // Double-clicks cannot keep resetting the memorization clock.
  if (progress.tracing?.phase === 'preview' || progress.tracing?.phase === 'drawing') return;
  beginWorldQuestPractice(progress);
  const shapeIndex = progress.count;
  if (!Number.isSafeInteger(shapeIndex) || shapeIndex < 0 || progress.state !== 'active') return;
  progress.traceVariant ??=
    progress.count > 0 ? 'star' : worldQuestTraceVariantForCycle(meta.worldQuestCycle);
  const shape = worldQuestTraceShape(quest, shapeIndex, progress.traceVariant);
  if (!shape) return;
  progress.tracing = createWorldQuestTrace(quest.id, shape, player.pos, ctx.time, shapeIndex);
  meta.wireRev++;
}

/** Returns one earned round for the owner's canonical credit path. */
export function updateWorldQuestTracing(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  quest: WorldQuestDef,
  progress: WorldQuestProgress,
): boolean {
  const trace = progress.tracing;
  if (!trace || quest.objective.type !== 'tracing') return false;
  if (trace.phase === 'success' || trace.phase === 'failed') {
    if (ctx.time >= trace.expiresAt) {
      delete progress.tracing;
      meta.wireRev++;
    }
    return false;
  }
  if (progress.state !== 'active') return false;
  const shape = worldQuestTraceShape(quest, trace.shapeIndex, progress.traceVariant);
  if (!Number.isSafeInteger(trace.shapeIndex) || trace.shapeIndex !== progress.count || !shape) {
    clearWorldQuestTracing(meta, progress);
    return false;
  }
  const previousPhase = trace.phase;
  const previousLength = trace.trail.length;
  const previousSegment = trace.segment;
  const previousStarted = trace.started;
  if (player.inCombat) {
    trace.phase = 'failed';
    trace.reason = 'combat';
  } else if (
    player.mountKey ||
    player.chargeTargetId !== null ||
    player.leap ||
    player.climb ||
    player.valkyrsCalling ||
    Math.abs(player.pos.y - ctx.groundPos(player.pos.x, player.pos.z).y) > 2
  ) {
    trace.phase = 'failed';
    trace.reason = 'movement';
  } else {
    const result = stepWorldQuestTrace(trace, shape, player.pos, ctx.time);
    if (result.phase === 'success') {
      meta.wireRev++;
      // Missing historical scores receive zero style marks, never extra gameplay
      // requirements. Retrying only replaces this uncompleted round's marks.
      const scores = progress.traceScores ?? [];
      while (scores.length < trace.shapeIndex)
        scores.push({ precision: 0, efficiency: 0, time: 0 });
      scores[trace.shapeIndex] = scoreWorldQuestTraceRound(shape, trace.metrics, ctx.time);
      progress.traceScores = scores.slice(0, trace.shapeIndex + 1);
      const nextIndex = trace.shapeIndex + 1;
      const nextShape = worldQuestTraceShape(quest, nextIndex, progress.traceVariant);
      if (nextShape) {
        emitWorldQuestTraceRoundSpeech(ctx, trace.shapeIndex);
        progress.tracing = createWorldQuestTrace(
          quest.id,
          nextShape,
          player.pos,
          ctx.time,
          nextIndex,
        );
        return true;
      }
      // An unsupported future final shape must never turn round two into a win.
      if (nextIndex < quest.count) {
        delete progress.tracing;
        emitWorldQuestTraceRoundSpeech(ctx, trace.shapeIndex);
        return true;
      }
      const previous = progress.traceResult;
      progress.traceResult = scoreWorldQuestTraceLesson(progress.traceScores);
      if (!previous || progress.traceResult.score > previous.score)
        emitWorldQuestScore(
          ctx,
          meta.entityId,
          quest.id,
          progress.traceResult.rating,
          progress.traceResult.score,
        );
      emitWorldQuestTraceRoundSpeech(ctx, trace.shapeIndex, progress.traceResult.rating === 'gold');
      result.expiresAt = ctx.time + WORLD_QUEST_TRACE_RESULT_SECONDS;
      return true;
    }
  }
  if (trace.phase === 'failed') trace.expiresAt = ctx.time + 120;
  if (
    previousPhase !== trace.phase ||
    previousLength !== trace.trail.length ||
    previousSegment !== trace.segment ||
    previousStarted !== trace.started
  )
    meta.wireRev++;
  return false;
}

export function clearWorldQuestTracing(meta: PlayerMeta, progress: WorldQuestProgress): void {
  if (!progress.tracing) return;
  delete progress.tracing;
  meta.wireRev++;
}
