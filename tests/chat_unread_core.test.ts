import { describe, expect, it } from 'vitest';
import {
  CHAT_UNREAD_CHANNELS,
  CHAT_UNREAD_PILL_CAP,
  type ChatUnreadCounts,
  type ChatViewState,
  channelInView,
  chatUnreadAfterReceive,
  chatUnreadAfterViewChange,
  chatUnreadPill,
  chatUnreadRows,
  chatUnreadTapTab,
  chatUnreadTotal,
  isChatUnreadChannel,
  NO_CHAT_UNREAD,
} from '../src/ui/hud/chat/chat_unread_core';

// The ONE counter behind both touch unread surfaces: the whisper badge reads
// its `whisper` slot, the unread box reads all three.

const closed: ChatViewState = { touch: true, logVisible: false, activeTab: 'all' };
const view = (over: Partial<ChatViewState>): ChatViewState => ({ ...closed, ...over });
const counts = (over: Partial<ChatUnreadCounts> = {}): ChatUnreadCounts => ({
  ...NO_CHAT_UNREAD,
  ...over,
});
const receive = (
  from: ChatUnreadCounts,
  channels: readonly (typeof CHAT_UNREAD_CHANNELS)[number][],
  at: ChatViewState,
): ChatUnreadCounts => channels.reduce((acc, ch) => chatUnreadAfterReceive(acc, ch, at), from);

describe('shared chat unread counter', () => {
  it('lists whisper first, then party, then general', () => {
    expect(CHAT_UNREAD_CHANNELS).toEqual(['whisper', 'party', 'general']);
    expect(isChatUnreadChannel('whisper')).toBe(true);
    expect(isChatUnreadChannel('guild')).toBe(false);
    expect(isChatUnreadChannel(undefined)).toBe(false);
  });

  it('feeds three independent rows from one counter while the touch chat is closed', () => {
    const after = receive(
      counts(),
      ['general', 'whisper', 'general', 'party', 'general', 'party'],
      closed,
    );
    expect(after).toEqual({ whisper: 1, party: 2, general: 3 });
  });

  it('counts with the chat closed whatever tab was left active', () => {
    expect(
      chatUnreadAfterReceive(counts(), 'whisper', view({ activeTab: 'whisper' })).whisper,
    ).toBe(1);
    expect(chatUnreadAfterReceive(counts(), 'party', view({ activeTab: 'combat' })).party).toBe(1);
  });

  it('counts a channel while the open log is filtered to a tab that hides it', () => {
    for (const activeTab of ['say', 'general', 'party', 'combat'] as const) {
      const at = view({ logVisible: true, activeTab });
      expect(chatUnreadAfterReceive(counts({ whisper: 2 }), 'whisper', at).whisper).toBe(3);
    }
    const onWhisper = view({ logVisible: true, activeTab: 'whisper' });
    expect(chatUnreadAfterReceive(counts(), 'party', onWhisper).party).toBe(1);
    expect(chatUnreadAfterReceive(counts(), 'general', onWhisper).general).toBe(1);
  });

  it('does not count a line the player is already looking at', () => {
    const onAll = view({ logVisible: true, activeTab: 'all' });
    for (const channel of CHAT_UNREAD_CHANNELS) {
      expect(chatUnreadAfterReceive(counts(), channel, onAll)).toEqual(NO_CHAT_UNREAD);
      const onOwn = view({ logVisible: true, activeTab: channel });
      expect(chatUnreadAfterReceive(counts(), channel, onOwn)).toEqual(NO_CHAT_UNREAD);
    }
  });

  it('never counts on desktop, and drops what was counted when the layout leaves touch', () => {
    const desktop = view({ touch: false });
    expect(chatUnreadAfterReceive(counts(), 'whisper', desktop)).toEqual(NO_CHAT_UNREAD);
    expect(chatUnreadAfterReceive(counts({ party: 4 }), 'party', desktop)).toEqual(NO_CHAT_UNREAD);
    expect(chatUnreadAfterViewChange(counts({ whisper: 5, general: 2 }), desktop)).toEqual(
      NO_CHAT_UNREAD,
    );
  });

  it('reading All clears all three', () => {
    const before = counts({ whisper: 1, party: 3, general: 12 });
    expect(chatUnreadAfterViewChange(before, view({ logVisible: true, activeTab: 'all' }))).toEqual(
      NO_CHAT_UNREAD,
    );
  });

  it('reading a channel tab clears that row only', () => {
    const before = counts({ whisper: 1, party: 3, general: 12 });
    const on = (activeTab: ChatViewState['activeTab']) =>
      chatUnreadAfterViewChange(before, view({ logVisible: true, activeTab }));
    expect(on('whisper')).toEqual({ whisper: 0, party: 3, general: 12 });
    expect(on('party')).toEqual({ whisper: 1, party: 0, general: 12 });
    expect(on('general')).toEqual({ whisper: 1, party: 3, general: 0 });
    // A tab that shows none of them clears nothing.
    expect(on('say')).toBe(before);
    expect(on('combat')).toBe(before);
  });

  it('switching tabs behind a closed panel clears nothing', () => {
    const before = counts({ whisper: 5, party: 1 });
    expect(chatUnreadAfterViewChange(before, view({ activeTab: 'whisper' }))).toBe(before);
    expect(chatUnreadAfterViewChange(before, closed)).toBe(before);
  });

  it('channelInView needs BOTH a visible log and a tab that shows the channel', () => {
    expect(channelInView('whisper', view({ logVisible: true, activeTab: 'all' }))).toBe(true);
    expect(channelInView('whisper', view({ logVisible: false, activeTab: 'all' }))).toBe(false);
    expect(channelInView('whisper', view({ logVisible: true, activeTab: 'guild' }))).toBe(false);
    expect(channelInView('party', view({ logVisible: true, activeTab: 'party' }))).toBe(true);
    expect(channelInView('party', view({ logVisible: true, activeTab: 'general' }))).toBe(false);
  });
});

describe('unread box rows', () => {
  const all = { enabled: true, general: true };
  const defaults = { enabled: true, general: false };

  it('shows only non-zero rows, whisper first', () => {
    expect(chatUnreadRows(counts({ general: 12, party: 3, whisper: 1 }), all)).toEqual([
      { channel: 'whisper', count: 1 },
      { channel: 'party', count: 3 },
      { channel: 'general', count: 12 },
    ]);
    expect(chatUnreadRows(counts({ party: 3 }), all)).toEqual([{ channel: 'party', count: 3 }]);
    expect(chatUnreadRows(counts(), all)).toEqual([]);
  });

  it('leaves the General row out unless the player turned it on', () => {
    const busy = counts({ general: 40, whisper: 2 });
    expect(chatUnreadRows(busy, defaults)).toEqual([{ channel: 'whisper', count: 2 }]);
    // General alone never raises the box by default.
    expect(chatUnreadRows(counts({ general: 40 }), defaults)).toEqual([]);
  });

  it('shows nothing when the box is switched off', () => {
    const busy = counts({ whisper: 2, party: 1, general: 9 });
    expect(chatUnreadRows(busy, { enabled: false, general: true })).toEqual([]);
  });

  it('totals the rows that are shown, not the hidden ones', () => {
    const busy = counts({ whisper: 1, party: 3, general: 12 });
    expect(chatUnreadTotal(chatUnreadRows(busy, all))).toBe(16);
    expect(chatUnreadTotal(chatUnreadRows(busy, defaults))).toBe(4);
    expect(chatUnreadTotal([])).toBe(0);
  });

  it('caps a pill at 99+', () => {
    expect(CHAT_UNREAD_PILL_CAP).toBe(99);
    expect(chatUnreadPill(1)).toEqual({ shown: 1, overflow: false });
    expect(chatUnreadPill(99)).toEqual({ shown: 99, overflow: false });
    expect(chatUnreadPill(100)).toEqual({ shown: 99, overflow: true });
    expect(chatUnreadPill(4000)).toEqual({ shown: 99, overflow: true });
  });

  it('a tap lands on the row tab when it is open, else All; the header always on All', () => {
    expect(chatUnreadTapTab('whisper', ['say', 'whisper'])).toBe('whisper');
    expect(chatUnreadTapTab('whisper', ['say'])).toBe('all');
    expect(chatUnreadTapTab('party', ['party'])).toBe('party');
    expect(chatUnreadTapTab('general', [])).toBe('all');
    expect(chatUnreadTapTab(null, ['whisper', 'party', 'general'])).toBe('all');
  });
});
