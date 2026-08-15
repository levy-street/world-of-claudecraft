'use strict';

// Where the desktop window comes back. Pure geometry over the saved prefs
// (electron/desktop_prefs.cjs) and the live display list, so the decision is
// unit-tested in Node instead of only on a multi-monitor machine.
//
// The hazard this exists for is a window restored onto a display that is no
// longer there: unplug the external monitor a session ended on and naive
// "reapply the saved bounds" puts the window at coordinates nothing renders,
// where the player sees no window at all and has no title bar to drag it back
// with. So a restore is honored only when BOTH halves of the memory still hold:
// the display it was saved on still exists, AND enough of the window (including
// the strip a player can grab) lands inside some display's work area. Anything
// else falls back to the default size centered on the display nearest where the
// window used to be, which is the friendly answer for a changed monitor layout.
//
// Work areas, not full display bounds: a window centered on the full bounds sits
// partly under the taskbar/dock/panel.

// The floor the BrowserWindow itself enforces (minWidth/minHeight in
// electron/main.cjs). Restoring anything smaller would be silently corrected by
// Chromium, so clamp here and keep the two in agreement.
const MIN_WINDOW_WIDTH = 1024;
const MIN_WINDOW_HEIGHT = 720;
// A ceiling for a hand-edited or corrupt prefs file. Well past any real desktop
// (an 8K panel is 7680 wide) and far below the point where a bogus value would
// ask Chromium for an absurd surface.
const MAX_WINDOW_DIMENSION = 16384;
// Position bounds for the same reason: a signed 16-bit range covers every real
// multi-monitor arrangement, including displays laid out to the left of or above
// the primary one (negative coordinates).
const MIN_WINDOW_POSITION = -32768;
const MAX_WINDOW_POSITION = 32767;

// How much of the window must land inside a work area for the saved position to
// count as usable. The height is also the title strip: a window whose top edge
// is above the work area cannot be dragged back, so the top edge must be inside
// too (see boundsUsableOn).
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** A display entry we can actually reason about: an id plus a numeric work area. */
function usableDisplay(display) {
  const area = display?.workArea;
  if (!area) return null;
  if (!isFiniteNumber(area.x) || !isFiniteNumber(area.y)) return null;
  if (!isFiniteNumber(area.width) || !isFiniteNumber(area.height)) return null;
  if (area.width <= 0 || area.height <= 0) return null;
  if (display.id === undefined || display.id === null) return null;
  return display;
}

function usableDisplays(displays) {
  return (Array.isArray(displays) ? displays : []).filter((d) => usableDisplay(d) !== null);
}

/** Width and height of the overlap between a window rect and a work area. */
function overlap(bounds, workArea) {
  const width =
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
  const height =
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
    Math.max(bounds.y, workArea.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/**
 * True when a restored window at these bounds would be both visible and
 * reachable on this display: at least MIN_VISIBLE_WIDTH x MIN_VISIBLE_HEIGHT of
 * it inside the work area, and its top edge not above the work area (a window
 * whose title strip is off the top of the screen cannot be dragged back).
 */
function boundsUsableOn(bounds, workArea) {
  const visible = overlap(bounds, workArea);
  if (visible.width < MIN_VISIBLE_WIDTH || visible.height < MIN_VISIBLE_HEIGHT) return false;
  return bounds.y >= workArea.y;
}

/** Squared distance from a point to the nearest edge of a rect (0 when inside). */
function squaredDistanceToRect(point, rect) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

/** The display whose work area is nearest the point, or null with no displays. */
function nearestDisplay(displays, point) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const display of displays) {
    const distance = squaredDistanceToRect(point, display.workArea);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = display;
    }
  }
  return best;
}

/** Saved bounds we can measure: every field a finite number. */
function readableBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const { x, y, width, height } = bounds;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** The default window, centered on `display`, never smaller than the minimums. */
function centeredDefaults(display, defaults) {
  const wanted = {
    width: isFiniteNumber(defaults?.width) ? defaults.width : MIN_WINDOW_WIDTH,
    height: isFiniteNumber(defaults?.height) ? defaults.height : MIN_WINDOW_HEIGHT,
  };
  if (!display) {
    return {
      x: 0,
      y: 0,
      width: clamp(Math.round(wanted.width), MIN_WINDOW_WIDTH, MAX_WINDOW_DIMENSION),
      height: clamp(Math.round(wanted.height), MIN_WINDOW_HEIGHT, MAX_WINDOW_DIMENSION),
    };
  }
  const area = display.workArea;
  // Never wider or taller than the display it is centered on (a small panel
  // would otherwise get a window hanging off both edges), and never below the
  // minimums the window enforces anyway.
  const width = clamp(
    Math.round(Math.min(wanted.width, area.width)),
    MIN_WINDOW_WIDTH,
    MAX_WINDOW_DIMENSION,
  );
  const height = clamp(
    Math.round(Math.min(wanted.height, area.height)),
    MIN_WINDOW_HEIGHT,
    MAX_WINDOW_DIMENSION,
  );
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

/**
 * Resolve the geometry a new window should be constructed with.
 *
 * `saved` is the prefs record (windowBounds / displayId / maximized), `displays`
 * the live list ({ id, workArea } each), `primaryId` the id to fall back to when
 * nothing usable was saved, and `defaults` the size a first launch gets.
 *
 * Returns { x, y, width, height, maximized, restored }. `maximized` rides only a
 * successful restore: a remembered maximized state belongs to a monitor layout,
 * and reapplying it after that layout changed is how a window ends up filling
 * the wrong screen on first paint.
 */
function resolveWindowRestore(input = {}) {
  const displays = usableDisplays(input.displays);
  const saved = input.saved && typeof input.saved === 'object' ? input.saved : null;
  const bounds = readableBounds(saved?.windowBounds);
  const savedDisplay =
    saved?.displayId === undefined || saved?.displayId === null
      ? null
      : (displays.find((display) => display.id === saved.displayId) ?? null);

  if (bounds && savedDisplay && displays.some((d) => boundsUsableOn(bounds, d.workArea))) {
    return {
      x: Math.round(clamp(bounds.x, MIN_WINDOW_POSITION, MAX_WINDOW_POSITION)),
      y: Math.round(clamp(bounds.y, MIN_WINDOW_POSITION, MAX_WINDOW_POSITION)),
      width: Math.round(clamp(bounds.width, MIN_WINDOW_WIDTH, MAX_WINDOW_DIMENSION)),
      height: Math.round(clamp(bounds.height, MIN_WINDOW_HEIGHT, MAX_WINDOW_DIMENSION)),
      maximized: saved?.maximized === true,
      restored: true,
    };
  }

  // No usable memory: center the default window on the display nearest where it
  // used to be (the monitor the player last played on may be gone, but its
  // neighbor is the closest thing to "where you left it"), or on the primary
  // display when there is nothing to be near.
  const primary = displays.find((display) => display.id === input.primaryId) ?? displays[0] ?? null;
  const anchor = bounds
    ? (nearestDisplay(displays, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      }) ?? primary)
    : primary;
  return { ...centeredDefaults(anchor, input.defaults), maximized: false, restored: false };
}

module.exports = {
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MAX_WINDOW_DIMENSION,
  MIN_WINDOW_POSITION,
  MAX_WINDOW_POSITION,
  MIN_VISIBLE_WIDTH,
  MIN_VISIBLE_HEIGHT,
  boundsUsableOn,
  nearestDisplay,
  resolveWindowRestore,
};
