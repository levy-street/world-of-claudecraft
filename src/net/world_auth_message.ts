import { DESKTOP_API_ORIGIN } from '../client_origin';
import { runtimeWebSocketUrl } from '../runtime';
import {
  DUNGEON_ENTRY_FACING_WIRE_VERSION,
  ONLINE_WORLD_AUTH_TYPE,
  PET_SPECIAL_WIRE_VERSION,
} from '../world_api';
import { STABLE_TIMER_WIRE_VERSION } from './snapshot_timer_wire';

/** The world socket's URL for this page (moved from online.ts, which
 *  re-exports it): the desktop shell dials its API origin, every other host
 *  the page's own. */
export function buildWebSocketUrl(protocol: string, host: string): string {
  return runtimeWebSocketUrl(protocol, host, DESKTOP_API_ORIGIN);
}

export function buildWebSocketAuthMessage(
  token: string,
  characterId: number,
  clientSeed = '',
): {
  t: typeof ONLINE_WORLD_AUTH_TYPE;
  token: string;
  character: number;
  clientSeed: string;
  dungeonEntryFacingWire: typeof DUNGEON_ENTRY_FACING_WIRE_VERSION;
  timerWire: typeof STABLE_TIMER_WIRE_VERSION;
  petSpecialWire: typeof PET_SPECIAL_WIRE_VERSION;
  movementWire: 2;
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
  };
}
