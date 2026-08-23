// The live caption a strip menu shows for the item under the finger: ONE box
// naming the one thing being chosen, never a permanent label per item (labels
// at the strips' pitch collide and clip, and they name items the player is not
// choosing).
//
// It sits beside strip_gesture_controller.ts because both strip menus need it:
// the Quick Actions row names the destination, and the consumables row names
// the item, which is the identification the retired quick bar had and the seat
// lost. The box reuses the game's own tooltip chrome (.panel for the box,
// .tt-title for the text) and the clamp is the shared pure rule
// (stripCaptionCenterX in action_bar/radial_action_core.ts), so neither the
// look nor the geometry is authored twice.
//
// It takes no layout read: the centre comes from the placement the gesture
// measured once at pointerdown, clamped against a nominal half-width, so a
// caption never costs a forced reflow while the finger travels.

import type { PainterHostWriters } from '../painter_host';

const CLASS_SHOWN = 'shown';
const LEFT_PROP = 'left';
const TOP_PROP = 'top';

export interface StripCaptionElements {
  /** The caption box (tooltip chrome). */
  box: HTMLElement;
  /** The .tt-title inside it. */
  text: HTMLElement;
}

export class StripCaptionPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly els: StripCaptionElements,
  ) {}

  /**
   * Show `caption` centred on `centerX` (the clamped centre; null hides the
   * box, which is also what an empty caption does), lifted off `anchorY` by the
   * stylesheet. Closed rows call it with a null centre, which costs one elided
   * class toggle.
   */
  paint(caption: string, centerX: number | null, anchorY: number): void {
    const { box, text } = this.els;
    this.writers.setText(text, caption);
    this.writers.toggleClass(box, CLASS_SHOWN, centerX !== null && caption !== '');
    if (centerX === null) return;
    this.writers.setStyleProp(box, LEFT_PROP, `${centerX}px`);
    this.writers.setStyleProp(box, TOP_PROP, `${anchorY}px`);
  }
}
