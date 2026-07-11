// Thin painter for the mobile action ring (#mobile-action-ring): the paged 1
// attack + 5 action touch buttons plus the page-cycle toggle. The per-button
// cooldown/usability/icon/aria math is IDENTICAL to the desktop action bar (both
// consume the same ActionBarState shape from action_bar_view.ts), so this module
// reuses ActionBarPainter directly for the 6 buttons instead of re-deriving any of
// that math, and adds only what the ring has that the desktop bar does not: the
// page indicator text and the toggle's aria-label.
//
// Every write routes through the injected PainterHostWriters (write-elided, no
// raw DOM), matching the desktop painter's contract exactly.

import type { ActionBarPaintDescriptor } from './action_bar_painter';
import { ActionBarPainter } from './action_bar_painter';
import type { ActionBarState } from './action_bar_view';
import type { InterpolationValues, TranslationKey } from './i18n';
import type { PainterHostWriters } from './painter_host';

const ARIA_LABEL_ATTR = 'aria-label';
const PAGE_INDICATOR_KEY: TranslationKey = 'hudChrome.mobile.actionPageIndicator';
const PAGE_TOGGLE_ARIA_KEY: TranslationKey = 'hudChrome.mobile.actionPageToggle';

/** The ring's paint descriptor: the 6-button descriptor ActionBarPainter already
 *  understands, plus the page toggle's own element and the current page/count
 *  (1-based for display, matching the "Page {page} of {count}" copy). */
export interface MobileActionRingPaintDescriptor {
  bar: ActionBarPaintDescriptor;
  pageToggle: HTMLElement;
  pageIndicator: HTMLElement;
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
  ) {
    this.barPainter = new ActionBarPainter(writers, descriptor.bar, resolveBackgroundImage);
  }

  /** Paint the 6 ring buttons from the shared ActionBarState, plus the page
   *  indicator/toggle aria for the given 0-based page and page count. Both the
   *  indicator text rebuild and the toggle's aria write are elided by the
   *  page/count pair, matching the icon-key elision idiom (skip the string
   *  rebuild + write entirely on an unchanged page). The toggle's aria-label is
   *  the static "Switch action page" action name (its purpose never changes);
   *  the indicator span shows the dynamic "Page X of Y" text. */
  paint(state: ActionBarState, page: number, pageCount: number): void {
    this.barPainter.paint(state);

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
}
