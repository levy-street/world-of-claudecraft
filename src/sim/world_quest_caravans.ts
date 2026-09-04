// Shared content lookup for caravan presentation and development commands.
// Regular quest escorts are intentionally not caravan visuals.
import { WORLD_QUEST_ESCORTS, WORLD_QUESTS_BY_ID } from './content/world_quests';
import type { EscortDef } from './types';

const CARAVANS = Object.values(WORLD_QUEST_ESCORTS);

export function worldQuestCaravanForMob(templateId: string): EscortDef | undefined {
  return CARAVANS.find((def) => def.npcMobId === templateId);
}

export function worldQuestCaravanForRegion(region: string): EscortDef | undefined {
  const zoneId =
    region === 'eastbrook' ? 'eastbrook_vale' : region === 'frostreach' ? 'frostveil' : region;
  return CARAVANS.find(
    (def) =>
      def.worldQuestId !== undefined && WORLD_QUESTS_BY_ID[def.worldQuestId]?.zoneId === zoneId,
  );
}
