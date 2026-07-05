import { describe, expect, it } from 'vitest';
import {
  type ActivityItem,
  allTierRoleNames,
  buildActivityMessage,
  buildDailyRewardWinnersMessage,
  buildLevelNick,
  buildLinkContent,
  buildRelayMessage,
  buildWelcomeMessage,
  buildWhoamiContent,
  computeRoleSync,
  GATEWAY_INTENTS,
  heartbeatIntervalMs,
  identifyPayload,
  isSlashCommand,
  levelNickSuffix,
  NICK_MAX,
  type RelayItem,
  relayAvatarUrl,
  relayRespondUrl,
  tierRoleName,
  voiceMembersForChannel,
} from '../bot/logic';

describe('gateway protocol helpers', () => {
  it('requests the privileged member + presence intents', () => {
    // GUILDS(1) | GUILD_MEMBERS(2) | GUILD_VOICE_STATES(128) | GUILD_PRESENCES(256)
    expect(GATEWAY_INTENTS).toBe(1 | 2 | 128 | 256 | 512); // + GUILD_MESSAGES (512)
    expect(identifyPayload('tok').d).toMatchObject({ token: 'tok', intents: GATEWAY_INTENTS });
  });

  it('reads the heartbeat interval with a sane floor + default', () => {
    expect(heartbeatIntervalMs({ d: { heartbeat_interval: 41250 } })).toBe(41250);
    expect(heartbeatIntervalMs({ d: { heartbeat_interval: 10 } })).toBe(1000); // floored
    expect(heartbeatIntervalMs({})).toBe(41250); // default
  });
});

describe('status-tier roles', () => {
  it('names roles "WoC <Tier>" per rung', () => {
    expect(tierRoleName(1)).toBe('WoC Initiate');
    expect(tierRoleName(8)).toBe('WoC Mythic');
    expect(tierRoleName(0)).toBeNull();
    expect(allTierRoleNames()).toHaveLength(8);
  });

  it('assigns the current rung role and removes other rung roles', () => {
    const tierRoleIds = new Map<number, string>([
      [1, 'r1'],
      [4, 'r4'],
      [5, 'r5'],
    ]);
    // Member is champion (5) but currently holds the knight (r4) role + a non-WoC role.
    const { toAdd, toRemove } = computeRoleSync({
      tier: 5,
      memberRoleIds: ['r4', 'other'],
      tierRoleIds,
    });
    expect(toAdd).toEqual(['r5']);
    expect(toRemove).toEqual(['r4']); // sheds the stale rung role, keeps 'other'
  });

  it('removes all rung roles when the member is unranked (tier 0)', () => {
    const tierRoleIds = new Map<number, string>([
      [1, 'r1'],
      [4, 'r4'],
    ]);
    const { toAdd, toRemove } = computeRoleSync({ tier: 0, memberRoleIds: ['r4'], tierRoleIds });
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual(['r4']);
  });

  it('is a no-op when the member already holds exactly the right role', () => {
    const tierRoleIds = new Map<number, string>([[5, 'r5']]);
    expect(computeRoleSync({ tier: 5, memberRoleIds: ['r5', 'x'], tierRoleIds })).toEqual({
      toAdd: [],
      toRemove: [],
    });
  });
});

describe('slash commands + messages', () => {
  it('recognizes its slash commands', () => {
    expect(isSlashCommand('whoami')).toBe(true);
    expect(isSlashCommand('link')).toBe(true);
    expect(isSlashCommand('flex')).toBe(false); // removed
    expect(isSlashCommand('nuke')).toBe(false);
  });

  it('builds whoami + link + welcome text', () => {
    expect(
      buildWhoamiContent({ linked: false, statusTier: 0, points: 0, lifetimePoints: 0 }),
    ).toContain('/link');
    expect(
      buildWhoamiContent({ linked: true, statusTier: 5, points: 100, lifetimePoints: 5000 }),
    ).toContain('Champion');
    expect(buildLinkContent('https://woc')).toContain('https://woc');
    expect(buildWelcomeMessage({ userMention: '<@1>', gameUrl: 'https://woc' })).toContain('<@1>');
  });
});

describe('level-on-name nickname', () => {
  it('appends a class icon + level to the base name', () => {
    expect(buildLevelNick('Aldric', 20, 'warrior')).toBe('Aldric ⚔20');
    expect(buildLevelNick('Mira', 7, 'mage')).toBe('Mira 🔮7');
    expect(levelNickSuffix(12, 'hunter')).toBe(' 🏹12');
  });

  it('handles an unknown class with no emoji', () => {
    expect(buildLevelNick('Bob', 5, 'unknown')).toBe('Bob 5');
  });

  it('caps at the Discord 32-char nickname limit without splitting an emoji', () => {
    const nick = buildLevelNick('A'.repeat(40), 20, 'warrior');
    expect([...nick].length).toBeLessThanOrEqual(NICK_MAX);
    expect(nick.endsWith('⚔20')).toBe(true);
  });

  it('is idempotent when built from the same stable base', () => {
    expect(buildLevelNick('Aldric', 20, 'warrior')).toBe(buildLevelNick('Aldric', 20, 'warrior'));
  });
});

describe('voice presence shaping', () => {
  it('keeps only members in the featured channel and resolves names', () => {
    const states = [
      { userId: 'a', channelId: 'voice1', selfMute: false },
      { userId: 'b', channelId: 'voice2', selfMute: true },
      { userId: 'c', channelId: 'voice1', selfMute: true },
    ];
    const names: Record<string, string> = { a: 'Aldric', c: 'Mira' };
    const out = voiceMembersForChannel(states, 'voice1', (id) => names[id] ?? '?');
    expect(out).toEqual([
      { id: 'a', name: 'Aldric', speaking: false, selfMute: false },
      { id: 'c', name: 'Mira', speaking: false, selfMute: true },
    ]);
  });
});

describe('relay (in-game "!" community posts)', () => {
  const baseItem: RelayItem = {
    commandId: 'lfg',
    tag: 'LFG',
    label: 'Looking for Group',
    color: 0x5865f2,
    characterName: 'Aldric',
    level: 12,
    className: 'Hunter',
    realm: 'Claudemoon',
    zone: 'Eastbrook Vale',
    message: 'need a healer for Cragmaw Crypt',
    profileUrl: 'https://woc.test/c/Aldric',
    discordUserId: '123',
    discordUsername: 'zj',
    discordAvatar: 'abc',
  };

  it('builds the game deep-link respond url with the command', () => {
    expect(relayRespondUrl('https://woc.test', 'Aldric', 'lfg')).toBe(
      'https://woc.test/?lfg=Aldric&c=lfg',
    );
    expect(relayRespondUrl('https://woc.test/', 'Al Dric', 'wts')).toBe(
      'https://woc.test/?lfg=Al%20Dric&c=wts',
    );
  });

  it('builds the avatar CDN url, or null without an avatar', () => {
    expect(relayAvatarUrl('123', 'abc')).toBe(
      'https://cdn.discordapp.com/avatars/123/abc.png?size=128',
    );
    expect(relayAvatarUrl('123', 'a_anim')).toContain('.gif');
    expect(relayAvatarUrl('123', null)).toBeNull();
    expect(relayAvatarUrl(null, 'abc')).toBeNull();
  });

  it('mentions the issuer, shows identity/location, and adds a deep-link button', () => {
    const msg = buildRelayMessage(baseItem, 'https://woc.test') as {
      content: string;
      allowed_mentions: { users: string[] };
      embeds: Array<Record<string, any>>;
      components: Array<Record<string, any>>;
    };
    expect(msg.content).toBe('<@123>');
    expect(msg.allowed_mentions).toEqual({ users: ['123'] });
    const embed = msg.embeds[0];
    expect(embed.author.name).toBe('zj - LFG');
    expect(embed.author.icon_url).toContain('/avatars/123/abc');
    expect(embed.thumbnail.url).toContain('/avatars/123/abc');
    expect(embed.description).toBe('need a healer for Cragmaw Crypt');
    expect(embed.fields).toEqual([
      { name: 'Character', value: 'Aldric - Level 12 Hunter', inline: true },
      { name: 'Location', value: 'Eastbrook Vale (Claudemoon)', inline: true },
    ]);
    const button = msg.components[0].components[0];
    expect(button.style).toBe(5); // link button
    expect(button.url).toBe('https://woc.test/?lfg=Aldric&c=lfg');
    expect(button.label).toBe('Respond to Aldric');
  });

  it('falls back to no ping + character name when Discord is not linked', () => {
    const msg = buildRelayMessage(
      { ...baseItem, discordUserId: null, discordUsername: null, discordAvatar: null },
      'https://woc.test',
    ) as { content?: string; allowed_mentions: unknown; embeds: Array<Record<string, any>> };
    expect(msg.content).toBeUndefined();
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.embeds[0].author.name).toBe('Aldric - LFG');
    expect(msg.embeds[0].author.icon_url).toBeUndefined();
    expect(msg.embeds[0].thumbnail).toBeUndefined();
  });
});

describe('significant-activity cards', () => {
  const linked = (name: string, id: string): ActivityItem['participants'][number] => ({
    name,
    discordUserId: id,
    discordAvatar: 'abc',
  });

  it('level-20 card pings the subject and shows the cap', () => {
    const msg = buildActivityMessage({
      kind: 'levelup',
      realm: 'Claudemoon',
      profileUrl: 'https://woc.test/c/Aldric',
      level: 20,
      participants: [linked('Aldric', '111')],
    }) as {
      content: string;
      allowed_mentions: { users: string[] };
      embeds: Array<Record<string, any>>;
    };
    expect(msg.content).toBe('<@111>');
    expect(msg.allowed_mentions).toEqual({ users: ['111'] });
    expect(msg.embeds[0].title).toContain('level 20');
    expect(msg.embeds[0].description).toContain('<@111>');
    expect(msg.embeds[0].thumbnail.url).toContain('/avatars/111/abc');
  });

  it('rare-loot card uses the quality color and names the item', () => {
    const msg = buildActivityMessage({
      kind: 'rareloot',
      realm: 'Claudemoon',
      profileUrl: null,
      itemName: 'Ember Greatsword',
      quality: 'legendary',
      participants: [linked('Aldric', '111')],
    }) as { embeds: Array<Record<string, any>> };
    expect(msg.embeds[0].title).toBe('Ember Greatsword');
    expect(msg.embeds[0].color).toBe(0xff8000); // legendary orange
    expect(msg.embeds[0].description).toContain('legendary');
  });

  it('duel card mentions both linked players and names the winner', () => {
    const msg = buildActivityMessage({
      kind: 'duel',
      realm: 'Claudemoon',
      profileUrl: null,
      winnerName: 'Aldric',
      loserName: 'Mira',
      participants: [linked('Aldric', '111'), linked('Mira', '222')],
    }) as {
      content: string;
      allowed_mentions: { users: string[] };
      embeds: Array<Record<string, any>>;
    };
    expect(msg.embeds[0].title).toContain('Aldric wins');
    expect(msg.embeds[0].description).toContain('<@111>');
    expect(msg.embeds[0].description).toContain('<@222>');
    expect(msg.allowed_mentions.users.sort()).toEqual(['111', '222']);
  });

  it('arena card shows the signed rating delta', () => {
    const msg = buildActivityMessage({
      kind: 'arena',
      realm: 'Claudemoon',
      profileUrl: null,
      ratingDelta: 24,
      participants: [linked('Aldric', '111')],
    }) as { embeds: Array<Record<string, any>> };
    expect(msg.embeds[0].description).toContain('+24');
  });

  it('renders a plain name (no ping) for an unlinked participant', () => {
    const msg = buildActivityMessage({
      kind: 'duel',
      realm: 'Claudemoon',
      profileUrl: null,
      winnerName: 'Aldric',
      loserName: 'Ghost',
      participants: [linked('Aldric', '111')], // Ghost is not linked
    }) as { allowed_mentions: { users: string[] }; embeds: Array<Record<string, any>> };
    expect(msg.embeds[0].description).toContain('Ghost'); // plain, no mention
    expect(msg.allowed_mentions.users).toEqual(['111']);
  });
});

describe('daily rewards winner cards', () => {
  it('formats the top-10 daily rewards winners without pings', () => {
    const msg = buildDailyRewardWinnersMessage({
      day: '2026-06-30',
      realm: 'Claudemoon',
      prizePoolUsd: 150,
      finalizedAt: '2026-07-01T00:00:00.000Z',
      payouts: [
        {
          day: '2026-06-30',
          rank: 1,
          username: 'titoisking',
          points: 12345,
          prizePercent: 0.2,
          prizeUsd: 30,
          status: 'pending',
          txSignature: null,
        },
        {
          day: '2026-06-30',
          rank: 2,
          username: 'alice',
          points: 1000,
          prizePercent: 0.15,
          prizeUsd: 22.5,
          status: 'pending',
          txSignature: null,
        },
      ],
    }) as {
      allowed_mentions: unknown;
      embeds: Array<{
        title: string;
        description: string;
        fields: Array<{ name: string; value: string; inline: boolean }>;
      }>;
    };

    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.embeds[0].title).toBe('Top 2 Winners - 2026-06-30');
    expect(msg.embeds[0].description).toContain('**#1** titoisking - 12,345 pts - $30.00 (20%)');
    expect(msg.embeds[0].description).toContain('**#2** alice - 1,000 pts - $22.50 (15%)');
    expect(msg.embeds[0].fields).toContainEqual({
      name: 'Prize Pool',
      value: '$150.00',
      inline: true,
    });
  });
});
