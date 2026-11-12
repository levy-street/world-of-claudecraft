// Pure core: which candidates a master-loot curate row starts with ticked. When the
// item names the classes it is meant for (`requiredClass`), the candidates of those
// classes are preselected so the looter only has to confirm or adjust; an item with
// no class list starts with nothing ticked, as before. `requiredClass` is read
// directly rather than through the tooltip resolver: on armor it is loot-targeting
// metadata (the classes the drop is meant for), which is exactly the intent here.
// A candidate whose class the client cannot resolve is never preselected.
import type { ItemDef, PlayerClass } from '../../../sim/types';

export function masterLootPreselectedPids(
  item: Pick<ItemDef, 'requiredClass'> | undefined,
  candidates: readonly { pid: number }[],
  classOf: (pid: number) => PlayerClass | undefined,
): number[] {
  const required = item?.requiredClass;
  if (!required?.length) return [];
  return candidates
    .filter((candidate) => {
      const cls = classOf(candidate.pid);
      return cls !== undefined && required.includes(cls);
    })
    .map((candidate) => candidate.pid);
}
