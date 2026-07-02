import type { ItemDef, Stats } from './types';

export interface AggregatedItemEnhancements {
  stats: Stats;
  attackPower: number;
  spellPower: number;
  crit: number;
}

export function aggregateItemEnhancements(
  item: Pick<ItemDef, 'enhancements'> | undefined,
): AggregatedItemEnhancements {
  const out: AggregatedItemEnhancements = {
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    attackPower: 0,
    spellPower: 0,
    crit: 0,
  };
  for (const enhancement of item?.enhancements ?? []) {
    const effect = enhancement.effect;
    out.stats.str += effect.stats?.str ?? 0;
    out.stats.agi += effect.stats?.agi ?? 0;
    out.stats.sta += effect.stats?.sta ?? 0;
    out.stats.int += effect.stats?.int ?? 0;
    out.stats.spi += effect.stats?.spi ?? 0;
    out.stats.armor += effect.stats?.armor ?? 0;
    out.attackPower += effect.attackPower ?? 0;
    out.spellPower += effect.spellPower ?? 0;
    out.crit += effect.crit ?? 0;
  }
  return out;
}
