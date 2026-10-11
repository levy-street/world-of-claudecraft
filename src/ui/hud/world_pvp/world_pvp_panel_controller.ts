// Thin DOM painter for the World PvP tab of the merged PvP window: renders the
// pure view (world_pvp_window_view.ts) as localized markup and wires the one
// action (raise, with its confirm step; lower; keep up) back through IWorld.
// Owns no state: the confirm step lives on the window (arena_window.ts) beside
// the active tab, and every string is a t() key from hudChrome.worldPvp with
// the stakes numbers resolved from the sim rules. The class families are the
// window's existing ones (arena-layout, ui-card, pvp-queue, bg-note), so the
// tab reads as a sibling of the Thornhollow Fields panel, not a new dialect.

import { audio } from '../../../game/audio';
import type { IWorld } from '../../../world_api';
import { clockSeconds } from '../../clock_seconds_core';
import { durationText } from '../../duration_text';
import { esc } from '../../esc';
import { focusKeyAttr } from '../../focus_restore';
import { formatMoney, formatNumber, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import type { WorldPvpWindowView } from './world_pvp_window_view';

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

/** A whole percent as the locale's percent (10 -> "10%"). */
const pct = (whole: number): string =>
  formatNumber(whole / 100, { style: 'percent', maximumFractionDigits: 0 });

/** The disarm countdown as m:ss, every digit from the formatters (the
 *  clock_seconds_core precedent): minutes bare, seconds zero-padded. */
export function disarmClockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${num(Math.floor(whole / 60))}:${clockSeconds(whole % 60, true)}`;
}

/** Focus keys, so a rebuild (once a second while disarming, and the flip into
 *  and out of the confirm step) hands keyboard focus back to a button instead
 *  of dropping it on the body. The action key rides the one-press controls AND
 *  the confirm step's Cancel: a press on Enable rebuilds the panel into the
 *  confirm step, and focus must land on the safe button there, never on Raise
 *  Flag, or a second Enter would raise the flag before the confirm text was
 *  read. Raise Flag carries its own key. */
export const WORLD_PVP_ACTION_FOCUS_KEY = 'wpvp-action';
export const WORLD_PVP_CONFIRM_FOCUS_KEY = 'wpvp-confirm';

/** A button that must stay in the tab order (a keyboard or screen-reader user
 *  finds the reason under it) but never act: aria-disabled, never the native
 *  attribute, which would drop it out of the focus order; wireWorldPvpPanel
 *  refuses its clicks. The look is the shared ui-btn--dis class, deliberately
 *  NOT a global aria-disabled rule: the Harvest button carries aria-disabled
 *  during its background polls while keeping its admitted appearance. */
const INERT_ATTR = ' aria-disabled="true"';
const INERT_CLASS = ' ui-btn--dis';

/** The panel body under the title and tab strip. */
export function worldPvpBodyHtml(view: WorldPvpWindowView): string {
  if (view.kind === 'pending') {
    return `<div class="bg-note">${esc(t('hudChrome.worldPvp.pending'))}</div>`;
  }
  const blurb = `<div class="bg-blurb">${esc(t('hudChrome.worldPvp.blurb'))}</div>`;
  const statusClass = view.flagged
    ? view.disarmRemaining === null
      ? 'is-on'
      : 'is-disarming'
    : 'is-off';
  const statusText = view.flagged
    ? view.disarmRemaining === null
      ? t('hudChrome.worldPvp.statusOn')
      : t('hudChrome.worldPvp.statusDisarming', { time: disarmClockText(view.disarmRemaining) })
    : flagDownText(view);
  const status =
    `<div class="wpvp-status ui-card ${statusClass}"><span aria-hidden="true">${svgIcon('battleground')}</span>` +
    `<span class="wpvp-status-text"><span>${esc(statusText)}</span>${groundHtml(view)}</span></div>`;
  const stats =
    `<div class="pvp-stat-grid wpvp-stats">` +
    `<div class="ui-card">${esc(t('hudChrome.worldPvp.record', { kills: num(view.kills), deaths: num(view.deaths) }))}</div>` +
    `<div class="ui-card">${esc(t('hudChrome.warfare.balance', { amount: num(view.honor) }))}</div>` +
    `</div>`;
  const stakes = view.stakes;
  const stakeRows = [
    // Where you can fight at all (the three zone policies), then what raises
    // the flag for you, then what a kill moves, then how to put it back down.
    t('hudChrome.worldPvp.groundSanctuary'),
    t('hudChrome.worldPvp.groundContested'),
    t('hudChrome.worldPvp.groundFfa'),
    t('hudChrome.worldPvp.groupLine'),
    t('hudChrome.worldPvp.markLine'),
    t('hudChrome.worldPvp.aidLine'),
    t('hudChrome.worldPvp.stakeLine', {
      cap: formatMoney(stakes.stakeCapCopper),
      percent: pct(stakes.stakePercent),
    }),
    t('hudChrome.worldPvp.noStakeLine'),
    t('hudChrome.worldPvp.noTakeLine'),
    t('hudChrome.worldPvp.honorLine', { honor: num(stakes.killHonor) }),
    t('hudChrome.worldPvp.splitLine'),
    t('hudChrome.worldPvp.repeatLine', {
      second: pct(stakes.repeatSecondPercent),
      third: pct(stakes.repeatThirdPercent),
      reset: durationText(stakes.repeatWindowSeconds),
    }),
    t('hudChrome.worldPvp.greyLine', { levels: num(stakes.greyLevelGap) }),
    t('hudChrome.worldPvp.disarmLine', { minutes: num(stakes.disarmMinutes) }),
  ]
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');
  return (
    `<div class="arena-layout"><section class="arena-overview">` +
    blurb +
    status +
    // The action sits right under the status it acts on, and above the record,
    // so it is on screen without scrolling on a landscape phone.
    actionHtml(view) +
    stats +
    `</section><section class="arena-ladders">` +
    `<div class="bg-sub">${esc(t('hudChrome.worldPvp.title'))}</div>` +
    `<ul class="wpvp-stakes">${stakeRows}</ul>` +
    `</section></div>`
  );
}

type LiveView = Extract<WorldPvpWindowView, { kind: 'live' }>;

/** The flag-down sentence. Free-for-all ground has its own, because standing
 *  there is the consent: the generic one would promise an immunity the ground
 *  does not grant. A player under the level gate is outside the free-for-all
 *  arm (the sim's pair rule), so for them the generic sentence is the true one. */
function flagDownText(view: LiveView): string {
  if (view.realmEnabled && view.zone === 'ffa' && view.action !== 'locked') {
    return t('hudChrome.worldPvp.statusOffFfa');
  }
  return t('hudChrome.worldPvp.statusOff');
}

/** The status card's second line: what the ground under the player says. A
 *  realm with the kill switch set has no live ground at all, so the line is
 *  dropped there rather than restated (the realm line sits under the disabled
 *  button, beside the control it explains). Free-for-all is the one state that
 *  reads hostile; the rest stay the card's muted tone (the tokens live in
 *  src/styles/components.css). */
function groundHtml(view: LiveView): string {
  if (!view.realmEnabled) return '';
  const text =
    view.zone === 'sanctuary'
      ? t('hudChrome.worldPvp.zoneSanctuary')
      : view.zone === 'ffa'
        ? t('hudChrome.worldPvp.zoneFfa')
        : t('hudChrome.worldPvp.zoneContested');
  // The class is chosen from the union, never interpolated from the wire.
  const tone = view.zone === 'ffa' ? ' is-ffa' : '';
  return `<span class="wpvp-zone${tone}">${esc(text)}</span>`;
}

function actionHtml(view: LiveView): string {
  const hint = `<div class="bg-note">${esc(t('hudChrome.worldPvp.commandHint'))}</div>`;
  if (view.action === 'realmOff') {
    // The reason sits under the button, where the level requirement does, so a
    // dead control is never unexplained. No command hint: /pvp is refused on
    // this realm too, so pointing at it would only lead to an error line.
    return (
      `<div class="pvp-queue ui-card"><button class="btn ui-btn ui-btn--red${INERT_CLASS}" data-act="pvp-enable"${focusKeyAttr(WORLD_PVP_ACTION_FOCUS_KEY)}${INERT_ATTR}>${esc(t('hudChrome.worldPvp.enable'))}</button>` +
      `<div class="bg-note bg-level-req">${esc(t('hudChrome.worldPvp.realmDisabled'))}</div></div>`
    );
  }
  if (view.action === 'locked') {
    return (
      `<div class="pvp-queue ui-card"><button class="btn ui-btn ui-btn--red${INERT_CLASS}" data-act="pvp-enable"${focusKeyAttr(WORLD_PVP_ACTION_FOCUS_KEY)}${INERT_ATTR}>${esc(t('hudChrome.worldPvp.enable'))}</button>` +
      `<div class="bg-note bg-level-req">${esc(t('hudChrome.worldPvp.levelReq', { level: num(view.stakes.minLevel) }))}</div>${hint}</div>`
    );
  }
  if (view.action === 'enable') {
    if (view.confirming) {
      return (
        `<div class="pvp-queue ui-card"><div class="bg-note">${esc(
          t('hudChrome.worldPvp.confirmBody', {
            cap: formatMoney(view.stakes.stakeCapCopper),
            minutes: num(view.stakes.disarmMinutes),
          }),
        )}</div><div class="pvp-queue-actions">` +
        `<button class="btn leave ui-btn" data-act="pvp-cancel"${focusKeyAttr(WORLD_PVP_ACTION_FOCUS_KEY)}>${esc(t('hudChrome.worldPvp.confirmCancel'))}</button>` +
        `<button class="btn ui-btn ui-btn--red" data-act="pvp-confirm"${focusKeyAttr(WORLD_PVP_CONFIRM_FOCUS_KEY)}>${esc(t('hudChrome.worldPvp.confirmAccept'))}</button>` +
        `</div></div>`
      );
    }
    return `<div class="pvp-queue ui-card"><button class="btn ui-btn ui-btn--red" data-act="pvp-enable"${focusKeyAttr(WORLD_PVP_ACTION_FOCUS_KEY)}>${esc(t('hudChrome.worldPvp.enable'))}</button>${hint}</div>`;
  }
  if (view.action === 'keepUp') {
    return `<div class="pvp-queue ui-card"><button class="btn ui-btn ui-btn--red" data-act="pvp-keep"${focusKeyAttr(WORLD_PVP_ACTION_FOCUS_KEY)}>${esc(t('hudChrome.worldPvp.keepUp'))}</button>${hint}</div>`;
  }
  return `<div class="pvp-queue ui-card"><button class="btn leave ui-btn" data-act="pvp-disable"${focusKeyAttr(WORLD_PVP_ACTION_FOCUS_KEY)}>${esc(t('hudChrome.worldPvp.disable'))}</button>${hint}</div>`;
}

/** Window-supplied glue: the world to act on and the confirm-step setter. */
export interface WorldPvpPanelDeps {
  world(): IWorld;
  setConfirming(confirming: boolean): void;
}

/** Wire the rendered panel's buttons. The confirm step is window state: a
 *  press flips it and the window re-renders (its signature carries the flag). */
export function wireWorldPvpPanel(el: HTMLElement, deps: WorldPvpPanelDeps): void {
  const on = (act: string, fn: () => void) => {
    // The click guard for the inert (aria-disabled) arms: no listener at all.
    el.querySelector(`[data-act="${act}"]:not([aria-disabled="true"])`)?.addEventListener(
      'click',
      () => {
        fn();
        audio.click();
      },
    );
  };
  on('pvp-enable', () => deps.setConfirming(true));
  on('pvp-cancel', () => deps.setConfirming(false));
  on('pvp-confirm', () => {
    deps.setConfirming(false);
    deps.world().setWorldPvpFlag(true);
  });
  on('pvp-keep', () => deps.world().setWorldPvpFlag(true));
  on('pvp-disable', () => deps.world().setWorldPvpFlag(false));
}
