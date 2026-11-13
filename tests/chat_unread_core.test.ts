import { describe, expect, it } from 'vitest';
import {
  CHAT_UNREAD_CHANNELS,
  type ChatUnreadCounts,
  type ChatViewState,
  channelInView,
  chatUnreadAfterReceive,
  chatUnreadAfterViewChange,
  isChatUnreadChannel,
  NO_CHAT_UNREAD,
} from '../src/ui/hud/chat/chat_unread_core';

// The counter behind the unread badge on the touch controls that open chat.

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

describe('chat unread counter', () => {
  it('counts whispers and party chat only, whisper first', () => {
    expect(CHAT_UNREAD_CHANNELS).toEqual(['whisper', 'party']);
    expect(isChatUnreadChannel('party')).toBe(true);
    // General would keep the badge lit all the time, so it is never counted.
    expect(isChatUnreadChannel('general')).toBe(false);
    expect(isChatUnreadChannel('say')).toBe(false);
    expect(isChatUnreadChannel('whisper')).toBe(true);
    expect(isChatUnreadChannel('guild')).toBe(false);
    expect(isChatUnreadChannel(undefined)).toBe(false);
  });

  it('counts each channel on its own while the touch chat is closed', () => {
    const after = receive(counts(), ['whisper', 'party', 'party'], closed);
    expect(after).toEqual({ whisper: 1, party: 2 });
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
    expect(chatUnreadAfterViewChange(counts({ whisper: 5, party: 2 }), desktop)).toEqual(
      NO_CHAT_UNREAD,
    );
  });

  it('reading All clears both', () => {
    const before = counts({ whisper: 1, party: 3 });
    expect(chatUnreadAfterViewChange(before, view({ logVisible: true, activeTab: 'all' }))).toEqual(
      NO_CHAT_UNREAD,
    );
  });

  it('reading a channel tab clears that channel only', () => {
    const before = counts({ whisper: 1, party: 3 });
    const on = (activeTab: ChatViewState['activeTab']) =>
      chatUnreadAfterViewChange(before, view({ logVisible: true, activeTab }));
    expect(on('whisper')).toEqual({ whisper: 0, party: 3 });
    expect(on('party')).toEqual({ whisper: 1, party: 0 });
    expect(on('general')).toBe(before);
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
