import {
  DUNGEON_ENTRY_FACING_WIRE_VERSION,
  ONLINE_WORLD_AUTH_TYPE,
  PET_SPECIAL_WIRE_VERSION,
} from '../world_api';
import { STABLE_TIMER_WIRE_VERSION } from './snapshot_timer_wire';

// resumeToken is the same-client proof the server minted on this tab's last
// `hello` (server/resume_token.ts). ClientWorld holds it in memory ONLY, never
// localStorage or any other storage, so another tab or device can never present
// it; a fresh ClientWorld (a char-select Enter World, a page reload) has none, so
// its first join is exactly today's. Echoed on an auto-reconnect, it lets the
// server supersede this tab's own stale socket instead of refusing the reconnect
// as 'character already in world' until the keepalive sweep reaps it. Omitted
// from the frame entirely when absent, so the no-token frame is byte-identical
// to the pre-token one.
export function buildWebSocketAuthMessage(
  token: string,
  characterId: number,
  clientSeed = '',
  resumeToken: string | null = null,
): {
  t: typeof ONLINE_WORLD_AUTH_TYPE;
  token: string;
  character: number;
  clientSeed: string;
  dungeonEntryFacingWire: typeof DUNGEON_ENTRY_FACING_WIRE_VERSION;
  timerWire: typeof STABLE_TIMER_WIRE_VERSION;
  petSpecialWire: typeof PET_SPECIAL_WIRE_VERSION;
  movementWire: 2;
  resumeToken?: string;
} {
  return {
    t: ONLINE_WORLD_AUTH_TYPE,
    token,
    character: characterId,
    clientSeed,
    // Every capability the handshake advertises must be minted here, not at the
    // old inline call site: server/ws_auth.ts negotiates each one by exact
    // equality and falls back to the legacy wire when the key is absent, so an
    // omitted field silently downgrades the session with nothing reddening.
    dungeonEntryFacingWire: DUNGEON_ENTRY_FACING_WIRE_VERSION,
    timerWire: STABLE_TIMER_WIRE_VERSION,
    petSpecialWire: PET_SPECIAL_WIRE_VERSION,
    movementWire: 2,
    ...(resumeToken ? { resumeToken } : {}),
  };
}

// The soft (cosmetic) profanity words a `hello` or `censor` frame carries, string
// entries only, or null when the field is not a list at all.
export function softWordList(raw: unknown): string[] | null {
  return Array.isArray(raw) ? raw.filter((w: unknown): w is string => typeof w === 'string') : null;
}

// The token a server `hello` frame carries, or null when it carries none (an
// older server binary mid rolling deploy).
export function helloResumeToken(hello: { resumeToken?: unknown }): string | null {
  return typeof hello.resumeToken === 'string' && hello.resumeToken ? hello.resumeToken : null;
}
