// Thin DOM consumer for the end-of-match scoreboard modal (#arena-end-window). Paints
// the VICTORY/DEFEAT banner, the per-player summation table, the local rating change,
// the honor earned, and the Leave button from the pure ArenaEndView (arena_end_view.ts).
// Owns no state; reports the Leave/close click through an injected callback. Cold path
// (built once when a match ends), so a plain innerHTML render, not a per-frame painter.
import type { PlayerClass } from '../sim/types';
import type { ArenaEndView } from './arena_end_view';
import { markDialogRoot } from './dialog_root';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

export interface ArenaEndWindowDeps {
  onClose(): void;
}

const num = (n: number) => formatNumber(Math.round(n), { maximumFractionDigits: 0 });
// Positive changes get a leading '+'; negatives already carry the locale minus sign.
const signed = (n: number) => (n > 0 ? `+${num(n)}` : num(n));

function resultKey(result: ArenaEndView['result']) {
  return result === 'win'
    ? 'hudChrome.arenaEnd.victory'
    : result === 'loss'
      ? 'hudChrome.arenaEnd.defeat'
      : 'hudChrome.arenaEnd.draw';
}

export function renderArenaEndWindow(
  el: HTMLElement,
  view: ArenaEndView,
  deps: ArenaEndWindowDeps,
): void {
  const header =
    `<th class="ae-name">${esc(t('hudChrome.arenaEnd.colName'))}</th>` +
    `<th>${esc(t('hudChrome.arenaEnd.colKills'))}</th>` +
    `<th>${esc(t('hudChrome.arenaEnd.colDamage'))}</th>` +
    `<th>${esc(t('hudChrome.arenaEnd.colHealing'))}</th>` +
    (view.ranked
      ? `<th>${esc(t('hudChrome.arenaEnd.colRating'))}</th><th>${esc(t('hudChrome.arenaEnd.colChange'))}</th>`
      : '');

  const rows = view.rows
    .map((r) => {
      const cls = classDisplayName(r.cls as PlayerClass);
      const rating = view.ranked
        ? `<td class="ae-rating">${num(r.ratingAfter)}</td>` +
          `<td class="ae-change ${r.ratingChange >= 0 ? 'up' : 'down'}">${signed(r.ratingChange)}</td>`
        : '';
      return (
        `<tr class="${r.ally ? 'ae-ally' : 'ae-enemy'}${r.me ? ' ae-me' : ''}">` +
        `<td class="ae-name"><span class="ae-pname">${esc(r.name)}</span> <span class="ae-cls">${esc(cls)}</span></td>` +
        `<td>${num(r.killingBlows)}</td>` +
        `<td>${num(r.damageDone)}</td>` +
        `<td>${num(r.healingDone)}</td>` +
        rating +
        '</tr>'
      );
    })
    .join('');

  const ratingLine = view.ranked
    ? `<div class="ae-rating-summary">${esc(
        t('hudChrome.arenaEnd.yourRating', {
          before: num(view.ratingBefore),
          after: num(view.ratingAfter),
        }),
      )}</div>`
    : '';
  const honorLine =
    view.honor > 0
      ? `<div class="ae-reward">${esc(t('hudChrome.arenaEnd.honorEarned', { honor: num(view.honor) }))}</div>`
      : '';

  el.innerHTML =
    `<div class="ae-banner ae-${view.result}"><span id="arena-end-title">${esc(t(resultKey(view.result)))}</span>` +
    `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.arenaEnd.close'))}">${svgIcon('close')}</button></div>` +
    `<table class="ae-board"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="ae-footer">${ratingLine}${honorLine}` +
    `<button type="button" class="btn ae-leave" data-close>${esc(t('hudChrome.arenaEnd.leave'))}</button></div>`;

  markDialogRoot(el, { labelledBy: 'arena-end-title' });
  el.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => deps.onClose());
  });
}
