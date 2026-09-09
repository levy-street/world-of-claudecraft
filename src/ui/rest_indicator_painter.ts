// The rest badge's DOM half: the portrait zZz marker's on/off class and BOTH of
// its text sinks. Sibling of rest_indicator.ts, which stays the DOM-free
// derivation; this file is the only place the view reaches an element.
//
// IT EXISTS BECAUSE THE TWO SINKS DRIFTED. #pf-rest carries `data-i18n-title`
// AND `data-i18n-aria`, both pointing at the bare "Resting" key, so the static
// shell pass stamps that over both on every language change. The live code
// corrected only the TITLE, which left a screen reader announcing "Resting" for
// the whole of a meal while the sighted tooltip read "Eating". Writing both from
// one resolved string is the fix, and putting them in one function is what stops
// the next reader correcting one of them again.
//
// Not a per-frame painter: the caller gates it on the resting flag changing, and
// the language fan-out clears that memo so a locale switch repaints once.
import { t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import type { RestView } from './rest_indicator';

export function paintRestIndicator(
  el: HTMLElement,
  view: RestView,
  writers: PainterHostWriters,
): void {
  writers.toggleClass(el, 'on', view.resting);
  // ONE resolved string into BOTH sinks. The title and the accessible name are
  // the same sentence; writing them from one value is what stops them drifting
  // again, and routing them through the facet keeps this painter raw-write-free.
  const label = view.labelKey ? t(view.labelKey) : '';
  writers.setAttr(el, 'title', label);
  writers.setAttr(el, 'aria-label', label);
}
