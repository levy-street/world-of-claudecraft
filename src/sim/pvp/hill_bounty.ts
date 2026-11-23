// King of the Hill bounties: the per-hill books behind the SimContext seam.
// The rule tables are the pure leaf hill_bounty_rules.ts; this module decides
// which world kills are HILL kills, keeps each player's kill and death streak
// for the life of the hill, pays the victim's bounty in place of the plain
// world kill (doubled when the victim also carries a world bounty), lifts
// the hourly repeat decay to full Honor for the first
// HILL_BOUNTY_REPEAT_CAP kills of a pair, mirrors a running bounty onto the
// player's entity (`hillBounty`, the nameplate and target-frame tag) while they
// stand in the hill's zone, and posts the announcer's callouts on the hill
// readout (hill.ts hillInfoFor) for everyone in that zone.
//
// A hill kill: a hostile world kill (world_pvp.ts worldPvpOnPlayerDeath, which
// calls in here) while the hill stands risen, with the victim or the player
// who landed the killing blow inside the circle. The books key a character by
// its stable identity (pvp_identity.ts), never the entity id a relog replaces,
// so a relog resets neither a streak nor the repeat cap. Everything is session
// state on the ActiveHill and dies with it (clearHillBounties at every way a
// hill ends). Sim clock only, no rng.
//
// Imports nothing that imports it: world_pvp.ts and hill.ts both call in, and
// this leaf reads the hill through SimContext (ActiveHill is a type import).

import type { HillCalloutInfo } from '../../world_api';
import { zoneContaining } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import type { ActiveHill } from './hill';
import {
  HILL_BOUNTY_BASE_HONOR,
  HILL_CALLOUT_SECONDS,
  HILL_SHUTDOWN_STREAK,
  type HillCalloutKind,
  hillBountyHonor,
  hillRepeatHonorMultiplier,
  hillStreakCallout,
} from './hill_bounty_rules';
import { hillContains } from './hill_rules';
import { pvpIdentityOf } from './pvp_identity';

interface Streak {
  kills: number;
  deaths: number;
}

/** One hill's bounty books, created on its first hill kill. */
export interface HillBountyBook {
  /** Character identity -> streak. */
  streaks: Map<string, Streak>;
  /** `${contributorIdentity}>${victimIdentity}` -> kills paid on this hill. */
  pairKills: Map<string, number>;
  callout: (HillCalloutInfo & { at: number }) | null;
}

/** A world kill that counts as a hill kill, from hillKillFor. */
export interface HillKill {
  hill: ActiveHill;
  /** What the victim was worth at the moment of death (the split's total). */
  bounty: number;
  victimStreak: number;
}

function book(hill: ActiveHill): HillBountyBook {
  hill.bounty ??= { streaks: new Map(), pairKills: new Map(), callout: null };
  return hill.bounty;
}

function streakOf(b: HillBountyBook, meta: PlayerMeta): Streak {
  const key = pvpIdentityOf(meta);
  let s = b.streaks.get(key);
  if (!s) {
    s = { kills: 0, deaths: 0 };
    b.streaks.set(key, s);
  }
  return s;
}

function pairKey(contributor: PlayerMeta, victim: PlayerMeta): string {
  return `${pvpIdentityOf(contributor)}>${pvpIdentityOf(victim)}`;
}

/** The hill kill this death is, or null for an ordinary world kill. */
export function hillKillFor(
  ctx: SimContext,
  killer: Entity,
  victim: Entity,
  victimMeta: PlayerMeta,
): HillKill | null {
  const hill = ctx.hillState.active;
  if (!hill || hill.phase !== 'active') return null;
  if (
    !hillContains(hill, victim.pos.x, victim.pos.z) &&
    !hillContains(hill, killer.pos.x, killer.pos.z)
  )
    return null;
  const s = hill.bounty?.streaks.get(pvpIdentityOf(victimMeta));
  return {
    hill,
    bounty: hillBountyHonor(s?.kills ?? 0, s?.deaths ?? 0),
    victimStreak: s?.kills ?? 0,
  };
}

/** A contributor's Honor multiplier on this hill kill: full for the first
 *  HILL_BOUNTY_REPEAT_CAP kills of this victim on this hill, then nothing. */
export function hillKillHonorMultiplier(
  kill: HillKill,
  contributor: PlayerMeta,
  victim: PlayerMeta,
): number {
  return hillRepeatHonorMultiplier(
    kill.hill.bounty?.pairKills.get(pairKey(contributor, victim)) ?? 0,
  );
}

/** The badge one player wears: their bounty while a kill streak lifts it above
 *  the plain world kill AND they stand in the hill's zone (the only ground the
 *  bounty is collected on), otherwise none. A death streak is not advertised. */
function syncBadge(hill: ActiveHill, e: Entity, s: Streak | undefined): void {
  const bounty = s ? hillBountyHonor(s.kills, s.deaths) : HILL_BOUNTY_BASE_HONOR;
  const inZone = zoneContaining(e.pos.x, e.pos.z)?.id === hill.zoneId;
  if (inZone && bounty > HILL_BOUNTY_BASE_HONOR) e.hillBounty = bounty;
  else if (e.hillBounty !== undefined) delete e.hillBounty;
}

function postCallout(
  ctx: SimContext,
  b: HillBountyBook,
  hill: ActiveHill,
  kind: HillCalloutKind,
  killer: string,
  victim: string,
  streak: number,
): void {
  // A realm-wide sequence (HillState.calloutSeq), not a per-hill one: a /dev
  // re-raise or a re-planned window reuses the ordinal, and a per-hill count
  // would repeat an id the HUD has already shown.
  const seq = (ctx.hillState.calloutSeq ?? 0) + 1;
  ctx.hillState.calloutSeq = seq;
  b.callout = { id: `${hill.ordinal}.${seq}`, kind, killer, victim, streak, at: ctx.time };
}

/**
 * Book a hill kill after its payout: each Honor-paid contributor's pair count,
 * the killer's streak (one more kill, the death streak over) and the victim's
 * (the kill streak over, one more death), both badges, and the callout: a shut
 * down when the victim was on a spree, else the killer's own streak call.
 * `killerCounted` is whether the killing blow was a paid contributor (a grey
 * or group-less kill builds no streak, so a streak cannot be farmed off an
 * unpaid kill).
 */
export function recordHillKill(
  ctx: SimContext,
  kill: HillKill,
  killer: PlayerMeta,
  victim: PlayerMeta,
  honorPaid: readonly PlayerMeta[],
  killerCounted: boolean,
): void {
  const b = book(kill.hill);
  for (const meta of honorPaid) {
    const key = pairKey(meta, victim);
    b.pairKills.set(key, (b.pairKills.get(key) ?? 0) + 1);
  }
  const lost = streakOf(b, victim);
  lost.kills = 0;
  lost.deaths += 1;
  const victimEntity = ctx.entities.get(victim.entityId);
  if (victimEntity) syncBadge(kill.hill, victimEntity, lost);
  if (!killerCounted) return;
  const won = streakOf(b, killer);
  won.kills += 1;
  won.deaths = 0;
  const killerEntity = ctx.entities.get(killer.entityId);
  if (killerEntity) syncBadge(kill.hill, killerEntity, won);
  if (kill.victimStreak >= HILL_SHUTDOWN_STREAK) {
    postCallout(ctx, b, kill.hill, 'shutDown', killer.name, victim.name, kill.victimStreak);
    return;
  }
  const call = hillStreakCallout(won.kills);
  if (call) postCallout(ctx, b, kill.hill, call, killer.name, '', won.kills);
}

/** Any death while the hill stands risen ends the victim's kill streak (the
 *  bounty is "Kill streak (no deaths)"): a fall, a mob, or a fight away from
 *  the circle, not only a hill kill (recordHillKill books those). The death
 *  streak counts hill deaths only, so it is left alone. */
export function endHillKillStreak(ctx: SimContext, victim: PlayerMeta | undefined): void {
  const hill = ctx.hillState.active;
  if (!victim || !hill || hill.phase !== 'active' || !hill.bounty) return;
  const s = hill.bounty.streaks.get(pvpIdentityOf(victim));
  if (!s || s.kills === 0) return;
  s.kills = 0;
  const e = ctx.entities.get(victim.entityId);
  if (e) syncBadge(hill, e, s);
}

/** The once-a-second badge pass (hill.ts updateHill, while the hill stands
 *  risen and has books): a player on a streak shows it only inside the hill's
 *  zone, and gets it back after a relog (a new entity, the same identity). */
export function syncHillBountyBadges(ctx: SimContext, hill: ActiveHill): void {
  const b = hill.bounty;
  if (!b) return;
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e) syncBadge(hill, e, b.streaks.get(pvpIdentityOf(meta)));
  }
}

/** The latest callout for the readout, or null once it is older than
 *  HILL_CALLOUT_SECONDS (or there has been none). */
export function hillCalloutFor(ctx: SimContext, hill: ActiveHill): HillCalloutInfo | null {
  const c = hill.bounty?.callout;
  if (!c || ctx.time - c.at > HILL_CALLOUT_SECONDS) return null;
  return { id: c.id, kind: c.kind, killer: c.killer, victim: c.victim, streak: c.streak };
}

/** The hill is ending (it fell, was ended, replaced, or the realm switched
 *  world PvP off): take every badge it put on a player. */
export function clearHillBounties(ctx: SimContext, hill: ActiveHill | null): void {
  if (!hill?.bounty) return;
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.hillBounty !== undefined) delete e.hillBounty;
  }
}
