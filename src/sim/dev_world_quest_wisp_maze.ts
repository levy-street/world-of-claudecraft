import {
  WISP_MAZE_NPC_DEF,
  WISP_MAZE_NPC_ID,
  WISP_MAZE_QUEST_ID,
} from './content/world_quest_wisp_maze';
import { armWorldQuestForDev } from './dev_world_quest';
import type { WispMazeDifficulty } from './minigames/wisp_maze';
import type { SimContext } from './sim_context';
import { ensureWispMazeInstructor, startWispMaze } from './world_quest_wisp_maze';
export function armWorldQuestWispMazeForDev(
  ctx: SimContext,
  pid: number,
  difficulty?: WispMazeDifficulty,
): boolean {
  if (!armWorldQuestForDev(ctx, pid, WISP_MAZE_QUEST_ID)) return false;
  const player = ctx.entities.get(pid);
  if (!player) return false;
  ensureWispMazeInstructor(ctx);
  player.pos = ctx.groundPos(WISP_MAZE_NPC_DEF.pos.x, WISP_MAZE_NPC_DEF.pos.z + 1);
  player.prevPos = { ...player.pos };
  player.vx = player.vy = player.vz = 0;
  ctx.rebucket(player);
  if (difficulty) {
    const meta = ctx.players.get(pid)!;
    const progress = meta.worldQuestLog.get(WISP_MAZE_QUEST_ID)!;
    startWispMaze(ctx, meta, player, ctx.entities.get(WISP_MAZE_NPC_ID)!, progress, difficulty);
  }
  return true;
}
