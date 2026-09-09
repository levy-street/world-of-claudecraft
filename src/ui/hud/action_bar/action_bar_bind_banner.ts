// The on-bar action-bar key-binding mode's banner (issue #1238): the hint, the
// status line and the Reset / Done buttons that sit under the bar while the
// mode is active. Owns only that DOM; the mode's state machine is the pure
// action_bar_bind_core.ts and action_bar_bind_controller.ts owns the slot
// clicks, the key capture and the confirm dialogs. Registered in
// tests/architecture.test.ts UI_DOM_MODULES.

import { audio } from '../../../game/audio';
import { t } from '../../i18n';
import { type ActionBarBindState, actionBarBindStatus } from './action_bar_bind_core';

const ACTION_BAR_BIND_BANNER_ID = 'actionbar-bind-banner';

/** Build the banner and append it to `parent`. Returns the banner root. */
export function mountActionBarBindBanner(
  parent: HTMLElement | null,
  handlers: { onReset: () => void; onDone: () => void },
): HTMLElement {
  const el = document.createElement('div');
  el.id = ACTION_BAR_BIND_BANNER_ID;
  el.setAttribute('role', 'status');
  const hint = document.createElement('div');
  hint.className = 'actionbar-bind-hint';
  hint.textContent = t('hudChrome.actionBar.bannerHint');
  const status = document.createElement('div');
  status.className = 'actionbar-bind-status';
  const actions = document.createElement('div');
  actions.className = 'actionbar-bind-actions';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn';
  resetBtn.textContent = t('hudChrome.actionBar.reset');
  resetBtn.addEventListener('click', () => {
    audio.click();
    handlers.onReset();
  });
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn';
  doneBtn.textContent = t('hudChrome.actionBar.done');
  doneBtn.addEventListener('click', () => {
    audio.click();
    handlers.onDone();
  });
  actions.append(resetBtn, doneBtn);
  el.append(hint, status, actions);
  parent?.appendChild(el);
  return el;
}

/** Paint the status line for the mode's current state. */
export function setActionBarBindBannerStatus(banner: HTMLElement, state: ActionBarBindState): void {
  const el = banner.querySelector<HTMLElement>('.actionbar-bind-status');
  if (!el) return;
  const status = actionBarBindStatus(state);
  el.textContent =
    status === 'capturing'
      ? t('hudChrome.actionBar.bannerCapturing')
      : status === 'bound'
        ? t('hudChrome.actionBar.boundToKey', { key: state.lastBoundKeyLabel ?? '' })
        : '';
}
