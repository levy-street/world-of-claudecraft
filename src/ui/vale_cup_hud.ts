// Thin DOM painter for the in-match Vale Cup HUD strip (the Fiesta HUD is the
// composition template: snapshot-driven per mediumHud tick from the pure
// VcupHudView, self-mounting root, sig-diffed skeleton). The skeleton (flags +
// nation names + separators) rebuilds only when the STRUCTURAL sig changes
// (new match / new nations); the score, count-down clock, and phase line ride
// ELIDED setText slots so the per-second tick never rebuilds DOM (per-frame
// perf contract, src/ui/CLAUDE.md).
//
// Colors live in the stylesheet; the nation flag colors are CSS custom
// properties derived from the VC_NATIONS data record (vale_cup_flag.ts, the
// documented data-driven exception).

import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { vcupFlagHtml } from './vale_cup_flag';
import type { VcupHudView } from './vale_cup_hud_view';
import { vcupNationName } from './vale_cup_window';

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

export interface ValeCupHudDeps {
  /** The HUD layer the strip mounts into (the #ui element). */
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
}

export class ValeCupHud {
  private root: HTMLElement | null = null;
  private lastSig = '';
  private scoreAEl: HTMLElement | null = null;
  private scoreBEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private phaseEl: HTMLElement | null = null;

  constructor(private readonly deps: ValeCupHudDeps) {}

  /** Repaint from the pure view (mediumHud band). */
  update(view: VcupHudView): void {
    const w = this.deps.writers;
    if (!view.active) {
      if (this.root) w.setDisplay(this.root, 'none');
      this.lastSig = view.sig;
      return;
    }
    const root = this.ensureRoot();
    if (!root) return;
    w.setDisplay(root, 'flex');
    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      root.innerHTML = this.skeleton(view);
      this.scoreAEl = root.querySelector('.vcuph-score.a');
      this.scoreBEl = root.querySelector('.vcuph-score.b');
      this.clockEl = root.querySelector('.vcuph-clock');
      this.phaseEl = root.querySelector('.vcuph-phase');
    }
    if (this.scoreAEl) w.setText(this.scoreAEl, num(view.scoreA));
    if (this.scoreBEl) w.setText(this.scoreBEl, num(view.scoreB));
    if (this.clockEl) {
      w.setText(
        this.clockEl,
        t('hudChrome.vcup.clock', {
          minutes: num(view.minutes),
          seconds: String(view.seconds).padStart(2, '0'),
        }),
      );
    }
    if (this.phaseEl) {
      const phase = this.phaseText(view);
      w.setText(this.phaseEl, phase);
      w.setDisplay(this.phaseEl, phase ? 'block' : 'none');
    }
  }

  /** Language switch: clear the structural sig so the next update rebuilds. */
  relocalize(): void {
    this.lastSig = '';
  }

  private phaseText(view: VcupHudView): string {
    switch (view.phase) {
      case 'countdown':
        return t('hudChrome.vcup.phaseCountdown', { seconds: num(view.countdown) });
      case 'goal':
        return t('hudChrome.vcup.phaseGoal');
      case 'golden':
        return t('hudChrome.vcup.phaseGolden');
      case 'over':
        return t('hudChrome.vcup.phaseOver');
      default:
        return view.golden ? t('hudChrome.vcup.phaseGolden') : '';
    }
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'vcup-match-hud';
    // A live-score region players glance at, not an announcement stream: the
    // per-second clock must never spam a screen reader (politeness contract).
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'off');
    layer.appendChild(el);
    this.root = el;
    return el;
  }

  private skeleton(view: VcupHudView): string {
    const nameA = vcupNationName(view.nationA);
    const nameB = vcupNationName(view.nationB);
    const mineA = view.myTeam === 'A' ? ' mine' : '';
    const mineB = view.myTeam === 'B' ? ' mine' : '';
    return (
      `<div class="vcuph-row">` +
      `<span class="vcuph-side a${mineA}">${vcupFlagHtml(view.nationA, { cls: 'lg' })}<span class="vcuph-name">${esc(nameA)}</span></span>` +
      `<span class="vcuph-core"><span class="vcuph-score a"></span><span class="vcuph-colon">:</span><span class="vcuph-score b"></span></span>` +
      `<span class="vcuph-side b${mineB}"><span class="vcuph-name">${esc(nameB)}</span>${vcupFlagHtml(view.nationB, { away: view.awayPalette, cls: 'lg' })}</span>` +
      `</div>` +
      `<div class="vcuph-under"><span class="vcuph-clock"></span><span class="vcuph-phase"></span></div>`
    );
  }
}
