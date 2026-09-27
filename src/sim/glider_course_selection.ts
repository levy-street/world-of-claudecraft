import { GLIDER_NPC_ID, GLIDER_QUEST_ID, WORLD_QUEST_GLIDER } from './content/world_quest_glider';
import { GLIDER_COURSES } from './content/world_quest_glider_levels';
import type { SimContext } from './sim_context';
import { INTERACT_RANGE } from './types';
import { startGliderFlight } from './world_quest_glider';
import { dismountForWorldQuestInstructor } from './world_quest_mount_gate';
import { hasActiveWorldQuest, updateWorldQuests } from './world_quests';

/** A course choice is authoritative, proximity-gated, and never changes reward eligibility. */
export function startSelectedGliderCourse(ctx: SimContext, courseId: string, pid?: number): void {
  if (!GLIDER_COURSES.some((course) => course.id === courseId)) return;
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { meta, e: player } = resolved;
  const npc = ctx.entities.get(GLIDER_NPC_ID);
  if (
    !npc ||
    player.dead ||
    player.level < WORLD_QUEST_GLIDER.minLevel ||
    Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z) > INTERACT_RANGE ||
    Math.abs(player.pos.y - npc.pos.y) > 3
  )
    return;
  updateWorldQuests(ctx, meta, player);
  const progress = meta.worldQuestLog.get(GLIDER_QUEST_ID);
  if (!progress || (progress.state !== 'completed' && !hasActiveWorldQuest(meta, GLIDER_QUEST_ID)))
    return;
  if (!dismountForWorldQuestInstructor(ctx, player, meta)) return;
  const previous = progress.glider;
  startGliderFlight(ctx, meta, player, npc, progress, progress.state === 'completed');
  if (progress.glider && progress.glider !== previous) {
    progress.glider.courseId = courseId;
  }
}
