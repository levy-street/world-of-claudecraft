// The Discord REST payload coercers (src/ui/discord_status.ts, moved out of
// src/main.ts by the R11 monolith payment): /api/discord/status is untrusted
// JSON, so every field must validate structurally with an explicit default.
import { describe, expect, it } from 'vitest';
import { coerceDiscordPresence, coerceDiscordStatus } from '../src/ui/discord_status';

describe('coerceDiscordStatus', () => {
  it('passes a well-formed payload through intact', () => {
    expect(
      coerceDiscordStatus({
        linked: true,
        username: 'levy',
        avatar: 'https://cdn/x.png',
        guildMember: true,
        points: 12,
        lifetimePoints: 40,
        statusTier: 2,
        claimedSwagIds: ['cap', 'tee'],
        passwordSet: true,
      }),
    ).toEqual({
      linked: true,
      username: 'levy',
      avatar: 'https://cdn/x.png',
      guildMember: true,
      points: 12,
      lifetimePoints: 40,
      statusTier: 2,
      claimedSwagIds: ['cap', 'tee'],
      passwordSet: true,
    });
  });

  it('defaults every malformed field instead of trusting it', () => {
    expect(
      coerceDiscordStatus({
        linked: 'yes',
        username: 7,
        avatar: null,
        points: '12',
        claimedSwagIds: ['ok', 7, null],
      }),
    ).toEqual({
      linked: false,
      username: null,
      avatar: null,
      guildMember: false,
      points: 0,
      lifetimePoints: 0,
      statusTier: 0,
      claimedSwagIds: ['ok'],
      passwordSet: true,
    });
  });

  it('only an EXPLICIT passwordSet false marks the account passwordless', () => {
    expect(coerceDiscordStatus({}).passwordSet).toBe(true);
    expect(coerceDiscordStatus({ passwordSet: false }).passwordSet).toBe(false);
  });
});

describe('coerceDiscordPresence', () => {
  it('coerces the voice roster member-by-member', () => {
    expect(
      coerceDiscordPresence({
        onlineCount: 3,
        memberTotal: 90,
        voiceChannelName: 'raid',
        voice: [{ id: 'u1', name: 'Trev', speaking: true, selfMute: false }, 'garbage'],
      }),
    ).toEqual({
      onlineCount: 3,
      memberTotal: 90,
      voiceChannelName: 'raid',
      voice: [
        { id: 'u1', name: 'Trev', speaking: true, selfMute: false },
        { id: '', name: '', speaking: false, selfMute: false },
      ],
    });
  });

  it('a non-object payload yields the empty presence', () => {
    expect(coerceDiscordPresence(undefined)).toEqual({
      onlineCount: 0,
      memberTotal: 0,
      voiceChannelName: null,
      voice: [],
    });
  });
});
