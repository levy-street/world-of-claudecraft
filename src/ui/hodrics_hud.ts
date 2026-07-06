// Thin DOM painter for the in-race Gauntlet HUD: the countdown numeral, the
// live position strip (rank, section, own progress, time left), the ten-racer
// progress board, and the aftermath banner. Painted from hud.update()'s
// mediumHud band off the HcInfo snapshot (hodrics_hud_view.ts decides what
// shows), with a content-signature skip so an unchanged frame writes nothing.
// One-shot juice (knock cues, the finish fanfare) rides events in hud.ts.
//
// FAIRNESS: everything here is actionable race information (countdown,
// positions, progress), so none of it may ever be tier-shed or delayed by a
// graphics preset (root CLAUDE.md graphics-fairness invariant).

import type { HcInfo } from '../world_api';
import { esc } from './esc';
import { buildHcHudView, type HcHudView } from './hodrics_hud_view';
import { formatNumber, t } from './i18n';

export interface HodricsHudDeps {
  root(): HTMLElement;
}

// Course section id -> the typed catalog key (t() keys are a literal union,
// so the lookup is explicit rather than a template string).
const SECTION_KEYS = {
  start_yard: 'hudChrome.hc.section.start_yard',
  flail_bridge: 'hudChrome.hc.section.flail_bridge',
  log_court: 'hudChrome.hc.section.log_court',
  axe_walk: 'hudChrome.hc.section.axe_walk',
  drawspan: 'hudChrome.hc.section.drawspan',
  boulder_alley: 'hudChrome.hc.section.boulder_alley',
  red_ascent: 'hudChrome.hc.section.red_ascent',
  finish_keep: 'hudChrome.hc.section.finish_keep',
} as const;

export class HodricsHud {
  private lastSig = '';

  constructor(private readonly deps: HodricsHudDeps) {}

  /** Re-localize after a language switch (one forced rebuild). */
  relocalize(): void {
    this.lastSig = '';
  }

  render(info: HcInfo | null): void {
    const el = this.deps.root();
    const view = buildHcHudView(info);
    if (view.kind === 'hidden') {
      if (this.lastSig === 'hidden') return;
      this.lastSig = 'hidden';
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    if (view.sig === this.lastSig) return;
    this.lastSig = view.sig;
    el.style.display = 'block';
    el.innerHTML = this.html(view);
  }

  private html(view: Exclude<HcHudView, { kind: 'hidden' }>): string {
    if (view.kind === 'countdown') {
      return `<div class="hc-countdown">${esc(formatNumber(view.seconds, { maximumFractionDigits: 0 }))}</div>`;
    }
    if (view.kind === 'over') {
      const text = view.won
        ? t('hudChrome.hc.overWon')
        : t('hudChrome.hc.overPlaced', {
            place: formatNumber(view.place ?? 0, { maximumFractionDigits: 0 }),
          });
      return `<div class="hc-over">${esc(text)}</div>`;
    }
    const rank = view.finished
      ? t('hudChrome.hc.finishPlace', {
          place: formatNumber(view.place ?? 0, { maximumFractionDigits: 0 }),
        })
      : t('hudChrome.hc.rank', {
          rank: formatNumber(view.rank, { maximumFractionDigits: 0 }),
          total: formatNumber(view.fieldSize, { maximumFractionDigits: 0 }),
        });
    const sectionKey =
      SECTION_KEYS[view.section as keyof typeof SECTION_KEYS] ?? SECTION_KEYS.start_yard;
    const section = t(sectionKey);
    const clock = t('hudChrome.hc.timeLeft', {
      seconds: formatNumber(view.timeLeft, { maximumFractionDigits: 0 }),
    });
    const strip =
      `<div class="hc-strip">` +
      `<span class="hc-rank">${esc(rank)}</span>` +
      `<span class="hc-section">${esc(section)}</span>` +
      `<span class="hc-clock">${esc(clock)}</span>` +
      `</div>`;
    const rows = view.rows
      .map((r) => {
        const pct = Math.round(r.progress * 100);
        const cls = `hc-row${r.you ? ' you' : ''}${r.bot ? ' bot' : ''}${r.left ? ' left' : ''}`;
        const badge = r.finished
          ? `<span class="hc-place">${esc(formatNumber(r.place ?? 0, { maximumFractionDigits: 0 }))}</span>`
          : '';
        return (
          `<div class="${cls}">` +
          `<span class="hc-name">${esc(r.name)}</span>` +
          `<span class="hc-bar"><span class="hc-fill" style="width:${pct}%"></span></span>` +
          badge +
          `</div>`
        );
      })
      .join('');
    return `${strip}<div class="hc-board">${rows}</div>`;
  }
}
