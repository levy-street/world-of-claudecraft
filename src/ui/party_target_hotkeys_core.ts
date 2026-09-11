// The party target hotkeys (F1..F10 by default): which unit each key selects.
// F1 is always the local player. F2..F10 walk the party frames top to bottom in
// the SAME order the frames paint (selectPartyFrameMembers: the persisted sort
// mode, raid group order), so the key a healer presses matches the row they are
// looking at. The player's own row never takes an F2..F10 slot, even with the
// Show Self option on: F1 already owns it, and a self row shifting every ally
// down one key would make the keys depend on a display toggle.
//
// Pure (UI_PURE_CORES): imports only the party frame selector and IWorld types,
// so tests/party_target_hotkeys_core.test.ts drives it with plain party info.

import type { PartyInfo } from '../world_api';
import { type PartyFrameDisplayConfig, selectPartyFrameMembers } from './party_frames';

/** How many ally slots the F-row carries (F2..F10); F1 is the self slot 0. */
export const PARTY_TARGET_HOTKEY_SLOTS = 9;

/**
 * The entity id a party target hotkey selects, or null when the slot has no
 * one in it (no party, or fewer allies than the slot asks for). Slot 0 is the
 * player; slots 1..PARTY_TARGET_HOTKEY_SLOTS index the party frame rows with
 * the player's own row skipped.
 */
export function partyHotkeyTargetId(
  slot: number,
  info: PartyInfo | null,
  playerId: number,
  playerPos: { x: number; z: number },
  config?: PartyFrameDisplayConfig,
): number | null {
  if (slot === 0) return playerId;
  if (!Number.isInteger(slot) || slot < 1 || slot > PARTY_TARGET_HOTKEY_SLOTS || !info) return null;
  const rows = selectPartyFrameMembers(info, playerId, playerPos, undefined, config).filter(
    (m) => m.pid !== playerId,
  );
  return rows[slot - 1]?.pid ?? null;
}
