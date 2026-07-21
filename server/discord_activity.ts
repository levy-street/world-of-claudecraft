// Significant-activity feed: the game loop detects notable moments (a character
// reaching max level, a rare drop, a duel result, an arena win) and enqueues a
// structured item here; the bot drains /internal/discord/activity and posts a
// rich card to the activity channel, tagging the linked Discord user(s) involved.
//
// Pure + dependency-free (no Discord IO, no DB), so it is trivially testable. The
// drain endpoint resolves accountIds to Discord identities; this layer is just the
// in-memory hand-off, mirroring discord_relay.ts.

export type ActivityKind = 'levelup' | 'rareloot' | 'duel' | 'arena' | 'vale_cup';

export interface QueuedActivity {
  kind: ActivityKind;
  // Accounts to tag (resolved to Discord ids at drain). Index 0 is the primary
  // subject (drives the card avatar/profile); duels carry [winner, loser].
  accountIds: number[];
  // Character names parallel to accountIds (display when a player is not linked).
  names: string[];
  realm: string;
  // Public profile URL of the primary subject, or null.
  profileUrl: string | null;
  // Type-specific payload (only the relevant fields are set):
  level?: number; // levelup
  itemName?: string; // rareloot
  quality?: string; // rareloot ('epic' | 'legendary')
  winnerName?: string; // duel
  loserName?: string; // duel
  ratingDelta?: number; // arena (signed)
  bracket?: number; // vale_cup (1..5, an NvN bout)
  scoreA?: number; // vale_cup
  scoreB?: number; // vale_cup
  winnerNation?: string; // vale_cup (VcNationId banner of the winning side)
}

const QUEUE: QueuedActivity[] = [];
const MAX_QUEUE = 100; // backstop so a stalled/absent bot can never grow this unbounded

// Recent dedupe keys with their wall-clock time, so a moment that surfaces as
// several sim events (a loot roll per candidate, an arena end per ally) is posted
// once. Keys expire after DEDUPE_TTL_MS.
const DEDUPE_TTL_MS = 30_000;
const recentKeys = new Map<string, number>();

/**
 * Enqueue an activity for the bot to post. When dedupeKey is given and was seen
 * within the TTL, the item is dropped (so one moment yields one card). `now` is
 * injected so callers pass the server clock (and tests stay deterministic).
 */
export function enqueueActivity(item: QueuedActivity, dedupeKey: string | null, now: number): void {
  if (dedupeKey) {
    const last = recentKeys.get(dedupeKey);
    if (last !== undefined && now - last < DEDUPE_TTL_MS) return;
    recentKeys.set(dedupeKey, now);
    if (recentKeys.size > 512) {
      for (const [k, t] of recentKeys) {
        if (now - t >= DEDUPE_TTL_MS) recentKeys.delete(k);
      }
    }
  }
  QUEUE.push(item);
  if (QUEUE.length > MAX_QUEUE) QUEUE.splice(0, QUEUE.length - MAX_QUEUE);
}

/** Remove and return everything queued (the bot calls this each poll). */
export function drainActivity(): QueuedActivity[] {
  return QUEUE.splice(0, QUEUE.length);
}

/** Current queue depth (for tests / diagnostics). */
export function activityQueueDepth(): number {
  return QUEUE.length;
}
