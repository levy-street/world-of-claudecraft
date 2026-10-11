// Trusted host entitlement, measured against the deterministic sim clock. Never
// loaded from CharacterState. Stored armour carries no authority of its own.
import { recalcPlayerStats } from './entity';
import { perfectMembershipArmour } from './membership_armour_progression';
import { claimScalingArmour } from './scaling_armour_claim';
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
  ctx.refreshKnownAbilities(meta, false);
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
    ctx.refreshKnownAbilities(meta, false);
    recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  }
}

export function claimMembershipArmour(ctx: SimContext, pid?: number, quiet = false): void {
  const resolved = ctx.resolve(pid);
  if (!resolved || resolved.e.dead) return;
  if (
    membershipActive(resolved.meta, ctx.time) &&
    !claimScalingArmour(ctx, resolved.meta.entityId, 'membership', quiet)
  )
    return;
  if (resolved.meta.referralArmour)
    claimScalingArmour(ctx, resolved.meta.entityId, 'referral', quiet);
}
