import { describe, expect, it } from 'vitest';
import {
  MODERATION_COMMAND_MINUTES_MAX,
  MODERATION_COMMAND_REASON_MAX,
  parseModerationChatCommand,
} from '../server/moderation_commands';

describe('moderation chat commands', () => {
  it('parses reason-only commands and bounds their reasons', () => {
    expect(parseModerationChatCommand('  /kick   "Mira Sun" griefing in chat  ')).toEqual({
      kind: 'kick',
      name: 'Mira Sun',
      reason: 'griefing in chat',
    });
    expect(parseModerationChatCommand('/kill "Kael\'thas" spawn camping')).toEqual({
      kind: 'kill',
      name: "Kael'thas",
      reason: 'spawn camping',
    });
    expect(parseModerationChatCommand('/forcerename "Bad Name" offensive name')).toEqual({
      kind: 'forcerename',
      name: 'Bad Name',
      reason: 'offensive name',
    });
    expect(parseModerationChatCommand('/ban "Repeat" repeat offender')).toEqual({
      kind: 'ban',
      name: 'Repeat',
      reason: 'repeat offender',
    });
    expect(parseModerationChatCommand('/kick "Mira Sun"')).toEqual({
      kind: 'kick',
      name: 'Mira Sun',
      reason: 'No reason specified',
    });
    expect(parseModerationChatCommand('/ban "Repeat"')).toEqual({
      kind: 'ban',
      name: 'Repeat',
      reason: 'No reason specified',
    });
    const bounded = parseModerationChatCommand(`/kick "Mira Sun" ${'x'.repeat(800)}`);
    expect(bounded?.kind).toBe('kick');
    expect(bounded && 'reason' in bounded ? bounded.reason : '').toHaveLength(
      MODERATION_COMMAND_REASON_MAX,
    );
  });

  it('parses timed commands and preserves invalid durations for policy validation', () => {
    expect(parseModerationChatCommand('/mute "Mira Sun" 5 spamming the market')).toEqual({
      kind: 'mute',
      name: 'Mira Sun',
      minutes: 5,
      reason: 'spamming the market',
    });
    expect(parseModerationChatCommand('/mute "Mira Sun" 5')).toEqual({
      kind: 'mute',
      name: 'Mira Sun',
      minutes: 5,
      reason: 'No reason specified',
    });
    expect(parseModerationChatCommand('  /suspend "Mira Sun"  60   cheating ')).toEqual({
      kind: 'suspend',
      name: 'Mira Sun',
      minutes: 60,
      reason: 'cheating',
    });
    expect(parseModerationChatCommand('/mute "Mira Sun" abc spamming')).toEqual({
      kind: 'mute',
      name: 'Mira Sun',
      minutes: null,
      reason: 'spamming',
    });
    expect(parseModerationChatCommand('/suspend "Mira Sun" 0 cheating')).toEqual({
      kind: 'suspend',
      name: 'Mira Sun',
      minutes: null,
      reason: 'cheating',
    });
    expect(
      parseModerationChatCommand(
        `/suspend "Mira Sun" ${MODERATION_COMMAND_MINUTES_MAX + 1} cheating`,
      ),
    ).toEqual({
      kind: 'suspend',
      name: 'Mira Sun',
      minutes: null,
      reason: 'cheating',
    });
  });

  it('rejects unquoted moderation targets without falling back to selected-target syntax', () => {
    expect(parseModerationChatCommand('/kick griefing in chat')).toEqual({
      kind: 'kick',
      name: null,
      reason: 'No reason specified',
    });
    expect(parseModerationChatCommand('/kill "Mira Sun')).toEqual({
      kind: 'kill',
      name: null,
      reason: 'No reason specified',
    });
    expect(parseModerationChatCommand('/ban "" reason')).toEqual({
      kind: 'ban',
      name: null,
      reason: 'reason',
    });
    expect(parseModerationChatCommand('/mute 5 spamming')).toEqual({
      kind: 'mute',
      name: null,
      minutes: null,
      reason: 'No reason specified',
    });
  });

  it('parses quoted and legacy unquoted spectate targets', () => {
    expect(parseModerationChatCommand('/spectate Mira')).toEqual({
      kind: 'spectate',
      name: 'Mira',
    });
    expect(parseModerationChatCommand(' /SpEcTaTe   Mira Sun ')).toEqual({
      kind: 'spectate',
      name: 'Mira Sun',
    });
    expect(parseModerationChatCommand(' /spectate   "Mira   Sun" ')).toEqual({
      kind: 'spectate',
      name: 'Mira Sun',
    });
    expect(parseModerationChatCommand('/spectate "Mira Sun" trailing')).toEqual({
      kind: 'spectate',
      name: null,
    });
    expect(parseModerationChatCommand('/spectate')).toEqual({ kind: 'spectate', name: null });
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
