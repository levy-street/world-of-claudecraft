// PURE rules for the touch HUD's unread chat counts (no DOM, no i18n).
//
// The counter behind the round badge on the controls that open chat
// (whisper_unread_badge.ts). A count means "received since you last looked at
// that channel": a line counts unless the log is on screen on a tab that shows
// it, and a channel clears when the log comes up on All (which shows every
// channel) or on its own tab.
//
// Whispers and party chat ONLY, by design: both are addressed to the player.
// General, Say or World traffic would keep a badge lit permanently, and a badge
// that is always lit says nothing.
//
// Touch only. Desktop keeps its log on screen and its per-tab badges
// (ChatWindowController.unreadTabs), so nothing is counted there.

import type { ChatOpenTab, ChatTabId } from './chat_channels';

/** The channels that are counted, in PRIORITY order: whisper leads because it
 *  is the one addressed to the player alone. */
export const CHAT_UNREAD_CHANNELS = ['whisper', 'party'] as const;
export type ChatUnreadChannel = (typeof CHAT_UNREAD_CHANNELS)[number];

export function isChatUnreadChannel(v: unknown): v is ChatUnreadChannel {
  return typeof v === 'string' && (CHAT_UNREAD_CHANNELS as readonly string[]).includes(v);
}

export type ChatUnreadCounts = Readonly<Record<ChatUnreadChannel, number>>;

export const NO_CHAT_UNREAD: ChatUnreadCounts = { whisper: 0, party: 0 };

export interface ChatViewState {
  /** The touch HUD is active (body.mobile-touch). Desktop keeps its log on screen. */
  touch: boolean;
  /** The chat log is on screen: the open chat panel or the read-only log peek. */
  logVisible: boolean;
  /** The chat tab the log is filtered to. */
  activeTab: ChatTabId;
}

/** True while the player can already read `channel` where its lines land: the
 *  log is up on All or on that channel's own tab. */
export function channelInView(channel: ChatUnreadChannel, view: ChatViewState): boolean {
  return view.logVisible && (view.activeTab === 'all' || view.activeTab === channel);
}

/** The counts after one line RECEIVED on `channel` (never the player's own
 *  line, never the "To X" whisper echo). Returns the same object when nothing
 *  changed. */
export function chatUnreadAfterReceive(
  counts: ChatUnreadCounts,
  channel: ChatUnreadChannel,
  view: ChatViewState,
): ChatUnreadCounts {
  if (!view.touch) return chatUnreadAfterViewChange(counts, view);
  if (channelInView(channel, view)) return counts;
  return { ...counts, [channel]: counts[channel] + 1 };
}

/** The counts after the view changed (chat opened or closed, tab switched,
 *  layout left touch): every channel now in view clears, the rest hold.
 *  Returns the same object when nothing changed. */
export function chatUnreadAfterViewChange(
  counts: ChatUnreadCounts,
  view: ChatViewState,
): ChatUnreadCounts {
  let next: Record<ChatUnreadChannel, number> | null = null;
  for (const channel of CHAT_UNREAD_CHANNELS) {
    if (counts[channel] === 0) continue;
    if (view.touch && !channelInView(channel, view)) continue;
    next ??= { ...counts };
    next[channel] = 0;
  }
  return next ?? counts;
}

/** What the badge on the chat controls shows: ONE count for everything unread,
 *  worn in the colour of the channel that leads. */
export interface ChatUnreadDot {
  /** Unread whispers plus unread party lines. */
  total: number;
  /** The channel whose colour the badge wears: whisper while any whisper is
   *  unread (it is the one addressed to the player alone), else party. */
  lead: ChatUnreadChannel;
}

/** The badge for these counts, or null when everything is read. */
export function chatUnreadDot(counts: ChatUnreadCounts): ChatUnreadDot | null {
  let total = 0;
  let lead: ChatUnreadChannel | null = null;
  for (const channel of CHAT_UNREAD_CHANNELS) {
    if (counts[channel] <= 0) continue;
    total += counts[channel];
    lead ??= channel;
  }
  return lead === null ? null : { total, lead };
}

/** The tab chat lands on when it is opened with something unread: the tab that
 *  holds the message. Whispers first (their own tab when the player has it
 *  open), else party (same rule), and All whenever that tab is not open, since
 *  All shows every channel. Null when nothing is unread: the player's own tab
 *  choice is left alone. */
export function chatUnreadOpenTab(
  counts: ChatUnreadCounts,
  openTabs: readonly ChatOpenTab[],
): ChatTabId | null {
  const lead = chatUnreadDot(counts)?.lead;
  if (lead === undefined) return null;
  return openTabs.includes(lead) ? lead : 'all';
}
