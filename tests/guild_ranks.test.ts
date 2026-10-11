// The guild rank ladder's pure core (src/sim/guild_ranks.ts,
// docs/prd/guild-custom-ranks.md): the default ladder reproduces the
// pre-ladder rules, the sanitizer is strict about structure and fail-closed
// about grants, and every permission predicate the server authorizes with
// (and the client mirrors) answers the reach rules exactly.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFICER_PERMISSIONS,
  defaultGuildRankLadder,
  effectiveGuildRankId,
  GUILD_RANK_MAX,
  GUILD_RANK_NAME_MAX,
  GUILD_RANK_PERMISSIONS,
  type GuildRankDef,
  guildBankStampRank,
  guildRankCan,
  guildRankCanRemove,
  guildRankDemoteTo,
  guildRankIndex,
  guildRankOutranks,
  guildRankPromoteTo,
  guildStepDownRankId,
  nextCustomGuildRankId,
  removedGuildRankIds,
  resolveGuildRankLadder,
  sanitizeGuildRankLadder,
  sanitizeGuildRankName,
} from '../src/sim/guild_ranks';

// A five-rank ladder: the Guild Master, an officer allowed to promote, a
// custom Veteran with only the bank, an untitled custom rank, the joiners.
const LADDER: GuildRankDef[] = [
  { id: 'leader', name: 'Warlord', perms: [...GUILD_RANK_PERMISSIONS] },
  { id: 'officer', name: '', perms: ['invite', 'remove', 'promote'] },
  { id: 'r1', name: 'Veteran', perms: ['bank'] },
  { id: 'r2', name: '', perms: ['officerChat'] },
  { id: 'member', name: 'Recruit', perms: [] },
];

describe('the default ladder (pre-ladder behavior)', () => {
  it('is Guild Master, Officer, Member with the old officer-plus powers', () => {
    const ladder = defaultGuildRankLadder();
    expect(ladder.map((r) => r.id)).toEqual(['leader', 'officer', 'member']);
    expect(ladder.every((r) => r.name === '')).toBe(true);
    expect(ladder[1].perms).toEqual([...DEFAULT_OFFICER_PERMISSIONS]);
    expect(ladder[2].perms).toEqual([]);
  });

  it('officers do everything but change ranks; members do nothing', () => {
    const ladder = defaultGuildRankLadder();
    for (const perm of GUILD_RANK_PERMISSIONS) {
      expect(guildRankCan(ladder, 'leader', perm)).toBe(true);
      expect(guildRankCan(ladder, 'officer', perm)).toBe(perm !== 'promote');
      expect(guildRankCan(ladder, 'member', perm)).toBe(false);
    }
  });

  it('keeps the old reach: leader removes officers and members, officers only members', () => {
    const ladder = defaultGuildRankLadder();
    expect(guildRankCanRemove(ladder, 'leader', 'officer')).toBe(true);
    expect(guildRankCanRemove(ladder, 'leader', 'member')).toBe(true);
    expect(guildRankCanRemove(ladder, 'officer', 'member')).toBe(true);
    expect(guildRankCanRemove(ladder, 'officer', 'officer')).toBe(false);
    expect(guildRankCanRemove(ladder, 'officer', 'leader')).toBe(false);
    expect(guildRankCanRemove(ladder, 'member', 'member')).toBe(false);
  });

  it('promotes member to officer and demotes back, leader-only, never to leader', () => {
    const ladder = defaultGuildRankLadder();
    expect(guildRankPromoteTo(ladder, 'leader', 'member')).toBe('officer');
    expect(guildRankPromoteTo(ladder, 'leader', 'officer')).toBeNull(); // only a transfer goes higher
    expect(guildRankDemoteTo(ladder, 'leader', 'officer')).toBe('member');
    expect(guildRankDemoteTo(ladder, 'leader', 'member')).toBeNull(); // already the bottom
    expect(guildRankPromoteTo(ladder, 'officer', 'member')).toBeNull(); // no promote permission
  });

  it('stamps the three built-in bank tiers unchanged', () => {
    const ladder = defaultGuildRankLadder();
    expect(guildBankStampRank(ladder, 'leader')).toBe('leader');
    expect(guildBankStampRank(ladder, 'officer')).toBe('officer');
    expect(guildBankStampRank(ladder, 'member')).toBe('member');
  });

  it('a former leader steps down to Officer', () => {
    expect(guildStepDownRankId(defaultGuildRankLadder())).toBe('officer');
  });
});

describe('a custom ladder', () => {
  it('indexes by seniority and resolves unknown ids to the joining rank (fail closed)', () => {
    expect(LADDER.map((r) => guildRankIndex(LADDER, r.id))).toEqual([0, 1, 2, 3, 4]);
    expect(guildRankIndex(LADDER, 'r77')).toBe(4);
    expect(effectiveGuildRankId(LADDER, 'r77')).toBe('member');
    expect(effectiveGuildRankId(LADDER, 'r1')).toBe('r1');
    expect(guildRankCan(LADDER, 'r77', 'bank')).toBe(false);
  });

  it('grants exactly the listed permissions (the Guild Master always all)', () => {
    expect(guildRankCan(LADDER, 'r1', 'bank')).toBe(true);
    expect(guildRankCan(LADDER, 'r1', 'invite')).toBe(false);
    expect(guildRankCan(LADDER, 'r2', 'officerChat')).toBe(true);
    expect(guildRankCan(LADDER, 'officer', 'bank')).toBe(false);
    expect(guildRankCan(LADDER, 'leader', 'events')).toBe(true);
  });

  it('reaches strictly lower ranks only', () => {
    expect(guildRankOutranks(LADDER, 'officer', 'r1')).toBe(true);
    expect(guildRankOutranks(LADDER, 'r1', 'r1')).toBe(false);
    expect(guildRankOutranks(LADDER, 'r2', 'r1')).toBe(false);
    expect(guildRankCanRemove(LADDER, 'officer', 'r2')).toBe(true);
    // r1 outranks r2 but holds no 'remove'.
    expect(guildRankCanRemove(LADDER, 'r1', 'r2')).toBe(false);
  });

  it('a promoting officer lifts members up to one rank below itself, never beside it', () => {
    expect(guildRankPromoteTo(LADDER, 'officer', 'member')).toBe('r2');
    expect(guildRankPromoteTo(LADDER, 'officer', 'r2')).toBe('r1');
    expect(guildRankPromoteTo(LADDER, 'officer', 'r1')).toBeNull(); // r1 -> officer is its own rank
    expect(guildRankDemoteTo(LADDER, 'officer', 'r1')).toBe('r2');
    expect(guildRankDemoteTo(LADDER, 'officer', 'officer')).toBeNull(); // not strictly lower
    expect(guildRankPromoteTo(LADDER, 'leader', 'r1')).toBe('officer');
  });

  it('stamps the bank tier from the bank permission, not the rank name', () => {
    expect(guildBankStampRank(LADDER, 'r1')).toBe('officer');
    expect(guildBankStampRank(LADDER, 'officer')).toBe('member'); // an officer without the bank
    expect(guildBankStampRank(LADDER, 'r2')).toBe('member');
    expect(guildBankStampRank(LADDER, 'leader')).toBe('leader');
    expect(guildBankStampRank(LADDER, 'r77')).toBe('member');
  });

  it('steps a former leader down to the most senior rank below them', () => {
    const noOfficer = LADDER.filter((r) => r.id !== 'officer');
    expect(guildStepDownRankId(noOfficer)).toBe('r1');
    expect(guildStepDownRankId([LADDER[0], LADDER[4]])).toBe('member');
  });
});

describe('sanitizeGuildRankName', () => {
  it('trims, collapses spaces, and allows the empty default', () => {
    expect(sanitizeGuildRankName('  Iron   Fist ')).toBe('Iron Fist');
    expect(sanitizeGuildRankName('')).toBe('');
    expect(sanitizeGuildRankName('   ')).toBe('');
  });

  it('accepts letters and digits in any script with apostrophes and hyphens', () => {
    for (const ok of ["Keeper's Hand", 'Two-Blade', 'Rank 7', 'Hüter', '守护者', 'Страж']) {
      expect(sanitizeGuildRankName(ok)).toBe(ok);
    }
  });

  it('refuses markup, emoji, edge punctuation, over-length, and non-strings', () => {
    for (const bad of ['<b>Boss</b>', 'Boss!', '-Lead', "Lead'", 'Chief \u{1F451}', 5, null]) {
      expect(sanitizeGuildRankName(bad)).toBeNull();
    }
    expect(sanitizeGuildRankName('a'.repeat(GUILD_RANK_NAME_MAX))).toBe('a'.repeat(20));
    expect(sanitizeGuildRankName('a'.repeat(GUILD_RANK_NAME_MAX + 1))).toBeNull();
  });
});

describe('sanitizeGuildRankLadder', () => {
  it('returns the canonical form of a valid ladder', () => {
    const out = sanitizeGuildRankLadder([
      { id: 'leader', name: ' Warlord ', perms: [] },
      { id: 'r3', name: 'Veteran', perms: ['bank', 'invite', 'bank'] },
      { id: 'member', name: '', perms: [] },
    ]);
    expect(out).toEqual([
      // The Guild Master's permissions are forced to the full set.
      { id: 'leader', name: 'Warlord', perms: [...GUILD_RANK_PERMISSIONS] },
      // De-duplicated, canonical order.
      { id: 'r3', name: 'Veteran', perms: ['invite', 'bank'] },
      { id: 'member', name: '', perms: [] },
    ]);
  });

  it('drops unknown permissions rather than granting them', () => {
    const out = sanitizeGuildRankLadder([
      { id: 'leader', name: '', perms: [] },
      { id: 'member', name: '', perms: ['bank', 'launchNukes', 7] },
    ]);
    expect(out?.[1].perms).toEqual(['bank']);
  });

  it('refuses every structural violation', () => {
    const leader = { id: 'leader', name: '', perms: [] };
    const member = { id: 'member', name: '', perms: [] };
    const bad: unknown[] = [
      null,
      'ladder',
      [],
      [leader], // below the minimum
      [member, leader], // ends swapped
      [leader, { id: 'officer', name: '', perms: [] }], // joining rank missing
      [leader, { id: 'leader', name: '', perms: [] }, member], // duplicate id
      [leader, { id: 'member', name: '', perms: [] }, member], // member in the middle
      [leader, { id: 'r0', name: '', perms: [] }, member], // bad custom id
      [leader, { id: 'r100', name: '', perms: [] }, member],
      [leader, { id: 'boss', name: '', perms: [] }, member],
      [leader, { id: 'r1', name: '<script>', perms: [] }, member], // bad title
      [leader, { id: 'r1', name: '', perms: 'bank' }, member], // perms not an array
      [leader, { id: 'r1', name: '' }, member], // perms missing
      [
        leader,
        ...Array.from({ length: GUILD_RANK_MAX - 1 }, (_, i) => ({
          id: `r${i + 1}`,
          name: '',
          perms: [],
        })),
        member,
      ], // one over the maximum
    ];
    for (const ladder of bad) expect(sanitizeGuildRankLadder(ladder)).toBeNull();
  });

  it('accepts exactly GUILD_RANK_MAX ranks', () => {
    const ladder = [
      { id: 'leader', name: '', perms: [] },
      ...Array.from({ length: GUILD_RANK_MAX - 2 }, (_, i) => ({
        id: `r${i + 1}`,
        name: '',
        perms: [],
      })),
      { id: 'member', name: '', perms: [] },
    ];
    expect(sanitizeGuildRankLadder(ladder)).toHaveLength(GUILD_RANK_MAX);
  });

  it('the officer rank is optional (a guild may delete it)', () => {
    expect(
      sanitizeGuildRankLadder([
        { id: 'leader', name: '', perms: [] },
        { id: 'member', name: '', perms: [] },
      ]),
    ).toHaveLength(2);
  });
});

describe('resolveGuildRankLadder (the persisted-row load path)', () => {
  it('NULL and damaged rows resolve to the default ladder', () => {
    expect(resolveGuildRankLadder(null)).toEqual(defaultGuildRankLadder());
    expect(resolveGuildRankLadder(undefined)).toEqual(defaultGuildRankLadder());
    expect(resolveGuildRankLadder([{ id: 'member' }])).toEqual(defaultGuildRankLadder());
  });

  it('a valid stored ladder round-trips through JSON', () => {
    const stored = JSON.parse(JSON.stringify(sanitizeGuildRankLadder(LADDER)));
    expect(resolveGuildRankLadder(stored)).toEqual(sanitizeGuildRankLadder(LADDER));
  });
});

describe('ladder edit helpers', () => {
  it('removedGuildRankIds names the ranks a save drops', () => {
    const after = LADDER.filter((r) => r.id !== 'r1' && r.id !== 'officer');
    expect(removedGuildRankIds(LADDER, after)).toEqual(['officer', 'r1']);
    expect(removedGuildRankIds(LADDER, LADDER)).toEqual([]);
  });

  it('nextCustomGuildRankId picks the lowest unused id and stops at the maximum', () => {
    expect(nextCustomGuildRankId(LADDER)).toBe('r3');
    expect(nextCustomGuildRankId(defaultGuildRankLadder())).toBe('r1');
    const full = [
      LADDER[0],
      ...Array.from({ length: GUILD_RANK_MAX - 2 }, (_, i) => ({
        id: `r${i + 1}`,
        name: '',
        perms: [],
      })),
      LADDER[4],
    ];
    expect(nextCustomGuildRankId(full)).toBeNull();
  });

  it('is deterministic: the same ladder always answers the same', () => {
    const run = () =>
      LADDER.map((r) => [
        guildBankStampRank(LADDER, r.id),
        guildRankPromoteTo(LADDER, 'officer', r.id),
        guildRankDemoteTo(LADDER, 'leader', r.id),
      ]);
    expect(run()).toEqual(run());
  });
});
