// The King of the Hill half of the Discord PvP channel: the hill's spawn
// announcements (the warning that one will rise, and the rise itself), posted
// beside the World PvP kill feed (server/discord_pvp_feed.ts) in the same
// DISCORD_PVP_FEED_CHANNEL_ID channel. The sim fires the server-only
// `hillAnnounced` event once per phase change (src/sim/pvp/hill.ts
// announcePhase, beside the realm's chat line); the activity-detect chain
// shapes it with `hillAnnouncementItem` and enqueues it; the bot drains it
// through the consolidated GET /internal/discord/outbox poll (the
// `hillAnnouncements` stream) and posts one card per item
// (bot/logic.ts buildHillAnnouncementMessage).
//
// Only the SPAWN phases post ('warning' and 'risen'); a fall is not a call to
// arms. The sim's times are relative seconds, mapped here onto the server's
// wall clock, so the bot can render a live Discord countdown and skip an item
// whose moment already passed while it was queued (a stalled bot).
//
// Names only, like the kill feed: no account ids, nobody pinged. Pure +
// dependency-free apart from the static zone table (no Discord IO, no DB).

import { ZONES } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';

/** One announcement, exactly the wire item the bot receives. */
export interface QueuedHillAnnouncement {
  phase: 'warning' | 'risen';
  /** The hill's zone, English (the bot posts English). */
  zoneName: string;
  /** Wall-clock ms the hill rises (past for 'risen') and falls. */
  risesAtMs: number;
  fallsAtMs: number;
  realm: string;
}

type HillAnnouncedEvent = Extract<SimEvent, { type: 'hillAnnounced' }>;

/**
 * Shape the sim event into the queued item on the server's clock, or null for
 * a phase the feed does not post (the fall).
 */
export function hillAnnouncementItem(
  ev: HillAnnouncedEvent,
  realm: string,
  nowMs: number,
): QueuedHillAnnouncement | null {
  if (ev.phase === 'fallen') return null;
  return {
    phase: ev.phase,
    zoneName: ZONES.find((z) => z.id === ev.zoneId)?.name ?? ev.zoneId,
    risesAtMs: Math.round(nowMs + ev.secondsUntilRise * 1000),
    fallsAtMs: Math.round(nowMs + ev.secondsUntilFall * 1000),
    realm,
  };
}

const QUEUE: QueuedHillAnnouncement[] = [];
/**
 * Backstop for a stalled or absent bot; oldest first. A hill announces twice
 * per window, so this holds far more than the bot could ever usefully post
 * late (the bot skips a stale item anyway). Exported for the outbox
 * payload-bound fixture.
 */
export const HILL_ANNOUNCEMENT_MAX_QUEUE = 10;

export function enqueueHillAnnouncement(item: QueuedHillAnnouncement): void {
  QUEUE.push(item);
  if (QUEUE.length > HILL_ANNOUNCEMENT_MAX_QUEUE) {
    QUEUE.splice(0, QUEUE.length - HILL_ANNOUNCEMENT_MAX_QUEUE);
  }
}

/** Remove and return everything queued (the outbox calls this each poll). */
export function drainHillAnnouncements(): QueuedHillAnnouncement[] {
  return QUEUE.splice(0, QUEUE.length);
}

/** Put drained items back at the front, in order (the requeuePvpKills contract). */
export function requeueHillAnnouncements(items: readonly QueuedHillAnnouncement[]): void {
  if (items.length === 0) return;
  QUEUE.unshift(...items);
  if (QUEUE.length > HILL_ANNOUNCEMENT_MAX_QUEUE) {
    QUEUE.splice(0, QUEUE.length - HILL_ANNOUNCEMENT_MAX_QUEUE);
  }
}

/** Current queue depth (for tests / diagnostics). */
export function hillAnnouncementQueueDepth(): number {
  return QUEUE.length;
}
