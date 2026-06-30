import { describe, expect, it } from 'vitest';
import type { DiscordAccountStatus, DiscordPresenceState } from '../src/ui/discord_status';
import { buildDiscordWidgetView } from '../src/ui/discord_widget_view';

const UNLINKED: DiscordAccountStatus = {
  linked: false,
  username: null,
  avatar: null,
  guildMember: false,
  points: 0,
  lifetimePoints: 0,
  statusTier: 0,
  claimedSwagIds: [],
};

const NO_PRESENCE: DiscordPresenceState = {
  onlineCount: 0,
  memberTotal: 0,
  voiceChannelName: null,
  voice: [],
};

function linked(over: Partial<DiscordAccountStatus> = {}): DiscordAccountStatus {
  return { ...UNLINKED, linked: true, username: 'maxp', guildMember: true, statusTier: 1, ...over };
}

describe('avatar + character profile link', () => {
  it('passes the Discord avatar through and builds a character profile URL when linked', () => {
    const v = buildDiscordWidgetView({
      enabled: true,
      status: linked({ avatar: 'https://cdn.discordapp.com/avatars/1/abc.png' }),
      presence: NO_PRESENCE,
      inviteUrl: 'u',
      characterName: 'Aldric',
      origin: 'https://woc',
    });
    expect(v.avatar).toBe('https://cdn.discordapp.com/avatars/1/abc.png');
    expect(v.characterName).toBe('Aldric');
    expect(v.characterUrl).toBe('https://woc/c/Aldric');
  });

  it('has no character link when unlinked or no character name', () => {
    expect(
      buildDiscordWidgetView({
        enabled: true,
        status: UNLINKED,
        presence: NO_PRESENCE,
        inviteUrl: 'u',
        characterName: 'Aldric',
      }).characterUrl,
    ).toBeNull();
    expect(
      buildDiscordWidgetView({
        enabled: true,
        status: linked(),
        presence: NO_PRESENCE,
        inviteUrl: 'u',
      }).characterUrl,
    ).toBeNull();
  });

  it('url-encodes the character name', () => {
    const v = buildDiscordWidgetView({
      enabled: true,
      status: linked(),
      presence: NO_PRESENCE,
      inviteUrl: 'u',
      characterName: 'Sir Lancelot',
      origin: 'https://woc',
    });
    expect(v.characterUrl).toBe('https://woc/c/Sir%20Lancelot');
  });
});

describe('buildDiscordWidgetView modes', () => {
  it('is disabled when the feature flag is off', () => {
    const v = buildDiscordWidgetView({
      enabled: false,
      status: linked(),
      presence: NO_PRESENCE,
      inviteUrl: 'u',
    });
    expect(v.mode).toBe('disabled');
  });

  it('is unlinked when enabled but no account link', () => {
    const v = buildDiscordWidgetView({
      enabled: true,
      status: UNLINKED,
      presence: NO_PRESENCE,
      inviteUrl: 'u',
    });
    expect(v.mode).toBe('unlinked');
    expect(v.swag).toEqual([]);
    expect(v.pointsToNext).toBeNull();
  });

  it('is linked and surfaces points/tier when linked', () => {
    const v = buildDiscordWidgetView({
      enabled: true,
      status: linked({ points: 1_500, lifetimePoints: 2_500, statusTier: 4 }),
      presence: NO_PRESENCE,
      inviteUrl: 'u',
    });
    expect(v.mode).toBe('linked');
    expect(v.points).toBe(1_500);
    expect(v.tierIndex).toBe(4);
    expect(v.pointsToNext).toBe(2_500); // 2500 lifetime -> champion at 5000
    expect(v.swag.length).toBeGreaterThan(0);
  });
});

describe('join CTA + presence', () => {
  it('shows the join nudge only when linked and not a guild member', () => {
    expect(
      buildDiscordWidgetView({
        enabled: true,
        status: linked({ guildMember: false }),
        presence: NO_PRESENCE,
        inviteUrl: 'u',
      }).showJoinCta,
    ).toBe(true);
    expect(
      buildDiscordWidgetView({
        enabled: true,
        status: linked({ guildMember: true }),
        presence: NO_PRESENCE,
        inviteUrl: 'u',
      }).showJoinCta,
    ).toBe(false);
    expect(
      buildDiscordWidgetView({
        enabled: true,
        status: UNLINKED,
        presence: NO_PRESENCE,
        inviteUrl: 'u',
      }).showJoinCta,
    ).toBe(false);
  });

  it('passes presence + voice through and clamps a negative online count', () => {
    const presence: DiscordPresenceState = {
      onlineCount: -3,
      memberTotal: 42,
      voiceChannelName: 'The Tavern',
      voice: [{ id: '1', name: 'Aldric', speaking: true, selfMute: false }],
    };
    const v = buildDiscordWidgetView({ enabled: true, status: linked(), presence, inviteUrl: 'u' });
    expect(v.onlineCount).toBe(0);
    expect(v.voiceChannelName).toBe('The Tavern');
    expect(v.voice).toHaveLength(1);
  });
});

describe('swag claimability', () => {
  it('counts claimable rows for the widget badge', () => {
    // Champion tier (5) + plenty of points: the free title and several others claimable.
    const v = buildDiscordWidgetView({
      enabled: true,
      status: linked({ points: 10_000, lifetimePoints: 10_000, statusTier: 5, claimedSwagIds: [] }),
      presence: NO_PRESENCE,
      inviteUrl: 'u',
    });
    expect(v.claimableCount).toBeGreaterThan(0);
    expect(v.claimableCount).toBe(v.swag.filter((s) => s.claimable).length);
  });

  it('marks already-claimed swag as claimed and not claimable', () => {
    const v = buildDiscordWidgetView({
      enabled: true,
      status: linked({
        points: 10_000,
        lifetimePoints: 10_000,
        statusTier: 5,
        claimedSwagIds: ['title_discordian'],
      }),
      presence: NO_PRESENCE,
      inviteUrl: 'u',
    });
    const row = v.swag.find((s) => s.id === 'title_discordian')!;
    expect(row.claimed).toBe(true);
    expect(row.claimable).toBe(false);
    expect(row.reason).toBe('claimed');
  });
});
