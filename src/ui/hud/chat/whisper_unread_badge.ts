// The touch HUD's unread-whisper badge: a small whisper-colored count on every
// control that leads to chat. Rules live in whisper_unread_core.ts; this is the
// thin DOM side. Owned by ChatWindowController, which reports received whispers
// and tab switches; chat opening and closing is read off the body classes the
// touch controls already toggle, so no touch-input file needs to know about it.
//
// Three controls are badged because which one is on screen depends on where the
// player is: the Quick Actions anchor (the only one visible while chat is
// closed), the strip's Chat seat (once the strip is open), and the More tray's
// Chat button. A control that is not in the DOM is skipped.
//
// The count is announced through aria-describedby, never by rewriting
// aria-label: the anchor's accessible name is owned by menu_control_controller
// (it swaps per gesture mode) and the shell re-stamps every data-i18n-aria name
// on a language switch, so a rewritten label would be fought over and lost.

import { formatNumber, t } from '../../i18n';
import {
  type ChatTabId,
  chatChannelColor,
  WHISPER_TAB,
  WHISPER_TAB_LABEL_KEY,
} from './chat_channels';
import {
  type WhisperViewState,
  whisperUnreadAfterReceive,
  whisperUnreadAfterViewChange,
  whisperUnreadBadge,
} from './whisper_unread_core';

/** Every control that opens chat or reveals the one that does. */
export const WHISPER_UNREAD_HOST_IDS = [
  'mobile-menu-anchor',
  'mobile-menu-chat',
  'mobile-chat',
] as const;
export const WHISPER_UNREAD_BADGE_CLASS = 'whisper-unread-badge';
export const WHISPER_UNREAD_HOST_CLASS = 'has-whisper-unread';
export const WHISPER_UNREAD_DESC_ID = 'whisper-unread-desc';

const CHAT_OPEN_CLASS = 'mobile-chat-open';
const CHAT_PEEK_CLASS = 'mobile-chatlog-peek';
const DESCRIBED_BY = 'aria-describedby';

export interface WhisperUnreadBadgeDeps {
  document: Document;
  isTouchLayout(): boolean;
  activeTab(): ChatTabId;
}

export class WhisperUnreadBadge {
  private count = 0;
  private painted = 0;
  private description: HTMLElement | null = null;
  private readonly badges = new Map<string, HTMLElement>();

  constructor(private readonly deps: WhisperUnreadBadgeDeps) {}

  /** Follow chat opening/closing (body class flips) and language switches. */
  start(): void {
    const { document } = this.deps;
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => this.sync()).observe(document.body as Node, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    document.addEventListener('woc:languagechange', () => this.paint(true));
  }

  get unread(): number {
    return this.count;
  }

  /** One whisper RECEIVED from another player (never the "To X" echo). */
  noteReceived(): void {
    this.count = whisperUnreadAfterReceive(this.count, this.view());
    this.paint();
  }

  /** The view changed: clear the count if the whispers are now on screen. */
  sync(): void {
    this.count = whisperUnreadAfterViewChange(this.count, this.view());
    this.paint();
  }

  private view(): WhisperViewState {
    const body = this.deps.document.body.classList;
    return {
      touch: this.deps.isTouchLayout(),
      logVisible: body.contains(CHAT_OPEN_CLASS) || body.contains(CHAT_PEEK_CLASS),
      activeTab: this.deps.activeTab(),
    };
  }

  private paint(force = false): void {
    if (!force && this.count === this.painted) return;
    this.painted = this.count;
    const { document } = this.deps;
    const badge = whisperUnreadBadge(this.count);
    if (badge === null) {
      for (const id of WHISPER_UNREAD_HOST_IDS) {
        this.badges.get(id)?.remove();
        this.badges.delete(id);
        const host = document.getElementById(id);
        host?.classList.remove(WHISPER_UNREAD_HOST_CLASS);
        host?.removeAttribute(DESCRIBED_BY);
      }
      this.description?.remove();
      this.description = null;
      return;
    }
    const digits = { maximumFractionDigits: 0, useGrouping: false };
    const shown = formatNumber(badge.shown, digits);
    const text = badge.overflow
      ? t('hudChrome.mobile.whisperUnreadOverflow', { count: shown })
      : shown;
    if (this.description === null) {
      // `hidden` keeps it out of the layout and the reading order; a hidden
      // element still supplies an aria-describedby description.
      this.description = document.createElement('span');
      this.description.id = WHISPER_UNREAD_DESC_ID;
      this.description.hidden = true;
      document.body.append(this.description);
    }
    this.description.textContent = t('hudChrome.mobile.whisperUnreadDesc', {
      channel: t(WHISPER_TAB_LABEL_KEY),
      count: formatNumber(this.count, digits),
    });
    for (const id of WHISPER_UNREAD_HOST_IDS) {
      const host = document.getElementById(id);
      if (!host) continue;
      let el = this.badges.get(id);
      if (!el || el.parentElement !== host) {
        el?.remove();
        el = document.createElement('span');
        el.className = `ui-badge ui-badge--corner ${WHISPER_UNREAD_BADGE_CLASS}`;
        el.setAttribute('aria-hidden', 'true');
        // The whisper channel color has one home (chat_channels.ts); CSS reads it.
        el.style.setProperty('--whisper-unread-color', chatChannelColor(WHISPER_TAB));
        host.append(el);
        this.badges.set(id, el);
      }
      el.textContent = text;
      host.classList.add(WHISPER_UNREAD_HOST_CLASS);
      host.setAttribute(DESCRIBED_BY, WHISPER_UNREAD_DESC_ID);
    }
  }
}
