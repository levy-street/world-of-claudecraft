// Thin painter for the touch menu control's strip: the nine item buttons, the
// cancel X that sits on top of the anchor, and the single live caption.
//
// The seating is the one thing here that cannot be CSS: it depends on where the
// anchor actually is, edge-clamped by placeConsumableStrip. The local dim's BAND
// is measured for the same reason (stripDimSpan turns the open row into the strip
// it darkens); static layout (size, shape, colours, transitions) stays in
// hud.mobile.css per tier, and every write routes through the injected
// PainterHostWriters, matching the ring and the consumables row.
//
// It takes no layout read of its own: the caption is centred from the CACHED
// placement the gesture measured once, clamped by the pure core against a nominal
// half-width, so a caption never costs a forced reflow while the finger travels.

import type { PainterHostWriters } from '../../painter_host';
import { type StripPlacement, stripDimSpan } from '../action_bar/radial_action_core';
import { menuCaptionCenterX } from './menu_strip_core';

const CLASS_OPEN = 'open';
const CLASS_LIVE = 'live';
const CLASS_SHOWN = 'shown';
/** Marks the band whose anchor is at its RIGHT edge, which is where the dim's
 *  fade starts. Set from the placement, so the row and its dim cannot disagree. */
const CLASS_DIM_FLIP = 'dim-flip';
const LEFT_PROP = 'left';
const TOP_PROP = 'top';
const ORIGIN_X_PROP = '--strip-x';
const ORIGIN_Y_PROP = '--strip-y';
const DIM_X_PROP = '--strip-dim-x';
const DIM_EXTENT_PROP = '--strip-extent-px';

/** Everything the painter needs about an OPEN strip. Null means closed, which is
 *  the steady state and costs one elided class toggle. */
export interface MenuStripOpenState {
  placement: StripPlacement;
  /** Centre of the anchor: where the cancel target lands and what the local dim
   *  is anchored on. */
  anchorX: number;
  anchorY: number;
  /** The item the finger is over, or -1 for none. */
  live: number;
  /** Whether the cancel target is the live choice (the finger came back to the
   *  anchor's band with the row open). Never true in sticky mode, where the
   *  choice is made by focus rather than by travel. */
  cancelLive: boolean;
  /** The app-viewport width the row was clamped against, reused to clamp the
   *  caption without a second measure. */
  viewportWidth: number;
  /** The edge clearance the clamp keeps. */
  margin: number;
  /** Rendered size of one item, so the dim knows how far past the last item its
   *  fade has to reach. The gesture already measured it off the anchor. */
  itemSize: number;
  /** The live item's localized name, or '' when nothing is live. */
  caption: string;
}

export interface MenuStripPaintDescriptor {
  /** The overlay root: carries the open class and the dim's origin vars. */
  strip: HTMLElement;
  /** The row's item buttons, in row order (index 0 nearest the anchor). */
  items: readonly HTMLElement[];
  /** The X on top of the anchor that backs out without opening anything. */
  cancel: HTMLElement;
  /** The caption box (tooltip chrome), and the .tt-title inside it. */
  caption: HTMLElement;
  captionText: HTMLElement;
}

export class MenuStripPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly descriptor: MenuStripPaintDescriptor,
  ) {}

  paint(open: MenuStripOpenState | null): void {
    const { strip, items, cancel, caption, captionText } = this.descriptor;
    this.writers.toggleClass(strip, CLASS_OPEN, open !== null);
    if (!open) {
      this.writers.toggleClass(caption, CLASS_SHOWN, false);
      return;
    }

    this.writers.setStyleProp(strip, ORIGIN_X_PROP, `${open.anchorX}px`);
    this.writers.setStyleProp(strip, ORIGIN_Y_PROP, `${open.anchorY}px`);
    const dim = stripDimSpan({
      anchorX: open.anchorX,
      centers: open.placement.centers,
      count: items.length,
      itemSize: open.itemSize,
    });
    this.writers.setStyleProp(strip, DIM_X_PROP, `${dim.left}px`);
    this.writers.setStyleProp(strip, DIM_EXTENT_PROP, `${dim.width}px`);
    this.writers.toggleClass(strip, CLASS_DIM_FLIP, dim.anchorAtRight);
    this.writers.setStyleProp(cancel, LEFT_PROP, `${open.anchorX}px`);
    this.writers.setStyleProp(cancel, TOP_PROP, `${open.anchorY}px`);
    this.writers.toggleClass(cancel, CLASS_LIVE, open.cancelLive);

    for (let i = 0; i < items.length; i++) {
      const center = open.placement.centers[i];
      if (center === undefined) continue;
      this.writers.setStyleProp(items[i], LEFT_PROP, `${center}px`);
      this.writers.setStyleProp(items[i], TOP_PROP, `${open.anchorY}px`);
      this.writers.toggleClass(items[i], CLASS_LIVE, i === open.live);
    }

    const captionX = menuCaptionCenterX({
      centers: open.placement.centers,
      live: open.live,
      viewportWidth: open.viewportWidth,
      margin: open.margin,
    });
    this.writers.setText(captionText, open.caption);
    this.writers.toggleClass(caption, CLASS_SHOWN, captionX !== null && open.caption !== '');
    if (captionX === null) return;
    this.writers.setStyleProp(caption, LEFT_PROP, `${captionX}px`);
    this.writers.setStyleProp(caption, TOP_PROP, `${open.anchorY}px`);
  }
}
