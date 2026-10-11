import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import { cancelProfessionSessionOnDisplacement } from './professions/session_teardown';
import type { SimContext } from './sim_context';
import type { WorldQuestProgress } from './types';
import { WORLD_QUEST_DAILY_GENERATION_CYCLE } from './world_quest_daily_generation';
import { resolveWorldQuestMatch3Level } from './world_quest_daily_levels';
import { worldQuestMatch3InitialBoard } from './world_quest_match3';
import { onObjectInteractedForWorldQuests, updateWorldQuests } from './world_quests';

/** Selects an exact daily challenge without changing the host's calendar. */
export function armDailyWorldQuestForDev(
  ctx: SimContext,
  pid: number,
  kind: string,
  input: string,
): boolean {
  if (!ctx.devCommands) return false;
  const requestedDay = Number(input);
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(requestedDay) || requestedDay < 1) {
    ctx.error(
      pid,
      '[dev] Use /dev wq candy <day> or /dev wq ley <day>, with a positive integer day.',
    );
    return false;
  }
  const quest =
    WORLD_QUESTS_BY_ID[
      kind === 'candy' ? 'wq_palmreach_confections' : kind === 'ley' ? 'wq_galecrest_wisps' : ''
    ];
  const player = ctx.entities.get(pid);
  const meta = ctx.players.get(pid);
  if (!quest || !player || !meta || player.dead) return false;
  const objective = quest.objective;
  if (objective.type !== 'match3' && objective.type !== 'puzzle') return false;
  const activation = [...ctx.entities.values()].find(
    (entity) => entity.objectItemId === objective.activationObjectItemId,
  );
  if (!activation) {
    ctx.error(pid, '[dev] Daily challenge activation object is unavailable.');
    return false;
  }
  // Preview exactly the requested day, never silently advance to another board.
  const day = (requestedDay - 1) % WORLD_QUEST_DAILY_GENERATION_CYCLE;
  const cycle = `wq1_${day}`;
  if (meta.openWorldQuestPuzzleId) {
    ctx.emit({ type: 'worldQuestPuzzleClosed', questId: meta.openWorldQuestPuzzleId, pid });
    meta.openWorldQuestPuzzleId = null;
  }
  meta.devWorldQuestCycle = cycle;
  ctx.setPlayerLevel(Math.max(quest.minLevel, player.level), pid);
  cancelProfessionSessionOnDisplacement(ctx, player);
  player.pos = ctx.groundPos(activation.pos.x, activation.pos.z);
  player.prevPos = { ...player.pos };
  ctx.rebucket(player);
  updateWorldQuests(ctx, meta, player);
  const progress: WorldQuestProgress = {
    questId: quest.id,
    count: 0,
    state: 'active',
    puzzleDay: day,
  };
  if (objective.type === 'match3') {
    const level = resolveWorldQuestMatch3Level(quest, progress);
    if (!level) return false;
    progress.match3Board = worldQuestMatch3InitialBoard(level);
    progress.match3Moves = 0;
    progress.match3RefillIndex = 0;
  }
  meta.worldQuestLog.set(quest.id, progress);
  meta.worldQuestAreas.add(quest.id);
  meta.wireRev++;
  ctx.emit({ type: 'worldQuestStarted', questId: quest.id, pid });
  onObjectInteractedForWorldQuests(ctx, activation, meta);
  ctx.emit({
    type: 'log',
    pid,
    text: `[dev] ${kind} day ${requestedDay}: generated level ${day + 1}. Re-run the command to restart.`,
  });
  return true;
}
