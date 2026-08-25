// Thin painter for the mobile action ring (#mobile-action-ring): the 1 attack +
// 4 radial action touch buttons plus the page-cycle toggle. The per-button
// cooldown/usability/icon/aria math is IDENTICAL to the desktop action bar (both
// consume the same ActionBarState shape from action_bar_view.ts), so this module
// reuses ActionBarPainter directly for the 5 buttons instead of re-deriving any of
// that math, and adds only what the ring has that the desktop bar does not: the
// page indicator text and the toggle's aria-label.
//
// Every write routes through the injected PainterHostWriters (write-elided, no
// raw DOM), matching the desktop painter's contract exactly.

import type { InterpolationValues, TranslationKey } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import type { ActionBarPaintDescriptor } from './action_bar_painter';
import { ActionBarPainter } from './action_bar_painter';
import type { ActionBarState } from './action_bar_view';
import { MOBILE_ACTION_BUTTONS, mobileButtonHasSourceSlot } from './mobile_action_page_view';
import type { RadialPetalPainter, RadialPetalSource } from './radial_petal_painter';

const ARIA_LABEL_ATTR = 'aria-label';
const PAGE_INDICATOR_KEY: TranslationKey = 'hudChrome.mobile.actionPageIndicator';
const PAGE_TOGGLE_ARIA_KEY: TranslationKey = 'hudChrome.mobile.actionPageToggle';

/** The ring's paint descriptor: the 5-button descriptor ActionBarPainter already
 *  understands, plus the page toggle's own element and the current page/count
 *  (1-based for display, matching the "Page {page} of {count}" copy). */
export interface MobileActionRingPaintDescriptor {
  bar: ActionBarPaintDescriptor;
  pageToggle: HTMLElement;
  pageIndicator: HTMLElement;
}

/** The petal overlay the ring reveals under a held button. Painted from HERE
 *  rather than from Hud.update() so the per-frame entry point keeps exactly one
 *  ring call: the overlay is the ring's own second layer, not a new surface. */
export interface MobileActionRingPetals {
  painter: RadialPetalPainter;
  source: RadialPetalSource;
}

export class MobileActionRingPainter {
  private readonly barPainter: ActionBarPainter;
  private lastPage = -1;
  private lastPageCount = -1;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly descriptor: MobileActionRingPaintDescriptor,
    resolveBackgroundImage: (iconKey: string) => string,
    private readonly t: (key: TranslationKey, values?: InterpolationValues) => string,
    private readonly petals?: MobileActionRingPetals,
  ) {
    this.barPainter = new ActionBarPainter(writers, descriptor.bar, resolveBackgroundImage);
  }

  /** Paint the 5 ring buttons from the shared ActionBarState, plus the page
   *  indicator/toggle aria for the given 0-based page and page count. Both the
   *  indicator text rebuild and the toggle's aria write are elided by the
   *  page/count pair, matching the icon-key elision idiom (skip the string
   *  rebuild + write entirely on an unchanged page). The toggle's aria-label is
   *  the static "Switch action page" action name (its purpose never changes);
   *  the indicator span shows the dynamic "Page X of Y" text. */
  paint(
    state: ActionBarState,
    page: number,
    pageCount: number,
    totalSourceSlotsOrShowAttackButton: number | boolean | undefined = undefined,
    showAttackButton = true,
  ): void {
    const totalSourceSlots =
      typeof totalSourceSlotsOrShowAttackButton === 'number'
        ? totalSourceSlotsOrShowAttackButton
        : undefined;
    const attackButtonVisible =
      typeof totalSourceSlotsOrShowAttackButton === 'boolean'
        ? totalSourceSlotsOrShowAttackButton
        : showAttackButton;
    this.writers.setDisplay(this.descriptor.bar.slots[0].btn, attackButtonVisible ? '' : 'none');
    this.barPainter.paint(state);
    for (let buttonIndex = 0; buttonIndex < MOBILE_ACTION_BUTTONS; buttonIndex++) {
      this.writers.setDisplay(
        this.descriptor.bar.slots[buttonIndex + 1].btn,
        mobileButtonHasSourceSlot(page, buttonIndex, totalSourceSlots) ? '' : 'none',
      );
    }
    this.paintPetals();

    if (this.lastPage !== page || this.lastPageCount !== pageCount) {
      this.lastPage = page;
      this.lastPageCount = pageCount;
      this.writers.setText(
        this.descriptor.pageIndicator,
        this.t(PAGE_INDICATOR_KEY, { page: page + 1, count: pageCount }),
      );
      this.writers.setAttr(
        this.descriptor.pageToggle,
        ARIA_LABEL_ATTR,
        this.t(PAGE_TOGGLE_ARIA_KEY),
      );
    }
  }

  /** Re-localize after an in-game language switch (the Hud's woc:languagechange
   *  fan-out). Both writes at the end of paint() are keyed on the page/count
   *  pair, which is two integers, so a switch alone never moves them and the ring
   *  would keep the old locale's "Page X of Y" and toggle name. Dropping the
   *  latch makes the NEXT paint rewrite both, the same in-place shape the party
   *  rows use; there is nothing to repaint from here, since the page and count
   *  arrive per call rather than being retained. */
  relocalize(): void {
    this.lastPage = -1;
    this.lastPageCount = -1;
  }

  /** Paint or close the direction petals. Closed is the steady state, and the
   *  close routes through the same elided toggle, so an idle frame writes
   *  nothing at all; only a held button costs the petal work. PUBLIC because the
   *  gesture layer repaints through it on a sticky open, which has to seat the
   *  petals before focus moves onto one; every ordinary paint still arrives from
   *  paint() above. */
  paintPetals(): void {
    if (!this.petals) return;
    const placement = this.petals.source.placement();
    if (!this.petals.source.isOpen() || !placement) {
      this.petals.painter.hide();
      return;
    }
    this.petals.painter.paint(
      this.petals.source.tick(),
      placement,
      this.petals.source.liveDirection(),
      this.petals.source.cancelIsLive(),
    );
  }
}
