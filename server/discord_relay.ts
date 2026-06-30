// In-game "!" community commands (LFG / trade / recruit / event / help) cross-post
// to Discord. Posting is done by the BOT (a separate process) rather than a plain
// webhook, so the message can carry the requester's Discord identity (mention +
// avatar) and an interactive "I'm keen to join" button that pings them back in
// game. This module is just the server-side hand-off: the game loop enqueues a
// structured item here; the bot drains the queue via /internal/discord/relay.
//
// Pure + dependency-free (no Discord IO), so it is trivially testable.

/** A community-command post awaiting delivery to Discord by the bot. */
export interface QueuedRelay {
  /** Relay command id, e.g. "lfg". */
  commandId: string;
  /** Short bracket tag, e.g. "LFG". */
  tag: string;
  /** Human label, e.g. "Looking for Group". */
  label: string;
  /** Embed accent colour. */
  color: number;
  /** Account that issued the command (used to resolve the Discord link at drain). */
  accountId: number;
  /** In-game character name. */
  characterName: string;
  /** Character level. */
  level: number;
  /** Capitalised class name, e.g. "Hunter". */
  className: string;
  /** Realm the character is on. */
  realm: string;
  /** Where the character is right now, e.g. "Eastbrook Vale" or a dungeon name. */
  zone: string;
  /** The free-text message the player typed (may be empty). */
  message: string;
  /** Public character profile URL, or null. */
  profileUrl: string | null;
}

const QUEUE: QueuedRelay[] = [];
const MAX_QUEUE = 50; // backstop so a stalled/absent bot can never grow this unbounded

/** Enqueue a community-command post for the bot to deliver. */
export function enqueueRelay(item: QueuedRelay): void {
  QUEUE.push(item);
  if (QUEUE.length > MAX_QUEUE) QUEUE.splice(0, QUEUE.length - MAX_QUEUE);
}

/** Remove and return everything queued (the bot calls this each poll). */
export function drainRelay(): QueuedRelay[] {
  return QUEUE.splice(0, QUEUE.length);
}

/** Current queue depth (for tests / diagnostics). */
export function relayQueueDepth(): number {
  return QUEUE.length;
}
