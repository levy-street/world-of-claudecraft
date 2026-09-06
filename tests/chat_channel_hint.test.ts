import { describe, expect, it } from 'vitest';
import { chatChannelHint } from '../server/chat_channel_hint';

describe('chatChannelHint (the violation log channel label)', () => {
  it('reads the channel off the command prefix, long and short forms alike', () => {
    expect(chatChannelHint('say', '/g hello')).toBe('guild');
    expect(chatChannelHint('say', '/gu hello')).toBe('guild');
    expect(chatChannelHint('say', '/guild hello')).toBe('guild');
    expect(chatChannelHint('say', '/o hello')).toBe('officer');
    expect(chatChannelHint('say', '/officer hello')).toBe('officer');
    expect(chatChannelHint('say', '/w Bob hello')).toBe('whisper');
    expect(chatChannelHint('say', '/tell Bob hello')).toBe('whisper');
    expect(chatChannelHint('say', '/r hello')).toBe('whisper');
    expect(chatChannelHint('say', '/y hello')).toBe('yell');
    expect(chatChannelHint('say', '/p hello')).toBe('party');
    expect(chatChannelHint('say', '/general hello')).toBe('general');
    expect(chatChannelHint('say', '/world hello')).toBe('general');
    expect(chatChannelHint('party', '/s hello')).toBe('say');
  });

  it('is case-insensitive on the prefix and needs whitespace after it', () => {
    expect(chatChannelHint('say', '/GUILD hello')).toBe('guild');
    // "/guildmate" is not the guild command; nothing matched, so the
    // remembered channel wins.
    expect(chatChannelHint('say', '/guildmate hello')).toBe('say');
  });

  it('falls back to the remembered channel for plain text and unknown commands', () => {
    expect(chatChannelHint('party', 'hello there')).toBe('party');
    expect(chatChannelHint('guild', '/dance')).toBe('guild');
  });
});
