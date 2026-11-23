// Explicit claims and trusted activation only. No recurring storage traversal.
import { MEMBERSHIP_ARMOUR_SLOTS, MEMBERSHIP_WEAPON_ID } from './content/membership';
import type { SimContext } from './sim_context';

export function claimScalingArmour(
  ctx: SimContext,
  pid: number,
  prefix: 'membership' | 'referral',
  _quiet: boolean,
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
  const rewardIds = MEMBERSHIP_ARMOUR_SLOTS.map((slot) => `${prefix}_${slot}`);
  if (prefix === 'membership') rewardIds.push(MEMBERSHIP_WEAPON_ID);
  let granted = false;
  for (const itemId of rewardIds) {
    if (owned.has(itemId)) continue;
    granted = true;
    if (resolved.e.level >= 20 && itemId !== MEMBERSHIP_WEAPON_ID)
      ctx.addItemInstance(itemId, { perfected: true }, meta.entityId);
    else ctx.addItem(itemId, 1, meta.entityId);
  }
  if (granted) meta.wireRev++;
  return true;
}
