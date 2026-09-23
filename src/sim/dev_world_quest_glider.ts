import {
  GLIDER_LAUNCH_SITE,
  GLIDER_NPC_DEF,
  GLIDER_NPC_ID,
  GLIDER_QUEST_ID,
  WORLD_QUEST_GLIDER,
} from './content/world_quest_glider';
import { GLIDER_COURSES } from './content/world_quest_glider_levels';
import { createGliderFlightState } from './minigames/glider_flight';
import type { SimContext } from './sim_context';
import {
  cancelGliderForRotation,
  ensureGliderInstructor,
  startGliderFlight,
} from './world_quest_glider';
import { gliderCourseById } from './world_quest_glider_levels';
import { worldQuestCycleOfferingQuest } from './world_quest_rotation';
import { restoreWorldQuestClaims, updateWorldQuests } from './world_quests';

/** Prepare a local glider preview without deleting an already earned completion claim. */
export function armWorldQuestGliderForDev(
  ctx: SimContext,
  pid: number,
  startImmediately = false,
  level?: string,
): void {
  if (!ctx.devCommands) return;
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player) return;
  const selected = level === undefined ? undefined : Number(level);
  if (
    selected !== undefined &&
    (!/^\d+$/.test(level ?? '') ||
      !Number.isSafeInteger(selected) ||
      selected < 1 ||
      selected > GLIDER_COURSES.length)
  ) {
    ctx.error(pid, `[dev] Use /dev wq glider <level> (1-${GLIDER_COURSES.length}).`);
    return;
  }
  const previousCourseId = meta.worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.courseId;
  const previousPracticeOnly = meta.worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.practiceOnly;
  const course =
    selected === undefined ? gliderCourseById(previousCourseId) : GLIDER_COURSES[selected - 1];
  cancelGliderForRotation(ctx, meta);

  meta.devWorldQuestCycle = worldQuestCycleOfferingQuest(
    ctx.currentWorldQuestRotation().cycle,
    GLIDER_QUEST_ID,
  );
  ctx.setPlayerLevel(Math.max(WORLD_QUEST_GLIDER.minLevel, player.level), pid);
  ensureGliderInstructor(ctx);
  player.pos = ctx.groundPos(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z + 2);
  player.prevPos = { ...player.pos };
  player.facing = GLIDER_LAUNCH_SITE.playerFacing;
  updateWorldQuests(ctx, meta, player);
  restoreWorldQuestClaims(meta);
  const progress = meta.worldQuestLog.get(GLIDER_QUEST_ID);
  const practiceOnly = progress?.state === 'completed' || previousPracticeOnly === true;
  if (progress && (selected !== undefined || previousCourseId !== undefined || practiceOnly)) {
    progress.glider = {
      ...createGliderFlightState(false),
      phase: 'failed',
      courseId: course.id,
      ...(practiceOnly ? { practiceOnly: true as const } : {}),
    };
    if (practiceOnly) {
      progress.state = 'active';
      progress.count = 0;
    }
  }
  meta.wireRev++;

  if (startImmediately) {
    const npc = ctx.entities.get(GLIDER_NPC_ID);
    if (npc && progress) {
      startGliderFlight(ctx, meta, player, npc, progress);
      ctx.emit({
        type: 'log',
        pid,
        text: `[dev] Windrider Slalom level ${GLIDER_COURSES.indexOf(course) + 1} launched! Hold right mouse: look up to trade speed for height, down to dive. A/D steer, S brakes. Wind tunnels boost speed once per attempt.`,
      });
      return;
    }
  }

  ctx.emit({
    type: 'log',
    pid,
    text: `[dev] Windrider Slalom ready at The Shear (${GLIDER_LAUNCH_SITE.x}, ${GLIDER_LAUNCH_SITE.z}). Speak with Flightmaster Zephyr, or use /dev glider start.`,
  });
}
