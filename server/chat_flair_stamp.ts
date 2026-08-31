import type { ChatSenderFlair } from '../src/sim/account_flair';
import { specialRoleChatTag } from '../src/sim/discord_roles';
import type { SimEvent } from '../src/sim/types';

// The events batch's chat-flair prologue, moved whole out of
// GameServer.routeEvents (server/game.ts, the monolith ratchet) so it is a pure
// function a Vitest drives directly. It runs ONCE per batch, before
// serializeEventFragments (server/event_frame.ts) captures each event's final
// wire shape, and it is the ONLY mutation of a SimEvent on the routing path:
// that ordering is what lets every recipient share one serialized fragment.

export interface ChatFlairSources {
  /** The sender's account flair, read from their SESSION rather than an entity:
   *  general/world/lfg chat reaches players far outside the sender's interest
   *  scope, where the recipient has no entity record for them. */
  flairForPid(pid: number): ChatSenderFlair | undefined;
  /** The sender's Discord role, read LIVE from their ENTITY. The bot's
   *  members-meta push writes it on its own cadence, so reading it at fan-out
   *  time cannot go stale the way a value folded into the cached session flair
   *  would. Undefined for a sender with no entity or no role. */
  discordRoleForPid(pid: number): string | undefined;
}

/**
 * Stamp each chat event in the batch with its sender's flair, resolved once per
 * EVENT rather than once per recipient. Sparse by design: an ordinary player's
 * chat event is left untouched, and only a staff sender allocates.
 *
 * The role half is gated on the catalog's chatTag flag, so community roles
 * (Artist, Content Creator, LEGEND, SHILL) stay nameplate-only and the chat tag
 * remains a pure authority signal (the anti-impersonation rule).
 */
export function stampChatSenderFlair(events: readonly SimEvent[], src: ChatFlairSources): void {
  for (const ev of events) {
    if (ev.type !== 'chat') continue;
    const flair = src.flairForPid(ev.fromPid);
    const role = src.discordRoleForPid(ev.fromPid);
    // `flair` may be undefined here; spreading undefined is a spec-defined
    // no-op, so a role-only sender yields a clean { role } object.
    if (role && specialRoleChatTag(role)) ev.flair = { ...flair, role };
    else if (flair) ev.flair = flair;
  }
}
