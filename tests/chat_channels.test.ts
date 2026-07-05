import { describe, expect, it } from 'vitest';
import {
  CHAT_TAB_CHANNELS,
  channelNeedsJoin,
  channelSendPrefix,
  chatOpenTabLabelKey,
  composeChatLine,
  composeWhisperReply,
  isChatOpenTab,
  isChatTabChannel,
  parseChatTabs,
  serializeChatTabs,
  WHISPER_TAB,
  WHISPER_TAB_LABEL_KEY,
} from '../src/ui/chat_channels';

describe('chat channel tabs — pure model', () => {
  it('exposes the bindable channels without whisper (which has no standing channel)', () => {
    expect(CHAT_TAB_CHANNELS).toContain('say');
    expect(CHAT_TAB_CHANNELS).toContain('world');
    expect(CHAT_TAB_CHANNELS).toContain('lfg');
    expect(CHAT_TAB_CHANNELS as readonly string[]).not.toContain('whisper');
  });

  it('maps each channel to the slash prefix the sim/server parses', () => {
    // say is the engine default for unprefixed text
    expect(channelSendPrefix('say')).toBe('');
    expect(channelSendPrefix('yell')).toBe('/y ');
    expect(channelSendPrefix('party')).toBe('/p ');
    expect(channelSendPrefix('world')).toBe('/world ');
    expect(channelSendPrefix('lfg')).toBe('/lfg ');
    expect(channelSendPrefix('guild')).toBe('/gu ');
    expect(channelSendPrefix('officer')).toBe('/o ');
    // general must NOT be "/g " — the server routes /g to GUILD
    expect(channelSendPrefix('general')).toBe('/general ');
  });

  it('only world and lfg require an explicit /join', () => {
    expect(channelNeedsJoin('world')).toBe(true);
    expect(channelNeedsJoin('lfg')).toBe(true);
    expect(channelNeedsJoin('party')).toBe(false);
    expect(channelNeedsJoin('say')).toBe(false);
    expect(channelNeedsJoin('guild')).toBe(false);
  });

  describe('composeChatLine', () => {
    it('prepends the active channel prefix to plain text', () => {
      expect(composeChatLine('world', 'looking for healer')).toBe('/world looking for healer');
      expect(composeChatLine('party', 'pull on 3')).toBe('/p pull on 3');
    });

    it('sends plain text unprefixed for the say channel', () => {
      expect(composeChatLine('say', 'hello there')).toBe('hello there');
    });

    it('lets an explicit slash command win over the active channel', () => {
      // a whisper typed from the World tab must still whisper, not go to world
      expect(composeChatLine('world', '/w Bob meet me')).toBe('/w Bob meet me');
      expect(composeChatLine('lfg', '/p inc')).toBe('/p inc');
    });

    it('trims and drops empty input', () => {
      expect(composeChatLine('world', '   ')).toBe('');
      expect(composeChatLine('world', '  ping  ')).toBe('/world ping');
    });
  });

  describe('persistence', () => {
    it('round-trips a tab list', () => {
      const tabs = ['world', 'party', 'guild'] as const;
      expect(parseChatTabs(serializeChatTabs([...tabs]))).toEqual([...tabs]);
    });

    it('is defensive against corrupt, malformed, or forward-version blobs', () => {
      expect(parseChatTabs(null)).toEqual([]);
      expect(parseChatTabs('not json')).toEqual([]);
      expect(parseChatTabs('{"a":1}')).toEqual([]); // not an array
      // 'whisper' is a valid (filter-only) tab now; 'bogus'/42 are still dropped
      expect(parseChatTabs('["world","bogus","whisper",42]')).toEqual(['world', 'whisper']);
    });

    it('round-trips the whisper collector tab alongside channels', () => {
      expect(parseChatTabs(serializeChatTabs(['guild', WHISPER_TAB]))).toEqual([
        'guild',
        WHISPER_TAB,
      ]);
    });

    it('drops duplicate entries, keeping first occurrence order', () => {
      expect(parseChatTabs('["lfg","world","lfg"]')).toEqual(['lfg', 'world']);
    });
  });

  describe('whisper collector tab', () => {
    it('is not a send-capable channel, but is a valid open tab', () => {
      expect(isChatTabChannel(WHISPER_TAB)).toBe(false);
      expect(CHAT_TAB_CHANNELS as readonly string[]).not.toContain(WHISPER_TAB);
      expect(isChatOpenTab(WHISPER_TAB)).toBe(true);
      expect(isChatOpenTab('guild')).toBe(true);
      expect(isChatOpenTab('bogus')).toBe(false);
      expect(isChatOpenTab(42)).toBe(false);
    });

    it('captions itself with the existing Whisper label (no new i18n key)', () => {
      expect(chatOpenTabLabelKey(WHISPER_TAB)).toBe(WHISPER_TAB_LABEL_KEY);
      expect(chatOpenTabLabelKey(WHISPER_TAB)).toBe('hud.chat.context.whisper');
      expect(chatOpenTabLabelKey('party')).toBe('hud.core.chatChannels.names.party');
    });

    describe('composeWhisperReply', () => {
      it('defaults plain text to a reply to the last whisperer', () => {
        expect(composeWhisperReply('on my way')).toBe('/r on my way');
        expect(composeWhisperReply('  hi  ')).toBe('/r hi');
      });

      it('lets an explicit slash command win (whisper a different player)', () => {
        expect(composeWhisperReply('/w Bob meet me')).toBe('/w Bob meet me');
        expect(composeWhisperReply('/p inc')).toBe('/p inc');
      });

      it('drops empty input', () => {
        expect(composeWhisperReply('   ')).toBe('');
      });
    });
  });

  it('isChatTabChannel guards unknown values', () => {
    expect(isChatTabChannel('world')).toBe(true);
    expect(isChatTabChannel('whisper')).toBe(false);
    expect(isChatTabChannel('')).toBe(false);
    expect(isChatTabChannel(null)).toBe(false);
    expect(isChatTabChannel(7)).toBe(false);
  });
});
