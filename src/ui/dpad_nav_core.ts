// Pure, DOM-free spatial navigation for the d-pad: given the boxes of the
// focusable controls in an open window and which one has focus, answer which one
// a d-pad press should move to.
//
// This replaces nudging a free-floating cursor with the d-pad. A cursor has to be
// steered pixel by pixel to reach a button; discrete focus moves land on the next
// control in that direction immediately, which is how console UIs actually read.
// The analog stick keeps the free cursor for anything the focus order cannot
// reach (dragging an item, clicking a spot on the map).

export type NavDirection = 'up' | 'down' | 'left' | 'right';

/** The box of one focusable control, in viewport pixels. */
export interface NavRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Cross-axis drift costs this much per pixel against a candidate. Above 1 so a
 *  control sitting squarely in the pressed direction always beats a nearer one
 *  that is mostly sideways: without it, "down" in a two-column form jumps to the
 *  other column rather than the next row. */
const CROSS_AXIS_PENALTY = 2;

/** A candidate must clear the current box by this much along the pressed axis to
 *  count as being in that direction, so controls that merely overlap (a label and
 *  its input on one row) never satisfy an up/down press. */
const MIN_AXIS_GAP = 1;

interface Center {
  x: number;
  y: number;
}

function centerOf(rect: NavRect): Center {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

/**
 * The index a d-pad press moves focus to, or the CURRENT index when nothing lies
 * that way (a press at the edge of a window holds rather than wrapping: wrapping
 * puts focus somewhere the player did not look).
 *
 * `current` outside the list means nothing is focused yet, which resolves to the
 * first control so the first press always lands somewhere.
 */
export function nextFocusIndex(
  rects: readonly NavRect[],
  current: number,
  dir: NavDirection,
): number {
  if (rects.length === 0) return -1;
  if (current < 0 || current >= rects.length) return 0;

  const from = centerOf(rects[current]);
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'up' || dir === 'left' ? -1 : 1;

  let best = current;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rects.length; i++) {
    if (i === current) continue;
    const to = centerOf(rects[i]);
    const along = horizontal ? (to.x - from.x) * sign : (to.y - from.y) * sign;
    if (along < MIN_AXIS_GAP) continue; // behind, or level with, the current box
    const cross = horizontal ? Math.abs(to.y - from.y) : Math.abs(to.x - from.x);
    const score = along + cross * CROSS_AXIS_PENALTY;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** The four d-pad directions, for a consumer mapping button indices to moves. */
export const NAV_DIRECTIONS: readonly NavDirection[] = ['up', 'down', 'left', 'right'];
