// /dev weekly: stand beside the emissary; /dev weekly credit: one completion
// of the active charge without playing it out. Local previews only.
import { WEEKLY_EMISSARY_NPC_DEF, WEEKLY_QUESTS_BY_ID } from './content/weekly_quests';
import type { SimContext } from './sim_context';
import { creditWeeklyQuest, ensureWeeklyEmissary } from './weekly_quests';

export function armWeeklyQuestForDev(ctx: SimContext, pid: number, credit: boolean): void {
  if (!ctx.devCommands) return;
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player) return;
  if (credit) {
    const quest = meta.weeklyQuest && WEEKLY_QUESTS_BY_ID[meta.weeklyQuest.questId];
    if (!quest || meta.weeklyQuest?.state !== 'active') {
      ctx.emit({ type: 'log', pid, text: '[dev] No active weekly charge to credit.' });
      return;
    }
    creditWeeklyQuest(ctx, meta, quest.kind);
    return;
  }
  ensureWeeklyEmissary(ctx);
  player.pos = ctx.groundPos(WEEKLY_EMISSARY_NPC_DEF.pos.x + 2, WEEKLY_EMISSARY_NPC_DEF.pos.z + 2);
  player.prevPos = { ...player.pos };
  meta.wireRev++;
  ctx.emit({
    type: 'log',
    pid,
    text: '[dev] Weekly emissary ready. Talk to the herald; /dev weekly credit advances the charge.',
  });
}
