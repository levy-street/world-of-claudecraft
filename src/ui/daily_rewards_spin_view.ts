// The daily-rewards spin wheel's markup and its landing geometry.
//
// Extracted from src/ui/daily_rewards_window.ts by Bank Storage phase 17, which
// is the extraction that file's own ratchet row named, taken for what it buys:
// the window sits at an exact zero-slack ceiling and the store's error-body
// focus fix needs lines there.
//
// The PURE half only. The overlay ELEMENT's lifetime (create, listen, mount,
// focus, remove) lives in src/ui/daily_rewards_spin_controller.ts, which is the
// pure-core-plus-thin-painter split this file's two neighbours
// (charter_card_view.ts, armory_card_view.ts) already use, and it is what keeps
// the wheel's geometry and its copy inside the determinism scan.

import type { DailyRewardsView } from './daily_rewards_view';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

/** The wheel's segments, in the order they are drawn. The landing angle below is
 *  derived from this array's INDEX, so the two cannot be changed apart. */
export const SPIN_WHEEL_VALUES: readonly number[] = [20, 30, 40, 50, 75, 100, 150, 250];

/** Where the wheel must stop for a given award: the negative centre angle of the
 *  segment holding it. An award that is not on the wheel lands on the first
 *  segment rather than spinning past the end (indexOf answers -1, and the clamp
 *  is what turns that into segment 0). */
export function spinLandingAngle(points: number): number {
  const index = Math.max(0, SPIN_WHEEL_VALUES.indexOf(points));
  const segment = 360 / SPIN_WHEEL_VALUES.length;
  const center = index * segment + segment / 2;
  return -center;
}

/** The rewards tab's spin section: the small wheel, the state line and the
 *  button. Disabled while the reward is locked or already claimed. */
export function spinSectionHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
  const spin = view.status.spin;
  const text = spin.claimed
    ? t('hudChrome.dailyRewards.spinClaimed', {
        points: formatNumber(spin.points ?? 0, { maximumFractionDigits: 0 }),
      })
    : t('hudChrome.dailyRewards.spinReady');
  return (
    `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.spinTitle'))}</h3>` +
    `<div class="dr-spin"><div class="dr-wheel">${esc(spin.claimed ? `+${formatNumber(spin.points ?? 0, { maximumFractionDigits: 0 })}` : '?')}</div>` +
    `<div><p>${esc(text)}</p><button type="button" class="lb-page-btn" data-spin ${view.locked || spin.claimed ? 'disabled' : ''}>${esc(t('hudChrome.dailyRewards.spinButton'))}</button></div></div></section>`
  );
}

/** The full-screen spin overlay's markup: the labelled modal stage, the close
 *  button, the pointer, the big wheel pre-aimed at its landing angle, and the
 *  result burst. The painter owns the element and the listeners; this owns every
 *  string and the angle. */
export function spinOverlayHtml(points: number): string {
  const labels = SPIN_WHEEL_VALUES.map(
    (value, index) =>
      `<span style="--i:${index}">+${formatNumber(value, { maximumFractionDigits: 0 })}</span>`,
  ).join('');
  return (
    `<div class="dr-spin-stage" role="dialog" aria-modal="true" aria-label="${esc(t('hudChrome.dailyRewards.spinDialogTitle'))}">` +
    `<button type="button" class="x-btn dr-spin-close" data-spin-close aria-label="${esc(t('hudChrome.dailyRewards.spinClose'))}">${svgIcon('close')}</button>` +
    `<div class="dr-spin-pointer" aria-hidden="true"></div>` +
    `<div class="dr-spin-wheel-big" style="--land-angle:${spinLandingAngle(points)}deg" aria-hidden="true">${labels}</div>` +
    `<div class="dr-spin-result" style="--tier-color:#ffe27a">` +
    `<span>${esc(t('hudChrome.dailyRewards.spinResult', { points: formatNumber(points, { maximumFractionDigits: 0 }) }))}</span>` +
    `<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>` +
    `<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>` +
    `</div></div>`
  );
}
