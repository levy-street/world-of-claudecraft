// Right-click "Make Leader": the party leader can hand leadership to another member.
// Only the current leader may promote; the target must be a different member.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const e = events.find(
    (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid,
  );
  return e?.text;
}

function formParty(sim: Sim, leader: number, members: number[]) {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

describe('party: promote to leader', () => {
  it('the leader can hand leadership to another member, announced to the group', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.tick();
    formParty(sim, a, [b, c]);
    expect(sim.partyOf(a)!.leader).toBe(a);

    sim.events.length = 0;
    sim.partyPromote(b, a);
    expect(sim.partyOf(a)!.leader).toBe(b);
    // the whole group is told who the new leader is
    const announced = sim.events.filter(
      (e) => e.type === 'log' && /Bet is now the party leader/.test((e as { text: string }).text),
    );
    expect(announced.length).toBeGreaterThan(0);
  });

  it('a non-leader cannot promote anyone', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    formParty(sim, a, [b]);

    sim.events.length = 0;
    sim.partyPromote(a, b); // member b tries to seize leadership
    expect(sim.partyOf(a)!.leader).toBe(a); // unchanged
    expect(errorText(sim.events, b)).toMatch(/not the party leader/i);
  });

  it('ignores promoting a non-member or the current leader', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const outsider = sim.addPlayer('priest', 'Stranger');
    sim.tick();
    formParty(sim, a, [b]);

    sim.partyPromote(outsider, a); // not in the party
    expect(sim.partyOf(a)!.leader).toBe(a);
    sim.partyPromote(a, a); // already the leader
    expect(sim.partyOf(a)!.leader).toBe(a);
  });
});
