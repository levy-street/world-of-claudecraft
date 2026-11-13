// The Log Out countdown prompt: "Logging out in N seconds" with a Cancel
// button, shown while the server makes a player in combat or flagged for PvP
// wait before leaving the world (server/logout_timer.ts). Not modal: the
// player keeps playing under it, and taking damage ends it from the server.
//
// Thin DOM adapter over logout_countdown_view.ts. Event-driven only: the
// server sends one beat a second, so this owns no timer and no clock.

import type { LogoutEvent } from '../sim/types';
import { formatNumber, t, tPlural } from './i18n';
import { LOGOUT_COUNTDOWN_PLURAL, logoutCountdownAction } from './logout_countdown_view';

let promptTitleSeq = 0;

export class LogoutCountdownController {
  private prompt: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;

  /**
   * @param cancel Ask the server to stop the countdown (the Cancel button).
   * @param showError Show the player a red error line.
   * @param log Put a line in the chat log (announced to screen readers).
   */
  constructor(
    private readonly cancel: () => void,
    private readonly showError: (text: string) => void,
    private readonly log: (text: string) => void,
  ) {}

  /** Feed one server `logout` event through. */
  apply(event: LogoutEvent): void {
    const action = logoutCountdownAction(event);
    if (action.kind === 'hide') {
      this.hide();
      if (action.errorKey) this.showError(t(action.errorKey));
      return;
    }
    const text = tPlural(LOGOUT_COUNTDOWN_PLURAL, action.seconds, {
      count: formatNumber(action.seconds, { maximumFractionDigits: 0 }),
    });
    // The prompt takes no focus (the player is still playing), so the beat that
    // opens the wait also goes to the chat log, where it is read out and kept.
    if (action.announce) this.log(text);
    if (!this.textEl) this.mount();
    if (this.textEl && this.textEl.textContent !== text) this.textEl.textContent = text;
  }

  private mount(): void {
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel ui-panel-strong';
    prompt.setAttribute('role', 'group');
    const text = document.createElement('div');
    text.className = 'prompt-text';
    text.id = `logout-countdown-title-${promptTitleSeq++}`;
    prompt.setAttribute('aria-labelledby', text.id);
    const cancel = document.createElement('button');
    cancel.className = 'btn ui-btn';
    cancel.type = 'button';
    cancel.textContent = t('hudChrome.logout.cancel');
    cancel.addEventListener('click', () => this.cancel());
    const actions = document.createElement('div');
    actions.className = 'prompt-actions';
    actions.append(cancel);
    prompt.append(text, actions);
    stack.appendChild(prompt);
    this.prompt = prompt;
    this.textEl = text;
  }

  private hide(): void {
    this.prompt?.remove();
    this.prompt = null;
    this.textEl = null;
  }
}
