// Trusted host identity. Character saves and item payloads never grant authority.
import { recalcPlayerStats } from './entity';
import { membershipActive } from './membership';
import { wearsReferralArmour } from './membership_armour';
import { perfectMembershipArmour } from './membership_armour_progression';
import { claimScalingArmour } from './scaling_armour_claim';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { RAID_MAX } from './social/party';

export interface ReferralArmourEntitlement {
  inviterAccountId: number;
  inviterName: string;
}
export interface HostArmourAuthority {
  /** Host-only sim-clock deadline. Never restored from a save. */
  membershipExpiresAt?: number;
  accountId?: number;
  referralArmour?: ReferralArmourEntitlement;
}

export function setReferralArmour(
  ctx: SimContext,
  pid: number,
  entitlement: ReferralArmourEntitlement | null,
): void {
  const meta = ctx.players.get(pid),
    entity = ctx.entities.get(pid);
  if (!meta || !entity) return;
  const valid =
    entitlement &&
    Number.isSafeInteger(entitlement.inviterAccountId) &&
    entitlement.inviterAccountId > 0 &&
    entitlement.inviterAccountId !== meta.accountId &&
    typeof entitlement.inviterName === 'string' &&
    entitlement.inviterName.trim().length > 0;
  const next = valid
    ? { ...entitlement, inviterName: entitlement.inviterName.trim().slice(0, 32) }
    : undefined;
  if (
    meta.referralArmour?.inviterAccountId === next?.inviterAccountId &&
    meta.referralArmour?.inviterName === next?.inviterName &&
    entity.referralInviterName === next?.inviterName
  )
    return;
  meta.referralArmour = next;
  entity.referralInviterName = next?.inviterName;
  meta.wireRev++;
  if (next) {
    claimScalingArmour(ctx, pid, 'referral', true);
    perfectMembershipArmour(meta, entity.level);
  }
  recalcPlayerStats(entity, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
}

export function referralArmourXpActive(ctx: SimContext, meta: PlayerMeta): boolean {
  const inviter = meta.referralArmour?.inviterAccountId;
  if (!inviter || inviter === meta.accountId || !wearsReferralArmour(meta.equipment)) return false;
  const party = ctx.partyOf(meta.entityId);
  if (!party || party.members.length > RAID_MAX) return false;
  // The party cap is enforced by its owner. No realm roster or account scan.
  for (const pid of party.members) {
    if (pid === meta.entityId) continue;
    const member = ctx.players.get(pid);
    if (member?.accountId === inviter && membershipActive(member, ctx.time)) return true;
  }
  return false;
}
