// The restart strip's painter: one row, the status text and the Restart
// button, from the state src/ui/restart_strip_core.ts resolves. The options
// window composes it at the foot of any panel hosting a next-launch setting and
// owns the request phase; this file only paints and forwards the click.
//
// Two paints: `buildRestartStrip` mints the row, `paintRestartStrip` moves an
// existing row to a new state IN PLACE. The second exists for the click: a
// panel rebuild would replace the live region together with its text (which
// screen readers commonly do not announce) and drop focus to the body, while
// an in-place repaint keeps the region and can hand focus to the status while
// the button is disabled, and back to the button when the offer stands again.

import { t } from './i18n';
import type { RestartStripState } from './restart_strip_core';

export interface RestartStripHooks {
  onRestart(): void;
}

const STATUS_KEY = {
  ready: 'hudChrome.options.restartPending',
  restarting: 'hudChrome.options.restartInProgress',
  failed: 'hudChrome.options.restartFailed',
} as const;

/** Paint the strip for `state`, or nothing for `hidden`. */
export function buildRestartStrip(
  state: RestartStripState,
  hooks: RestartStripHooks,
): HTMLElement | null {
  if (state === 'hidden') return null;
  const strip = document.createElement('div');
  strip.className = 'restart-strip';

  const status = document.createElement('div');
  status.className = 'restart-strip-status';
  // Focusable by script only: where focus parks while the button is disabled.
  status.tabIndex = -1;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn restart-strip-btn';
  button.dataset.restartGame = '';
  button.dataset.focusKey = 'restart-game';
  button.textContent = t('hudChrome.options.restartGame');
  button.addEventListener('click', () => hooks.onRestart());

  strip.append(status, button);
  paintRestartStrip(strip, state, false);
  return strip;
}

/**
 * Move a built strip to `state` in place: the status text and its live-region
 * role (an alert for the failure a player must hear, a status otherwise), the
 * button's availability, and focus: onto the status while restarting (the
 * disabled button cannot hold it), back onto the button when the offer stands
 * again after a failure. The focus moves only on a transition the player
 * caused (`moveFocus`), never on a build: a panel rebuilt for another reason
 * while the strip reads failed must not pull focus onto it. `hidden` is not a
 * state a built strip takes; the window drops the node instead.
 */
export function paintRestartStrip(
  strip: HTMLElement,
  state: RestartStripState,
  moveFocus = true,
): void {
  if (state === 'hidden') return;
  strip.dataset.restartStrip = state;
  const status = strip.querySelector<HTMLElement>('.restart-strip-status');
  const button = strip.querySelector<HTMLButtonElement>('[data-restart-game]');
  if (!status || !button) return;
  status.setAttribute('role', state === 'failed' ? 'alert' : 'status');
  status.textContent = t(STATUS_KEY[state]);
  button.disabled = state === 'restarting';
  if (!moveFocus) return;
  if (state === 'restarting') status.focus();
  else if (state === 'failed') button.focus();
}
