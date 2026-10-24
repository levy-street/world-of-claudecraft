import type { Entity } from '../src/sim/types';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { round2 } from './tick_perf_log';

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

/**
 * The world-boss fight's per-entity bits in the dynamic wire block (every one omitted when
 * unset, so an ordinary entity pays nothing): the Shardpike brace (lance_trial.ts, remote
 * clients pose it), a slumbering boss in bed (mob/slumber.ts, remote rigs lie down and
 * wake with him), and the warpath circuit phase (mob/warpath.ts) the phase aura and travel
 * cues read (balgath_aura_core.ts). The unharried clock rides only while he travels, the
 * only phase that reads it.
 */
export function writeWorldBossWireFields(e: Entity, out: Record<string, unknown>): void {
  if (e.bracing) out.brc = 1;
  if (e.asleep) out.slp = 1;
  if (e.warpathPhase) {
    out.wp = e.warpathPhase;
    if (e.warpathPhase === 'travel' && e.warpathUnharried) out.wu = round2(e.warpathUnharried);
  }
}
