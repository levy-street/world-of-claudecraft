// Linkdead grace: a dropped socket does not log the character out. The
// session is held in-world ("linkdead") for LINKDEAD_GRACE_MS so an
// accidental disconnect (network blip, page reload, flaky mobile radio) can
// resume seamlessly, and the character stays online for friends, the open
// play-session analytics row, and the concurrent-player counts. Forced
// disconnects (moderation, takeover, anti-bot, account lock) never enter
// grace; they tear down through GameServer.leave() directly. This module is
// the pure decision core so the join rules are unit-testable without a
// GameServer.
//
// This is also the reconnect policy for a dropped dungeon run (issue #1351):
// keeping the linkdead player's entity live and in place is what stops a
// claimed instance's empty-timeout reaper (updateInstances,
// src/sim/instances/dungeons.ts) from ever seeing it as empty during the
// grace window. See that file's updateInstances comment for the full chain.

export const LINKDEAD_GRACE_MS = 5 * 60 * 1000;

export interface LinkdeadSessionView {
  accountId: number;
  linkdead: boolean;
  // True once GameServer.leave() has begun tearing the session down. leave()
  // sets it synchronously, then awaits the character save before removing the
  // sim entity and releasing the character load lease; a session in that
  // window must never be resumed (the reconnect would get a zombie whose
  // lease release the nonce fence cannot see, since the resume arm never
  // re-acquires).
  left: boolean;
  // True once this session's guild bank escrow was ROLLED BACK: its live state
  // was abandoned and it can never persist again
  // (server/guild_bank_escrow_refusal.ts handleGuildBankEscrowRefusal).
  // RESUMING it would hand the player a session
  // that plays normally and saves NOTHING, forever, with no error and no
  // signal: silent unbounded data loss, which is far worse than the reconnect
  // refusal below. The refused client retries into the fresh-join arm and
  // loads from its durable row, which is exactly what the rollback intends.
  escrowQuarantined: boolean;
}

// English-source join error, re-localized client-side (src/ui/api_error_i18n.ts).
export const WORLD_FIGHT_HOLD_JOIN_ERROR =
  'another character on this account is still in the world after a fight';

export type JoinPlan =
  | { action: 'resume' }
  | { action: 'reject'; error: string }
  | { action: 'join' };

// Decide what a join request means given the account's existing sessions.
// - The same character is already in the world: resume it when it is linkdead
//   and owned by the requesting account (an accidental-disconnect reconnect);
//   otherwise reject, so the explicit takeover flow stays the only way to
//   displace a session whose socket is still alive.
// - A different character: the account's linkdead sessions never block the
//   login (the caller displaces them, switching the account over to the new
//   character immediately instead of at the end of the grace window); only
//   sessions with a live socket count against the per-account cap. The one
//   exception: a linkdead body a recent world fight still holds
//   (heldOtherSession, server/world_pvp_departure.ts) refuses the login until
//   its fight window closes, so an alt cannot pull a fighter out of reach.
export function planJoin(opts: {
  accountId: number;
  isGm: boolean;
  sameCharacter: LinkdeadSessionView | null;
  liveOtherSessions: number;
  heldOtherSession?: boolean;
  maxPerAccount: number;
}): JoinPlan {
  if (opts.sameCharacter) {
    if (
      opts.sameCharacter.linkdead &&
      !opts.sameCharacter.left &&
      !opts.sameCharacter.escrowQuarantined &&
      opts.sameCharacter.accountId === opts.accountId
    ) {
      return { action: 'resume' };
    }
    // Mid-teardown (left), escrow-quarantined, and live-socket sessions all
    // reject with the transient conflict error; the client's reconnect policy
    // retries it, and the retry lands on a clean fresh join once the teardown
    // finishes.
    return { action: 'reject', error: 'character already in world' };
  }
  if (opts.heldOtherSession) return { action: 'reject', error: WORLD_FIGHT_HOLD_JOIN_ERROR };
  if (!opts.isGm && opts.liveOtherSessions >= opts.maxPerAccount) {
    return {
      action: 'reject',
      error: 'too many characters on this account are already in the world',
    };
  }
  return { action: 'join' };
}

// Count the account's OTHER sessions for planJoin and plan the join: live
// sockets count against the cap, linkdead ones are returned for the caller to
// displace on a fresh join, and `holdsBody` (server/world_pvp_departure.ts
// worldFightHoldsBody) says whether a linkdead one is still held by a recent
// world fight. `sameCharacter` is never counted as an "other".
export function planAccountJoin<S extends LinkdeadSessionView>(opts: {
  sessions: Iterable<S>;
  accountId: number;
  isGm: boolean;
  sameCharacter: S | null;
  maxPerAccount: number;
  holdsBody: (session: S) => boolean;
}): { plan: JoinPlan; linkdeadOthers: S[] } {
  let liveOtherSessions = 0;
  const linkdeadOthers: S[] = [];
  for (const s of opts.sessions) {
    if (s.accountId !== opts.accountId || s === opts.sameCharacter) continue;
    if (s.linkdead) linkdeadOthers.push(s);
    else liveOtherSessions++;
  }
  const plan = planJoin({
    accountId: opts.accountId,
    isGm: opts.isGm,
    sameCharacter: opts.sameCharacter,
    liveOtherSessions,
    heldOtherSession: linkdeadOthers.some(opts.holdsBody),
    maxPerAccount: opts.maxPerAccount,
  });
  return { plan, linkdeadOthers };
}
