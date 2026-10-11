import { FORGE_NPC_DEF, FORGE_QUEST_ID, WORLD_QUEST_FORGING } from './content/world_quest_forging';
import type { SimContext } from './sim_context';
import { ensureForgeWorkshop } from './world_quest_forging';
import { worldQuestCycleOfferingQuest } from './world_quest_rotation';
import { restoreWorldQuestClaims, updateWorldQuests } from './world_quests';

/** Prepare a local preview without deleting an already earned completion claim. */
export function armWorldQuestForgingForDev(ctx: SimContext, pid: number): void {
  if (!ctx.devCommands) return;
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player) return;
  meta.devWorldQuestCycle = worldQuestCycleOfferingQuest(
    ctx.currentWorldQuestRotation().cycle,
    FORGE_QUEST_ID,
  );
  ctx.setPlayerLevel(Math.max(WORLD_QUEST_FORGING.minLevel, player.level), pid);
  player.pos = ctx.groundPos(FORGE_NPC_DEF.pos.x, FORGE_NPC_DEF.pos.z + 4);
  player.prevPos = { ...player.pos };
  updateWorldQuests(ctx, meta, player);
  restoreWorldQuestClaims(meta);
  ensureForgeWorkshop(ctx);
  meta.wireRev++;
  ctx.emit({
    type: 'log',
    pid,
    text: '[dev] Forge workshop ready. Talk to Smith Mara to start or retry.',
  });
}
