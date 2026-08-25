// The consumables seat's gesture layer: one instance of the shared StripGesture
// (../strip_gesture_controller.ts), which owns pointer capture, the reveal
// timer, the seat measure, the window release backstop, sticky/tap mode, the
// aria-expanded state and the Escape closer. This module supplies only what is
// genuinely this row's: the direction is RESOLVED per gesture (it grows LEFT off
// the ring's top arc, and flips only when the left-handed mirror seats the ring
// against the opposite edge), the count is however many consumables are carried
// right now, and a bare tap USES the first one, because the common case is "heal
// now" and making that require a swipe would be worse than the top-left bar it
// replaces.
//
// It was a near-verbatim copy of the menu control's gesture layer until the rule
// of three was reached; see that module's header for the split.

import type { PainterHostWriters } from '../../painter_host';
import {
  StripGesture,
  type StripGestureOpenState,
  type StripGestureOutcome,
  type StripMetrics,
  type StripReleaseInput,
} from '../strip_gesture_controller';
import {
  CONSUMABLE_STRIP_PITCH_PX,
  resolveConsumableStripDirection,
  resolveConsumableStripRelease,
} from './consumable_strip_core';
import type { StripDirection } from './radial_action_core';

export interface ConsumableStripGestureDeps {
  /** The ring's 5th seat, which owns the press. */
  seat: HTMLElement;
  /** The element whose computed style carries the row geometry per tier. */
  metricsHost: HTMLElement;
  /** The row's item buttons, in row order (index 0 nearest the seat). */
  items: readonly HTMLElement[];
  /** The X that sits on top of the seat and backs out without using anything. */
  cancel: HTMLElement;
  /** The write-elision facet the seat's aria-expanded state is written through. */
  writers: PainterHostWriters;
  /** Tap mode (settings.touchTapMenus), read live at press time. */
  tapMenus(): boolean;
  /** Carried consumables right now. */
  count(): number;
  /** Use the carried consumable at `index`. */
  use(index: number): void;
  /** The player opened the row and chose nothing. */
  onCancel(): void;
  /** Repaint from openState(); called on every state change. The seat also
   *  paints from Hud's frame, but a sticky open moves focus onto the first item
   *  in the same call, and an item still carrying display:none refuses it. */
  repaint?(): void;
}

/** The row's release rule in the shared outcome shape. A bare tap resolves to
 *  the FIRST consumable rather than to a default action, which is why the row's
 *  own table has no 'default' arm to bridge. */
function release(input: StripReleaseInput): StripGestureOutcome {
  const outcome = resolveConsumableStripRelease(input);
  return outcome.kind === 'use' ? { kind: 'pick', index: outcome.index } : { kind: 'cancel' };
}

function direction(metrics: StripMetrics): StripDirection {
  return resolveConsumableStripDirection(metrics);
}

export class ConsumableStripGesture {
  private readonly gesture: StripGesture;

  constructor(deps: ConsumableStripGestureDeps) {
    this.gesture = new StripGesture({
      anchor: deps.seat,
      metricsHost: deps.metricsHost,
      items: deps.items,
      cancel: deps.cancel,
      writers: deps.writers,
      tapMenus: () => deps.tapMenus(),
      count: () => deps.count(),
      pitch: CONSUMABLE_STRIP_PITCH_PX,
      direction,
      release,
      onPick: (index) => deps.use(index),
      // Tap mode's second press on the seat: the row's default IS its first
      // consumable, so the tap path and the release path quaff the same thing.
      onDefault: () => deps.use(0),
      onCancel: () => deps.onCancel(),
      repaint: () => deps.repaint?.(),
    });
  }

  /** Bind the seat and the row's own buttons. Called once, at build. */
  attach(): void {
    this.gesture.attach();
  }

  /** Open the row as a persistent, focusable menu. Assistive activation calls
   *  this, and so does a tap-mode press. */
  openSticky(): void {
    this.gesture.openSticky();
  }

  /** Close the sticky menu and hand focus back to the seat it came from. */
  closeSticky(): void {
    this.gesture.closeSticky();
  }

  /** Escape's way out, through Hud's single closeAll dispatcher. */
  closeIfOpen(): boolean {
    return this.gesture.closeIfOpen();
  }

  /** True while the row is showing, from either path. */
  isOpen(): boolean {
    return this.gesture.isOpen();
  }

  /** True from the moment a press arms, which is what the carried-item list is
   *  frozen on (see StripGesture.isArmed). */
  isArmed(): boolean {
    return this.gesture.isArmed();
  }

  /** What the painter needs to seat the row, or null while it is closed. The
   *  SHARED shape rather than the painter's narrower one: the caption clamps
   *  against the same viewport width and edge margin the row was placed with,
   *  and re-measuring them would cost a forced reflow per pointer move. */
  openState(): StripGestureOpenState | null {
    return this.gesture.openState();
  }

  /** Drop the gesture and close the row. Safe to call from any path. */
  cancelDrag(): void {
    this.gesture.cancelDrag();
  }
}
