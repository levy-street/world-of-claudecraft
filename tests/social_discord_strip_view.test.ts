// The Social window's Discord strip core (menu consolidation step 5: the
// Discord window's rail button and U key folded into a strip in Social).
import { describe, expect, it } from 'vitest';
import type { DiscordAccountStatus, DiscordPresenceState } from '../src/ui/discord_status';
import { buildSocialDiscordStrip } from '../src/ui/social_discord_strip_view';

const status = (over: Partial<DiscordAccountStatus> = {}): DiscordAccountStatus => ({
  linked: false,
  username: null,
  avatar: null,
  guildMember: false,
  points: 0,
  lifetimePoints: 0,
  statusTier: 0,
  claimedSwagIds: [],
  passwordSet: true,
  ...over,
});
const presence = (over: Partial<DiscordPresenceState> = {}): DiscordPresenceState => ({
  onlineCount: 12,
  memberTotal: 300,
  voiceChannelName: null,
  voice: [],
  ...over,
});

describe('buildSocialDiscordStrip', () => {
  it('is hidden on a build with no Discord entry', () => {
    expect(
      buildSocialDiscordStrip({ enabled: false, status: status(), presence: presence() }),
    ).toEqual({
      visible: false,
    });
  });

  it('names the linked account, or none when unlinked', () => {
    const linked = buildSocialDiscordStrip({
      enabled: true,
      status: status({ linked: true, username: 'aelric' }),
      presence: presence(),
    });
    expect(linked).toMatchObject({ visible: true, username: 'aelric', onlineCount: 12 });
    const unlinked = buildSocialDiscordStrip({
      enabled: true,
      status: status({ linked: false, username: 'stale' }),
      presence: presence(),
    });
    expect(unlinked).toMatchObject({ visible: true, username: null });
  });

  it('carries the featured voice room and its head count', () => {
    const strip = buildSocialDiscordStrip({
      enabled: true,
      status: status(),
      presence: presence({
        voiceChannelName: 'Vale Wardens',
        voice: [
          { id: 'a', name: 'A', speaking: false, selfMute: false },
          { id: 'b', name: 'B', speaking: true, selfMute: false },
        ],
      }),
    });
    expect(strip).toMatchObject({ voiceChannel: 'Vale Wardens', voiceCount: 2 });
  });
});
