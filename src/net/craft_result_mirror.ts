// The online client's CraftResultView mirror of the authoritative craftResult
// event (#1127): the same projection the offline Sim keeps as lastCraftResult,
// so the crafting window reads one shape in both worlds.

import { isValidLootQuality } from '../sim/loot_quality';
import type { MaterialRarity } from '../sim/professions/gathering';
import { cloneItemInstancePayload, type SimEvent } from '../sim/types';
import type { CraftResultView } from '../world_api';

export function craftResultViewFromEvent(
  ev: Extract<SimEvent, { type: 'craftResult' }>,
): CraftResultView {
  // Only a copy whose descriptor validates is mirrored, as the receipt path does.
  const instance =
    ev.instance && isValidLootQuality(ev.instance.lootQuality)
      ? cloneItemInstancePayload(ev.instance)
      : undefined;
  return {
    ok: ev.ok,
    recipeId: ev.recipeId,
    itemId: ev.itemId,
    count: ev.count,
    quality: ev.quality as MaterialRarity | undefined,
    masterwork: ev.masterwork,
    ...(instance ? { instance } : {}),
    reason: ev.reason,
  };
}
