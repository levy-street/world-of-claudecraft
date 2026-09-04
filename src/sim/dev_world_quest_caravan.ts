import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import type { SimContext } from './sim_context';
import { worldQuestCaravanForRegion } from './world_quest_caravans';
import { worldQuestCycleOfferingQuest } from './world_quest_rotation';

/** Called only by the dev-gated chat router. Does not teleport or complete quests. */
export function armWorldQuestCaravanForDev(ctx: SimContext, pid: number, region: string): void {
  const escort = worldQuestCaravanForRegion(region);
  const quest = escort?.worldQuestId ? WORLD_QUESTS_BY_ID[escort.worldQuestId] : undefined;
  const meta = ctx.players.get(pid);
  const devCycle = worldQuestCycleOfferingQuest(
    ctx.currentWorldQuestRotation().cycle,
    quest?.id ?? '',
  );
  if (!meta || !quest || !escort || !devCycle) {
    ctx.error(pid, '[dev] Unknown caravan. Use /dev caravan eastbrook|willowfen|frostveil.');
    return;
  }
  meta.devWorldQuestCycle = devCycle;
  if (meta.worldQuestCycle !== devCycle) {
    meta.worldQuestCycle = devCycle;
    meta.worldQuestLog.clear();
    meta.worldQuestAreas.clear();
  }
  meta.worldQuestLog.set(quest.id, { questId: quest.id, count: 0, state: 'active' });
  meta.worldQuestAreas.delete(quest.id);
  meta.wireRev++;
  ctx.setPlayerLevel(Math.max(quest.minLevel, ctx.entities.get(pid)?.level ?? 1), pid);
  ctx.emit({ type: 'worldQuestStarted', questId: quest.id, pid });
  ctx.emit({
    type: 'log',
    pid,
    text: `[dev] ${escort.story?.speaker ?? region}'s caravan armed. Use /dev tp ${escort.start.x} ${escort.start.z}, then interact with the wagon.`,
  });
}
