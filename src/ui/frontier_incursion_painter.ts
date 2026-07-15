// Thin painter for the Frontier incursion bar. The pure visual derivation lives in
// frontier_incursion_view.ts; this turns that view into DOM, routing EVERY write
// through the host's elided writers and caching its element refs ONCE. It resolves the
// live rare's name here (tEntity) and hands it to the view; the view owns the already
// localized label, so this painter otherwise never calls t().

import type { FrontierIncursionView } from '../world_api';
import { tEntity } from './entity_i18n';
import { frontierIncursionBarView } from './frontier_incursion_view';
import type { PainterHostWriters } from './painter_host';

const FILL_FRACTION_DIGITS = 1;
const DANGER_CLASS = 'incursion-danger'; // a rare is up: distinct urgent styling

export class FrontierIncursionPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly bar: HTMLElement, // #frontier-incursion
    private readonly fill: HTMLElement, // #frontier-incursion .fill
    private readonly label: HTMLElement, // #frontier-incursion .label
  ) {}

  paint(state: FrontierIncursionView | null): void {
    const rareName =
      state && state.active && state.rareTemplateId
        ? tEntity({ kind: 'mob', id: state.rareTemplateId, field: 'name' })
        : '';
    const view = frontierIncursionBarView({ state, rareName });
    this.writers.setDisplay(this.bar, view.visible ? 'flex' : 'none');
    if (!view.visible) return;
    this.writers.setWidth(this.fill, `${(view.fillFrac * 100).toFixed(FILL_FRACTION_DIGITS)}%`);
    this.writers.setText(this.label, view.label);
    this.writers.toggleClass(this.bar, DANGER_CLASS, view.active);
  }
}
