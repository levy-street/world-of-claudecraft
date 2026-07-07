// Linkdead grace: a dropped socket does not log the character out. The
// session is held in-world ("linkdead") for LINKDEAD_GRACE_MS so an
// accidental disconnect (network blip, page reload, flaky mobile radio) can
// resume seamlessly, and the character stays online for friends, the open
// play-session analytics row, and the concurrent-player counts. Forced
// disconnects (moderation, takeover, anti-bot, account lock) never enter
// grace; they tear down through GameServer.leave() directly. This module is
// the pure decision core so the join rules are unit-testable without a
// GameServer.

export const LINKDEAD_GRACE_MS = 5 * 60 * 1000;

export interface LinkdeadSessionView {
  accountId: number;
  linkdead: boolean;
}

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
//   sessions with a live socket count against the per-account cap.
export function planJoin(opts: {
  accountId: number;
  isGm: boolean;
  sameCharacter: LinkdeadSessionView | null;
  liveOtherSessions: number;
  maxPerAccount: number;
}): JoinPlan {
  if (opts.sameCharacter) {
    if (opts.sameCharacter.linkdead && opts.sameCharacter.accountId === opts.accountId) {
      return { action: 'resume' };
    }
    return { action: 'reject', error: 'character already in world' };
  }
  if (!opts.isGm && opts.liveOtherSessions >= opts.maxPerAccount) {
    return {
      action: 'reject',
      error: 'too many characters on this account are already in the world',
    };
  }
  return { action: 'join' };
}
