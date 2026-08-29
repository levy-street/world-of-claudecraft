// Thin painter for the consumables seat and the row it opens: the ring's 5th arc
// seat (#mobile-consumable-seat, showing the first carried consumable) plus the
// leftward strip overlay (#mobile-consumable-strip) and the cancel target that
// sits on top of the seat.
//
// The per-item icon / cooldown / usability / aria math is IDENTICAL to the ring,
// the petals and the desktop bar (all of them consume the same ActionBarState
// from action_bar_view.ts), so this reuses ActionBarPainter for both the seat and
// the row instead of re-deriving any of it, and adds only what the strip has that
// a bar does not: the measured seating, the live-item highlight, and hiding the
// tail positions the player is not carrying.
//
// The seating is the one thing here that cannot be CSS: it depends on where the
// seat actually is, edge-clamped by placeConsumableStrip. The local dim's BAND is
// measured for the same reason (stripDimSpan turns the open row into the strip it
// darkens, so a two-potion row never dims as much screen as a six-potion one);
// static layout (size, shape, colours, transitions) stays in hud.mobile.css per
// tier, and every write routes through the injected PainterHostWriters, matching
// the ring painter.

import type { PainterHostWriters } from '../../painter_host';
import type { ActionBarSlotElements } from './action_bar_painter';
import { ActionBarPainter } from './action_bar_painter';
import type { ActionBarState } from './action_bar_view';
import { type StripPlacement, stripDimSpan } from './radial_action_core';

const CLASS_OPEN = 'open';
const CLASS_LIVE = 'live';
/** Marks the band whose anchor is at its RIGHT edge, which is where the dim's
 *  fade starts. Set from the placement, never from the left-handed body class,
 *  so the runtime direction and the dim can never disagree. */
const CLASS_DIM_FLIP = 'dim-flip';
const LEFT_PROP = 'left';
const TOP_PROP = 'top';
const ORIGIN_X_PROP = '--strip-x';
const ORIGIN_Y_PROP = '--strip-y';
const DIM_X_PROP = '--strip-dim-x';
const DIM_EXTENT_PROP = '--strip-extent-px';

/** Everything the painter needs about an OPEN row. Null means closed, which is
 *  the steady state and costs one elided class toggle. */
export interface ConsumableStripOpenState {
  placement: StripPlacement;
  /** Centre of the seat: where the cancel target lands and what the local dim is
   *  anchored on. */
  anchorX: number;
  anchorY: number;
  /** Carried consumables, so the tail positions stay hidden. */
  count: number;
  /** The item the finger is over, or -1 for none. */
  live: number;
  /** Whether the cancel target is the live choice (the finger came back to the
   *  seat's band with the row open). Never true in sticky mode, where the choice
   *  is made by focus rather than by travel. */
  cancelLive: boolean;
  /** Rendered size of one item, so the dim knows how far past the last item its
   *  fade has to reach. The gesture already measured it off the seat. */
  itemSize: number;
}

export interface ConsumableStripPaintDescriptor {
  /** The overlay root: carries the open class and the dim's origin vars. */
  strip: HTMLElement;
  /** The X on top of the seat that backs out without using anything. */
  cancel: HTMLElement;
  /** The ring's 5th seat, painted from state slot 0. */
  seat: ActionBarSlotElements;
  /** The row's items, painted from state slots 1..n. */
  items: readonly ActionBarSlotElements[];
}

export class ConsumableStripPainter {
  private readonly barPainter: ActionBarPainter;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly descriptor: ConsumableStripPaintDescriptor,
    resolveBackgroundImage: (iconKey: string) => string,
  ) {
    this.barPainter = new ActionBarPainter(
      writers,
      { container: descriptor.strip, slots: [descriptor.seat, ...descriptor.items] },
      resolveBackgroundImage,
    );
  }

  /** Paint the seat every frame and the row only while it is open. `state` holds
   *  the seat at slot 0 and the row items at slots 1..n, so one shared view feeds
   *  both and the seat can never disagree with the item it duplicates. */
  paint(state: ActionBarState, open: ConsumableStripOpenState | null): void {
    const { strip, cancel, items } = this.descriptor;
    this.barPainter.paint(state);
    this.writers.toggleClass(strip, CLASS_OPEN, open !== null);
    if (!open) return;

    this.writers.setStyleProp(strip, ORIGIN_X_PROP, `${open.anchorX}px`);
    this.writers.setStyleProp(strip, ORIGIN_Y_PROP, `${open.anchorY}px`);
    const dim = stripDimSpan({
      anchorX: open.anchorX,
      centers: open.placement.centers,
      count: open.count,
      itemSize: open.itemSize,
    });
    this.writers.setStyleProp(strip, DIM_X_PROP, `${dim.left}px`);
    this.writers.setStyleProp(strip, DIM_EXTENT_PROP, `${dim.width}px`);
    this.writers.toggleClass(strip, CLASS_DIM_FLIP, dim.anchorAtRight);
    this.writers.setStyleProp(cancel, LEFT_PROP, `${open.anchorX}px`);
    this.writers.setStyleProp(cancel, TOP_PROP, `${open.anchorY}px`);
    this.writers.toggleClass(cancel, CLASS_LIVE, open.cancelLive);

    for (let i = 0; i < items.length; i++) {
      const btn = items[i].btn;
      const carried = i < open.count;
      this.writers.setDisplay(btn, carried ? '' : 'none');
      if (!carried) continue;
      this.writers.setStyleProp(btn, LEFT_PROP, `${open.placement.centers[i]}px`);
      this.writers.setStyleProp(btn, TOP_PROP, `${open.anchorY}px`);
      this.writers.toggleClass(btn, CLASS_LIVE, i === open.live);
    }
  }
}
