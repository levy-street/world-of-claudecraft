import { describe, expect, it } from 'vitest';
import type { PlayerClass } from '../src/sim/types';
import {
  friendRows,
  guildView,
  ignoreRows,
  raidView,
  type SocialTab,
  socialDot,
  socialStructSig,
} from '../src/ui/social_view';
import type {
  FriendInfo,
  GuildInfo,
  GuildMemberInfo,
  PartyInfo,
  PartyMemberInfo,
  SocialInfo,
} from '../src/world_api';

// The social core derives the panel's structural signature (the full-rebuild vs
// refresh-in-place gate) and the per-tab row view models from socialInfo +
// partyInfo. These tests pin (1) the signature stability across no-op content
// ticks, (2) the tab list + permission rules, and (3) the
// ClientWorld-vs-Sim parity: a Sim-shaped and a ClientWorld-mirror-shaped source
// yield identical models.

function friend(over: Partial<FriendInfo> & { name: string }): FriendInfo {
  return {
    id: 1,
    cls: 'warrior',
    level: 10,
    realm: 'Test',
    online: true,
    ...over,
  };
}

function guildMember(over: Partial<GuildMemberInfo> & { name: string }): GuildMemberInfo {
  return { ...friend(over), rank: over.rank ?? 'member' };
}

function partyMember(
  over: Partial<PartyMemberInfo> & { pid: number; group: 1 | 2 },
): PartyMemberInfo {
  return {
    name: `p${over.pid}`,
    cls: 'warrior' as PlayerClass,
    level: 10,
    hp: 100,
    mhp: 100,
    res: 0,
    mres: 0,
    rtype: null,
    x: 0,
    z: 0,
    dead: 0,
    inCombat: 0,
    ...over,
  };
}

const SOCIAL: SocialInfo = {
  friends: [
    friend({ name: 'Aria', online: true, status: 'combat', zone: 'zone:elwynn' }),
    friend({ name: 'Borin', online: false }),
  ],
  blocks: [{ id: 9, name: 'Spammer' }],
  guild: {
    id: 7,
    name: 'Wolves',
    rank: 'leader',
    members: [
      guildMember({ name: 'Me', rank: 'leader' }),
      guildMember({ name: 'Off', rank: 'officer', online: true }),
      guildMember({ name: 'Grunt', rank: 'member', online: false }),
    ],
  } as GuildInfo,
};

describe('socialStructSig', () => {
  it('is stable across a no-op content tick (same tab + structure)', () => {
    const a = socialStructSig('friends', SOCIAL, null);
    // a content-only change (a friend coming online) must NOT change the struct sig
    const moved: SocialInfo = {
      ...SOCIAL,
      friends: [friend({ name: 'Aria', online: false }), friend({ name: 'Borin', online: true })],
    };
    const b = socialStructSig('friends', moved, null);
    expect(b).toBe(a);
  });

  it('changes when the tab, online state, or guild rank changes', () => {
    const base = socialStructSig('friends', SOCIAL, null);
    expect(socialStructSig('guild', SOCIAL, null)).not.toBe(base);
    expect(socialStructSig('friends', null, null)).not.toBe(base);
    const demoted: SocialInfo = {
      ...SOCIAL,
      guild: { ...(SOCIAL.guild as GuildInfo), rank: 'member' },
    };
    expect(socialStructSig('friends', demoted, null)).not.toBe(base);
  });

  it('encodes the raid roster shape so a regroup forces a rebuild', () => {
    const a: PartyInfo = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [partyMember({ pid: 1, group: 1 }), partyMember({ pid: 2, group: 1 })],
    };
    const b: PartyInfo = {
      ...a,
      members: [partyMember({ pid: 1, group: 1 }), partyMember({ pid: 2, group: 2 })],
    };
    expect(socialStructSig('raid', null, b)).not.toBe(socialStructSig('raid', null, a));
  });
});

describe('socialDot', () => {
  it('is off when offline, the status (or online) when online', () => {
    expect(socialDot(false, 'combat')).toBe('off');
    expect(socialDot(true, undefined)).toBe('online');
    expect(socialDot(true, 'dungeon')).toBe('dungeon');
  });
});

describe('per-tab row models', () => {
  it('derives friend rows in source order with dot kinds', () => {
    const rows = friendRows(SOCIAL);
    expect(rows.map((r) => r.name)).toEqual(['Aria', 'Borin']);
    expect(rows[0].dot).toBe('combat');
    expect(rows[1].dot).toBe('off');
  });

  it('derives ignore rows', () => {
    expect(ignoreRows(SOCIAL).map((r) => r.name)).toEqual(['Spammer']);
    expect(ignoreRows(null)).toEqual([]);
  });

  it('resolves guild action permissions against the viewer rank', () => {
    const view = guildView(SOCIAL, 'Me');
    expect(view.guild?.rows.map((r) => r.name)).toEqual(['Me', 'Off', 'Grunt']);
    const me = view.guild!.rows.find((r) => r.name === 'Me')!;
    expect(me.self).toBe(true);
    expect(me.canKick).toBe(false);
    const off = view.guild!.rows.find((r) => r.name === 'Off')!;
    expect(off.canDemote).toBe(true);
    expect(off.canPromote).toBe(false);
    expect(off.canKick).toBe(true);
    const grunt = view.guild!.rows.find((r) => r.name === 'Grunt')!;
    expect(grunt.canPromote).toBe(true);
    expect(grunt.canTransfer).toBe(true);
  });

  it('returns a null guild for a guildless viewer', () => {
    expect(guildView({ ...SOCIAL, guild: null }, 'Me').guild).toBeNull();
  });
});

describe('raidView', () => {
  it('flags convert eligibility for a 5+ party leader', () => {
    const party: PartyInfo = {
      leader: 1,
      raid: false,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [1, 2, 3, 4, 5].map((pid) => partyMember({ pid, group: 1 })),
    };
    const view = raidView(party, 1);
    expect(view.raid).toBe(false);
    expect(view.canConvert).toBe(true);
    expect(view.canUnconvert).toBe(false);
    expect(raidView(party, 2).canConvert).toBe(false);
  });

  it('builds two groups with hp percent + move eligibility, and un-convert for a small raid', () => {
    const party: PartyInfo = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [
        partyMember({ pid: 1, group: 1, hp: 50, mhp: 200 }),
        partyMember({ pid: 2, group: 2, hp: 100, mhp: 100 }),
      ],
    };
    const view = raidView(party, 1);
    expect(view.raid).toBe(true);
    expect(view.canUnconvert).toBe(true);
    const [g1, g2] = view.groups!;
    expect(g1.members[0].hpPct).toBe(25);
    expect(g1.members[0].isLead).toBe(true);
    expect(g1.members[0].moveTo).toBe(2);
    expect(g2.members[0].moveTo).toBe(1);
  });

  it('hides the move button when the other group is full at 5', () => {
    const members: PartyMemberInfo[] = [
      ...[1, 2, 3, 4, 5].map((pid) => partyMember({ pid, group: 2 })),
      partyMember({ pid: 6, group: 1 }),
    ];
    const view = raidView(
      {
        leader: 1,
        raid: true,
        master: { enabled: false, looter: 0, threshold: 'uncommon' },
        members,
      },
      1,
    );
    const g1 = view.groups![0];
    expect(g1.members[0].moveTo).toBeNull();
  });
});

describe('same input -> same output (pure projection)', () => {
  it('returns deeply-equal models for identical input', () => {
    const tab: SocialTab = 'guild';
    expect(socialStructSig(tab, SOCIAL, null)).toBe(socialStructSig(tab, SOCIAL, null));
    expect(guildView(SOCIAL, 'Me')).toEqual(guildView(SOCIAL, 'Me'));
    expect(friendRows(SOCIAL)).toEqual(friendRows(SOCIAL));
  });
});

describe('ClientWorld-vs-Sim parity', () => {
  // The Sim exposes socialInfo/partyInfo directly; a ClientWorld mirrors them from a
  // server snapshot (a structural clone). Feed BOTH shapes the same logical data and
  // assert identical models, so the offline-only-shape trap (party presence fields)
  // can't drift the panel between the two hosts.
  function simShaped(): { social: SocialInfo; party: PartyInfo } {
    return {
      social: SOCIAL,
      party: {
        leader: 1,
        raid: true,
        master: { enabled: false, looter: 0, threshold: 'uncommon' },
        members: [partyMember({ pid: 1, group: 1 }), partyMember({ pid: 2, group: 2 })],
      },
    };
  }
  function clientShaped(): { social: SocialInfo; party: PartyInfo } {
    const s = simShaped();
    // a ClientWorld mirror is a JSON round-trip of the server snapshot
    return JSON.parse(JSON.stringify(s)) as { social: SocialInfo; party: PartyInfo };
  }

  it('yields identical row + signature models from a Sim-shaped and a mirror-shaped source', () => {
    const sim = simShaped();
    const cli = clientShaped();
    for (const tab of ['friends', 'guild', 'ignore', 'raid'] as SocialTab[]) {
      expect(socialStructSig(tab, sim.social, sim.party)).toBe(
        socialStructSig(tab, cli.social, cli.party),
      );
    }
    expect(friendRows(sim.social)).toEqual(friendRows(cli.social));
    expect(guildView(sim.social, 'Me')).toEqual(guildView(cli.social, 'Me'));
    expect(raidView(sim.party, 1)).toEqual(raidView(cli.party, 1));
  });
});
