// The Social window's guild-rank pure core (src/ui/guild_ranks_view.ts,
// docs/prd/guild-custom-ranks.md): keyed rank labels, the viewer's UX
// permission answers, the Ranks tab table model, and the ladder edits the
// tab's buttons make. Driven with both a ClientWorld-shaped mirror (a social
// frame, with and without a ladder: an older server sends none) and the
// offline Sim's shape (socialInfo null).
import { describe, expect, it } from 'vitest';
import {
  defaultGuildRankLadder,
  GUILD_RANK_MAX,
  GUILD_RANK_PERMISSIONS,
  type GuildRankDef,
  sanitizeGuildRankLadder,
} from '../src/sim/guild_ranks';
import {
  addGuildRank,
  guildLadder,
  guildRankLabel,
  guildRanksPanelView,
  moveGuildRank,
  removeGuildRank,
  viewerGuildCan,
} from '../src/ui/guild_ranks_view';
import type { GuildInfo, GuildMemberInfo, SocialInfo } from '../src/world_api';

const LADDER: GuildRankDef[] = [
  { id: 'leader', name: '', perms: [...GUILD_RANK_PERMISSIONS] },
  { id: 'officer', name: 'Council', perms: ['invite', 'remove'] },
  { id: 'r1', name: '', perms: ['bank'] },
  { id: 'member', name: '', perms: [] },
];

function member(name: string, rank: string): GuildMemberInfo {
  return {
    id: name.length,
    name,
    cls: 'warrior',
    level: 10,
    realm: 'Claudemoon',
    activeTitle: null,
    online: true,
    rank,
    lastLogin: null,
    joinedAt: null,
  };
}

function social(rank: string, ranks?: GuildRankDef[]): SocialInfo {
  const guild: GuildInfo = {
    id: 1,
    name: 'Iron Vanguard',
    rank,
    ...(ranks ? { ranks } : {}),
    motd: '',
    motdSetBy: '',
    members: [
      member('Lead', 'leader'),
      member('Offi', 'officer'),
      member('Bank', 'r1'),
      member('Also', 'r1'),
      member('Rook', 'member'),
      member('Ghost', 'r9'), // an id the ladder does not know: counts as a joiner
    ],
    events: [],
    pledgeSettings: { enabled: true, minLevel: 1, note: '', newPlayerFriendly: false },
    pledges: [],
    tier: 0,
  };
  return { friends: [], blocks: [], ignores: [], guild, myPledge: null };
}

describe('guildLadder / viewerGuildCan', () => {
  it('an older server frame (no ladder) resolves to the default ladder', () => {
    expect(guildLadder(social('officer').guild)).toEqual(defaultGuildRankLadder());
    expect(viewerGuildCan(social('officer').guild, 'bank')).toBe(true);
    expect(viewerGuildCan(social('officer').guild, 'promote')).toBe(false);
  });

  it('follows a custom ladder, fails closed on unknown ids, and answers false guildless', () => {
    expect(viewerGuildCan(social('r1', LADDER).guild, 'bank')).toBe(true);
    expect(viewerGuildCan(social('officer', LADDER).guild, 'bank')).toBe(false);
    expect(viewerGuildCan(social('r9', LADDER).guild, 'invite')).toBe(false);
    expect(viewerGuildCan(null, 'invite')).toBe(false);
    expect(viewerGuildCan(undefined, 'invite')).toBe(false);
  });
});

describe('guildRankLabel', () => {
  it('keys built-in defaults, numbers untitled custom ranks, passes guild titles through', () => {
    expect(guildRankLabel(LADDER, 'leader')).toEqual({ kind: 'default', rank: 'leader' });
    expect(guildRankLabel(LADDER, 'officer')).toEqual({ kind: 'custom', name: 'Council' });
    expect(guildRankLabel(LADDER, 'r1')).toEqual({ kind: 'numbered', n: 2 });
    expect(guildRankLabel(LADDER, 'member')).toEqual({ kind: 'default', rank: 'member' });
    expect(guildRankLabel(LADDER, 'r9')).toEqual({ kind: 'default', rank: 'member' });
  });
});

describe('guildRanksPanelView (the Ranks tab)', () => {
  it('is null guildless and offline (the Sim has no socialInfo)', () => {
    expect(guildRanksPanelView(null)).toBeNull();
    expect(guildRanksPanelView({ ...social('leader'), guild: null })).toBeNull();
  });

  it('the Guild Master edits: middle ranks reorder and remove, the ends never do', () => {
    const view = guildRanksPanelView(social('leader', LADDER))!;
    expect(view.editable).toBe(true);
    expect(view.canAdd).toBe(true);
    expect(view.rows.map((r) => [r.id, r.canMoveUp, r.canMoveDown, r.canRemove])).toEqual([
      ['leader', false, false, false],
      ['officer', false, true, true],
      ['r1', true, false, true],
      ['member', false, false, false],
    ]);
    expect(view.rows[0].locked).toBe(true);
    expect(Object.values(view.rows[0].perms).every(Boolean)).toBe(true);
    expect(view.rows[1].perms).toMatchObject({ invite: true, remove: true, bank: false });
  });

  it('counts holders per rank, an unknown id counting at the joining rank', () => {
    const view = guildRanksPanelView(social('leader', LADDER))!;
    expect(view.rows.map((r) => r.memberCount)).toEqual([1, 1, 2, 2]);
  });

  it('every other member reads the same table with nothing editable', () => {
    for (const rank of ['officer', 'r1', 'member']) {
      const view = guildRanksPanelView(social(rank, LADDER))!;
      expect(view.editable).toBe(false);
      expect(view.canAdd).toBe(false);
      expect(view.rows.some((r) => r.canMoveUp || r.canMoveDown || r.canRemove)).toBe(false);
      expect(view.rows.map((r) => r.id)).toEqual(['leader', 'officer', 'r1', 'member']);
    }
  });

  it('a full ladder cannot add', () => {
    const full = [
      LADDER[0],
      ...Array.from({ length: GUILD_RANK_MAX - 2 }, (_, i) => ({
        id: `r${i + 1}`,
        name: '',
        perms: [] as GuildRankDef['perms'],
      })),
      LADDER[3],
    ];
    expect(guildRanksPanelView(social('leader', full))!.canAdd).toBe(false);
  });

  it('same input, same output (the view is pure)', () => {
    const s = social('leader', LADDER);
    expect(guildRanksPanelView(s)).toEqual(guildRanksPanelView(s));
  });
});

describe('ladder edits (the Ranks tab buttons)', () => {
  it('addGuildRank inserts an untitled rank just above the joining rank', () => {
    const next = addGuildRank(LADDER)!;
    expect(next.map((r) => r.id)).toEqual(['leader', 'officer', 'r1', 'r2', 'member']);
    expect(next[3]).toEqual({ id: 'r2', name: '', perms: [] });
    expect(sanitizeGuildRankLadder(next)).not.toBeNull();
    expect(LADDER).toHaveLength(4); // the input is never mutated
  });

  it('addGuildRank refuses at the maximum', () => {
    let ladder: GuildRankDef[] | null = defaultGuildRankLadder();
    for (let i = 3; i < GUILD_RANK_MAX; i++) ladder = addGuildRank(ladder!);
    expect(ladder).toHaveLength(GUILD_RANK_MAX);
    expect(addGuildRank(ladder!)).toBeNull();
  });

  it('removeGuildRank drops a middle rank only', () => {
    expect(removeGuildRank(LADDER, 'officer')?.map((r) => r.id)).toEqual([
      'leader',
      'r1',
      'member',
    ]);
    expect(removeGuildRank(LADDER, 'leader')).toBeNull();
    expect(removeGuildRank(LADDER, 'member')).toBeNull();
    expect(removeGuildRank(LADDER, 'r9')).toBeNull();
  });

  it('moveGuildRank swaps within the middle and never past an end', () => {
    expect(moveGuildRank(LADDER, 'r1', -1)?.map((r) => r.id)).toEqual([
      'leader',
      'r1',
      'officer',
      'member',
    ]);
    expect(moveGuildRank(LADDER, 'officer', -1)).toBeNull(); // would pass the Guild Master
    expect(moveGuildRank(LADDER, 'r1', 1)).toBeNull(); // would pass the joining rank
    expect(moveGuildRank(LADDER, 'leader', 1)).toBeNull();
    expect(LADDER.map((r) => r.id)).toEqual(['leader', 'officer', 'r1', 'member']);
  });
});
