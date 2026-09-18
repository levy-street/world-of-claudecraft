// The town-bell homecoming's HUD-side policy, kept out of hud.ts: which note
// the ferryBellHome event opens for this character, the device one-shot for
// the plain return-bell hint, and the guidance-choice write. The note models
// themselves are the pure tutorial_greeting_view.ts.

import type { Settings } from '../game/settings';
import { ferryBellHomeNoteFor, type TutorialGreetingNote } from './tutorial_greeting_view';

/** The woc.tutorial.v1 presentation-only one-shot idiom: the plain
 *  return-bell hint is shown once per device. */
const RETURN_HINT_SEEN_KEY = 'woc.ferrybellhint.v1';

type HintStorage = Pick<Storage, 'getItem' | 'setItem'>;

function deviceStorage(): HintStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The note to open on a town-bell homecoming, or null when there is nothing
 *  left to say on this device. While Wolves at the Door is still ahead of the
 *  character the note carries the guidance choice on EVERY crossing (a
 *  changed mind is one ride away, and a browser that cannot persist settings
 *  still gets asked). Once the quest is done the guidance has nothing to
 *  draw, so the note is the return-bell hint ONCE per device (the ride may
 *  have been a misclick), and never at all where storage is unavailable
 *  (private mode: skip the hint rather than throw). */
export function ferryBellHomeNoteToOpen(
  world: { questState(questId: string): string },
  storage: HintStorage | null = deviceStorage(),
): TutorialGreetingNote | null {
  const note = ferryBellHomeNoteFor(world);
  if (note.guidanceChoice) return note;
  try {
    if (!storage || storage.getItem(RETURN_HINT_SEEN_KEY) === 'seen') return null;
    storage.setItem(RETURN_HINT_SEEN_KEY, 'seen');
    return note;
  } catch {
    return null;
  }
}

/** Persist the player's guidance choice through the options hooks. The hooks
 *  are wired at boot, long before any ferry event, so a missing writer is a
 *  wiring bug: it is reported, never a silently dropped click. */
export function writeEastbrookGuidanceChoice(
  hooks: { settings: Pick<Settings, 'set'> } | null,
  enabled: boolean,
): void {
  if (!hooks) {
    console.warn('eastbrookGuidance choice dropped: options hooks not wired');
    return;
  }
  hooks.settings.set('eastbrookGuidance', enabled);
}
