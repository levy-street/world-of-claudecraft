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
  chunk,
  clearDepartedFlair,
  clearedMemberMeta,
  computeRoleSync,
  GATEWAY_INTENTS,
  GATEWAY_OP,
  GUILD_LARGE_THRESHOLD,
  heartbeatIntervalMs,
  identifyPayload,
  indexSpecialRoleIds,
  interactionFailureFallback,
  isSlashCommand,
  levelNickSuffix,
  MEMBERS_META_BATCH,
  memberRolesFromPayload,
  NICK_MAX,
  type RelayItem,
  reconcileMemberRolesFromUpdate,
  relayAvatarUrl,
  relayRespondUrl,
  requestGuildMembersPayload,
  rosterComplete,
  staleFlairedIds,
  stripLevelSuffix,
  tierRoleName,
  topSpecialRoleKeyFor,
  VC_NATION_LABELS,
  voiceMembersForChannel,
} from '../bot/logic';
import type { ActivityKind } from '../server/discord_activity';
import { DEFAULT_JSON_BODY_MAX_BYTES } from '../server/http_util';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

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

  it('raises the large_threshold so offline members ship in GUILD_CREATE', () => {
    expect(GUILD_LARGE_THRESHOLD).toBe(250);
    expect((identifyPayload('tok').d as Record<string, unknown>).large_threshold).toBe(250);
  });

  it('requests the full member list with op 8 (query "" / limit 0 / presences)', () => {
    expect(GATEWAY_OP.REQUEST_GUILD_MEMBERS).toBe(8); // Discord opcode, pinned
    expect(requestGuildMembersPayload('guild-1')).toEqual({
      op: 8,
      d: { guild_id: 'guild-1', query: '', limit: 0, presences: true },
    });
  });
});

describe('special-role resolution (staff flair)', () => {
  // A guild that (as in the bug report) has BOTH an "Admin" and an "Admins" role,
  // plus a higher-priority "Levy St" role and a non-special role.
  const guildRoles = [
    { id: 'r-admin', name: 'Admin' },
    { id: 'r-admins', name: 'Admins' },
    { id: 'r-levy', name: 'Levy St' },
    { id: 'r-member', name: 'Member' },
  ];

  it('indexes ALL ids that map to a key so either "Admin" or "Admins" resolves', () => {
    const index = indexSpecialRoleIds(guildRoles);
    // Both admin-aliased role ids are kept (the old first-wins map dropped one).
    expect(index.get('r-admin')).toBe('admin');
    expect(index.get('r-admins')).toBe('admin');
    expect(index.get('r-member')).toBeUndefined(); // not a special role
    // A holder of EITHER admin role id resolves to the 'admin' flair.
    expect(topSpecialRoleKeyFor(['r-admin'], index)).toBe('admin');
    expect(topSpecialRoleKeyFor(['r-admins'], index)).toBe('admin');
    expect(topSpecialRoleKeyFor(['r-member'], index)).toBeNull();
  });

  it('picks the highest-priority special role a member holds', () => {
    const index = indexSpecialRoleIds(guildRoles);
    // Levy St (priority 11) outranks Admin (10) per the shared catalog.
    expect(topSpecialRoleKeyFor(['r-admins', 'r-levy'], index)).toBe('levyst');
  });

  it('reflects a live GUILD_MEMBER_UPDATE role grant in the resolved flair', () => {
    const index = indexSpecialRoleIds(guildRoles);
    // Before: the member holds only a non-special role -> no flair.
    const before = ['r-member'];
    expect(topSpecialRoleKeyFor(before, index)).toBeNull();
    // A GUILD_MEMBER_UPDATE arrives granting the Admins role: Discord sends the
    // member's COMPLETE role list, so the reconciled state replaces the cache.
    const after = reconcileMemberRolesFromUpdate({ roles: ['r-member', 'r-admins'] });
    expect(after).toEqual(['r-member', 'r-admins']);
    // After: 'admin' now resolves where it did not before (the core bug fix).
    expect(topSpecialRoleKeyFor(after ?? [], index)).toBe('admin');
  });

  it('leaves the cache untouched when an update carries no roles array', () => {
    expect(reconcileMemberRolesFromUpdate({ nick: 'Nyx' })).toBeNull();
    expect(reconcileMemberRolesFromUpdate({ roles: ['a', 2, 'b', null] })).toEqual(['a', 'b']);
  });

  it('extracts a member payload role-id array, dropping non-strings', () => {
    expect(memberRolesFromPayload({ roles: ['x', 'y'] })).toEqual(['x', 'y']);
    expect(memberRolesFromPayload({ roles: [1, 'z', {}] })).toEqual(['z']);
    expect(memberRolesFromPayload({})).toEqual([]);
  });
});

describe('members-meta batching + clearing', () => {
  it('batches the full roster in cap-sized requests without dropping the tail', () => {
    // The batch size is derived from the server's 64 KiB body cap (see the
    // byte-budget test below), and must also stay at or under the server's
    // 1000-entry slice (pinned server-side in tests/server/internal.test.ts).
    expect(MEMBERS_META_BATCH).toBe(200);

    // A large-guild backfill: 2500 members. The old single-slice push kept only
    // the first 1000, so members 1000..2499 never got meta pushed. Batching must
    // split at exactly the cap and cover the whole roster including the tail.
    const ids = Array.from({ length: 2500 }, (_, i) => `u${i}`);
    const batches = chunk(ids, MEMBERS_META_BATCH);

    expect(batches.length).toBe(13); // 12 full batches of 200 + a 100 tail
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(MEMBERS_META_BATCH);
    // Every member appears exactly once, in order (nothing dropped past the cap).
    expect(batches.flat()).toEqual(ids);
    expect(batches.flat()).toContain('u2499'); // the tail member is covered
  });

  it('a worst-case full batch serializes under the server JSON body cap', () => {
    // readBody rejects request bodies over DEFAULT_JSON_BODY_MAX_BYTES, and the
    // members-meta handler coerces that rejection to an EMPTY member list (200,
    // updated: 0): the whole batch silently drops. So the batch size must be
    // derived from BYTES, not the server's 1000-entry slice: a full batch of
    // worst-case records (20-char snowflake ids, 32-char names where every char
    // JSON-escapes to 6 bytes, full join dates, the longest role key) must fit
    // under the cap. This is the pin that fails if MEMBERS_META_BATCH grows, a
    // pushed field widens, or the server cap shrinks.
    const worst = Array.from({ length: MEMBERS_META_BATCH }, () => ({
      discord_user_id: '9'.repeat(20),
      name: '\u0001'.repeat(32), // control chars: JSON.stringify emits \u0001 (6 bytes) each
      joinedAtMs: 1_700_000_000_000,
      role: 'contentcreator', // the longest key in DISCORD_SPECIAL_ROLES
    }));
    const bytes = Buffer.byteLength(JSON.stringify({ members: worst }), 'utf8');
    expect(bytes).toBeLessThan(DEFAULT_JSON_BODY_MAX_BYTES);
  });

  it('chunk clamps a non-positive size and never emits empty batches', () => {
    expect(chunk([], 1000)).toEqual([]); // empty roster -> no request
    expect(chunk(['a', 'b', 'c'], 0)).toEqual([['a'], ['b'], ['c']]); // size clamped to 1
    expect(chunk(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });

  it('builds a clearing meta record that drops an ex-member flair', () => {
    // On GUILD_MEMBER_REMOVE the bot sends this (plus setMember(id, false)) so the
    // ex-member loses their in-game verified/staff tag. A null role key is what the
    // server treats as "clear the special-role flair"; name/join-date stay null so
    // nothing is re-asserted. The old removal path only deleted the local cache and
    // left this server state stale, so this record + its null role are the fix.
    expect(clearedMemberMeta('123')).toEqual({
      discord_user_id: '123',
      name: null,
      joinedAtMs: null,
      role: null,
    });
  });
});

describe('departed-member reconcile (flair cleared after an offline leave)', () => {
  it('rosterComplete requires a positive member_count fully covered by the cache', () => {
    // The gate that keeps the reconcile from running against a PARTIAL roster
    // (a large-guild GUILD_CREATE before the op 8 backfill lands): a partial
    // diff would misread unseeded members as departed and clear real flair.
    expect(rosterComplete(10, 10)).toBe(true);
    expect(rosterComplete(11, 10)).toBe(true); // a join mid-seed can overshoot
    expect(rosterComplete(9, 10)).toBe(false); // partial seed: never reconcile
    expect(rosterComplete(0, 0)).toBe(false); // no member_count: never reconcile
    expect(rosterComplete(5, 0)).toBe(false);
  });

  it('clearDepartedFlair pushes null-role meta BEFORE dropping the membership flag', async () => {
    // The clear order matters for the reader: the meta row (role: null) is what
    // drops the visible flair, so it lands before the membership flag flips.
    const ops: string[] = [];
    const io = {
      pushMembersMeta: async (records: { discord_user_id: string }[]) => {
        ops.push(`meta:${records.map((r) => r.discord_user_id).join(',')}`);
      },
      setMember: async (id: string, guildMember: boolean) => {
        ops.push(`member:${id}:${guildMember}`);
      },
    };
    const cleared = await clearDepartedFlair(['u1', 'u2'], () => false, io);
    expect(ops).toEqual(['meta:u1,u2', 'member:u1:false', 'member:u2:false']);
    expect(cleared).toEqual(['u1', 'u2']);
  });

  it('clearDepartedFlair batches the meta clears under the members-meta cap', async () => {
    const ops: string[] = [];
    const io = {
      pushMembersMeta: async (records: unknown[]) => {
        ops.push(`meta:${records.length}`);
      },
      setMember: async (id: string) => {
        ops.push(`member:${id}`);
      },
    };
    await clearDepartedFlair(['a', 'b', 'c'], () => false, io, 2);
    // Split at the injected cap with the tail kept, and the ordering is GLOBAL:
    // every meta batch lands before ANY membership flag flips (a per-batch
    // interleave of meta and flag writes would fail here).
    expect(ops).toEqual(['meta:2', 'meta:1', 'member:a', 'member:b', 'member:c']);
  });

  it('clearDepartedFlair re-evaluates membership FRESH before each flag write', async () => {
    // u1 rejoins WHILE the meta push is in flight (GUILD_MEMBER_ADD mutates the
    // live cache during the await). The flag phase must re-read membership and
    // skip the rejoiner: an implementation that snapshots the non-member set
    // once before the pushes would wrongly setMember('u1', false) here.
    const members = new Set<string>();
    const ops: string[] = [];
    const io = {
      pushMembersMeta: async (records: { discord_user_id: string }[]) => {
        ops.push(`meta:${records.map((r) => r.discord_user_id).join(',')}`);
        members.add('u1'); // the rejoin lands during this await
      },
      setMember: async (id: string, guildMember: boolean) => {
        ops.push(`member:${id}:${guildMember}`);
      },
    };
    const cleared = await clearDepartedFlair(['u1', 'u2'], (id) => members.has(id), io);
    expect(ops).toEqual(['meta:u1,u2', 'member:u2:false']);
    expect(cleared).toEqual(['u2']);
  });

  it('clearDepartedFlair skips a member re-observed between the diff and the writes', async () => {
    // u2 rejoined (GUILD_MEMBER_ADD) after the roster diff flagged them: the
    // membership predicate is re-checked before EVERY write, so u2 is neither
    // meta-cleared nor unflagged, and the live event handlers keep their state.
    const ops: string[] = [];
    const io = {
      pushMembersMeta: async (records: { discord_user_id: string }[]) => {
        ops.push(`meta:${records.map((r) => r.discord_user_id).join(',')}`);
      },
      setMember: async (id: string, guildMember: boolean) => {
        ops.push(`member:${id}:${guildMember}`);
      },
    };
    const cleared = await clearDepartedFlair(['u1', 'u2'], (id) => id === 'u2', io);
    expect(ops).toEqual(['meta:u1', 'member:u1:false']);
    expect(cleared).toEqual(['u1']);
  });

  it('clearDepartedFlair makes no calls at all when everyone was re-observed', async () => {
    let calls = 0;
    const io = {
      pushMembersMeta: async () => {
        calls++;
      },
      setMember: async () => {
        calls++;
      },
    };
    expect(await clearDepartedFlair(['u1'], () => true, io)).toEqual([]);
    expect(await clearDepartedFlair([], () => false, io)).toEqual([]);
    expect(calls).toBe(0); // no empty meta push, no member write
  });

  it('staleFlairedIds returns exactly the flagged ids missing from the roster', () => {
    // u2 left while the bot was offline (flagged server-side, not in the live
    // roster); u1 is still a member and must NOT be cleared.
    const roster = new Set(['u1', 'u3']);
    expect(staleFlairedIds(['u1', 'u2'], roster)).toEqual(['u2']);
    expect(staleFlairedIds(['u1'], roster)).toEqual([]); // nothing stale
    expect(staleFlairedIds([], roster)).toEqual([]); // nothing flagged
    // An empty roster set claims everyone flagged is stale, which is why the
    // caller gates on rosterComplete before ever diffing.
    expect(staleFlairedIds(['u1'], new Set())).toEqual(['u1']);
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
    const linked = buildWhoamiContent({
      linked: true,
      statusTier: 5,
      points: 100,
      lifetimePoints: 5000,
    });
    expect(linked).toContain('Champion');
    expect(linked).not.toContain('/flex'); // removed command, must not be referenced in the reply
    expect(buildLinkContent('https://woc')).toContain('https://woc');
    expect(buildWelcomeMessage({ userMention: '<@1>', gameUrl: 'https://woc' })).toContain('<@1>');
  });

  it('falls back to editing the deferred reply once the interaction is acknowledged', () => {
    // A failure AFTER a successful defer (e.g. the game-server call or the
    // final edit itself throws) has already spent the interaction's one
    // initial-response slot, so the only way left to reach the player is
    // editing that response.
    const fallback = interactionFailureFallback(true);
    expect(fallback.via).toBe('edit');
    expect(fallback.content.length).toBeGreaterThan(0);
  });

  it('falls back to a fresh response when the interaction was never acknowledged', () => {
    // A failure BEFORE any ack lands (e.g. respondInteraction/deferInteraction
    // itself throws) leaves the initial-response slot open, so the fallback
    // becomes that response instead of an edit with nothing to edit.
    const fallback = interactionFailureFallback(false);
    expect(fallback.via).toBe('respond');
    expect(fallback.content.length).toBeGreaterThan(0);
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

  it('replaces an existing suffix instead of compounding it', () => {
    // Simulates a re-sync fed the CURRENT (already-suffixed) nick as its base,
    // e.g. because the fallback chain reused the live Discord nick.
    const first = buildLevelNick('Aldric', 20, 'warrior');
    const second = buildLevelNick(first, 21, 'warrior');
    expect(second).toBe(`Aldric${levelNickSuffix(21, 'warrior')}`);
  });

  it('collapses several stacked suffixes from a prior compounding bug down to one', () => {
    // Simulates a name mangled by the old compounding bug: several suffixes
    // (possibly from different classes/levels) stacked back to back.
    const stacked =
      'Enrik' +
      levelNickSuffix(20, 'warrior').repeat(5) +
      levelNickSuffix(2, 'warrior') +
      levelNickSuffix(20, 'warrior');
    expect(buildLevelNick(stacked, 20, 'warrior')).toBe(`Enrik${levelNickSuffix(20, 'warrior')}`);

    const stackedMixed =
      'jgyy' +
      levelNickSuffix(1, 'rogue').repeat(3) +
      levelNickSuffix(1, 'priest') +
      levelNickSuffix(1, 'rogue').repeat(3) +
      levelNickSuffix(1, 'priest').repeat(2);
    expect(stripLevelSuffix(stackedMixed)).toBe('jgyy');
  });

  it('stripLevelSuffix leaves a name with no suffix unchanged', () => {
    expect(stripLevelSuffix('Aldric')).toBe('Aldric');
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

  // The server has enqueued vale_cup cards since the Vale Cup shipped, but the
  // bot's builder had no case for the kind, so every card posted as an embed
  // with an undefined title/description/color (the empty-embed render).
  it('vale-cup card names the winning nation, bracket, and score, tagging the side', () => {
    const msg = buildActivityMessage({
      kind: 'vale_cup',
      realm: 'Claudemoon',
      profileUrl: null,
      bracket: 3,
      scoreA: 2,
      scoreB: 5,
      winnerNation: 'copperdig',
      participants: [linked('Aldric', '111'), linked('Mira', '222')],
    }) as {
      content: string;
      allowed_mentions: { users: string[] };
      embeds: Array<Record<string, any>>;
    };
    expect(msg.embeds[0].title).toContain('The Copper Dig');
    expect(msg.embeds[0].title).toContain('3v3');
    // Winning score reads first regardless of which team's column it sat in.
    expect(msg.embeds[0].description).toContain('5 to 2');
    expect(msg.embeds[0].description).toContain('<@111>');
    expect(msg.embeds[0].description).toContain('<@222>');
    expect(msg.allowed_mentions.users.sort()).toEqual(['111', '222']);
    expect(typeof msg.embeds[0].color).toBe('number');
  });

  it('vale-cup card falls back to the raw nation id when the label map misses', () => {
    const msg = buildActivityMessage({
      kind: 'vale_cup',
      realm: 'Claudemoon',
      profileUrl: null,
      bracket: 1,
      scoreA: 3,
      scoreB: 0,
      winnerNation: 'newnation',
      participants: [linked('Aldric', '111')],
    }) as { embeds: Array<Record<string, any>> };
    expect(msg.embeds[0].title).toContain('newnation');
  });

  // The bot's nation labels are a deliberate COPY of the game catalog's English
  // values: bot/logic.ts must not import the ui catalog (the bot bundle stays
  // standalone), so only this test, which imports BOTH, notices the two drifting
  // apart. Reword hudChrome.vcup.nation.* and the bot copy reddens here.
  it('pins the bot Vale Cup nation labels to the game catalog English values', () => {
    const catalog: Record<string, string> = hudChromeStrings.vcup.nation;
    expect(Object.keys(VC_NATION_LABELS).sort()).toEqual(Object.keys(catalog).sort());
    expect(Object.keys(VC_NATION_LABELS)).toHaveLength(8);
    for (const [id, label] of Object.entries(VC_NATION_LABELS)) {
      expect(label, `nation ${id}`).toBe(catalog[id]);
    }
  });

  it('masterwork card names the crafted item and pings the crafter', () => {
    const msg = buildActivityMessage({
      kind: 'masterwork',
      realm: 'Claudemoon',
      profileUrl: 'https://woc.test/c/Aldric',
      itemName: 'Osmium Breastplate',
      participants: [linked('Aldric', '111')],
    }) as {
      content: string;
      allowed_mentions: { users: string[] };
      embeds: Array<Record<string, any>>;
    };
    expect(msg.embeds[0].title).toBe('Osmium Breastplate');
    expect(msg.embeds[0].description).toContain('masterwork');
    expect(msg.embeds[0].description).toContain('<@111>');
    expect(msg.allowed_mentions.users).toEqual(['111']);
  });

  it('deed-title card names the deed and the earned title', () => {
    const msg = buildActivityMessage({
      kind: 'deed',
      realm: 'Claudemoon',
      profileUrl: null,
      deedId: 'prog_masterwright',
      deedName: 'Masterwright',
      deedTitle: 'Masterwright',
      participants: [linked('Aldric', '111')],
    }) as { embeds: Array<Record<string, any>> };
    expect(msg.embeds[0].title).toBe('Masterwright');
    expect(msg.embeds[0].description).toContain('"Masterwright"');
    expect(msg.embeds[0].description).toContain('title');
    expect(msg.embeds[0].description).toContain('<@111>');
  });

  it('first-koi card reads as a catch, not a generic deed', () => {
    const msg = buildActivityMessage({
      kind: 'deed',
      realm: 'Claudemoon',
      profileUrl: null,
      deedId: 'col_glimmerfin',
      deedName: 'Glimmer of Hope',
      itemName: 'Sunglint Koi',
      participants: [linked('Aldric', '111')],
    }) as { embeds: Array<Record<string, any>> };
    expect(msg.embeds[0].title).toBe('Glimmer of Hope');
    expect(msg.embeds[0].description).toContain('first Sunglint Koi');
    expect(msg.embeds[0].description).toContain('<@111>');
  });

  // Same empty-embed class, one layer in: an item name the server sends as an
  // EMPTY string (not absent) must fall back to the generic title. `??` keeps
  // the empty string and Discord rejects a blank embed title, so every title
  // fallback in buildActivityMessage is `||`.
  it('degrades an empty item or deed name to the generic title', () => {
    const titleOf = (item: ActivityItem): string =>
      (buildActivityMessage(item) as { embeds: Array<{ title: string }> }).embeds[0].title;
    const base = { realm: 'Claudemoon', profileUrl: null, participants: [linked('Aldric', '111')] };
    expect(titleOf({ ...base, kind: 'rareloot', itemName: '' })).toBe('A rare item');
    expect(titleOf({ ...base, kind: 'masterwork', itemName: '' })).toBe('A masterwork piece');
    expect(titleOf({ ...base, kind: 'deed', deedId: 'col_glimmerfin', deedName: '' })).toBe(
      'A rare catch',
    );
    expect(titleOf({ ...base, kind: 'deed', deedId: 'prog_masterwright', deedName: '' })).toBe(
      'A deed of renown',
    );
  });

  // The empty-embed class guard: a kind this bot build does not know (a newer
  // server mid-deploy) must skip the post entirely, never render a blank card.
  it('returns null for an unknown activity kind', () => {
    const msg = buildActivityMessage({
      kind: 'parade' as never,
      realm: 'Claudemoon',
      profileUrl: null,
      participants: [linked('Aldric', '111')],
    });
    expect(msg).toBeNull();
  });

  // Server-to-bot kind parity, the drift class that broke vale_cup (the server
  // enqueued the kind for months while the bot union lacked it, so every card
  // rendered an author-less empty embed Discord rejects). The wire crosses
  // processes as unchecked JSON, so tsc alone never sees the drift; this list
  // is pinned to the server union in BOTH directions at tsc time (a server
  // kind missing from the list reddens the conditional-type line; a listed
  // kind the bot cannot take reddens the buildActivityMessage call) and every
  // kind must render a real card at runtime.
  const SERVER_KINDS = [
    'levelup',
    'rareloot',
    'duel',
    'arena',
    'vale_cup',
    'masterwork',
    'deed',
  ] as const satisfies readonly ActivityKind[];
  type MissingServerKind = Exclude<ActivityKind, (typeof SERVER_KINDS)[number]>;
  // Deliberately a TYPE-level pin: the initializer is literally null, so the
  // runtime expect below is a tautology; the teeth are that this line fails
  // `tsc --noEmit` (which the gate and the pre-push floor run) the moment the
  // server union gains a kind the list lacks.
  const noMissingServerKinds: MissingServerKind extends never ? null : MissingServerKind = null;

  it('renders a fully populated card for every kind the server can enqueue', () => {
    expect(noMissingServerKinds).toBeNull();
    for (const kind of SERVER_KINDS) {
      const msg = buildActivityMessage({
        kind,
        realm: 'Claudemoon',
        profileUrl: null,
        level: 20,
        participants: [linked('Aldric', '111')],
      }) as { embeds: Array<Record<string, any>> } | null;
      expect(msg, `kind ${kind} must render a card`).not.toBeNull();
      // Non-null is not enough: the production failure was a card that rendered
      // with an EMPTY author ({}) and an undefined title/description, which
      // Discord 400s. author.name is the field that 400s first, so every kind
      // is pinned on all three universal embed fields being real, non-blank
      // text (the item here carries only the fields the server always sends,
      // so any kind leaning on an optional field must still fill them).
      const embed = (msg as { embeds: Array<Record<string, any>> }).embeds[0];
      expect(embed, `kind ${kind} must render one embed`).toBeDefined();
      for (const [field, value] of [
        ['author.name', embed.author?.name],
        ['title', embed.title],
        ['description', embed.description],
      ] as const) {
        expect(typeof value, `kind ${kind} ${field} must be a string`).toBe('string');
        expect(
          String(value).trim().length,
          `kind ${kind} ${field} must not be blank`,
        ).toBeGreaterThan(0);
      }
      expect(typeof embed.color, `kind ${kind} must set an accent color`).toBe('number');
    }
  });

  it('buildActivityMessage answers null for an unknown kind, never an empty embed', () => {
    // The never-post-an-empty-embed rule (the vale_cup failure): a kind this
    // build does not know maps to null, and the outbox io seam drops the null
    // instead of posting (tests/discord_bot_outbox.test.ts pins the drop).
    // Known kinds keep building full payloads.
    const known = (kind: ActivityItem['kind']): ActivityItem => ({
      kind,
      realm: 'Claudemoon',
      profileUrl: null,
      level: 20,
      participants: [linked('Aldric', '111')],
    });
    expect(buildActivityMessage({ ...known('rareloot'), kind: 'parade' as never })).toBeNull();
    const levelup = buildActivityMessage(known('levelup'));
    if (!levelup) throw new Error('the levelup payload must build');
    expect((levelup.embeds as Array<{ title: string }>)[0].title).toContain('level 20');
    const masterwork = buildActivityMessage(known('masterwork'));
    if (!masterwork) throw new Error('the masterwork payload must build');
    expect((masterwork.embeds as Array<{ title: string }>)[0].title).toBe('A masterwork piece');
  });
});

describe('daily rewards winner cards', () => {
  it('formats the top-10 daily rewards winners without pings', () => {
    const msg = buildDailyRewardWinnersMessage({
      day: '2026-06-30',
      taskName: 'Complete quests',
      nextTaskName: 'Win an arena match',
      realm: 'Claudemoon',
      prizePoolUsd: 150,
      finalizedAt: '2026-07-01T00:00:00.000Z',
      payouts: [
        {
          rank: 1,
          username: 'titoisking',
          points: 12345,
          prizePercent: 0.2,
          prizeUsd: 30,
          status: 'pending',
        },
        {
          rank: 2,
          username: 'alice',
          points: 1000,
          prizePercent: 0.15,
          prizeUsd: 22.5,
          status: 'pending',
        },
      ],
    }) as {
      allowed_mentions: unknown;
      embeds: Array<{
        author: { name: string };
        title: string;
        description: string;
        fields: Array<{ name: string; value: string; inline: boolean }>;
      }>;
    };

    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.embeds[0].author).toEqual({ name: 'Task: Complete quests' });
    expect(msg.embeds[0].title).toBe('Top 2 Winners - 2026-06-30');
    expect(msg.embeds[0].description).toContain('**#1** titoisking - 12,345 pts - $30.00 (20%)');
    expect(msg.embeds[0].description).toContain('**#2** alice - 1,000 pts - $22.50 (15%)');
    expect(msg.embeds[0].fields).toEqual([
      { name: 'Realm', value: 'Claudemoon', inline: true },
      { name: 'Prize Pool', value: '$150.00', inline: true },
      { name: 'Next task', value: 'Win an arena match', inline: false },
    ]);
  });
});
