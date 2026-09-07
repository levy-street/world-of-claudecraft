import {
  DUNGEON_ENTRY_FACING_WIRE_VERSION,
  MOVEMENT_WIRE_VERSION,
  ONLINE_WORLD_AUTH_TYPE,
  PET_SPECIAL_WIRE_VERSION,
} from '../world_api';
import { STABLE_TIMER_WIRE_VERSION } from './snapshot_timer_wire';

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
  movementWire: typeof MOVEMENT_WIRE_VERSION;
} {
  return {
    t: ONLINE_WORLD_AUTH_TYPE,
    token,
    character: characterId,
    clientSeed,
    // Every capability the handshake advertises must be minted here, not at the
    // old inline call site: server/ws_auth.ts checks each one by exact equality,
    // so an omitted field either silently downgrades the session with nothing
    // reddening (the optional ones) or fails the handshake (movementWire).
    dungeonEntryFacingWire: DUNGEON_ENTRY_FACING_WIRE_VERSION,
    timerWire: STABLE_TIMER_WIRE_VERSION,
    petSpecialWire: PET_SPECIAL_WIRE_VERSION,
    movementWire: MOVEMENT_WIRE_VERSION,
  };
}
