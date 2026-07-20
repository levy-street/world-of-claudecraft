// Raid/party ready check (social/ready_check.ts): the leader runs /ready, every other
// member gets a readyCheckStart event, non-responders time out after 30 s, and the
// tally is announced. Uses the sim clock, no rng, so it is deterministic.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { READY_CHECK_SECONDS } from '../src/sim/social/ready_check';
import type { SimEvent } from '../src/sim/types';

function makeParty() {
  const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
  const lead = sim.addPlayer('warrior', 'Lead');
  const mate = sim.addPlayer('mage', 'Mate');
  sim.partyInvite(mate, lead);
  sim.partyAccept(mate);
  return { sim, lead, mate };
}

// Leader plus three members, so a single finalize can produce every tally bucket.
function makeParty4() {
  const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
  const lead = sim.addPlayer('warrior', 'Lead');
  const a = sim.addPlayer('mage', 'Aay');
  const b = sim.addPlayer('priest', 'Bee');
  const c = sim.addPlayer('rogue', 'Cee');
  for (const m of [a, b, c]) {
    sim.partyInvite(m, lead);
    sim.partyAccept(m);
  }
  return { sim, lead, a, b, c };
}

const summaryFor = (evs: SimEvent[], pid: number) =>
  evs.find((e) => e.type === 'log' && e.pid === pid && /^Ready check:/.test((e as any).text));

// The per-member follow-up lines naming who was not ready / never answered.
const nameLinesFor = (evs: SimEvent[], pid: number) =>
  evs
    .filter((e) => e.type === 'log' && e.pid === pid)
    .map((e) => (e as any).text as string)
    .filter((text) => / is not ready\.$| did not respond to the ready check\.$/.test(text));

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

  it('announces a counts-only tally covering every bucket (ready, not ready, no response)', () => {
    const { sim, lead, a, b, c } = makeParty4();
    sim.chat('/ready', lead);
    sim.tick();
    sim.readyCheckRespond(true, a); // Aay: ready (leader is auto-ready -> 2 ready)
    sim.readyCheckRespond(false, b); // Bee: explicit not ready
    expect((sim as any).readyChecks.size).toBe(1); // Cee still pending, not finalized yet
    // Cee never answers: advance past the timeout to finalize as "no response".
    const evs: SimEvent[] = [];
    for (let i = 0; i < (READY_CHECK_SECONDS + 1) * 20; i++) evs.push(...sim.tick());
    expect((sim as any).readyChecks.size).toBe(0);
    const line = 'Ready check: 2 ready, 1 not ready, 1 no response.';
    // Every participant, including the not-ready and the no-response member, hears it.
    for (const pid of [lead, a, b, c]) {
      expect((summaryFor(evs, pid) as any)?.text).toBe(line);
    }
  });

  it('names each not-ready and no-response member to every participant after the summary', () => {
    const { sim, lead, a, b, c } = makeParty4();
    sim.chat('/ready', lead);
    sim.tick();
    sim.readyCheckRespond(true, a); // Aay: ready
    sim.readyCheckRespond(false, b); // Bee: explicit not ready
    // Cee never answers: advance past the timeout to finalize as "no response".
    const evs: SimEvent[] = [];
    for (let i = 0; i < (READY_CHECK_SECONDS + 1) * 20; i++) evs.push(...sim.tick());
    // One line per non-ready member, states distinguished, ready members never named.
    for (const pid of [lead, a, b, c]) {
      expect(nameLinesFor(evs, pid)).toEqual([
        'Bee is not ready.',
        'Cee did not respond to the ready check.',
      ]);
      // The counts summary always precedes the per-member name lines.
      const logs = evs
        .filter((e) => e.type === 'log' && e.pid === pid)
        .map((e) => (e as any).text as string);
      const summaryAt = logs.findIndex((text) => /^Ready check:/.test(text));
      expect(summaryAt).toBeGreaterThanOrEqual(0);
      expect(logs.indexOf('Bee is not ready.')).toBeGreaterThan(summaryAt);
    }
  });

  it('an all-ready check emits the summary only, no per-member name lines', () => {
    const { sim, lead, mate } = makeParty();
    sim.chat('/ready', lead);
    sim.tick();
    sim.readyCheckRespond(true, mate); // everyone answered ready -> finalizes immediately
    const evs: SimEvent[] = [...sim.tick()];
    for (const pid of [lead, mate]) {
      expect((summaryFor(evs, pid) as any)?.text).toBe(
        'Ready check: 2 ready, 0 not ready, 0 no response.',
      );
      expect(nameLinesFor(evs, pid)).toEqual([]);
    }
  });

  it('a member leaving mid-check drops their pending slot so the rest can early-finalize', () => {
    const { sim, lead, a, b } = makeParty4();
    sim.chat('/ready', lead);
    sim.tick();
    sim.readyCheckRespond(true, a);
    sim.readyCheckRespond(true, b);
    // Only Cee is still pending; nobody has timed out, so the check is live.
    expect((sim as any).readyChecks.size).toBe(1);
    // Cee leaves: their pending response is removed, leaving no one pending -> finalize.
    const cee = [...(sim as any).players.keys()].find(
      (p: number) => p !== lead && p !== a && p !== b,
    ) as number;
    sim.removePlayer(cee);
    // The end-of-tick sweep finalizes now that no one is pending (no full timeout).
    const evs: SimEvent[] = [...sim.tick()];
    expect((sim as any).readyChecks.size).toBe(0);
    // The leaver's slot was dropped, so they count in no bucket and are never named.
    for (const pid of [lead, a, b]) {
      expect((summaryFor(evs, pid) as any)?.text).toBe(
        'Ready check: 3 ready, 0 not ready, 0 no response.',
      );
      expect(nameLinesFor(evs, pid)).toEqual([]);
    }
  });

  it('disbanding the party mid-check clears the check (no orphan summary fires later)', () => {
    const { sim, lead, mate } = makeParty();
    sim.chat('/ready', lead);
    sim.tick();
    expect((sim as any).readyChecks.size).toBe(1);
    // Drop below the 2-member floor: the party disbands and the check goes with it.
    sim.removePlayer(mate);
    expect((sim as any).readyChecks.size).toBe(0);
    // Advancing past the old timeout must not resurrect a summary for a dead party.
    const evs: SimEvent[] = [];
    for (let i = 0; i < (READY_CHECK_SECONDS + 1) * 20; i++) evs.push(...sim.tick());
    expect(summaryFor(evs, lead)).toBeUndefined();
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
