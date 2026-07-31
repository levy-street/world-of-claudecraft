// Charms (kind:'charm') grant their affixes while CARRIED, so the bonus follows the
// bags and never the bank (bank.ts owns its own container and is deliberately not
// consulted here). One copy per item id counts: a second charm of the same id adds
// nothing, however many are held.
//
// A charm carries the same affixes a gear piece does (the six primaries plus the
// power and combat/PvP ratings), so CharmBonus mirrors the per-item accumulators
// in recalcPlayerStats field for field: a new ItemDef affix is folded here as well
// as there.
//
// A leaf module (no SimContext) so recalcPlayerStats can fold the aggregate at the
// one place derived stats are computed, and a Vitest can drive it directly.
import type { CoreStats, InvSlot, ItemDef } from './types';

export interface CharmBonus extends CoreStats {
  spellPower: number;
  attackPower: number;
  critRating: number;
  hasteRating: number;
  hitRating: number;
  pvpOffenseRating: number;
  pvpDefenseRating: number;
}

function zeroCharmBonus(): CharmBonus {
  return {
    str: 0,
    agi: 0,
    sta: 0,
    int: 0,
    spi: 0,
    armor: 0,
    spellPower: 0,
    attackPower: 0,
    critRating: 0,
    hasteRating: 0,
    hitRating: 0,
    pvpOffenseRating: 0,
    pvpDefenseRating: 0,
  };
}

// The carried-charm set as a comparable key. Because duplicates do not stack and
// every value comes from the item def, the DISTINCT charm ids alone determine the
// bonus, so this is an exact signature rather than a heuristic: equal signatures
// always mean an equal aggregate. The inventory hub compares it across a mutation
// and only rebuilds the stat block when it actually moves, so ordinary looting
// and selling cost one scan instead of a full recalc.
export function carriedCharmSignature(
  inventory: readonly InvSlot[],
  items: Record<string, ItemDef | undefined>,
): string {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const slot of inventory) {
    if (slot.count <= 0 || seen.has(slot.itemId)) continue;
    if (items[slot.itemId]?.kind !== 'charm') continue;
    seen.add(slot.itemId);
    ids.push(slot.itemId);
  }
  return ids.sort().join(',');
}

// Sum the carried charms into one bonus, counting each charm item id once.
// Mirrors aggregateSetBonuses: everything adds, and the caller folds the result
// into the gear totals so it feeds every derivation downstream.
export function aggregateCharmBonus(
  inventory: readonly InvSlot[],
  items: Record<string, ItemDef | undefined>,
): CharmBonus {
  const out = zeroCharmBonus();
  const counted = new Set<string>();
  for (const slot of inventory) {
    if (slot.count <= 0 || counted.has(slot.itemId)) continue;
    const def = items[slot.itemId];
    if (def?.kind !== 'charm') continue;
    counted.add(slot.itemId);
    out.spellPower += def.spellPower ?? 0;
    out.attackPower += def.attackPower ?? 0;
    out.critRating += def.critRating ?? 0;
    out.hasteRating += def.hasteRating ?? 0;
    out.hitRating += def.hitRating ?? 0;
    out.pvpOffenseRating += def.pvpOffenseRating ?? 0;
    out.pvpDefenseRating += def.pvpDefenseRating ?? 0;
    const s = def.stats;
    if (!s) continue;
    out.str += s.str ?? 0;
    out.agi += s.agi ?? 0;
    out.sta += s.sta ?? 0;
    out.int += s.int ?? 0;
    out.spi += s.spi ?? 0;
    out.armor += s.armor ?? 0;
  }
  return out;
}
