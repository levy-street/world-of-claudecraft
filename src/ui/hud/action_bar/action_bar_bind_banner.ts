// The on-bar key-binding mode's banner (issue #1238): the hint, the transient
// status line, and the Reset / Done buttons. A HUD-ROOT element (appended to
// #ui by the Hud, never to #actionbar-stack): a bar moved with Interface Unlock
// is reparented to #ui and painted over a stack-anchored banner, so every
// "Done" click landed on a slot and armed another capture, with no exit short
// of a restart. Placement is computed against the live bar's box through the
// DOM-free actionBarBindBannerPlacement core; this module owns only the DOM.
import { t } from '../../i18n';
import { actionBarBindBannerPlacement } from './action_bar_bind_core';

export interface ActionBarBindBannerHandle {
  el: HTMLElement;
  /** Write the status line (the capturing prompt or "bound to X"); '' clears it. */
  setStatus(text: string): void;
  remove(): void;
}

export function createActionBarBindBanner(deps: {
  onReset: () => void;
  onDone: () => void;
}): ActionBarBindBannerHandle {
  const el = document.createElement('div');
  el.id = 'actionbar-bind-banner';
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
  resetBtn.addEventListener('click', deps.onReset);
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn';
  doneBtn.textContent = t('hudChrome.actionBar.done');
  doneBtn.addEventListener('click', deps.onDone);
  actions.append(resetBtn, doneBtn);
  el.append(hint, status, actions);
  return {
    el,
    setStatus: (text) => {
      status.textContent = text;
    },
    remove: () => el.remove(),
  };
}

/**
 * Position a connected banner against the live primary bar, in HUD author px.
 * getBoundingClientRect reports VISUAL px (the #ui zoom applied), so the bar's
 * box is divided by `uiScale` before it meets the banner's own offset size and
 * the #ui client box, which are already author px. A bar with no box (hidden
 * under the cross hotbar, or display:none) anchors nothing and the core's
 * bottom-centre fallback applies.
 */
export function placeActionBarBindBanner(
  el: HTMLElement,
  bar: HTMLElement | null,
  uiRoot: HTMLElement,
  uiScale: number,
): void {
  const scale = uiScale > 0 ? uiScale : 1;
  const r = bar?.getBoundingClientRect() ?? null;
  const box =
    r && r.width > 0 && r.height > 0
      ? {
          left: r.left / scale,
          top: r.top / scale,
          width: r.width / scale,
          height: r.height / scale,
        }
      : null;
  const placed = actionBarBindBannerPlacement({
    bar: box,
    banner: { width: el.offsetWidth, height: el.offsetHeight },
    viewport: { width: uiRoot.clientWidth, height: uiRoot.clientHeight },
  });
  el.style.left = `${placed.left}px`;
  el.style.top = `${placed.top}px`;
}
