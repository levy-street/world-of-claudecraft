// Drowned Reliquary Rite difficulty popup (#delve-rite-panel). A thin DOM consumer
// shown when a player approaches the risen reliquary: a three-way Easy/Medium/Hard
// choice that sets how many times the shrine sequence is shown (3/2/1), its length,
// the tries allowed (3/2/1), and the loot ceiling. Mirrors the lockpick ante selector and
// reuses its `lp-ante-*` styling; renders all text through the delveRiteUi.* t() keys.
// hud.ts owns open/close, focus, and routing the choice to IWorld; this module only
// paints and reports the picked intensity through `deps`.

import type { RiteIntensity } from '../sim/types';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { svgIcon } from './ui_icons';

export interface RiteWindowDeps {
  /** Player picked a difficulty (sends the server-authoritative choose command). */
  onChoose(intensity: RiteIntensity): void;
  /** Dismiss the popup without choosing. */
  onClose(): void;
}

const NUM0 = { maximumFractionDigits: 0 } as const;

// Display copy for each difficulty, in the same Easy -> Hard order the sim uses.
const OPTIONS: {
  intensity: RiteIntensity;
  playbacks: number;
  symbols: number;
  tries: number;
}[] = [
  { intensity: 'easy', playbacks: 3, symbols: 4, tries: 3 },
  { intensity: 'medium', playbacks: 2, symbols: 5, tries: 2 },
  { intensity: 'hard', playbacks: 1, symbols: 6, tries: 1 },
];

export class RiteWindow {
  constructor(private readonly deps: RiteWindowDeps) {}

  private panel(): HTMLElement | null {
    return document.getElementById('delve-rite-panel');
  }

  render(): void {
    const el = this.panel();
    if (!el) return;
    const buttons = OPTIONS.map((o) => {
      const shows =
        o.playbacks === 1
          ? t('delveRiteUi.showsOnce')
          : t('delveRiteUi.showsTimes', { count: formatNumber(o.playbacks, NUM0) });
      return (
        `<button type="button" class="lp-ante-btn" data-rite="${o.intensity}">` +
        `<span class="lp-ante-tier">${esc(t(`delveRiteUi.${o.intensity}` as TranslationKey))}</span>` +
        `<span class="lp-ante-badges">` +
        `<span class="lp-ante-pages">${esc(t('delveRiteUi.symbols', { count: formatNumber(o.symbols, NUM0) }))}</span>` +
        `<span class="lp-ante-tries">${esc(t('delveRiteUi.tries', { count: formatNumber(o.tries, NUM0) }))}</span>` +
        `</span>` +
        `<span class="lp-ante-timer">${esc(shows)}</span>` +
        `<span class="lp-ante-timer">${esc(t(`delveRiteUi.reward.${o.intensity}` as TranslationKey))}</span>` +
        `</button>`
      );
    }).join('');
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('delveRiteUi.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('delveRiteUi.closeAria'))}">${svgIcon('close')}</button></div>` +
      `<div class="lp-blurb">${esc(t('delveRiteUi.blurb'))}</div>` +
      `<div class="lp-ante-row">${buttons}</div>`;
    el.querySelectorAll('[data-rite]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.deps.onChoose((btn as HTMLElement).dataset.rite as RiteIntensity);
      });
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.deps.onClose());
  }
}
