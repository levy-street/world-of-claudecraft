// PURE rules for the touch HUD's unread chat counts (no DOM, no i18n).
//
// ONE counter feeds both touch surfaces: the round badge on the controls that
// open chat (whisper_unread_badge.ts, whispers only) and the unread box seated
// over the Quick Actions control (chat_unread_box.ts, one row per channel).
// A count means "received since you last looked at that channel": a line counts
// unless the log is on screen on a tab that shows it, and a channel clears when
// the log comes up on All (which shows every channel) or on its own tab.
//
// Touch only. Desktop keeps its log on screen and its per-tab badges
// (ChatWindowController.unreadTabs), so nothing is counted there.

import type { ChatOpenTab, ChatTabId } from './chat_channels';

/** The channels the box can show, in ROW order: whisper leads because it is
 *  the one addressed to the player. */
export const CHAT_UNREAD_CHANNELS = ['whisper', 'party', 'general'] as const;
export type ChatUnreadChannel = (typeof CHAT_UNREAD_CHANNELS)[number];

export function isChatUnreadChannel(v: unknown): v is ChatUnreadChannel {
  return typeof v === 'string' && (CHAT_UNREAD_CHANNELS as readonly string[]).includes(v);
}

export type ChatUnreadCounts = Readonly<Record<ChatUnreadChannel, number>>;

export const NO_CHAT_UNREAD: ChatUnreadCounts = { whisper: 0, party: 0, general: 0 };

/** The highest count a box pill prints as a number; above it the pill reads "99+". */
export const CHAT_UNREAD_PILL_CAP = 99;

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

/** Which rows the player asked to see. The box itself is one switch; the
 *  General row is a second one, off by default because on a busy realm that
 *  count never stops climbing. */
export interface ChatUnreadBoxSettings {
  enabled: boolean;
  general: boolean;
}

export interface ChatUnreadRow {
  channel: ChatUnreadChannel;
  count: number;
}

/** The rows the box paints, in row order: only channels with something unread,
 *  and only those the settings allow. Empty means the whole box is hidden. */
export function chatUnreadRows(
  counts: ChatUnreadCounts,
  settings: ChatUnreadBoxSettings,
): ChatUnreadRow[] {
  if (!settings.enabled) return [];
  const rows: ChatUnreadRow[] = [];
  for (const channel of CHAT_UNREAD_CHANNELS) {
    if (counts[channel] <= 0) continue;
    if (channel === 'general' && !settings.general) continue;
    rows.push({ channel, count: counts[channel] });
  }
  return rows;
}

/** The header total: the sum of the rows actually shown. */
export function chatUnreadTotal(rows: readonly ChatUnreadRow[]): number {
  let total = 0;
  for (const row of rows) total += row.count;
  return total;
}

/** What a pill prints: the number, and whether it is the capped "99+" form. */
export function chatUnreadPill(count: number): { shown: number; overflow: boolean } {
  return count > CHAT_UNREAD_PILL_CAP
    ? { shown: CHAT_UNREAD_PILL_CAP, overflow: true }
    : { shown: Math.max(0, count), overflow: false };
}

/** The tab a tap on the box selects before chat opens: the row's own tab when
 *  the player has it open, else All (which shows every channel). The header
 *  (`null`) always lands on All. */
export function chatUnreadTapTab(
  channel: ChatUnreadChannel | null,
  openTabs: readonly ChatOpenTab[],
): ChatTabId {
  return channel !== null && openTabs.includes(channel) ? channel : 'all';
}
