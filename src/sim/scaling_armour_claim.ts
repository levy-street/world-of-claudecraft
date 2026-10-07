// Explicit claims and trusted activation only. No recurring storage traversal.
import { bagPools, canGrantCopies } from './bags';
import { MEMBERSHIP_ARMOUR_SLOTS } from './content/membership';
import type { SimContext } from './sim_context';

export function claimScalingArmour(
  ctx: SimContext,
  pid: number,
  prefix: 'membership' | 'referral',
  quiet: boolean,
): boolean {
  const resolved = ctx.resolve(pid);
  if (!resolved || resolved.e.dead) return false;
  const { meta } = resolved;
  const owned = new Set([
    ...Object.values(meta.equipment),
    ...meta.inventory.map((slot) => slot.itemId),
    ...meta.bank.inventory.map((slot) => slot.itemId),
    ...(meta.courier?.cargo.map((slot) => slot.itemId) ?? []),
  ]);
  for (const slot of MEMBERSHIP_ARMOUR_SLOTS) {
    const itemId = `${prefix}_${slot}`;
    if (owned.has(itemId)) continue;
    if (!canGrantCopies(meta.inventory, bagPools(meta.bags), itemId, 1)) {
      if (!quiet) ctx.error(meta.entityId, 'Your bags are full.');
      return false;
    }
    if (resolved.e.level >= 20) ctx.addItemInstance(itemId, { perfected: true }, meta.entityId);
    else ctx.addItem(itemId, 1, meta.entityId);
  }
  return true;
}
