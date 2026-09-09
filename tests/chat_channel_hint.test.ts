// server/chat_channel_hint.ts: the best-effort channel label the chat-filter
// violation log records. Extracted from server/game.ts at Masterwrought phase
// 18, which is what makes these cases possible at all: as a private helper
// taking the whole ClientSession it needed a GameServer to drive, so no suite
// covered its seven prefix rules or the fallback, and the log could have been
// mislabelling a channel for as long as it has existed.
//
// Every prefix in the real table gets a case (a rule the extraction dropped
// would otherwise silently fall through to the fallback and look correct), and
// the fallback is asserted with a value no rule can produce.
import { describe, expect, it } from 'vitest';
import { chatChannelHint } from '../server/chat_channel_hint';

const FALLBACK = 'remembered-channel-sentinel';

describe('chatChannelHint: the command prefix decides the label', () => {
  // One row per ALIAS the regexes accept, not one per channel: the aliases are
  // the part a reword can quietly drop, and they are what players actually
  // type. Driven from a table so a new alias is one row.
  const cases: [string, string][] = [
    ['/g hello', 'guild'],
    ['/gu hello', 'guild'],
    ['/guild hello', 'guild'],
    ['/o hello', 'officer'],
    ['/officer hello', 'officer'],
    ['/w Aleph hello', 'whisper'],
    ['/whisper Aleph hello', 'whisper'],
    ['/t Aleph hello', 'whisper'],
    ['/tell Aleph hello', 'whisper'],
    ['/r hello', 'whisper'],
    ['/reply hello', 'whisper'],
    ['/y hello', 'yell'],
    ['/yell hello', 'yell'],
    ['/p hello', 'party'],
    ['/party hello', 'party'],
    ['/general hello', 'general'],
    ['/world hello', 'general'],
    ['/s hello', 'say'],
    ['/say hello', 'say'],
  ];

  it.each(cases)('%s labels as %s', (text, expected) => {
    expect(chatChannelHint(text, FALLBACK)).toBe(expected);
  });

  it('matches case-insensitively, the way the real regexes are written', () => {
    expect(chatChannelHint('/GUILD hello', FALLBACK)).toBe('guild');
    expect(chatChannelHint('/Whisper Aleph hello', FALLBACK)).toBe('whisper');
  });

  it('falls back to the caller-supplied channel when no prefix matches', () => {
    // The sentinel can be produced by no rule, so a rule accidentally matching
    // everything would fail here rather than pass by coincidence.
    for (const text of [
      'just talking',
      '',
      '/unknowncommand hello',
      // The trailing \s is load-bearing in every rule: a bare command with no
      // message is not a routed line, so it falls back.
      '/guild',
      '/say',
      // A prefix must START the line; a quoted one mid-sentence is ordinary text.
      'he said /guild hello',
    ]) {
      expect(chatChannelHint(text, FALLBACK), text).toBe(FALLBACK);
    }
  });

  it('the earlier rule wins where two could match (first match, in table order)', () => {
    // '/g ' is guild and '/general ' is general: the guild rule is written
    // first and is anchored on the alias plus whitespace, so '/general x'
    // cannot be swallowed by it. Pins the ordering the extraction preserved.
    expect(chatChannelHint('/general x', FALLBACK)).toBe('general');
    expect(chatChannelHint('/g x', FALLBACK)).toBe('guild');
  });
});
