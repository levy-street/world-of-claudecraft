// The menu control's gesture layer: one instance of the shared StripGesture
// (../strip_gesture_controller.ts), which owns pointer capture, the reveal
// timer, the anchor measure, the window release backstop, sticky/tap mode, the
// aria-expanded state and the Escape closer. This module supplies only what is
// genuinely this menu's: the row grows RIGHT and flips only for the left-handed
// mirror that reseats the control against the opposite edge (nothing else may
// move it, because the muscle memory the roster order buys depends on that), the
// roster is a constant ten, and the control runs no action of its own, so a bare
// tap OPENS the row and the next press closes it again (anchorRole 'toggle',
// whose whole meaning lives in tap_menu_core.ts).
//
// It was a near-verbatim copy of the consumables row's gesture layer until the
// rule of three was reached: identical drag state, metric reads, fallbacks,
// pointer wiring and every sticky path, differing only in those parameters. The
// sibling CLAUDE.md's warning was the exact drift ("a new gesture menu asks
// those two; it does not grow a fourth dialect"), so the two now ask one.

import type { PainterHostWriters } from '../../painter_host';
import {
  StripGesture,
  type StripGestureOutcome,
  type StripPickSource,
  type StripReleaseInput,
} from '../strip_gesture_controller';
import {
  MENU_STRIP_COUNT,
  MENU_STRIP_PITCH_PX,
  resolveMenuStripDirection,
  resolveMenuStripRelease,
} from './menu_strip_core';
import type { MenuStripOpenState } from './menu_strip_painter';

export interface MenuStripGestureDeps {
  /** The menu control itself, which owns the press. */
  anchor: HTMLElement;
  /** The element whose computed style carries the row geometry per tier. */
  metricsHost: HTMLElement;
  /** The row's item buttons, in row order (index 0 nearest the anchor). */
  items: readonly HTMLElement[];
  /** The X that sits on top of the anchor and backs out without opening. */
  cancel: HTMLElement;
  /** The write-elision facet the anchor's aria-expanded state is written through. */
  writers: PainterHostWriters;
  /** Tap mode (settings.touchTapMenus), read live at press time. */
  tapMenus(): boolean;
  /** Whether the left-handed HUD mirror is on, read live at press time: it moves
   *  the anchor to the opposite edge, and the row has to grow the other way with
   *  it or the travel, the dim and the drawn items disagree. */
  leftHanded(): boolean;
  /** Open the item at `index`. `source` says whether the item's own button has
   *  already been activated by the pick, which decides how the owner routes it. */
  pick(index: number, source: StripPickSource): void;
  /** The player opened the row and chose nothing. */
  onCancel(): void;
  /** Repaint from openState(); called on every state change. */
  repaint(): void;
}

/** The menu strip's release rule in the shared outcome shape. The strip's own
 *  'pick' / 'open' / 'cancel' table is already that shape, so this is a type
 *  bridge rather than a second rule. */
function release(input: StripReleaseInput): StripGestureOutcome {
  return resolveMenuStripRelease(input);
}

export class MenuStripGesture {
  private readonly gesture: StripGesture;

  constructor(deps: MenuStripGestureDeps) {
    this.gesture = new StripGesture({
      anchor: deps.anchor,
      metricsHost: deps.metricsHost,
      items: deps.items,
      cancel: deps.cancel,
      writers: deps.writers,
      tapMenus: () => deps.tapMenus(),
      // Quick Actions has no action of its own to run, so its own press only
      // ever opens or closes the row.
      anchorRole: 'toggle',
      count: () => MENU_STRIP_COUNT,
      pitch: MENU_STRIP_PITCH_PX,
      // Per GESTURE, like the consumables row: the mirror can be toggled mid
      // session, and the whole open row (placement, travel, dim, caption) is
      // resolved from this one answer.
      direction: () => resolveMenuStripDirection({ leftHanded: deps.leftHanded() }),
      release,
      onPick: (index, source) => deps.pick(index, source),
      // No onDefault: resolveMenuStripRelease answers 'open' wherever another
      // control would answer 'default'.
      onCancel: () => deps.onCancel(),
      repaint: () => deps.repaint(),
    });
  }

  /** Bind the anchor and the row's own buttons. Called once, at build. */
  attach(): void {
    this.gesture.attach();
  }

  /** Open the row as a persistent, focusable menu. Assistive activation calls
   *  this, and so does a tap-mode press. */
  openSticky(): void {
    this.gesture.openSticky();
  }

  /** Close the sticky menu and hand focus back to the anchor it came from. */
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

  /** The item the finger is over, or -1 for none. */
  liveIndex(): number {
    return this.gesture.liveIndex();
  }

  /** What the painter needs to seat the row, minus the caption text the owner
   *  localizes, or null while it is closed. */
  openState(): Omit<MenuStripOpenState, 'caption'> | null {
    return this.gesture.openState();
  }

  /** Drop the gesture and close the row. Safe to call from any path. */
  cancelDrag(): void {
    this.gesture.cancelDrag();
  }
}
