// The pure half of the launcher creator's one-time gesture hint (src/ui/preview_touch_hint.ts):
// what the hint does with the stage's per-frame offer and with the player's first gesture,
// and the one stored flag that remembers that gesture across visits. DOM-free.
//
// The hint teaches a phone player that the creator's 3D model takes a pinch. It shows beside
// the model until the player first moves it while the hint is up (a pinch, a slide, a turn or
// a double tap), plays its exit, and never shows on that device again. A visit that ends
// without such a gesture leaves it to show on the next one: it retires on the gesture, not on
// being seen. A gesture made while the hint is not on screen (on the character select's
// stage, or before the creator's model draws) does not retire it: the player never saw it.
//
// The phases:
// - idle: not on screen (the stage does not offer it now, or has not yet).
// - shown: on screen beside the model.
// - leaving: the player just moved the model; the exit is playing.
// - done: retired for good (a gesture on this visit or an earlier one).

export type TouchHintPhase = 'idle' | 'shown' | 'leaving' | 'done';

/** The localStorage key that remembers the gesture, and the value it stores. */
export const PREVIEW_TOUCH_HINT_STORAGE_KEY = 'woc_preview_touch_hint_seen';
export const PREVIEW_TOUCH_HINT_SEEN = '1';

/** How long the exit plays before the node comes off, ms (shell.css pth-dock-out runs
 *  inside it). */
export const PREVIEW_TOUCH_HINT_LEAVE_MS = 360;

/** The phase a hint starts in, from what storage holds (null: nothing, or no storage). */
export function touchHintStartPhase(stored: string | null | undefined): TouchHintPhase {
  return stored === PREVIEW_TOUCH_HINT_SEEN ? 'done' : 'idle';
}

/** The stage's per-frame answer: whether it offers the hint now (a touch creator with its
 *  model drawn). An exit under way finishes where it is unless the stage goes, which takes
 *  it off at once. */
export function touchHintOnOffer(phase: TouchHintPhase, offered: boolean): TouchHintPhase {
  switch (phase) {
    case 'idle':
    case 'shown':
      return offered ? 'shown' : 'idle';
    case 'leaving':
      return offered ? 'leaving' : 'done';
    case 'done':
      return 'done';
  }
}

/** The player moved the model: a hint on screen plays its exit; one off screen is untouched. */
export function touchHintOnInteract(phase: TouchHintPhase): TouchHintPhase {
  return phase === 'shown' ? 'leaving' : phase;
}

/** The exit finished. */
export function touchHintOnLeft(phase: TouchHintPhase): TouchHintPhase {
  return phase === 'leaving' ? 'done' : phase;
}

/** Whether a gesture in this phase is the one the hint stores: the first while it is up. */
export function touchHintFirstGesture(phase: TouchHintPhase): boolean {
  return phase === 'shown';
}
