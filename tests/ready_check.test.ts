// Raid/party ready check (social/ready_check.ts): the leader runs /ready, every other
// member gets a readyCheckStart event, non-responders time out after 30 s, and the
// tally is announced. Uses the sim clock, no rng, so it is deterministic.
import { describe, expect, it } from 'vitest';
import { READY_CHECK_SECONDS } from '../src/sim/social/ready_check';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeParty() {
  const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
  const lead = sim.addPlayer('warrior', 'Lead');
  const mate = sim.addPlayer('mage', 'Mate');
  sim.partyInvite(mate, lead);
  sim.partyAccept(mate);
  return { sim, lead, mate };
}

const startEventsFor = (evs: SimEvent[], pid: number) =>
  evs.filter((e) => e.type === 'readyCheckStart' && e.pid === pid);

describe('ready check', () => {
  it('the leader /ready sends a readyCheckStart prompt to the other member (not to themselves)', () => {
    const { sim, lead, mate } = makeParty();
    const evs: SimEvent[] = [];
    // chat() returns nothing actionable; the emits come out of the next tick drain.
    sim.chat('/ready', lead);
    evs.push(...sim.tick());
    expect(startEventsFor(evs, mate)).toHaveLength(1);
    expect(startEventsFor(evs, lead)).toHaveLength(0); // initiator is auto-ready, no prompt
    expect((sim as any).readyChecks.size).toBe(1);
  });

  it('rejects a non-leader and someone with no party', () => {
    const { sim, mate } = makeParty();
    sim.chat('/ready', mate); // member, not leader
    expect((sim as any).readyChecks.size).toBe(0);
    const solo = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const alone = solo.addPlayer('warrior', 'Solo');
    solo.chat('/ready', alone);
    expect((solo as any).readyChecks.size).toBe(0);
  });

  it('finalizes as soon as every member has answered', () => {
    const { sim, lead, mate } = makeParty();
    sim.chat('/ready', lead);
    sim.tick();
    expect((sim as any).readyChecks.size).toBe(1);
    sim.readyCheckRespond(true, mate);
    // leader was auto-ready + mate answered -> no one pending -> finalized immediately
    expect((sim as any).readyChecks.size).toBe(0);
  });

  it('times out after READY_CHECK_SECONDS, marking non-responders and clearing the check', () => {
    const { sim, lead } = makeParty();
    sim.chat('/ready', lead);
    sim.tick();
    expect((sim as any).readyChecks.size).toBe(1);
    // Advance past the timeout (20 ticks per second).
    for (let i = 0; i < (READY_CHECK_SECONDS + 1) * 20; i++) sim.tick();
    expect((sim as any).readyChecks.size).toBe(0); // auto-finalized on timeout
  });

  it('refuses a second concurrent check while one is running', () => {
    const { sim, lead } = makeParty();
    sim.chat('/ready', lead);
    sim.tick();
    const before = (sim as any).readyChecks.get(1)?.endsAt;
    sim.chat('/ready', lead); // already in progress -> ignored
    expect((sim as any).readyChecks.get(1)?.endsAt).toBe(before);
  });
});
