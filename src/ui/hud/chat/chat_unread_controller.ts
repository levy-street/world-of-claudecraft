// Owns the touch HUD's unread chat counts (chat_unread_core.ts) and paints the
// badge that shows them on the controls that open chat
// (whisper_unread_badge.ts).
//
// ChatWindowController owns this and reports received lines and tab switches.
// Chat opening and closing is read off the body classes the touch controls
// already toggle, so no touch-input file needs to know about the badge.
// Event-driven only (one MutationObserver on the body class, one listener):
// no frame loop, no timer, no layout read.

import type { ChatTabId } from './chat_channels';
import {
  type ChatUnreadChannel,
  type ChatUnreadCounts,
  type ChatViewState,
  chatUnreadAfterReceive,
  chatUnreadAfterViewChange,
  NO_CHAT_UNREAD,
} from './chat_unread_core';
import { WhisperUnreadBadge } from './whisper_unread_badge';

const CHAT_OPEN_CLASS = 'mobile-chat-open';
const CHAT_PEEK_CLASS = 'mobile-chatlog-peek';

export interface ChatUnreadControllerDeps {
  document: Document;
  isTouchLayout(): boolean;
  activeTab(): ChatTabId;
}

export class ChatUnreadController {
  private counts: ChatUnreadCounts = NO_CHAT_UNREAD;
  private readonly badge: WhisperUnreadBadge;

  constructor(private readonly deps: ChatUnreadControllerDeps) {
    this.badge = new WhisperUnreadBadge(deps.document);
  }

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

  get unread(): ChatUnreadCounts {
    return this.counts;
  }

  /** One line RECEIVED on `channel` from another player (never the player's
   *  own line or the "To X" whisper echo). */
  noteReceived(channel: ChatUnreadChannel): void {
    this.counts = chatUnreadAfterReceive(this.counts, channel, this.view());
    this.paint();
  }

  /** The view changed: clear every channel that is now on screen. */
  sync(): void {
    this.counts = chatUnreadAfterViewChange(this.counts, this.view());
    this.paint();
  }

  private view(): ChatViewState {
    const body = this.deps.document.body.classList;
    return {
      touch: this.deps.isTouchLayout(),
      logVisible: body.contains(CHAT_OPEN_CLASS) || body.contains(CHAT_PEEK_CLASS),
      activeTab: this.deps.activeTab(),
    };
  }

  private paint(force = false): void {
    this.badge.render(this.counts, force);
  }
}
