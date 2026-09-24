// Which world quests the objective tracker lists, WoW style: a world quest shows
// only while the player stands in its area, and it lingers a few seconds after
// the player steps out (coming back inside in time keeps it) or after it is
// completed, then drops off. A running lesson (tracing, forging, the wisp maze,
// a glider flight) always shows. Presentation only: the frame time is passed
// in, the sim is never consulted for timers, and no clock is read here.

/** How long a world quest stays listed after its player leaves the area or
 *  completes it. */
export const WORLD_QUEST_TRACKER_GRACE_MS = 5_000;

export interface WorldQuestTrackerRowState {
  /** The player stands inside the quest's area this frame. */
  inArea: boolean;
  /** The row reads as completed. */
  complete: boolean;
  /** A lesson minigame for this quest is running (it owns the section). */
  lessonRunning: boolean;
}

export interface WorldQuestTrackerVisibility {
  /** Whether the tracker lists this world quest at `nowMs`. */
  visible(questId: string, row: WorldQuestTrackerRowState, nowMs: number): boolean;
  /** Forget quests no longer in the world quest log (the daily reset). */
  retain(questIds: ReadonlySet<string>): void;
}

export function createWorldQuestTrackerVisibility(
  graceMs = WORLD_QUEST_TRACKER_GRACE_MS,
): WorldQuestTrackerVisibility {
  // Quests this tracker has listed at least once: only those earn a grace
  // period, so a quest completed or left before this view saw it never flashes.
  const shown = new Set<string>();
  // When a listed quest last stopped qualifying (left the area or completed).
  const goneAt = new Map<string, number>();
  return {
    visible(questId, row, nowMs) {
      if (row.lessonRunning || (row.inArea && !row.complete)) {
        shown.add(questId);
        goneAt.delete(questId);
        return true;
      }
      if (!shown.has(questId)) return false;
      let since = goneAt.get(questId);
      if (since === undefined) {
        since = nowMs;
        goneAt.set(questId, since);
      }
      return nowMs - since < graceMs;
    },
    retain(questIds) {
      for (const id of shown) if (!questIds.has(id)) shown.delete(id);
      for (const id of goneAt.keys()) if (!questIds.has(id)) goneAt.delete(id);
    },
  };
}
