// Painter for the $WOC reward-season HUD window. A PURE function: it turns the
// view model from woc_season.ts into the panel's inner HTML (the same
// innerHTML-string idiom the leaderboard/arena panels use), so it is unit-tested
// in plain Node without a DOM. hud.ts sets `el.innerHTML = wocSeasonPanelHtml(view)`
// and wires the [data-close] click.
import { t, formatNumber } from './i18n';
import type { SeasonView } from './woc_season';

// Local HTML escape — the panel interpolates the server-supplied season label, so
// it must be escaped (the ui/ rule: never innerHTML raw server text).
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function titleBar(): string {
  return `<div class="panel-title"><span>${t('hudChrome.wocSeason.title')} `
    + `<span class="ws-sub">${t('hudChrome.wocSeason.subtitle')}</span></span>`
    + `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.wocSeason.close'))}">✕</button></div>`;
}

/** The window's inner HTML for the given view (pure; safe for unit tests). */
export function wocSeasonPanelHtml(view: SeasonView): string {
  if (view.state === 'none') {
    return titleBar()
      + `<div class="ws-body ws-body-empty">`
      + `<div class="ws-empty">${t('hudChrome.wocSeason.none')}</div>`
      + `<div class="ws-empty-hint">${t('hudChrome.wocSeason.noneHint')}</div>`
      + `</div>`;
  }

  const statusKey = view.state === 'active' ? 'hudChrome.wocSeason.statusActive' : 'hudChrome.wocSeason.statusEnded';
  const statusCls = view.state === 'active' ? 'ws-status-active' : 'ws-status-ended';

  let timing: string;
  if (view.countdown) {
    const { days, hours, minutes } = view.countdown;
    timing = `<div class="ws-timing"><span class="ws-timing-label">${t('hudChrome.wocSeason.endsIn')}</span> `
      + `<span class="ws-timing-value">${t('hudChrome.wocSeason.endsInValue', { days, hours, minutes })}</span></div>`;
  } else if (view.state === 'ended') {
    timing = `<div class="ws-timing ws-timing-ended">${t('hudChrome.wocSeason.ended')}</div>`;
  } else {
    timing = `<div class="ws-timing ws-timing-open">${t('hudChrome.wocSeason.openEnded')}</div>`;
  }

  // emittedPct is already clamped 0..100 by the presenter; round for display + bar.
  const pct = Math.round(view.emittedPct * 10) / 10;

  return titleBar()
    + `<div class="ws-body">`
    + `<div class="ws-head"><span class="ws-name">${esc(view.label)}</span>`
    + `<span class="ws-status ${statusCls}">${t(statusKey)}</span></div>`
    + timing
    + `<div class="ws-pool">`
    + `<div class="ws-pool-label">${t('hudChrome.wocSeason.poolLabel')}</div>`
    + `<div class="ws-pool-amt">${esc(view.poolWoc)} <span class="ws-unit">${t('hudChrome.wocSeason.wocUnit')}</span></div>`
    + `</div>`
    + `<div class="ws-bar" role="img" aria-label="${esc(t('hudChrome.wocSeason.emittedLabel', { pct: formatNumber(pct) }))}">`
    + `<div class="ws-bar-fill" style="width:${pct}%"></div></div>`
    + `<div class="ws-bar-cap">${t('hudChrome.wocSeason.emittedLabel', { pct: formatNumber(pct) })}</div>`
    + `<div class="ws-totals">`
    + `<span class="ws-total"><span class="ws-total-k">${t('hudChrome.wocSeason.sinkLabel')}</span> <b>${esc(view.sinkWoc)}</b></span>`
    + `<span class="ws-total"><span class="ws-total-k">${t('hudChrome.wocSeason.emissionLabel')}</span> <b>${esc(view.emissionWoc)}</b></span>`
    + `</div>`
    + `<div class="ws-invariant">${t('hudChrome.wocSeason.invariant')}</div>`
    + `</div>`;
}
