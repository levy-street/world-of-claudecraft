// Trusted host entitlement, measured against the deterministic sim clock. Never
// loaded from CharacterState. Stored armour carries no authority of its own.
import { bagPools, canGrantCopies } from './bags';
import { MEMBERSHIP_ARMOUR_SLOTS } from './content/membership';
import { recalcPlayerStats } from './entity';
import { perfectMembershipArmour } from './membership_armour_progression';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export function membershipActive(
  meta: Pick<PlayerMeta, 'membershipExpiresAt'>,
  time: number,
): boolean {
  return (meta.membershipExpiresAt ?? 0) > time;
}

export function setMembership(ctx: SimContext, pid: number, remainingSeconds: number): void {
  const meta = ctx.players.get(pid);
  const p = ctx.entities.get(pid);
  if (!meta || !p || !Number.isFinite(remainingSeconds)) return;
  meta.membershipExpiresAt = ctx.time + Math.max(0, remainingSeconds);
  const active = membershipActive(meta, ctx.time);
  // A recurring host refresh only moves the deadline. Claims and cap promotion
  // inspect character storage, so they belong to activation or explicit actions.
  if (p.membershipActive === active) return;
  p.membershipActive = active;
  meta.wireRev++;
  if (active) {
    claimMembershipArmour(ctx, pid, true);
    perfectMembershipArmour(meta, p.level);
  }
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
}

export function updateMembership(ctx: SimContext, meta: PlayerMeta, p: Entity): void {
  if (p.membershipActive && !membershipActive(meta, ctx.time)) {
    p.membershipActive = false;
    meta.wireRev++;
    recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  }
}

export function claimMembershipArmour(ctx: SimContext, pid?: number, quiet = false): void {
  const resolved = ctx.resolve(pid);
  if (!resolved || !membershipActive(resolved.meta, ctx.time) || resolved.e.dead) return;
  const { meta } = resolved;
  // Seven ids, bounded by existing character containers; run only on an explicit
  // claim or host entitlement change. Partial claims are safe to retry.
  const owned = new Set([
    ...Object.values(meta.equipment),
    ...meta.inventory.map((slot) => slot.itemId),
    ...meta.bank.inventory.map((slot) => slot.itemId),
  ]);
  for (const slot of MEMBERSHIP_ARMOUR_SLOTS) {
    const itemId = `membership_${slot}`;
    if (owned.has(itemId)) continue;
    if (!canGrantCopies(meta.inventory, bagPools(meta.bags), itemId, 1)) {
      if (!quiet) ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    if (resolved.e.level >= 20) ctx.addItemInstance(itemId, { perfected: true }, meta.entityId);
    else ctx.addItem(itemId, 1, meta.entityId);
  }
}
