import { describe, expect, it } from 'vitest';
import {
  PartyFrameProjectionCache,
  type PartyFrameProjectionParty,
} from '../server/party_frame_projection';
import type { Aura } from '../src/sim/types';

function aura(partial: Partial<Aura> & Pick<Aura, 'id' | 'kind'>): Aura {
  return {
    name: partial.id,
    remaining: 10,
    duration: 10,
    value: 1,
    sourceId: 1,
    school: 'holy',
    ...partial,
  } as Aura;
}

const party: PartyFrameProjectionParty = {
  id: 7,
  leader: 11,
  raid: true,
  master: { enabled: true, looter: 11, threshold: 'rare' },
  members: [11, 22, 33],
};

describe('PartyFrameProjectionCache', () => {
  it('projects each member once per broadcast while preserving viewer-owned Echo auras', () => {
    const cache = new PartyFrameProjectionCache();
    let memberProjections = 0;
    let hp = 900;
    const projectMember = (pid: number) => {
      memberProjections++;
      return {
        member: {
          pid,
          name: `Player ${pid}`,
          cls: 'mage' as const,
          level: 60,
          hp,
          mhp: 1_000,
          res: 80,
          mres: 100,
          rtype: 'mana' as const,
          x: pid,
          z: -pid,
          dead: 0,
          inCombat: 1,
          group: 1 as const,
          absorb: 25,
          role: 'healer' as const,
          rewind: 100,
          connected: 1,
          hasAggro: 0,
          incomingHeal: 200,
        },
        auras: [
          // The server cache must discard maintenance buffs and priority-sort
          // actionable rows rather than trusting the entity's aura order.
          aura({ id: 'maintenance', kind: 'buff_ap', value: 2, sourceId: 33 }),
          aura({ id: 'renew', kind: 'hot', value: 20, sourceId: 33 }),
          aura({ id: 'rend', kind: 'dot', value: 5, sourceId: 99 }),
          aura({
            id: 'temporal_echo',
            kind: 'temporal_echo',
            value: 0,
            sourceId: 11,
            remaining: 11.1,
          }),
          aura({
            id: 'temporal_echo',
            kind: 'temporal_echo',
            value: 0,
            sourceId: 22,
            remaining: 22.1,
          }),
          ...Array.from({ length: 7 }, (_, index) =>
            aura({ id: `hot_${index}`, kind: 'hot', value: 20, sourceId: 33 }),
          ),
        ],
      };
    };

    cache.beginBroadcast();
    const forEleven = cache.forViewer(party, 11, projectMember);
    const forTwentyTwo = cache.forViewer(party, 22, projectMember);
    const forThirtyThree = cache.forViewer(party, 33, projectMember);

    // Three viewers of a three-person party must perform three common member
    // projections, not the previous 3 x 3 history/aura projection work.
    expect(memberProjections).toBe(party.members.length);
    expect(forEleven.members[0].auras).toEqual([
      { id: 'rend', kind: 'dot', remaining: 10 },
      { id: 'temporal_echo', kind: 'temporal_echo', remaining: 12 },
      { id: 'renew', kind: 'hot', remaining: 10 },
      { id: 'hot_0', kind: 'hot', remaining: 10 },
      { id: 'hot_1', kind: 'hot', remaining: 10 },
      { id: 'hot_2', kind: 'hot', remaining: 10 },
      { id: 'hot_3', kind: 'hot', remaining: 10 },
      { id: 'hot_4', kind: 'hot', remaining: 10 },
    ]);
    expect(forTwentyTwo.members[0].auras).toEqual([
      { id: 'rend', kind: 'dot', remaining: 10 },
      { id: 'temporal_echo', kind: 'temporal_echo', remaining: 23 },
      { id: 'renew', kind: 'hot', remaining: 10 },
      { id: 'hot_0', kind: 'hot', remaining: 10 },
      { id: 'hot_1', kind: 'hot', remaining: 10 },
      { id: 'hot_2', kind: 'hot', remaining: 10 },
      { id: 'hot_3', kind: 'hot', remaining: 10 },
      { id: 'hot_4', kind: 'hot', remaining: 10 },
    ]);
    expect(forThirtyThree.members[0].auras).toEqual([
      { id: 'rend', kind: 'dot', remaining: 10 },
      { id: 'renew', kind: 'hot', remaining: 10 },
      { id: 'hot_0', kind: 'hot', remaining: 10 },
      { id: 'hot_1', kind: 'hot', remaining: 10 },
      { id: 'hot_2', kind: 'hot', remaining: 10 },
      { id: 'hot_3', kind: 'hot', remaining: 10 },
      { id: 'hot_4', kind: 'hot', remaining: 10 },
      { id: 'hot_5', kind: 'hot', remaining: 10 },
    ]);

    // A second broadcast can happen without a sim tick. It must rebuild from
    // live state rather than reuse the previous broadcast's projection.
    hp = 700;
    cache.beginBroadcast();
    const nextBroadcast = cache.forViewer(party, 11, projectMember);
    expect(memberProjections).toBe(party.members.length * 2);
    expect(nextBroadcast.members[0].hp).toBe(700);
  });

  it('isolates party cache keys and skips members that disappeared during projection', () => {
    const cache = new PartyFrameProjectionCache();
    const firstParty = { ...party, id: 8, members: [11, 22] };
    const secondParty = { ...party, id: 9, leader: 44, members: [44] };
    const projected: number[] = [];
    const projectMember = (pid: number) => {
      projected.push(pid);
      if (pid === 22) return null;
      return {
        member: {
          pid,
          name: `Player ${pid}`,
          cls: 'warrior' as const,
          level: 60,
          hp: 1_000,
          mhp: 1_000,
          res: 0,
          mres: 100,
          rtype: 'rage' as const,
          x: 0,
          z: 0,
          dead: 0,
          inCombat: 0,
          group: 1 as const,
          absorb: 0,
          role: 'dps' as const,
          rewind: 0,
          connected: 1,
          hasAggro: 0,
          incomingHeal: 0,
        },
        auras: [],
      };
    };

    cache.beginBroadcast();
    const first = cache.forViewer(firstParty, 11, projectMember);
    const second = cache.forViewer(secondParty, 44, projectMember);
    const firstAgain = cache.forViewer(firstParty, 11, projectMember);

    expect(first.members.map((member) => member.pid)).toEqual([11]);
    expect(second.members.map((member) => member.pid)).toEqual([44]);
    expect(firstAgain.members.map((member) => member.pid)).toEqual([11]);
    expect(projected).toEqual([11, 22, 44]);
  });
});
