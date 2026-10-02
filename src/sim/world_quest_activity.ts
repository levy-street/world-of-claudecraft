// Explicit-difficulty starts for World Quest activities.
//
// The plain instructor talk starts an activity at its default difficulty. This
// command is the dialog's second path: the player picks Normal or Hard before
// entering, the server revalidates every gate the talk applies (level, an active
// offer, the work area, the instructor standing at his post, a rider dismounted)
// and only then starts the kernel with that profile. The Wispwood maze offers a
// difficulty; the glider's courses and Fire and Fly's scenarios ride the
// `{ courseId }` choice. The command is quest-keyed so the next activity adds a
// row here, never a new wire verb.

import { FIRE_AND_FLY_QUEST_ID } from './content/world_quest_fire_and_fly';
import { GLIDER_QUEST_ID } from './content/world_quest_glider';
import { WISP_MAZE_NPC_ID, WISP_MAZE_QUEST_ID } from './content/world_quest_wisp_maze';
import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import { startSelectedGliderCourse } from './glider_course_selection';
import type { SimContext } from './sim_context';
import { fireAndFlyScenarioById, startFireAndFly } from './world_quest_fire_and_fly';
import { dismountForWorldQuestInstructor } from './world_quest_mount_gate';
import { startWispMaze } from './world_quest_wisp_maze';
import { hasActiveWorldQuest, updateWorldQuests } from './world_quests';

export const WORLD_QUEST_DIFFICULTIES = ['normal', 'hard'] as const;
export type WorldQuestDifficulty = (typeof WORLD_QUEST_DIFFICULTIES)[number];
export type ActivityChoice = WorldQuestDifficulty | { courseId: string };

export function isActivityChoice(value: unknown): value is ActivityChoice {
  return (
    isWorldQuestDifficulty(value) ||
    (typeof value === 'object' &&
      value !== null &&
      'courseId' in value &&
      typeof value.courseId === 'string' &&
      value.courseId.length <= 64)
  );
}

export function isWorldQuestDifficulty(value: unknown): value is WorldQuestDifficulty {
  return (
    typeof value === 'string' && (WORLD_QUEST_DIFFICULTIES as readonly string[]).includes(value)
  );
}

/** Quest ids that offer a difficulty pick at their instructor. */
export const WORLD_QUEST_ACTIVITIES_WITH_DIFFICULTY: readonly string[] = Object.freeze([
  WISP_MAZE_QUEST_ID,
]);

export function worldQuestOffersDifficulty(questId: string): boolean {
  return WORLD_QUEST_ACTIVITIES_WITH_DIFFICULTY.includes(questId);
}

export function startWorldQuestActivity(
  ctx: SimContext,
  questId: string,
  difficulty: ActivityChoice,
  pid?: number,
): void {
  if (!isActivityChoice(difficulty)) return;
  if (typeof difficulty === 'object') {
    if (questId === GLIDER_QUEST_ID) startSelectedGliderCourse(ctx, difficulty.courseId, pid);
    if (questId === FIRE_AND_FLY_QUEST_ID) startSelectedFireAndFly(ctx, difficulty.courseId, pid);
    return;
  }
  if (!isWorldQuestDifficulty(difficulty) || !worldQuestOffersDifficulty(questId)) return;
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { meta, e: player } = resolved;
  const quest = Object.hasOwn(WORLD_QUESTS_BY_ID, questId) ? WORLD_QUESTS_BY_ID[questId] : null;
  if (!quest || quest.objective.type !== 'wisp_maze') return;
  // Entering the area on foot or by teleport may not have run the area sweep yet.
  updateWorldQuests(ctx, meta, player);
  const progress = meta.worldQuestLog.get(quest.id);
  if (
    player.dead ||
    player.level < quest.minLevel ||
    !progress ||
    (!hasActiveWorldQuest(meta, quest.id) && progress.state !== 'completed') ||
    Math.hypot(player.pos.x - quest.area.x, player.pos.z - quest.area.z) > quest.area.radius
  )
    return;
  const npc = ctx.entities.get(WISP_MAZE_NPC_ID);
  if (!npc || npc.kind !== 'npc') return;
  if (!dismountForWorldQuestInstructor(ctx, player, meta)) return;
  startWispMaze(ctx, meta, player, npc, progress, difficulty);
}

/** The dialog's scenario pick; past the instructor's gates the area sweep mints today's row, as for the glider. */
function startSelectedFireAndFly(ctx: SimContext, scenarioId: string, pid?: number): void {
  if (!fireAndFlyScenarioById(scenarioId)) return;
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { meta, e: player } = resolved;
  startFireAndFly(ctx, meta, player, scenarioId, () => updateWorldQuests(ctx, meta, player));
}
