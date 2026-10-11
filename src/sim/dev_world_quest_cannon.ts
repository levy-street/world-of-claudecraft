import {
  LAST_KEEP_CANNON,
  NORTH_WATCH_CANNON,
  WORLD_QUEST_CANNON,
} from './content/vehicle_stations';
import type { SimContext } from './sim_context';
import { ensureVehicleStation } from './vehicles';
import { worldQuestCycleOfferingQuest } from './world_quest_rotation';

/** Exposes the encounter in developer worlds without bypassing completion or claims. */
export function armWorldQuestCannonForDev(ctx: SimContext, pid: number, site = 'wyrmwatch'): void {
  if (!ctx.devCommands) return;
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player) return;
  const station = site === 'last_keep' ? LAST_KEEP_CANNON : NORTH_WATCH_CANNON;
  meta.devWorldQuestCycle = worldQuestCycleOfferingQuest(
    ctx.currentWorldQuestRotation().cycle || 'wq3_0',
    station.questId,
  );
  ctx.setPlayerLevel(Math.max(WORLD_QUEST_CANNON.minLevel, player.level), pid);
  ensureVehicleStation(ctx);
  ctx.emit({
    type: 'log',
    pid,
    text: `[dev] Cannon rotation selected. Use /dev tp ${station.x} ${station.z + 2}, then interact with the cannon. No completion or reward is granted by this command.`,
  });
}
