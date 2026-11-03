// The dungeon door level gate: may a character of this level walk through
// this dungeon's door? The minimums are authored in
// content/dungeon_entry_levels.ts; enterDungeon consumes the verdict and owns
// the denial (deny callback, preflight, throttle). Pure: no rng, no ctx, no
// mutation, so the same answer holds on every host.

import { DUNGEON_ENTRY_MIN_LEVEL } from '../content/dungeon_entry_levels';
import { isIgnivarRaidRoom } from '../ignivar_raid_ids';

/** Seconds between repeated level denials for one player: the walk-in door
 *  trigger fires at 20 Hz, so an unthrottled denial would spam the toast. */
export const DUNGEON_LEVEL_DENIED_NOTICE_SECONDS = 4;

/** The door's level floor for this dungeon, or 0 when the door has none. */
export function dungeonEntryMinLevel(dungeonId: string): number {
  return DUNGEON_ENTRY_MIN_LEVEL[dungeonId] ?? 0;
}

/** The door's minimum level when this character is below it, or null when
 *  the door admits them. */
export function dungeonLevelRequirement(dungeonId: string, level: number): number | null {
  const minLevel = dungeonEntryMinLevel(dungeonId);
  return level < minLevel ? minLevel : null;
}

/** True when a player standing inside a claim of `claimDungeonId` is moving
 *  between rooms of the same family as `targetDungeonId` (the same room, or
 *  two rooms of the Ignivar raid chain), so the door floor already admitted
 *  them. Any other claim counts as outside. */
export function sameLevelFloorFamily(claimDungeonId: string, targetDungeonId: string): boolean {
  return (
    claimDungeonId === targetDungeonId ||
    (isIgnivarRaidRoom(claimDungeonId) && isIgnivarRaidRoom(targetDungeonId))
  );
}

/** The English denial line (re-localized client-side by the error-text
 *  matcher in src/ui/error_text_i18n_core.ts). */
export function dungeonLevelDeniedText(dungeonName: string, minLevel: number): string {
  return `You must be level ${minLevel} to enter ${dungeonName}.`;
}
