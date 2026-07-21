// Thin painter for the swing-timer (auto-attack) bar. The pure fill / ready /
// label rules live in swing_timer.ts; this turns that state into DOM, routing
// EVERY write through the host's elided writers and caching the
// #swingbar element plus its .fill / .label children ONCE (they were re-queried
// via $()/querySelector every frame, the leak this painter fixes). It resolves the
// i18n-free core's label discriminator through t() (like the cast-bar renderer),
// so the core stays string-table-free.

import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import type { SwingTimerState } from './swing_timer';

// The swing seconds label shows one fraction digit (e.g. "1.4s"), byte-identical
// to the former inline formatNumber call.
const SWING_SECONDS_FRACTION_DIGITS = 1;
// Fill width percent precision (e.g. "62.5%").
const FILL_PERCENT_FRACTION_DIGITS = 1;

export class SwingTimerPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly bar: HTMLElement, // #swingbar
    private readonly fill: HTMLElement, // #swingbar .fill
    private readonly label: HTMLElement, // #swingbar .label
  ) {}

  paint(state: SwingTimerState): void {
    if (!state.visible) {
      this.writers.setDisplay(this.bar, 'none');
      return;
    }
    this.writers.setDisplay(this.bar, 'block');
    this.writers.setWidth(
      this.fill,
      `${(state.frac * 100).toFixed(FILL_PERCENT_FRACTION_DIGITS)}%`,
    );
    this.writers.toggleClass(this.bar, 'ready', state.ready);
    this.writers.setText(this.label, this.resolveLabel(state));
  }

  // Localize the core's discriminator: 'ready' -> the swing-up label, 'seconds' ->
  // the formatted seconds-remaining label. No concat / no `?? 'English'` fallback
  // (both keys already exist in hudChrome.swing).
  private resolveLabel(state: SwingTimerState): string {
    if (state.labelKind === 'ready') return t('hudChrome.swing.ready');
    return t('hudChrome.swing.seconds', {
      seconds: formatNumber(state.seconds, {
        minimumFractionDigits: SWING_SECONDS_FRACTION_DIGITS,
        maximumFractionDigits: SWING_SECONDS_FRACTION_DIGITS,
      }),
    });
  }
}
