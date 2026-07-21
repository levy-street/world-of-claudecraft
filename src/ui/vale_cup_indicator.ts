// Thin DOM painter for the persistent Vale Cup indicator: a BUTTON (pinned by
// the stylesheet next to #arena-status) that opens the Vale Cup window. Driven
// from hud.update()'s mediumHud band off the pure VcupIndicatorView; the
// structural sig gates the innerHTML rebuild while the ~1Hz live clock rides an
// ELIDED setText slot so the tick never rebuilds the DOM (per-frame perf
// contract, src/ui/CLAUDE.md). Never tier-shed: queue position and the live
// score are information, not cosmetics.
//
// Colors live in the stylesheet; the nation flag colors are CSS custom
// properties derived from the VC_NATIONS data record (vale_cup_flag.ts, the
// documented data-driven exception).

import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { vcupFlagHtml } from './vale_cup_flag';
import type { VcupIndicatorView } from './vale_cup_indicator_view';
import { vcupNationName } from './vale_cup_window';

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

export interface ValeCupIndicatorDeps {
  /** The pre-existing <button id="vcup-indicator"> (index.html + play.html). */
  root(): HTMLElement;
  /** Open the Vale Cup window (Hud.toggleValeCup). */
  open(): void;
  writers: PainterHostWriters;
}

export class ValeCupIndicator {
  private readonly root: HTMLElement;
  private lastSig = '';
  private clockEl: HTMLElement | null = null;

  constructor(private readonly deps: ValeCupIndicatorDeps) {
    // Resolve the element ref ONCE (per-frame no-re-query rule) and wire the
    // click once; renders only swap the button's children.
    this.root = deps.root();
    this.root.addEventListener('click', () => this.deps.open());
  }

  /** Repaint from the pure view (mediumHud band). */
  update(view: VcupIndicatorView): void {
    const w = this.deps.writers;
    if (view.kind === 'hidden') {
      w.setDisplay(this.root, 'none');
      this.lastSig = view.sig;
      return;
    }
    w.setDisplay(this.root, 'flex');
    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      this.root.innerHTML = this.html(view);
      this.clockEl = this.root.querySelector('.vcupi-clock');
    }
    if (view.kind === 'live' && this.clockEl) {
      w.setText(
        this.clockEl,
        t('hudChrome.vcup.clock', {
          minutes: num(view.minutes),
          seconds: String(view.seconds).padStart(2, '0'),
        }),
      );
    }
  }

  /** Language switch: clear the structural sig so the next update rebuilds. */
  relocalize(): void {
    this.lastSig = '';
  }

  private html(view: Exclude<VcupIndicatorView, { kind: 'hidden' }>): string {
    if (view.kind === 'queued') {
      return `<span class="vcupi-text">${esc(
        t('hudChrome.vcup.indicatorQueued', {
          bracket: t('hudChrome.vcup.bracketLabel', { n: num(view.bracket) }),
          position: num(view.position),
          count: num(view.waiting),
        }),
      )}</span>`;
    }
    return (
      `<span class="vcupi-title">${esc(t('hudChrome.vcup.indicatorLive'))}</span>` +
      `${vcupFlagHtml(view.nationA)}` +
      `<span class="vcupi-score">${esc(num(view.scoreA))}<span class="vcupi-colon">:</span>${esc(num(view.scoreB))}</span>` +
      `${vcupFlagHtml(view.nationB, { away: view.awayPalette })}` +
      `<span class="vcupi-clock"></span>` +
      `<span class="visually-hidden">${esc(
        t('hudChrome.vcup.liveAria', {
          nationA: vcupNationName(view.nationA),
          nationB: vcupNationName(view.nationB),
          scoreA: num(view.scoreA),
          scoreB: num(view.scoreB),
        }),
      )}</span>`
    );
  }
}
