// The daily-rewards spin overlay's ELEMENT: the half of the extraction that
// reaches a host (Bank Storage phase 17).
//
// NAMED `_controller` DELIBERATELY, and the reason is a gate rather than a style.
// tests/hud_perf_budget.test.ts discovers its corpus by FILENAME SUFFIX
// (_painter|_window|_controller), so while this code lived in
// src/ui/daily_rewards_window.ts it was held to that file's cold contract: no
// forced-reflow layout read, and no repeating driver outside a counted
// allowance. A name outside that regex would have taken the contract off code
// that did not change, which is the definition of an extraction leaving a guard
// covering less.
//
// `_controller` and not `_painter`, which is a stricter bucket than this module
// wants: a `*_painter.ts` must be a facet-routed per-frame painter or a
// documented canvas one, and `_painter`/`_view`/`_core` are swept out of the
// module CLASSIFICATION sweep by name, which would drop the UI_DOM_MODULES row
// that pins the host state this file owns. A controller keeps both: the cold
// contract and the classification. src/ui/hud/CLAUDE.md lists controllers,
// windows and painters as the three DOM adapters and says a controller holds the
// same cold contract a window does.
//
// A thin CONTROLLER over src/ui/daily_rewards_spin_view.ts, which owns the markup
// and the landing geometry. Deliberately not the word "painter" here: the
// eighteen lines above reject that bucket by name, and a reader following the
// word back to src/ui/hud/CLAUDE.md would land on the stricter contract this
// module does not hold. This owns one thing the pure core cannot: the live
// element, its two dismiss listeners, and the at-most-one rule that keeps a
// second spin from stacking a second modal over the first. Registered in
// UI_DOM_MODULES (tests/architecture.test.ts) because it names `document`.
//
// The overlay mounts on document.body rather than inside the window, which is
// how it shipped and is why it is not the window's own inert-root prompt
// recipe: it is a full-screen celebration, not a decision the player has to
// make, and it dismisses on Escape, on a backdrop press, and on its own close
// button.

import { spinOverlayHtml } from './daily_rewards_spin_view';

export class SpinOverlay {
  private el: HTMLElement | null = null;

  /** Show the wheel landing on `points`. Closes any overlay already up first, so
   *  a second spin replaces rather than stacks. */
  open(points: number): void {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'dr-spin-overlay open';
    overlay.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') this.close();
    });
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.close();
    });
    overlay.innerHTML = spinOverlayHtml(points);
    overlay.querySelector('[data-spin-close]')?.addEventListener('click', () => this.close());
    document.body.appendChild(overlay);
    this.el = overlay;
    (overlay.querySelector('[data-spin-close]') as HTMLElement | null)?.focus();
  }

  /** Take it down. Safe to call when nothing is up, which is what lets the
   *  window's close() run it unconditionally. */
  close(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
  }
}
