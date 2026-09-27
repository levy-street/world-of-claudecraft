import {
  WORLD_QUEST_CALLIGRAPHY_NPCS,
  WORLD_QUEST_CALLIGRAPHY_QUEST,
} from './content/world_quest_calligraphy';
import type { SimContext } from './sim_context';
import { worldQuestCycleOfferingQuest } from './world_quest_rotation';
import { ensureWorldQuestTraceInstructors } from './world_quest_tracing';

/** Dev-only preparation, never bypasses the actual tracing/reward evaluator. */
export function armWorldQuestTracingForDev(ctx: SimContext, pid: number): void {
  if (!ctx.devCommands) return;
  const meta = ctx.players.get(pid);
  if (!meta) return;
  const quest = WORLD_QUEST_CALLIGRAPHY_QUEST;
  meta.devWorldQuestCycle = worldQuestCycleOfferingQuest(
    ctx.currentWorldQuestRotation().cycle,
    quest.id,
  );
  ctx.setPlayerLevel(Math.max(quest.minLevel, ctx.entities.get(pid)?.level ?? 1), pid);
  if (meta.worldQuestCycle !== meta.devWorldQuestCycle) {
    meta.worldQuestCycle = meta.devWorldQuestCycle;
    meta.worldQuestLog.clear();
    meta.worldQuestAreas.clear();
    meta.openWorldQuestPuzzleId = null;
  }
  meta.worldQuestLog.set(quest.id, { questId: quest.id, count: 0, state: 'active' });
  meta.wireRev++;
  ensureWorldQuestTraceInstructors(ctx);
  const instructor = WORLD_QUEST_CALLIGRAPHY_NPCS.calligraphy_instructor;
  const approach = { x: instructor.pos.x, z: instructor.pos.z - 4 };
  ctx.emit({ type: 'worldQuestStarted', questId: quest.id, pid });
  ctx.emit({
    type: 'log',
    pid,
    text: `[dev] Calligraphy armed. Use /dev tp ${approach.x} ${approach.z}, then interact with Instructor Elian on foot.`,
  });
}
