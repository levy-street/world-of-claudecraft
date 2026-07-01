import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeParty() {
  const sim = new Sim({ seed: 73, playerClass: 'warrior', noPlayer: true });
  const leader = sim.addPlayer('warrior', 'Leader');
  const member = sim.addPlayer('priest', 'Member');
  sim.primaryId = leader;
  sim.partyInvite(member, leader);
  sim.partyAccept(member);
  sim.events.length = 0;
  return { sim, leader, member };
}

function lastError(events: SimEvent[], pid: number): string | undefined {
  const errors = events.filter(
    (e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid,
  );
  return errors.at(-1)?.text;
}

describe('party ready check', () => {
  it('lets the party leader start a check with the leader auto-ready and members pending', () => {
    const { sim, leader, member } = makeParty();

    sim.readyCheckStart(leader);

    expect(sim.partyInfo?.readyCheck).toEqual({
      initiator: leader,
      expiresAt: 30,
      responses: { [leader]: 'ready', [member]: 'pending' },
    });
  });

  it('records ready and not-ready responses from party members', () => {
    const { sim, leader, member } = makeParty();
    sim.readyCheckStart(leader);

    sim.readyCheckRespond(false, member);
    expect(sim.partyInfo?.readyCheck?.responses[member]).toBe('not_ready');

    sim.readyCheckRespond(true, member);
    expect(sim.partyInfo?.readyCheck?.responses[member]).toBe('ready');
  });

  it('rejects non-leaders and solo players', () => {
    const { sim, member } = makeParty();

    sim.readyCheckStart(member);
    expect(lastError(sim.events, member)).toBe('You are not the party leader.');
    expect(sim.partyInfo?.readyCheck).toBeNull();

    const solo = sim.addPlayer('mage', 'Solo');
    sim.readyCheckStart(solo);
    expect(lastError(sim.events, solo)).toBe('You are not in a party.');
  });

  it('expires active checks on sim time', () => {
    const { sim, leader } = makeParty();
    sim.readyCheckStart(leader);
    expect(sim.partyInfo?.readyCheck).not.toBeNull();

    sim.time = 30;
    expect(sim.partyInfo?.readyCheck).toBeNull();
  });

  it('routes /readycheck through the chat command parser', () => {
    const { sim, leader, member } = makeParty();

    expect(sim.chat('/readycheck', leader)).toBeNull();

    expect(sim.partyInfo?.readyCheck?.initiator).toBe(leader);
    expect(sim.partyInfo?.readyCheck?.responses[leader]).toBe('ready');
    expect(sim.partyInfo?.readyCheck?.responses[member]).toBe('pending');
  });
});
