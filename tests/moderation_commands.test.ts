import { describe, expect, it } from 'vitest';
import {
  MODERATION_COMMAND_MINUTES_MAX,
  MODERATION_COMMAND_REASON_MAX,
  parseModerationChatCommand,
} from '../server/moderation_commands';

describe('moderation chat commands', () => {
  it('parses reason-only commands and bounds their reasons', () => {
    expect(parseModerationChatCommand('  /kick   griefing in chat  ')).toEqual({
      kind: 'kick',
      reason: 'griefing in chat',
    });
    expect(parseModerationChatCommand('/kill spawn camping')).toEqual({
      kind: 'kill',
      reason: 'spawn camping',
    });
    expect(parseModerationChatCommand('/forcerename offensive name')).toEqual({
      kind: 'forcerename',
      reason: 'offensive name',
    });
    expect(parseModerationChatCommand('/ban repeat offender')).toEqual({
      kind: 'ban',
      reason: 'repeat offender',
    });
    expect(parseModerationChatCommand('/kick')).toEqual({
      kind: 'kick',
      reason: 'No reason specified',
    });
    expect(parseModerationChatCommand('/ban')).toEqual({
      kind: 'ban',
      reason: 'No reason specified',
    });
    const bounded = parseModerationChatCommand(`/kick ${'x'.repeat(800)}`);
    expect(bounded?.kind).toBe('kick');
    expect(bounded && 'reason' in bounded ? bounded.reason : '').toHaveLength(
      MODERATION_COMMAND_REASON_MAX,
    );
  });

  it('parses timed commands and preserves invalid durations for policy validation', () => {
    expect(parseModerationChatCommand('/mute 5 spamming the market')).toEqual({
      kind: 'mute',
      minutes: 5,
      reason: 'spamming the market',
    });
    expect(parseModerationChatCommand('  /suspend  60   cheating ')).toEqual({
      kind: 'suspend',
      minutes: 60,
      reason: 'cheating',
    });
    expect(parseModerationChatCommand('/mute abc spamming')).toEqual({
      kind: 'mute',
      minutes: null,
      reason: 'spamming',
    });
    expect(parseModerationChatCommand('/suspend 0 cheating')).toEqual({
      kind: 'suspend',
      minutes: null,
      reason: 'cheating',
    });
    expect(
      parseModerationChatCommand(`/suspend ${MODERATION_COMMAND_MINUTES_MAX + 1} cheating`),
    ).toEqual({
      kind: 'suspend',
      minutes: null,
      reason: 'cheating',
    });
  });

  it('parses spectate commands including an empty target', () => {
    expect(parseModerationChatCommand('/spectate Mira')).toEqual({
      kind: 'spectate',
      name: 'Mira',
    });
    expect(parseModerationChatCommand(' /SpEcTaTe   Mira Sun ')).toEqual({
      kind: 'spectate',
      name: 'Mira Sun',
    });
    expect(parseModerationChatCommand('/spectate')).toEqual({ kind: 'spectate', name: '' });
    expect(parseModerationChatCommand('/unspectate')).toEqual({ kind: 'unspectate' });
  });

  it('ignores unrelated commands and near misses', () => {
    expect(parseModerationChatCommand('/guild hello')).toBeNull();
    expect(parseModerationChatCommand('/kicker someone')).toBeNull();
    expect(parseModerationChatCommand('/suspender someone')).toBeNull();
    expect(parseModerationChatCommand('/spectator someone')).toBeNull();
    expect(parseModerationChatCommand('/unspectate now')).toBeNull();
    expect(parseModerationChatCommand('hello /kick')).toBeNull();
  });
});
