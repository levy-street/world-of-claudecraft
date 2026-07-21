// Direct unit tests for the extracted party/raid state machine (A1). These import
// PartyMachine and drive it against a minimal fake SimContext, so they pin the
// machine's behavior independently of the full Sim. The parity gate (party_raid
// scenario) covers the happy path end to end; these focus on the guard/rejection
// branches and the leadership-handoff / disband teardown.

import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveMasterLooter } from '../src/sim/loot_master';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { PartyMachine } from '../src/sim/social/party';
import type { Entity, SimEvent } from '../src/sim/types';

type Invite = { fromPid: number; expires: number };

// A minimal SimContext that supplies only what PartyMachine reads: resolve/players/
// error/emit/time + the trade/duel invite maps + readyChecks + dropPartyMarkers. The
// rest of the seam is irrelevant to the party machine and left unimplemented.
function makeCtx() {
  const players = new Map<number, PlayerMeta>();
  const tradeInvites = new Map<number, Invite>();
  const duelInvites = new Map<number, Invite>();
  const readyChecks = new Map();
  const events: SimEvent[] = [];
  const errors: { pid: number; text: string }[] = [];
  const droppedMarkers: number[] = [];
  const clock = { time: 0 };

  const ctx = {
    get time() {
      return clock.time;
    },
    get players() {
      return players;
    },
    get tradeInvites() {
      return tradeInvites;
    },
    get duelInvites() {
      return duelInvites;
    },
    get readyChecks() {
      return readyChecks;
    },
    resolve(pid?: number) {
      if (pid === undefined) return null;
      const meta = players.get(pid);
      return meta ? { meta, e: {} as Entity } : null;
    },
    error(pid: number, text: string) {
      errors.push({ pid, text });
    },
    bumpDeedStat() {},
    inheritDungeonResetLocks() {},
    emit(ev: SimEvent) {
      events.push(ev);
    },
    dropPartyMarkers(partyId: number) {
      droppedMarkers.push(partyId);
    },
  } as unknown as SimContext;

  const addPlayer = (pid: number, name: string): number => {
    players.set(pid, { entityId: pid, name } as unknown as PlayerMeta);
    return pid;
  };

  return {
    ctx,
    players,
    tradeInvites,
    duelInvites,
    events,
    errors,
    droppedMarkers,
    clock,
    addPlayer,
  };
}

const logTexts = (events: SimEvent[]): string[] =>
  events.filter((e) => e.type === 'log').map((e) => (e as { text: string }).text);

describe('PartyMachine: dungeon finder formation', () => {
  it('runs reset-lock inheritance for every finder-merged member', () => {
    const t = makeCtx();
    const leader = t.addPlayer(1, 'L');
    const member = t.addPlayer(2, 'M');
    const solo = t.addPlayer(3, 'S');
    (t.ctx as any).entities = { has: () => true };
    const inherited: number[] = [];
    (t.ctx as any).inheritDungeonResetLocks = (pid: number) => inherited.push(pid);
    const party = new PartyMachine(t.ctx);
    party.partyInvite(member, leader);
    party.partyAccept(member);
    // The invite join inherits too; isolate the finder merge below.
    inherited.length = 0;

    const formed = party.formDungeonFinderGroup(
      [
        { partyId: party.partyOf(leader)!.id, leaderPid: leader, members: [leader, member] },
        { partyId: null, leaderPid: solo, members: [solo] },
      ],
      { raid: false },
    );

    expect(formed).not.toBeNull();
    expect(formed!.members).toEqual([leader, member, solo]);
    expect(inherited).toEqual([solo]);
  });
});

describe('PartyMachine: formation', () => {
  it('invite -> accept forms a party with leader + member, both resolving via partyOf', () => {
    const t = makeCtx();
    const a = t.addPlayer(1, 'Aaa');
    const b = t.addPlayer(2, 'Bbb');
    const party = new PartyMachine(t.ctx);

    party.partyInvite(b, a);
    expect(t.events.some((e) => e.type === 'partyInvite')).toBe(true);
    expect(party.partyInvites.has(b)).toBe(true);

    party.partyAccept(b);
    const pa = party.partyOf(a);
    const pb = party.partyOf(b);
    expect(pa).not.toBeNull();
    expect(pa).toBe(pb); // same party object
    expect(pa!.leader).toBe(a);
    expect(pa!.members).toEqual([a, b]);
    expect(pa!.raid).toBe(false);
    expect(party.partyInvites.has(b)).toBe(false); // invite consumed
    expect(logTexts(t.events)).toContain('Bbb joins the party.');
  });

  it('only the leader may invite, and a full party rejects a sixth member', () => {
    const t = makeCtx();
    const leader = t.addPlayer(1, 'L');
    for (let i = 2; i <= 6; i++) t.addPlayer(i, `M${i}`);
    const party = new PartyMachine(t.ctx);
    // fill a party of 5 (leader + 4)
    for (let i = 2; i <= 5; i++) {
      party.partyInvite(i, leader);
      party.partyAccept(i);
    }
    expect(party.partyOf(leader)!.members.length).toBe(5);

    // a non-leader cannot invite
    t.errors.length = 0;
    party.partyInvite(6, 2);
    expect(t.errors.map((e) => e.text)).toContain('Only the party leader may invite.');

    // a full party is full
    t.errors.length = 0;
    party.partyInvite(6, leader);
    expect(t.errors.map((e) => e.text)).toContain('Your party is full.');
    expect(party.partyOf(6)).toBeNull();
  });

  it('a pending social invite (party/trade/duel) blocks a new invite and lazily expires', () => {
    const t = makeCtx();
    const a = t.addPlayer(1, 'A');
    const b = t.addPlayer(2, 'B');
    const party = new PartyMachine(t.ctx);

    // duel invite pending for b -> party invite blocked
    t.duelInvites.set(b, { fromPid: 99, expires: 30 });
    t.clock.time = 0;
    party.partyInvite(b, a);
    expect(t.errors.map((e) => e.text)).toContain('B already has a pending invitation.');

    // advance past expiry: the stale duel invite is lazily dropped, invite succeeds
    t.errors.length = 0;
    t.clock.time = 31;
    party.partyInvite(b, a);
    expect(t.duelInvites.has(b)).toBe(false); // lazily expired by hasActiveInvite
    expect(party.partyInvites.has(b)).toBe(true);
  });
});

describe('PartyMachine: raid conversion + groups', () => {
  function fullParty() {
    const t = makeCtx();
    const leader = t.addPlayer(1, 'L');
    for (let i = 2; i <= 7; i++) t.addPlayer(i, `M${i}`);
    const party = new PartyMachine(t.ctx);
    for (let i = 2; i <= 5; i++) {
      party.partyInvite(i, leader);
      party.partyAccept(i);
    }
    return { t, party, leader };
  }

  it('convertPartyToRaid requires a full party of five', () => {
    const t = makeCtx();
    const leader = t.addPlayer(1, 'L');
    t.addPlayer(2, 'M');
    const party = new PartyMachine(t.ctx);
    party.partyInvite(2, leader);
    party.partyAccept(2); // party of 2
    party.convertPartyToRaid(leader);
    expect(t.errors.map((e) => e.text)).toContain(
      'You need a full party of five before converting to raid.',
    );
    expect(party.partyOf(leader)!.raid).toBe(false);
  });

  it('convert to raid, fill to two subgroups, and reject a full target group', () => {
    const { t, party, leader } = fullParty();
    party.convertPartyToRaid(leader);
    expect(party.partyOf(leader)!.raid).toBe(true);
    // all five normalized into subgroup 1
    const p = party.partyOf(leader)!;
    expect([...p.raidGroups.values()].filter((g) => g === 1).length).toBe(5);

    // invite two more -> subgroup 1 is full (5), so they land in subgroup 2
    for (const i of [6, 7]) {
      party.partyInvite(i, leader);
      party.partyAccept(i);
    }
    expect(p.members.length).toBe(7);
    expect(p.raidGroups.get(6)).toBe(2);
    expect(p.raidGroups.get(7)).toBe(2);

    // moving a member into subgroup 1 (already full at 5) is rejected
    t.errors.length = 0;
    party.moveRaidMember(6, 1, leader);
    expect(t.errors.map((e) => e.text)).toContain('Raid group 1 is full.');
    expect(p.raidGroups.get(6)).toBe(2);

    // moving within capacity succeeds (subgroup 2 has room)
    party.moveRaidMember(2, 2, leader);
    expect(p.raidGroups.get(2)).toBe(2);
    expect(logTexts(t.events)).toContain('M2 has been moved to raid group 2.');
  });

  it('convertRaidToParty rejects a raid with more than five members', () => {
    const { t, party, leader } = fullParty();
    party.convertPartyToRaid(leader);
    for (const i of [6, 7]) {
      party.partyInvite(i, leader);
      party.partyAccept(i);
    }
    t.errors.length = 0;
    party.convertRaidToParty(leader);
    expect(t.errors.map((e) => e.text)).toContain(
      'A raid with more than five members cannot convert back to a party.',
    );
    expect(party.partyOf(leader)!.raid).toBe(true);
  });
});

describe('PartyMachine: teardown', () => {
  it('leader leaving a 3-person party hands leadership to the first remaining member', () => {
    const t = makeCtx();
    const a = t.addPlayer(1, 'Aaa');
    const b = t.addPlayer(2, 'Bbb');
    const c = t.addPlayer(3, 'Ccc');
    const party = new PartyMachine(t.ctx);
    for (const m of [b, c]) {
      party.partyInvite(m, a);
      party.partyAccept(m);
    }
    t.events.length = 0;
    party.partyLeave(a);
    const p = party.partyOf(b);
    expect(p).not.toBeNull();
    expect(p!.leader).toBe(b);
    expect(p!.members).toEqual([b, c]);
    expect(party.partyOf(a)).toBeNull();
    expect(logTexts(t.events)).toContain('Bbb is now the party leader.');
  });

  it('draining to one member disbands the party and drops its markers', () => {
    const t = makeCtx();
    const a = t.addPlayer(1, 'Aaa');
    const b = t.addPlayer(2, 'Bbb');
    const party = new PartyMachine(t.ctx);
    party.partyInvite(b, a);
    party.partyAccept(b);
    const partyId = party.partyOf(a)!.id;

    t.events.length = 0;
    party.partyLeave(b); // drops to 1 -> disband
    expect(party.partyOf(a)).toBeNull();
    expect(party.partyOf(b)).toBeNull();
    expect(party.parties.size).toBe(0);
    expect(logTexts(t.events)).toContain('Your party has disbanded.');
    expect(t.droppedMarkers).toContain(partyId);
  });

  it('partyKick is leader-only and removes the target', () => {
    const t = makeCtx();
    const a = t.addPlayer(1, 'Aaa');
    const b = t.addPlayer(2, 'Bbb');
    const c = t.addPlayer(3, 'Ccc');
    const party = new PartyMachine(t.ctx);
    for (const m of [b, c]) {
      party.partyInvite(m, a);
      party.partyAccept(m);
    }
    // a non-leader cannot kick
    t.errors.length = 0;
    party.partyKick(c, b);
    expect(t.errors.map((e) => e.text)).toContain('You are not the party leader.');
    expect(party.partyOf(c)).not.toBeNull();
    // the leader can
    party.partyKick(c, a);
    expect(party.partyOf(c)).toBeNull();
    expect(party.partyOf(a)!.members).toEqual([a, b]);
  });

  it('partyDecline consumes the invite and notifies the inviter', () => {
    const t = makeCtx();
    const a = t.addPlayer(1, 'Aaa');
    const b = t.addPlayer(2, 'Bbb');
    const party = new PartyMachine(t.ctx);
    party.partyInvite(b, a);
    t.events.length = 0;
    party.partyDecline(b);
    expect(party.partyInvites.has(b)).toBe(false);
    expect(logTexts(t.events)).toContain('Bbb declines your invitation.');
    expect(party.partyOf(b)).toBeNull();
  });
});

describe('PartyMachine: promote to leader', () => {
  function trio() {
    const t = makeCtx();
    const a = t.addPlayer(1, 'Aaa');
    const b = t.addPlayer(2, 'Bbb');
    const c = t.addPlayer(3, 'Ccc');
    const party = new PartyMachine(t.ctx);
    for (const m of [b, c]) {
      party.partyInvite(m, a);
      party.partyAccept(m);
    }
    return { t, party, a, b, c };
  }

  it('the leader can hand leadership to a member, announcing it to everyone', () => {
    const { t, party, a, b } = trio();
    t.events.length = 0;
    party.partyPromote(b, a);
    const p = party.partyOf(a)!;
    expect(p.leader).toBe(b);
    expect(p.members).toEqual([1, 2, 3]); // membership is unchanged by a promote
    expect(logTexts(t.events)).toContain('Bbb is now the party leader.');
  });

  it('a non-leader cannot promote', () => {
    const { t, party, a, b, c } = trio();
    t.errors.length = 0;
    party.partyPromote(c, b); // b is not the leader
    expect(t.errors.map((e) => e.text)).toContain('You are not the party leader.');
    expect(party.partyOf(a)!.leader).toBe(a);
  });

  it('promoting a non-member or yourself is a no-op (no leadership change, no announce)', () => {
    const { t, party, a } = trio();
    t.events.length = 0;
    party.partyPromote(99, a); // not in the party
    party.partyPromote(a, a); // already the leader
    expect(party.partyOf(a)!.leader).toBe(a);
    expect(logTexts(t.events)).not.toContain('Aaa is now the party leader.');
  });

  it('master loot pinned to the leader (looter 0) follows the promotion', () => {
    const { party, a, b } = trio();
    const p = party.partyOf(a)!;
    p.lootStrategies.master = { enabled: true, looter: 0, threshold: 'rare' };
    party.partyPromote(b, a);
    expect(effectiveMasterLooter(p.lootStrategies.master, p.leader, p.members)).toBe(b);
  });
});
