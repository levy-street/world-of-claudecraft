// Refer-a-friend bond buff + Summon a Friend (docs/prd/refer-a-friend.md).
//
// While a referrer's character and their recruited friend's character are
// PARTIED and IN THE SAME PLACE, both earn multiplied XP, decided
// server-authoritatively on every XP award (grantXp is the one funnel, so
// kills, quests, delves, gathering, and crafting are all covered). "Same
// place" means the same overworld zone, or the same live instance claim; an
// overworld character and an instanced one are never co-located.
//
// The ENTITLEMENT (which characters are bonded, the multiplier, the summon
// cooldown) is a server-stamped session fact exactly like guildMembership:
// written only through Sim.setPlayerBond, never persisted into
// CharacterState, always null offline, so this module decides per-award
// activity deterministically (it draws NO rng and reads no clock) and the
// parity meta sample excludes the stamp (tests/parity/trace.ts). The server
// owns WHEN the bond exists (the referral graph, the BOND_END_LEVEL cutoff);
// the sim owns only "is it active right now for this award".

import { DUNGEON_X_THRESHOLD, zoneAt } from './data';
import { refusedWhileDead } from './dead_gate';
import * as deedsMod from './deeds';
import { instanceClaimIdAt } from './instances/dungeons';
import { cancelProfessionSessionOnDisplacement } from './professions/session_teardown';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { SUMMON_FRIEND_COOLDOWN_ID } from './summon_friend_cooldown';
import type { Entity } from './types';

/** The server-stamped bond entitlement. A referrer can hold several active
 *  referrals at once, so the stamp carries every bonded partner character. */
export interface BondBuffStamp {
  partnerCharacterIds: number[];
  multiplier: number;
  summonCooldownSeconds: number;
}

export const DEFAULT_STAMP_SUMMON_COOLDOWN_SECONDS = 1800;

/** The server-callable stamp body (Sim.setPlayerBond is the thin facade
 *  delegate). Host-trusted but normalized anyway: a malformed stamp lands
 *  null rather than garbage, and the object is cloned at this write boundary
 *  so the sim never aliases the host's object (the guildMembership
 *  precedent). Pass null when the bond ends or the partner set empties. */
export function stampBondBuff(ctx: SimContext, pid: number, stamp: BondBuffStamp | null): void {
  const meta = ctx.players.get(pid);
  if (!meta) return;
  meta.bondBuff = normalizeBondStamp(stamp);
}

function normalizeBondStamp(stamp: BondBuffStamp | null): BondBuffStamp | null {
  if (!stamp || typeof stamp !== 'object') return null;
  if (!Number.isFinite(stamp.multiplier) || stamp.multiplier <= 1) return null;
  const ids = Array.isArray(stamp.partnerCharacterIds)
    ? [...new Set(stamp.partnerCharacterIds.filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  if (ids.length === 0) return null;
  const cooldown =
    Number.isFinite(stamp.summonCooldownSeconds) && stamp.summonCooldownSeconds > 0
      ? stamp.summonCooldownSeconds
      : DEFAULT_STAMP_SUMMON_COOLDOWN_SECONDS;
  return {
    partnerCharacterIds: ids,
    multiplier: stamp.multiplier,
    summonCooldownSeconds: cooldown,
  };
}

// Same overworld zone, or the same live instance claim. Instances sit in the
// far-east X band where zoneAt misreports, so the band check gates which
// identity applies (the gather_events.ts precedent).
function samePlace(ctx: SimContext, a: Entity, b: Entity): boolean {
  const aInstanced = a.pos.x > DUNGEON_X_THRESHOLD;
  const bInstanced = b.pos.x > DUNGEON_X_THRESHOLD;
  if (aInstanced !== bInstanced) return false;
  if (!aInstanced) return zoneAt(a.pos.x, a.pos.z).id === zoneAt(b.pos.x, b.pos.z).id;
  const claim = instanceClaimIdAt(ctx, a.pos);
  return claim !== null && claim === instanceClaimIdAt(ctx, b.pos);
}

/** The bonded partner currently in this player's party, or null. A party here
 *  includes a raid (Party.raid); co-play is co-play either way. The scan is
 *  bounded by the raid cap (10 members) and draws no rng. */
function bondPartnerInParty(ctx: SimContext, meta: PlayerMeta, p: Entity): Entity | null {
  const stamp = meta.bondBuff;
  if (!stamp) return null;
  const party = ctx.partyOf(p.id);
  if (!party) return null;
  for (const memberPid of party.members) {
    if (memberPid === p.id) continue;
    const memberMeta = ctx.players.get(memberPid);
    if (!memberMeta) continue;
    const memberCharacterId = memberMeta.characterId ?? memberMeta.entityId;
    if (!stamp.partnerCharacterIds.includes(memberCharacterId)) continue;
    const partner = ctx.entities.get(memberPid);
    if (partner) return partner;
  }
  return null;
}

/** The XP multiplier this award earns from the bond: stamp.multiplier while a
 *  bonded partner is partied and co-located, else 1. */
export function bondXpMultiplier(ctx: SimContext, meta: PlayerMeta): number {
  const stamp = meta.bondBuff;
  if (!stamp) return 1;
  const p = ctx.entities.get(meta.entityId);
  if (!p) return 1;
  const partner = bondPartnerInParty(ctx, meta, p);
  if (!partner || partner.dead) return 1;
  return samePlace(ctx, p, partner) ? stamp.multiplier : 1;
}

// The ladder-title deeds by the tier (1-based) that unlocks each. Grants ride
// grantDeed (idempotent), so re-applying a tier is safe.
const LADDER_TIER_DEEDS: readonly (string | null)[] = [
  'soc_recruiter', // tier 1 (first completed referral)
  null, // tier 2 has no deed (the tier-3 threshold is index 1 of a 3-rung ladder)
  'soc_realm_builder', // tier 3 rung (three completed referrals)
];

/**
 * Apply the refer-a-friend ladder's title deeds for a completed-referral tier
 * (server/referral_milestones.ts computes the tier from the graph and calls
 * this through Sim.grantReferralLadder with a live session). The sim grants
 * every deed at or below the tier so a referrer who skipped a login still
 * collects the earlier rungs; grantDeed is idempotent, so re-application is
 * free. Manual-trigger shape: the referral graph is a server-side account
 * fact, so the sim grants on the supplied fact rather than evaluating a
 * trigger of its own.
 */
export function applyReferralLadder(ctx: SimContext, pid: number, tier: number): void {
  const meta = ctx.players.get(pid);
  if (!meta || !Number.isInteger(tier) || tier <= 0) return;
  for (let i = 0; i < LADDER_TIER_DEEDS.length && i < tier; i++) {
    const deedId = LADDER_TIER_DEEDS[i];
    if (deedId) deedsMod.grantDeed(ctx, meta, deedId);
  }
}

/** Summon a Friend: teleport the bonded, partied partner to the player's side.
 *  Overworld only in both directions (summoning into or out of an instance
 *  would bypass dungeon entry rules), on the stamped cooldown. The party
 *  requirement doubles as consent: nobody can be yanked by someone they have
 *  not grouped with. */
export function summonFriend(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  const p = ctx.entities.get(pid);
  if (!meta || !p) return;
  if (refusedWhileDead(ctx, pid)) return;
  if (!meta.bondBuff) {
    ctx.error(pid, 'You have no recruit bond.');
    return;
  }
  const cooldown = p.cooldowns.get(SUMMON_FRIEND_COOLDOWN_ID) ?? 0;
  if (cooldown > 0) {
    ctx.error(pid, 'Summon a Friend is still recovering.');
    return;
  }
  const partner = bondPartnerInParty(ctx, meta, p);
  if (!partner) {
    ctx.error(pid, 'Your bonded friend is not in your party.');
    return;
  }
  if (partner.dead) {
    ctx.error(pid, 'Your bonded friend is dead.');
    return;
  }
  if (p.pos.x > DUNGEON_X_THRESHOLD || partner.pos.x > DUNGEON_X_THRESHOLD) {
    ctx.error(pid, 'You cannot summon into or out of an instance.');
    return;
  }
  // The portals.ts teleport recipe: session teardown, reground beside the
  // summoner, kill the interpolation streak, rebucket, drop target and
  // auto-attack, land settled so arrival never deals fall damage.
  cancelProfessionSessionOnDisplacement(ctx, partner);
  partner.pos = ctx.groundPos(p.pos.x + 1.5, p.pos.z);
  partner.prevPos = { ...partner.pos };
  ctx.rebucket(partner);
  partner.facing = p.facing;
  partner.targetId = null;
  partner.autoAttack = false;
  partner.vy = 0;
  partner.jumping = false;
  partner.onGround = true;
  partner.fallStartY = partner.pos.y;
  p.cooldowns.set(SUMMON_FRIEND_COOLDOWN_ID, meta.bondBuff.summonCooldownSeconds);
  ctx.emit({
    type: 'log',
    text: `${partner.name} answers your summons.`,
    color: '#b9f',
    pid: p.id,
  });
  ctx.emit({
    type: 'log',
    text: `${p.name} summons you to their side.`,
    color: '#b9f',
    pid: partner.id,
  });
}
