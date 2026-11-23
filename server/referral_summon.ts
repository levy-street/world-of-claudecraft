import { zoneContaining } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import type { ClientSession } from './game';

export type ReferralSummonSession = Pick<
  ClientSession,
  | 'pid'
  | 'accountId'
  | 'left'
  | 'escrowQuarantined'
  | 'jailed'
  | 'spectating'
  | 'blockListLoaded'
  | 'blockedAccountIds'
>;

/** Shared fail-closed privacy rule for live identity, prompts and summons. */
export function canInteractWithReferralFriend(
  a: ReferralSummonSession,
  b: ReferralSummonSession,
): boolean {
  return (
    a.accountId !== b.accountId &&
    !a.left &&
    !b.left &&
    !a.escrowQuarantined &&
    !b.escrowQuarantined &&
    a.blockListLoaded &&
    b.blockListLoaded &&
    !a.blockedAccountIds.has(b.accountId) &&
    !b.blockedAccountIds.has(a.accountId)
  );
}

export function canSummonReferralFriend(
  sim: Pick<Sim, 'entities' | 'ctx' | 'meta'>,
  a: ReferralSummonSession,
  b: ReferralSummonSession,
): boolean {
  if (!canInteractWithReferralFriend(a, b) || a.jailed || b.jailed || a.spectating || b.spectating)
    return false;
  const from = sim.entities.get(a.pid),
    to = sim.entities.get(b.pid);
  if (
    !from ||
    !to ||
    from.dead ||
    to.dead ||
    from.inCombat ||
    to.inCombat ||
    from.castingAbility ||
    to.castingAbility
  )
    return false;
  if (sim.ctx.duelFor(a.pid) || sim.ctx.duelFor(b.pid)) return false;
  const sourceZone = zoneContaining(from.pos.x, from.pos.z),
    targetZone = zoneContaining(to.pos.x, to.pos.z);
  // Instance admission and the tutorial exit retain their own authoritative gates.
  if (!sourceZone || !targetZone) return false;
  const tutorial = (pid: number) => !sim.meta(pid)?.questsDone.has('q_ps_set_sail');
  return !(tutorial(a.pid) || tutorial(b.pid)) || sourceZone.id === targetZone.id;
}
