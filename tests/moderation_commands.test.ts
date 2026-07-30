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

  it('parses jail visits and requires a sentence length on jail targets', () => {
    const invalid = { kind: 'jail', name: null, minutes: null, reason: null, malformed: true };
    expect(parseModerationChatCommand('/jail')).toEqual({
      kind: 'jail',
      name: null,
      minutes: null,
      reason: null,
      malformed: false,
    });
    expect(parseModerationChatCommand('/jail "Mira Sun" 10')).toEqual({
      kind: 'jail',
      name: 'Mira Sun',
      minutes: 10,
      reason: null,
      malformed: false,
    });
    // The reason rides after the minutes, bare or quoted.
    expect(parseModerationChatCommand('/jail "Mira Sun" 10 spamming chat')).toEqual({
      kind: 'jail',
      name: 'Mira Sun',
      minutes: 10,
      reason: 'spamming chat',
      malformed: false,
    });
    expect(parseModerationChatCommand('/jail "Mira Sun" 10 "the reason"')).toEqual({
      kind: 'jail',
      name: 'Mira Sun',
      minutes: 10,
      reason: 'the reason',
      malformed: false,
    });
    // No indefinite form: a name without minutes is malformed usage.
    expect(parseModerationChatCommand('/jail "Mira Sun"')).toEqual(invalid);
    expect(parseModerationChatCommand('/jail Mira Sun')).toEqual(invalid);
    // A zero, non-numeric, or absurd sentence is malformed usage too.
    expect(parseModerationChatCommand('/jail "Mira Sun" 0')).toEqual(invalid);
    expect(parseModerationChatCommand('/jail "Mira Sun" soon')).toEqual(invalid);
    expect(parseModerationChatCommand('/jail "Mira Sun" 99999999999')).toEqual(invalid);
    // A reason without minutes is malformed as well.
    expect(parseModerationChatCommand('/jail "Mira Sun" "the reason"')).toEqual(invalid);
    expect(parseModerationChatCommand('/unjail')).toEqual({
      kind: 'unjail',
      name: null,
      malformed: false,
    });
    expect(parseModerationChatCommand('/unjail "Mira Sun"')).toEqual({
      kind: 'unjail',
      name: 'Mira Sun',
      malformed: false,
    });
    expect(parseModerationChatCommand('/unjail "Mira Sun" trailing')).toEqual({
      kind: 'unjail',
      name: null,
      malformed: true,
    });
  });

  it('ignores unrelated commands and near misses', () => {
    expect(parseModerationChatCommand('/guild hello')).toBeNull();
    expect(parseModerationChatCommand('/kicker someone')).toBeNull();
    expect(parseModerationChatCommand('/suspender someone')).toBeNull();
    expect(parseModerationChatCommand('/spectator someone')).toBeNull();
    expect(parseModerationChatCommand('/unspectate now')).toBeNull();
    expect(parseModerationChatCommand('/jailer "Mira"')).toBeNull();
    expect(parseModerationChatCommand('hello /kick')).toBeNull();
  });
});
