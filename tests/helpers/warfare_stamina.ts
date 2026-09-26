// The stamina a WARFARE piece is authored to carry, derived from the named
// fractions in src/sim/content/pvp_honor.ts so the tier tests pin the rule, not
// a table of magic numbers. `base` is the larger of the fraction target's
// implied stamina and the stamina-model floor (both tier tests reconstruct it).
// Caster armor and weapons add WARFARE_CASTER_STAMINA_PREMIUM_SHARE of the
// premium the physical WARFARE piece in the same slot carries over that base;
// jewelry and physical pieces carry the base unchanged.
import { FURY_STOCK, WARFARE_CASTER_STAMINA_PREMIUM_SHARE } from '../../src/sim/content/pvp_honor';
import { ITEMS } from '../../src/sim/data';
import { statIdentity } from '../../src/sim/item_budget';
import type { ItemDef } from '../../src/sim/types';

export function expectedWarfareStamina(item: ItemDef, impliedSta: number, floor: number): number {
  const base = Math.max(impliedSta, floor);
  const jewelry = item.slot === 'neck' || item.slot === 'ring';
  if (jewelry || statIdentity(item.stats) !== 'caster') return base;
  const physicalSta = FURY_STOCK.map((id) => ITEMS[id])
    .filter((other) => other.slot === item.slot && statIdentity(other.stats) === 'physical')
    .map((other) => other.stats?.sta ?? 0);
  const premium = Math.max(0, Math.max(0, ...physicalSta) - base);
  return base + Math.round(premium * WARFARE_CASTER_STAMINA_PREMIUM_SHARE);
}
