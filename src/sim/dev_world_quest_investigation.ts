import {
  INVESTIGATION_NPCS,
  INVESTIGATION_QUEST_ID,
  WORLD_QUEST_INVESTIGATION,
} from './content/world_quest_investigation';
import type { SimContext } from './sim_context';
import { ensureInvestigationPost } from './world_quest_investigation';
import { worldQuestCycleOfferingQuest } from './world_quest_rotation';
import { restoreWorldQuestClaims, updateWorldQuests } from './world_quests';

export function armWorldQuestInvestigationForDev(ctx: SimContext, pid: number): void {
  if (!ctx.devCommands) return;
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player) return;
  meta.devWorldQuestCycle = worldQuestCycleOfferingQuest(
    ctx.currentWorldQuestRotation().cycle,
    INVESTIGATION_QUEST_ID,
  );
  ctx.setPlayerLevel(Math.max(WORLD_QUEST_INVESTIGATION.minLevel, player.level), pid);
  const captain = INVESTIGATION_NPCS[0];
  player.pos = ctx.groundPos(captain.pos.x + 2, captain.pos.z);
  player.prevPos = { ...player.pos };
  updateWorldQuests(ctx, meta, player);
  restoreWorldQuestClaims(meta);
  ensureInvestigationPost(ctx);
  meta.wireRev++;
  ctx.emit({
    type: 'log',
    pid,
    text: '[dev] Investigation ready. Speak with Sergeant Alric at Fenbridge.',
  });
}
