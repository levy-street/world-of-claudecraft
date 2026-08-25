// Thin painter for the radial petal overlay (#mobile-action-radial): the four
// direction petals a held ring button reveals, plus the centre cancel target.
//
// The per-petal icon / cooldown / usability / aria math is IDENTICAL to the ring
// and the desktop bar (all three consume the same ActionBarState shape from
// action_bar_view.ts), so this module reuses ActionBarPainter for the petals
// instead of re-deriving any of it, and adds only what the radial has that a bar
// does not: the measured seating around the pressed button and the live-direction
// highlight.
//
// The seating is the one thing here that cannot be CSS: it depends on where the
// pressed button actually is, edge-clamped by placeRadial. Static layout (size,
// shape, scrim, transitions) stays in hud.mobile.css per tier. Every write routes
// through the injected PainterHostWriters, matching the ring painter's contract.

import type { PainterHostWriters } from '../../painter_host';
import type { ActionBarPaintDescriptor } from './action_bar_painter';
import { ActionBarPainter } from './action_bar_painter';
import type { ActionBarState } from './action_bar_view';
import {
  RADIAL_DIRECTIONS,
  type RadialDirection,
  type RadialPlacement,
} from './radial_action_core';

const CLASS_OPEN = 'open';
const CLASS_LIVE = 'live';
const LEFT_PROP = 'left';
const TOP_PROP = 'top';
const ORIGIN_X_PROP = '--radial-x';
const ORIGIN_Y_PROP = '--radial-y';

/** The petal directions, in the order the descriptor's slots are given. Index i
 *  here is descriptor slot i, and placeRadial returns its petals in the same
 *  RADIAL_DIRECTIONS order with the centre first, so the two line up by index. */
export const RADIAL_PETAL_DIRECTIONS: readonly RadialDirection[] = RADIAL_DIRECTIONS.slice(1);

/** What the ring painter reads to decide whether the petals are showing and
 *  what they hold. Implemented by the gesture layer plus the petal view, so the
 *  painter stays free of pointer state and of the view it paints from. */
export interface RadialPetalSource {
  isOpen(): boolean;
  placement(): RadialPlacement | null;
  liveDirection(): RadialDirection;
  /** Whether the centre cancel target is the live choice. Comes from the gesture
   *  layer's radialCancelIsLive so the rule has ONE author; re-deriving it here
   *  would give the painter a second, drifting copy. */
  cancelIsLive(): boolean;
  /** Tick the petal action-bar view for the currently held ring button. */
  tick(): ActionBarState;
}

export interface RadialPetalPaintDescriptor {
  /** The overlay root: carries the open class and the scrim's origin vars. */
  overlay: HTMLElement;
  /** The centre target that backs out of an opened radial without casting. */
  cancel: HTMLElement;
  /** The 4 petals, in RADIAL_PETAL_DIRECTIONS order. */
  bar: ActionBarPaintDescriptor;
}

export class RadialPetalPainter {
  private readonly barPainter: ActionBarPainter;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly descriptor: RadialPetalPaintDescriptor,
    resolveBackgroundImage: (iconKey: string) => string,
  ) {
    this.barPainter = new ActionBarPainter(writers, descriptor.bar, resolveBackgroundImage);
  }

  /** Show the petals seated around `placement`, painting each from the shared
   *  ActionBarState and marking `live` the one the drag currently points at.
   *  `cancelLive` arrives resolved from the gesture layer's shared rule. */
  paint(
    state: ActionBarState,
    placement: RadialPlacement,
    live: RadialDirection,
    cancelLive: boolean,
  ): void {
    const { overlay, cancel, bar } = this.descriptor;
    this.writers.toggleClass(overlay, CLASS_OPEN, true);
    this.writers.setStyleProp(overlay, ORIGIN_X_PROP, `${placement.originX}px`);
    this.writers.setStyleProp(overlay, ORIGIN_Y_PROP, `${placement.originY}px`);
    this.writers.setStyleProp(cancel, LEFT_PROP, `${placement.originX}px`);
    this.writers.setStyleProp(cancel, TOP_PROP, `${placement.originY}px`);
    this.writers.toggleClass(cancel, CLASS_LIVE, cancelLive);

    this.barPainter.paint(state);
    for (let i = 0; i < bar.slots.length; i++) {
      const petal = placement.petals[i + 1];
      const btn = bar.slots[i].btn;
      this.writers.setStyleProp(btn, LEFT_PROP, `${placement.originX + petal.dx}px`);
      this.writers.setStyleProp(btn, TOP_PROP, `${placement.originY + petal.dy}px`);
      this.writers.toggleClass(btn, CLASS_LIVE, petal.direction === live);
    }
  }

  /** Close the overlay. The seating stays as written: it is re-established on the
   *  next reveal, and rewriting it here would cost writes for a hidden layer. */
  hide(): void {
    this.writers.toggleClass(this.descriptor.overlay, CLASS_OPEN, false);
  }
}
