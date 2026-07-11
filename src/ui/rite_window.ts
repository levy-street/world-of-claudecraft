// Drowned Reliquary Rite difficulty popup (#delve-rite-panel). A thin DOM consumer
// shown when a player approaches the risen reliquary: a three-way Easy/Medium/Hard
// choice that sets how many times the shrine sequence is shown (3/2/1), its length,
// the tries allowed (3/2/1), and the loot ceiling. Mirrors the lockpick ante selector and
// reuses its `lp-ante-*` styling; renders all text through the delveRiteUi.* t() keys.
// hud.ts owns open/close, focus, and routing the choice to IWorld; this module only
// paints and reports the picked intensity through `deps`.
//
// Chrome comes from the shared window-frame builder (window_frame.ts): a titlebar
// whose display-font title is the ceremony moment (spec: sparse by design), a
// close control, and a scrollable body carrying the blurb, guide, and the ante
// grid. Sparse by design, so no footer (the ante choices are the actions). The
// popup had no dialog role before, so the frame owns the dialog; Hud's focus trap
// (root-scoped, focuses the first .lp-ante-btn) is unchanged. The frame mounts on
// an inner container and is reused across repaints.

import { RITE_INTENSITY, RITE_INTENSITY_ORDER } from '../sim/delves/rite_tuning';
import type { RiteIntensity } from '../sim/types';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { renderWindowFrame, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

export interface RiteWindowDeps {
  /** Player picked a difficulty (sends the server-authoritative choose command). */
  onChoose(intensity: RiteIntensity): void;
  /** Dismiss the popup without choosing. */
  onClose(): void;
}

const RITE_FRAME: WindowFrameDescriptor = {
  id: 'delve-rite-panel',
  titleKey: 'delveRiteUi.title',
  closeLabelKey: 'delveRiteUi.closeAria',
};

/** Stamp the shared window frame cold on an inner mount, then reuse it. */
function ensureFrame(el: HTMLElement, onClose: () => void): WindowFrameParts {
  const mounted = el.querySelector<HTMLElement>(':scope > .window-frame');
  const body = mounted?.querySelector<HTMLElement>('.window-body');
  if (mounted && body) {
    return { root: mounted, body, footer: null, tabButtons: [] };
  }
  const mount = document.createElement('div');
  const parts = renderWindowFrame(mount, RITE_FRAME, { onClose });
  el.replaceChildren(mount);
  return parts;
}

const NUM0 = { maximumFractionDigits: 0 } as const;

// Display data derived from the sim's own tuning table (rite_tuning.ts), so the
// popup's advertised numbers can never desync from what the rite actually does.
const OPTIONS: {
  intensity: RiteIntensity;
  playbacks: number;
  symbols: number;
  tries: number;
}[] = RITE_INTENSITY_ORDER.map((intensity) => {
  const cfg = RITE_INTENSITY[intensity];
  return { intensity, playbacks: cfg.playbacks, symbols: cfg.length, tries: cfg.tries };
});

export class RiteWindow {
  constructor(private readonly deps: RiteWindowDeps) {}

  private panel(): HTMLElement | null {
    return document.getElementById('delve-rite-panel');
  }

  render(): void {
    const el = this.panel();
    if (!el) return;
    const { body } = ensureFrame(el, () => this.deps.onClose());
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
    body.innerHTML =
      `<div class="lp-blurb">${esc(t('delveRiteUi.blurb'))}</div>` +
      `<ol class="lp-blurb rite-guide">` +
      `<li>${esc(t('delveRiteUi.guideWatch'))}</li>` +
      `<li>${esc(t('delveRiteUi.guideRepeat'))}</li>` +
      `<li>${esc(t('delveRiteUi.guideStakes'))}</li>` +
      `</ol>` +
      `<div class="lp-ante-row">${buttons}</div>`;
    body.querySelectorAll('[data-rite]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.deps.onChoose((btn as HTMLElement).dataset.rite as RiteIntensity);
      });
    });
  }
}
