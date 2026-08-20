// Thin painter for the cross-hotbar overlay (#cross-hotbar). Every write routes
// through the injected PainterHostWriters, so a frame that changes nothing costs
// no DOM mutation.
//
// The sixteen cells are painted by the SHARED ActionBarPainter, not by a second
// copy of the icon/cooldown/usability rules: the overlay re-presents cells the
// desktop action bar has already ticked this frame. It builds a small adapter state
// whose entries are REFERENCES into that state's slot array (no per-frame copy, no
// allocation), so a cross-hotbar cell can never disagree with the action-bar button
// it mirrors.

import type { PainterHostWriters } from '../../painter_host';
import type { ActionBarPaintDescriptor } from '../action_bar/action_bar_painter';
import { ActionBarPainter } from '../action_bar/action_bar_painter';
import type { ActionBarState } from '../action_bar/action_bar_view';
import type { CrossHotbarOverlayState } from './cross_hotbar_view';

const DISPLAY_SHOWN = '';
const DISPLAY_HIDDEN = 'none';
const CLASS_EXPANDED = 'xhb-expanded';
// Marks the half a held trigger has armed. Both halves stay visible either way:
// the bar shows the whole set, and this only says which one a press will fire.
const CLASS_HALF_ARMED = 'xhb-armed';

/** The overlay's root, its two halves, and the sixteen cells in cell order. */
export interface CrossHotbarPaintDescriptor {
  root: HTMLElement;
  leftHalf: HTMLElement;
  rightHalf: HTMLElement;
  bar: ActionBarPaintDescriptor;
}

export class CrossHotbarPainter {
  private readonly barPainter: ActionBarPainter;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly descriptor: CrossHotbarPaintDescriptor,
    resolveBackgroundImage: (iconKey: string) => string,
  ) {
    this.barPainter = new ActionBarPainter(writers, descriptor.bar, resolveBackgroundImage);
  }

  /**
   * Paint one frame. `bar` is the overlay's OWN ticked state (the bar owns its
   * actions now, so it cannot read cells out of the desktop bar's array). A
   * hidden overlay stops after the display write, so a player with no pad pays
   * one elided write per frame.
   */
  paint(state: CrossHotbarOverlayState, bar: ActionBarState): void {
    this.writers.setDisplay(this.descriptor.root, state.visible ? DISPLAY_SHOWN : DISPLAY_HIDDEN);
    if (!state.visible) return;

    this.writers.toggleClass(this.descriptor.root, CLASS_EXPANDED, state.expanded);
    this.writers.toggleClass(
      this.descriptor.leftHalf,
      CLASS_HALF_ARMED,
      state.activeLayer === 'left',
    );
    this.writers.toggleClass(
      this.descriptor.rightHalf,
      CLASS_HALF_ARMED,
      state.activeLayer === 'right',
    );

    this.barPainter.paint(bar);
  }
}
