// Owns the touch HUD's unread chat counts and paints both surfaces that show
// them: the whisper badge on the controls that open chat
// (whisper_unread_badge.ts) and the unread box over the Quick Actions control
// (chat_unread_box.ts). ONE counter (chat_unread_core.ts) feeds both, so the
// badge and the box can never disagree about what is unread.
//
// ChatWindowController owns this and reports received lines and tab switches.
// Chat opening and closing is read off the body classes the touch controls
// already toggle, so no touch-input file needs to know about either surface.
// Event-driven only (one MutationObserver on the body class, two listeners):
// no frame loop, no timer, no layout read.

import { SETTINGS_CHANGE_EVENT, Settings } from '../../../game/settings';
import type { ChatOpenTab, ChatTabId } from './chat_channels';
import { ChatUnreadBox } from './chat_unread_box';
import {
  type ChatUnreadBoxSettings,
  type ChatUnreadChannel,
  type ChatUnreadCounts,
  type ChatViewState,
  chatUnreadAfterReceive,
  chatUnreadAfterViewChange,
  chatUnreadRows,
  chatUnreadTapTab,
  NO_CHAT_UNREAD,
} from './chat_unread_core';
import { WhisperUnreadBadge } from './whisper_unread_badge';

const CHAT_OPEN_CLASS = 'mobile-chat-open';
const CHAT_PEEK_CLASS = 'mobile-chatlog-peek';
/** The Quick Actions strip's Chat seat: the real button that opens chat. */
const CHAT_OPENER_ID = 'mobile-menu-chat';

export interface ChatUnreadControllerDeps {
  document: Document;
  isTouchLayout(): boolean;
  activeTab(): ChatTabId;
  /** The channel tabs the player has open, in strip order. */
  openTabs(): readonly ChatOpenTab[];
  selectTab(tab: ChatTabId): void;
  /** The two box settings; defaults to the persisted game settings. */
  boxSettings?(): ChatUnreadBoxSettings;
}

function persistedBoxSettings(): ChatUnreadBoxSettings {
  const settings = new Settings();
  return {
    enabled: settings.get('chatUnreadBox'),
    general: settings.get('chatUnreadBoxGeneral'),
  };
}

export class ChatUnreadController {
  private counts: ChatUnreadCounts = NO_CHAT_UNREAD;
  private settings: ChatUnreadBoxSettings | null = null;
  private readonly badge: WhisperUnreadBadge;
  private readonly box: ChatUnreadBox;

  constructor(private readonly deps: ChatUnreadControllerDeps) {
    this.badge = new WhisperUnreadBadge(deps.document);
    this.box = new ChatUnreadBox({
      document: deps.document,
      onPick: (channel) => this.open(channel),
    });
  }

  /** Follow chat opening/closing (body class flips), settings and language. */
  start(): void {
    const { document } = this.deps;
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => this.sync()).observe(document.body as Node, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    document.addEventListener('woc:languagechange', () => this.paint(true));
    document.defaultView?.addEventListener(SETTINGS_CHANGE_EVENT, () => {
      // Dropped, not re-read here: a settings write can come in bursts, and the
      // next paint reads the store once.
      this.settings = null;
      this.paint();
    });
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

  /** A box tap: land on the right tab, then open chat through the real Chat
   *  button so the touch controls run their own open path. */
  private open(channel: ChatUnreadChannel | null): void {
    const { document } = this.deps;
    this.deps.selectTab(chatUnreadTapTab(channel, this.deps.openTabs()));
    if (!document.body.classList.contains(CHAT_OPEN_CLASS)) {
      document.getElementById(CHAT_OPENER_ID)?.click();
    }
    this.sync();
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
    this.settings ??= (this.deps.boxSettings ?? persistedBoxSettings)();
    this.badge.render(this.counts.whisper, force);
    this.box.render(chatUnreadRows(this.counts, this.settings));
  }
}
