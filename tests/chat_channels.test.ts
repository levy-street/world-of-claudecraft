import { describe, expect, it } from 'vitest';
import {
  CHAT_TAB_CHANNELS,
  channelNeedsJoin,
  channelSendPrefix,
  chatChannelColor,
  chatInputTint,
  chatOpenTabLabelKey,
  composeChatLine,
  composeWhisperReply,
  isChatOpenTab,
  isChatTabChannel,
  parseChatTabs,
  sentLineChannel,
  sentLineTarget,
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
    // say is explicit so the online server clears any remembered whisper/guild mode
    expect(channelSendPrefix('say')).toBe('/say ');
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

    it('sends plain text with an explicit /say prefix for the say channel', () => {
      expect(composeChatLine('say', 'hello there')).toBe('/say hello there');
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

  describe('per-channel colors (single source of truth for log + input)', () => {
    it('colors each log channel, sharing the same table the input tint reads', () => {
      // The chat log switch in hud.ts derives its line color from this table, so
      // the input tint and the log line always agree for a given channel.
      expect(chatChannelColor('party')).toBe('#7fd4ff');
      expect(chatChannelColor('yell')).toBe('#ff5040');
      expect(chatChannelColor('whisper')).toBe('#ff80ff');
      expect(chatChannelColor('general')).toBe('#ffc864');
      expect(chatChannelColor('world')).toBe('#ff9d5c');
      expect(chatChannelColor('lfg')).toBe('#5cd6a0');
      expect(chatChannelColor('guild')).toBe('#40d264');
      expect(chatChannelColor('officer')).toBe('#4ce0c0');
      expect(chatChannelColor('emote')).toBe('#ff8040');
      expect(chatChannelColor('roll')).toBe('#ffd100');
      expect(chatChannelColor('say')).toBe('#f0ead8');
    });

    it('falls back to the neutral say color for an unknown channel', () => {
      // mirrors the chat switch's historical default arm
      expect(chatChannelColor('bogus')).toBe('#f0ead8');
      expect(chatChannelColor('')).toBe('#f0ead8');
    });
  });

  describe('chatInputTint (channel -> input tint)', () => {
    it('tints the input to a non-say channel color', () => {
      expect(chatInputTint('party')).toBe('#7fd4ff');
      expect(chatInputTint('guild')).toBe('#40d264');
      expect(chatInputTint('world')).toBe('#ff9d5c');
      // the whisper collector tab: plain text replies as a whisper
      expect(chatInputTint(WHISPER_TAB)).toBe('#ff80ff');
    });

    it('keeps the default input color for say and for no channel', () => {
      expect(chatInputTint('say')).toBeNull();
      expect(chatInputTint(null)).toBeNull();
    });

    it('agrees with the log line color for every send channel it tints', () => {
      for (const ch of CHAT_TAB_CHANNELS) {
        const tint = chatInputTint(ch);
        if (ch === 'say') expect(tint).toBeNull();
        else expect(tint).toBe(chatChannelColor(ch));
      }
    });
  });

  describe('sentLineChannel (the standing channel a sent line reached)', () => {
    it('treats plain text (no leading slash) as say', () => {
      expect(sentLineChannel('hello there')).toBe('say');
      expect(sentLineChannel('  hi  ')).toBe('say');
    });

    it('maps the canonical channel prefixes composeChatLine prepends', () => {
      expect(sentLineChannel('/p pull on 3')).toBe('party');
      expect(sentLineChannel('/y RUN')).toBe('yell');
      expect(sentLineChannel('/gu hello guild')).toBe('guild');
      expect(sentLineChannel('/o officers only')).toBe('officer');
      expect(sentLineChannel('/general anyone on?')).toBe('general');
      expect(sentLineChannel('/world lf tank')).toBe('world');
      expect(sentLineChannel('/lfg need heals')).toBe('lfg');
    });

    it('also recognizes the long-form aliases a player may type explicitly', () => {
      expect(sentLineChannel('/party inc')).toBe('party');
      expect(sentLineChannel('/yell look out')).toBe('yell');
      expect(sentLineChannel('/say for the horde')).toBe('say');
      expect(sentLineChannel('/guild raid tonight')).toBe('guild');
      expect(sentLineChannel('/officer promo?')).toBe('officer');
    });

    it('leaves the sticky channel unchanged for whisper, reply, emotes, rolls, and unknowns', () => {
      // whisper / reply target a specific player, not a standing channel
      expect(sentLineChannel('/w Bob meet me')).toBeNull();
      expect(sentLineChannel('/r on my way')).toBeNull();
      // emotes, rolls, membership, and unknown commands never become sticky
      expect(sentLineChannel('/me ponders the void')).toBeNull();
      expect(sentLineChannel('/dance')).toBeNull();
      expect(sentLineChannel('/roll 100')).toBeNull();
      expect(sentLineChannel('/join world')).toBeNull();
      expect(sentLineChannel('/foobar baz')).toBeNull();
      expect(sentLineChannel('')).toBeNull();
    });

    it('never maps the host-ambiguous bare /g (say offline, guild online)', () => {
      // composeChatLine only ever emits /general for the general channel, and /g is
      // routed differently offline vs online, so it must not move the sticky channel.
      expect(sentLineChannel('/g hi')).toBeNull();
    });
  });

  describe('sticky-channel switch flow (send -> sticky -> compose + tint)', () => {
    // Models the Hud's sticky-channel state with the pure primitives: on the All
    // tab the effective send channel is the sticky one, plain text is composed for
    // it, and the input tints to its color until the channel changes.
    const effectiveOnAllTab = (sticky: string): string => sticky; // All tab: no bound channel

    it('defaults to say (no tint, plain text) before anything is sent', () => {
      const sticky = 'say';
      const ch = effectiveOnAllTab(sticky);
      expect(composeChatLine(ch as 'say', 'hi')).toBe('/say hi');
      expect(chatInputTint(ch as 'say')).toBeNull();
      expect(sticky).toBe('say');
    });

    it('sends /p, then defaults the next All-tab open to party until it changes', () => {
      let sticky = 'say';
      // player types "/p hello" on the All tab and hits enter
      const sent = composeChatLine('say', '/p hello'); // explicit command wins over say
      expect(sent).toBe('/p hello');
      const reached = sentLineChannel(sent);
      if (reached) sticky = reached;
      expect(sticky).toBe('party');

      // reopen on the All tab: plain text now goes to party and the input tints blue
      const ch = effectiveOnAllTab(sticky);
      expect(composeChatLine(ch as 'party', 'gg team')).toBe('/p gg team');
      expect(chatInputTint(ch as 'party')).toBe('#7fd4ff');

      // switching to an explicit /gu send moves the sticky channel to guild
      const guildSent = composeChatLine(ch as 'party', '/gu ready'); // command wins
      expect(guildSent).toBe('/gu ready');
      const guildReached = sentLineChannel(guildSent);
      if (guildReached) sticky = guildReached;
      expect(sticky).toBe('guild');
      expect(chatInputTint(effectiveOnAllTab(sticky) as 'guild')).toBe('#40d264');
    });

    it('a whisper reply does not disturb the sticky channel', () => {
      let sticky = 'party';
      const sent = composeWhisperReply('brb'); // "/r brb"
      const reached = sentLineChannel(sent);
      if (reached) sticky = reached;
      expect(sticky).toBe('party'); // unchanged
    });
  });

  it('isChatTabChannel guards unknown values', () => {
    expect(isChatTabChannel('world')).toBe(true);
    expect(isChatTabChannel('whisper')).toBe(false);
    expect(isChatTabChannel('')).toBe(false);
    expect(isChatTabChannel(null)).toBe(false);
    expect(isChatTabChannel(7)).toBe(false);
  });

  it('passes a "!" community command through untouched (never wraps it in a channel prefix)', () => {
    // The v0.26.0 regression prefixed non-slash lines, so "!lfg ..." became
    // "/say !lfg ..." and the server "!" relay gate (text.startsWith("!")) missed it.
    expect(composeChatLine('party', '!lfg need a healer')).toBe('!lfg need a healer');
    expect(composeChatLine('say', '!events raid at the fountain')).toBe(
      '!events raid at the fountain',
    );
    // A plain line still gets the channel prefix; an explicit slash still wins.
    expect(composeChatLine('party', 'hello')).toBe('/p hello');
    expect(composeChatLine('party', '/w Bob hi')).toBe('/w Bob hi');
  });

  it('a "!" community command is transient: it never resets the sticky channel to say', () => {
    // noteSentChannel runs on every send; if a "!" line mapped like plain text
    // it would return 'say' and firing "!lfg ..." mid-conversation would drop
    // your NEXT plain line from party/general to say. It stays null, like the
    // other transient commands (whispers, emotes, rolls).
    expect(sentLineTarget('!lfg need a healer')).toBeNull();
    expect(sentLineChannel('!events raid at the fountain')).toBeNull();
  });

  it('sentLineChannel maps the /1 shortcut to General (but never /g, which is guild online)', () => {
    expect(sentLineChannel('/1 hey everyone')).toBe('general');
    expect(sentLineChannel('/general hey everyone')).toBe('general');
    expect(sentLineChannel('/p on my way')).toBe('party');
    expect(sentLineChannel('/w Bob hi')).toBeNull();
    expect(sentLineChannel('/r sure')).toBeNull();
  });

  it('sentLineTarget also sticks to whisper after a /r reply, so the input keeps replying', () => {
    expect(sentLineTarget('/r sure thing')).toBe(WHISPER_TAB);
    expect(sentLineTarget('/reply ok')).toBe(WHISPER_TAB);
    // An explicit one-off "/w Name" does NOT stick (its next reply would target the
    // wrong person); standing channels still carry through, including /1 -> general.
    expect(sentLineTarget('/w Bob hi')).toBeNull();
    expect(sentLineTarget('/1 hey')).toBe('general');
    expect(sentLineTarget('/p on my way')).toBe('party');
    expect(sentLineTarget('hello')).toBe('say');
  });
});
