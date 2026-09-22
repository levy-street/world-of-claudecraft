// The two localStorage keys the emote wheel persists under.
//
// Pure string building, lifted out of hud.ts because it is the definition of what does not
// need the coordinator: two names derived from a class and a character name. Kept together
// in one module because the pair must agree, and the version key is derived FROM the slots
// key rather than written twice.

/** Where a character's chosen emote slots live. Scoped per class AND per character name. */
export function emoteWheelSlotsKey(playerClass: string, playerName: string): string {
  return `woc_emote_wheel_${playerClass}_${playerName}`;
}

/**
 * The migration flag beside those slots.
 *
 * Suffixed `_v2` on purpose and derived from the slots key, so a rename of the storage
 * scheme can never move one of the pair without the other; a split rename would strand the
 * flag and silently re-run the migration on every load.
 */
export function emoteWheelVersionKey(playerClass: string, playerName: string): string {
  return `${emoteWheelSlotsKey(playerClass, playerName)}_v2`;
}
