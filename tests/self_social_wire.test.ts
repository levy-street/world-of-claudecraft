// Paired suite for server/self_social_wire.ts: the three pure self-snapshot
// social rows (marks/trade/duel), extracted whole from server/game.ts at
// Masterwrought phase 12. Driven over a real Sim; the end-to-end snapshot
// liveness of the same rows stays in tests/snapshots.test.ts.
import { describe, expect, it } from 'vitest';
import { duelWire, markersWire, tradeWire } from '../server/self_social_wire';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function twoPlayers(): { sim: Sim; a: number; b: number } {
  const sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
  const a = sim.addPlayer('warrior', 'Ada');
  const b = sim.addPlayer('mage', 'Bram');
  // Side by side, so trade and duel requests resolve in range.
  const ea = sim.entities.get(a) as Entity;
  const eb = sim.entities.get(b) as Entity;
  eb.pos.x = ea.pos.x + 1;
  eb.pos.z = ea.pos.z;
  eb.prevPos = { ...eb.pos };
  sim.rebucket(eb);
  return { sim, a, b };
}

describe('self_social_wire', () => {
  it('every row is null for a player outside a party, trade, or duel', () => {
    const { sim, a } = twoPlayers();
    expect(markersWire(sim, a)).toBeNull();
    expect(tradeWire(sim, a)).toBeNull();
    expect(duelWire(sim, a)).toBeNull();
  });

  it('tradeWire is viewer-relative: each side reads its own offer as mine', () => {
    const { sim, a, b } = twoPlayers();
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    const t = sim.tradeFor(a);
    expect(t).toBeTruthy();
    if (!t) return;
    const mine = t.a === a;
    const forA = tradeWire(sim, a) as Record<string, unknown>;
    const forB = tradeWire(sim, b) as Record<string, unknown>;
    expect(forA.otherPid).toBe(b);
    expect(forA.otherName).toBe('Bram');
    expect(forB.otherPid).toBe(a);
    expect(forB.otherName).toBe('Ada');
    // The SAME live offer arrays, viewed from each side.
    expect(forA.myOffer).toBe(mine ? t.offerA : t.offerB);
    expect(forA.theirOffer).toBe(mine ? t.offerB : t.offerA);
    expect(forB.myOffer).toBe(forA.theirOffer);
    expect(forB.theirOffer).toBe(forA.myOffer);
    expect(forA).toMatchObject({ myAccepted: false, theirAccepted: false });
  });

  it('duelWire names the other duelist and the live state', () => {
    const { sim, a, b } = twoPlayers();
    sim.duelRequest(b, a);
    sim.duelAccept(b);
    const d = sim.duelFor(a);
    expect(d).toBeTruthy();
    if (!d) return;
    expect(duelWire(sim, a)).toEqual({ otherPid: b, otherName: 'Bram', state: d.state });
    expect(duelWire(sim, b)).toEqual({ otherPid: a, otherName: 'Ada', state: d.state });
  });

  it('markersWire is the party marker map, and null outside a party even with markers set', () => {
    const { sim, a, b } = twoPlayers();
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.partyOf(a)).toBeTruthy();
    expect(markersWire(sim, a)).toEqual(sim.markersFor(a));
    sim.partyLeave(b);
    // Ada is alone again: the row goes null whatever markersFor would say.
    expect(sim.partyOf(a)).toBeNull();
    expect(markersWire(sim, a)).toBeNull();
  });
});
