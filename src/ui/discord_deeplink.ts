// Deep link from a Discord relay "Respond" button. The bot posts a link button to
// <gameOrigin>/?lfg=<characterName>&c=<commandId>; opening it should land the
// responder in the game (logging in with Discord if needed) and auto-whisper that
// character with a message tailored to the original command (group / guild / trade
// / event / help).
//
// Pure + DOM-free so it is unit-tested directly; main.ts owns the localStorage +
// OAuth + world wiring and consumes these helpers.

/** Query-string key carrying the target character name. */
export const LFG_PARAM = 'lfg';

/** Query-string key carrying the relay command id (lfg / wts / ...). */
export const LFG_CMD_PARAM = 'c';

/** localStorage key the pending intent is stashed under across the login redirect. */
export const LFG_INTENT_KEY = 'woc_lfg_intent';

/** How long a stashed intent stays valid (so a stale tab never whispers later). */
export const LFG_INTENT_TTL_MS = 30 * 60 * 1000;

/** A whisper intent persisted across the Discord-login round-trip. */
export interface LfgIntent {
  target: string;
  /** Relay command id the responder is answering (defaults to 'lfg'). */
  command?: string;
  ts: number;
}

// Per-command whisper openers, so a "Respond" lands as the right kind of message:
// a group ask, a guild ask, a trade, an event RSVP, or an offer of help.
const WHISPERS: Record<string, (target: string) => string> = {
  lfg: (t) => `/w ${t} Saw your LFG on Discord, mind if I join your group?`,
  recruit: (t) => `/w ${t} Saw your guild recruitment on Discord, I would love to join!`,
  wts: (t) => `/w ${t} Saw what you are selling on Discord, I am interested, want to trade?`,
  wtb: (t) => `/w ${t} Saw your buy request on Discord, I might have what you need, want to trade?`,
  event: (t) => `/w ${t} Saw your event on Discord, count me in!`,
  help: (t) => `/w ${t} Saw your help request on Discord, happy to help, whereabouts are you?`,
};

/**
 * Read the target character name from a location.search string, validated to the
 * in-game character-name shape (so a crafted param can't inject anything else).
 * Returns null when absent or malformed.
 */
export function parseLfgTarget(search: string): string | null {
  const raw = new URLSearchParams(search).get(LFG_PARAM);
  if (!raw) return null;
  const name = raw.trim();
  return /^[A-Za-z][A-Za-z0-9]{1,23}$/.test(name) ? name : null;
}

/** Read the relay command id from a location.search string, or null if unknown. */
export function parseLfgCommand(search: string): string | null {
  const raw = (new URLSearchParams(search).get(LFG_CMD_PARAM) ?? '').toLowerCase();
  return raw in WHISPERS ? raw : null;
}

/** The chat line that whispers the requester, tailored to the relay command. */
export function buildLfgWhisper(target: string, command: string | null | undefined): string {
  const make = (command && WHISPERS[command]) || WHISPERS.lfg;
  return make(target);
}

/**
 * Validate a stashed intent and return its target, or null when missing, empty, or
 * older than the TTL. Pure (now is injected) so the freshness rule is testable.
 */
export function lfgIntentTarget(intent: LfgIntent | null, now: number): string | null {
  if (!intent?.target) return null;
  if (!Number.isFinite(intent.ts) || now - intent.ts > LFG_INTENT_TTL_MS) return null;
  return intent.target;
}
