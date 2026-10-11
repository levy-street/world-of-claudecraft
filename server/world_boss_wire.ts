import { WORLD_BOSSES } from '../src/sim/world_boss';

export interface WorldBossWireSource {
  worldBossActive(bossId: string): boolean;
}

/** One realm-identical fragment, built once per broadcast and reused for every viewer. */
export function activeWorldBossIdsWireJson(world: WorldBossWireSource): string {
  return JSON.stringify(
    WORLD_BOSSES.filter((boss) => world.worldBossActive(boss.templateId)).map(
      (boss) => boss.templateId,
    ),
  );
}
