// The Discord PvP kill feed: every resolved World PvP (/pvp flag) kill, as one
// line in a dedicated channel. The sim fires the server-only `worldPvpKill`
// event exactly once per death (src/sim/pvp/world_pvp.ts, behind its
// paid-death guard, so no dedupe key is needed here); the activity-detect chain
// shapes it with `pvpKillFeedItem` and enqueues it; the bot drains it through
// the consolidated GET /internal/discord/outbox poll (the `pvpKills` stream)
// and batches each drain into digest posts (bot/logic.ts buildPvpKillFeedMessage).
//
// Deliberately NOT an activity kind. The activity feed posts one card per
// moment, tags linked players, and drops any item with no linked participant;
// a kill feed is the opposite on all three counts: high volume, names only
// (nobody is pinged), and every kill posts whether or not anyone is linked. So
// it carries no account ids and costs the outbox's identity read nothing.
//
// Pure + dependency-free apart from the static zone table (no Discord IO, no
// DB), mirroring discord_activity.ts: the in-memory hand-off only.

import { ZONES } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';

/** One kill line, exactly the wire item the bot receives. */
export interface QueuedPvpKill {
  killerName: string;
  victimName: string;
  killerLevel: number;
  victimLevel: number;
  /** The victim's zone, English (the bot posts English), or null off the table. */
  zoneName: string | null;
  /** Credited contributors other than the killing blow. */
  assists: number;
  /** The gold stake actually taken from the victim, in copper. */
  copper: number;
  realm: string;
}

type WorldPvpKillEvent = Extract<SimEvent, { type: 'worldPvpKill' }>;

/** Shape the sim event into the queued item: resolve the zone id to its name. */
export function pvpKillFeedItem(ev: WorldPvpKillEvent, realm: string): QueuedPvpKill {
  const zone = ev.zoneId === null ? undefined : ZONES.find((z) => z.id === ev.zoneId);
  return {
    killerName: ev.killerName,
    victimName: ev.victimName,
    killerLevel: ev.killerLevel,
    victimLevel: ev.victimLevel,
    zoneName: zone?.name ?? null,
    assists: ev.assists,
    copper: ev.copper,
    realm,
  };
}

const QUEUE: QueuedPvpKill[] = [];
/**
 * Backstop so a stalled/absent bot (or an unset channel) can never grow this
 * unbounded; oldest kills drop first. Exported so the outbox payload-bound
 * fixture builds its worst case from the REAL cap, not a mirror. A drain at the
 * cap costs ceil(cap / bot/logic.ts PVP_FEED_LINES_PER_POST) digest posts.
 */
export const PVP_KILL_FEED_MAX_QUEUE = 100;

export function enqueuePvpKill(item: QueuedPvpKill): void {
  QUEUE.push(item);
  if (QUEUE.length > PVP_KILL_FEED_MAX_QUEUE) {
    QUEUE.splice(0, QUEUE.length - PVP_KILL_FEED_MAX_QUEUE);
  }
}

/** Remove and return everything queued (the outbox calls this each poll). */
export function drainPvpKills(): QueuedPvpKill[] {
  return QUEUE.splice(0, QUEUE.length);
}

/**
 * Put drained items BACK at the front, in their original order, so a poll whose
 * response failed to build costs the bot a retry rather than the kills (the
 * requeueActivity contract, including its honest limit: a queue that refilled
 * past the cap during the failed poll spends the requeued, oldest, items first).
 */
export function requeuePvpKills(items: readonly QueuedPvpKill[]): void {
  if (items.length === 0) return;
  QUEUE.unshift(...items);
  if (QUEUE.length > PVP_KILL_FEED_MAX_QUEUE) {
    QUEUE.splice(0, QUEUE.length - PVP_KILL_FEED_MAX_QUEUE);
  }
}

/** Current queue depth (for tests / diagnostics). */
export function pvpKillQueueDepth(): number {
  return QUEUE.length;
}
