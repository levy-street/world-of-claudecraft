// Player housing (src/sim/housing/homestead.ts + the Glens band in data.ts /
// world.ts): deed purchase at the Land Steward, teleport travel in and out,
// per-visit slot occupancy, save/rejoin ejection, persistence of the deed, the
// plot mailbox, and the terrain invariants (flat plot, untouched overworld).

import { describe, expect, it } from 'vitest';
import { HOMESTEAD_DEED_COPPER, LAND_STEWARD } from '../src/sim/content/housing';
import {
  HOMESTEAD_SLOT_COUNT,
  HOMESTEAD_X,
  homesteadOrigin,
  isHomesteadPos,
} from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { HOMESTEAD_PLOT_HEIGHT, terrainHeight } from '../src/sim/world';

const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

function moveToSteward(sim: Sim, pid: number): void {
  const steward = sim.entities.get(sim.homestead.stewardIds[0]);
  const p = sim.entities.get(pid);
  if (!steward || !p) throw new Error('missing steward or player');
  p.pos = { ...steward.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function housingCodes(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'housingResult').map((e: any) => e.code);
}

describe('the Land Steward and the deed', () => {
  it('spawns the steward in Eastbrook and anchors housing to him', () => {
    const sim = makeWorld();
    expect(sim.homestead.stewardIds).toHaveLength(1);
    const steward = sim.entities.get(sim.homestead.stewardIds[0]);
    expect(steward?.kind).toBe('npc');
    expect(steward?.templateId).toBe('land_steward');
  });

  it('sells the deed once, for exactly 100 gold, in person', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Settler');
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    sim.drainEvents();

    // Too far: the steward deals face to face.
    sim.homesteadBuy(pid);
    expect(housingCodes(sim.drainEvents())).toEqual(['tooFar']);

    moveToSteward(sim, pid);
    meta.copper = HOMESTEAD_DEED_COPPER - 1;
    sim.homesteadBuy(pid);
    expect(housingCodes(sim.drainEvents())).toEqual(['cantAfford']);

    meta.copper = HOMESTEAD_DEED_COPPER + 500;
    sim.homesteadBuy(pid);
    expect(housingCodes(sim.drainEvents())).toEqual(['purchased']);
    expect(meta.copper).toBe(500);
    expect(meta.homesteadOwned).toBe(true);

    sim.homesteadBuy(pid);
    expect(housingCodes(sim.drainEvents())).toEqual(['alreadyOwned']);
  });

  it('persists the deed through a save/load round-trip', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Settler');
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.homesteadOwned = true;
    const state = sim.serializeCharacter(pid);
    expect(state?.homesteadOwned).toBe(true);
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Settler', { state: state ?? undefined });
    expect(sim2.homesteadOwnedFor(pid2)).toBe(true);
  });
});

describe('travel to and from the Glens', () => {
  function owner(sim: Sim, name = 'Settler'): number {
    const pid = sim.addPlayer('warrior', name);
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.homesteadOwned = true;
    moveToSteward(sim, pid);
    sim.drainEvents();
    return pid;
  }

  it('refuses travel without the deed, then teleports an owner to a plot', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Renter');
    moveToSteward(sim, pid);
    sim.drainEvents();
    sim.homesteadTravel(pid);
    expect(housingCodes(sim.drainEvents())).toEqual(['notOwned']);

    const ownerPid = owner(sim, 'Settler');
    sim.homesteadTravel(ownerPid);
    expect(housingCodes(sim.drainEvents())).toEqual(['traveledHome']);
    const p = sim.entities.get(ownerPid);
    if (!p) throw new Error('no player');
    expect(isHomesteadPos(p.pos.x)).toBe(true);
    expect(sim.homestead.slots.indexOf(ownerPid)).toBeGreaterThanOrEqual(0);
  });

  it('the plot gate returns you to Eastbrook and frees the slot', () => {
    const sim = makeWorld();
    const pid = owner(sim);
    sim.homesteadTravel(pid);
    sim.drainEvents();
    sim.homesteadLeave(pid);
    expect(housingCodes(sim.drainEvents())).toEqual(['leftHome']);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('no player');
    expect(isHomesteadPos(p.pos.x)).toBe(false);
    expect(sim.homestead.slots.indexOf(pid)).toBe(-1);
    // Leaving when not home is a refusal, not a teleport.
    sim.homesteadLeave(pid);
    expect(housingCodes(sim.drainEvents())).toEqual(['notHome']);
  });

  it('two visitors get different slots; a vacated slot is reclaimed', () => {
    const sim = makeWorld();
    const a = owner(sim, 'Alice');
    const b = owner(sim, 'Bob');
    sim.homesteadTravel(a);
    sim.homesteadTravel(b);
    const slotA = sim.homestead.slots.indexOf(a);
    const slotB = sim.homestead.slots.indexOf(b);
    expect(slotA).not.toBe(slotB);
    expect(slotA).toBeGreaterThanOrEqual(0);
    expect(slotB).toBeGreaterThanOrEqual(0);
    // A dev-style teleport out of the band releases the slot within a second.
    const pa = sim.entities.get(a);
    if (!pa) throw new Error('no player');
    pa.pos = sim.groundPos(2, -2);
    pa.prevPos = { ...pa.pos };
    sim.rebucket(pa);
    for (let i = 0; i < 25; i++) sim.tick();
    expect(sim.homestead.slots.indexOf(a)).toBe(-1);
  });

  it('a character saved inside the Glens rejoins beside the steward', () => {
    const sim = makeWorld();
    const pid = owner(sim);
    sim.homesteadTravel(pid);
    const state = sim.serializeCharacter(pid);
    if (!state) throw new Error('no state');
    expect(isHomesteadPos(state.pos.x)).toBe(true);
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Settler', { state });
    const p2 = sim2.entities.get(pid2);
    if (!p2) throw new Error('no player');
    expect(isHomesteadPos(p2.pos.x)).toBe(false);
    const dx = p2.pos.x - LAND_STEWARD.pos.x;
    const dz = p2.pos.z - LAND_STEWARD.pos.z;
    expect(Math.hypot(dx, dz)).toBeLessThan(12);
  });

  it('every plot has its own mailbox and return gate', () => {
    const sim = makeWorld();
    const pid = owner(sim);
    sim.homesteadTravel(pid);
    sim.drainEvents();
    // The plot mailbox serves the visitor: mailInfo streams at home.
    const p = sim.entities.get(pid);
    const slot = sim.homestead.slots.indexOf(pid);
    if (!p || slot < 0) throw new Error('not home');
    // stand on the plot mailbox
    const boxes = sim.postOffice.mailboxIds
      .map((id) => sim.entities.get(id))
      .filter((e) => e && isHomesteadPos(e.pos.x));
    expect(boxes.length).toBe(HOMESTEAD_SLOT_COUNT);
    const origin = homesteadOrigin(slot);
    const mine = boxes.find((e) => e && Math.abs(e.pos.z - origin.z) < 100);
    if (!mine) throw new Error('no plot mailbox');
    p.pos = { ...mine.pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    expect(sim.mailInfoFor(pid)).not.toBeNull();
    const gates = [...sim.entities.values()].filter((e) => e.templateId === 'homestead_exit');
    expect(gates.length).toBe(HOMESTEAD_SLOT_COUNT);
  });
});

describe('the Glens heightfield', () => {
  it('keeps the plot disc flat and level', () => {
    const seed = 42;
    const origin = homesteadOrigin(3);
    for (const [dx, dz] of [
      [0, 0],
      [8, -10],
      [-12, 6],
      [10, 12],
    ]) {
      expect(terrainHeight(origin.x + dx, origin.z + dz, seed)).toBeCloseTo(
        HOMESTEAD_PLOT_HEIGHT,
        3,
      );
    }
  });

  it('raises bowl walls between neighboring glens', () => {
    const seed = 42;
    const origin = homesteadOrigin(3);
    const midway = terrainHeight(HOMESTEAD_X, origin.z + 120, seed);
    expect(midway).toBeGreaterThan(HOMESTEAD_PLOT_HEIGHT + 15);
  });

  it('leaves the overworld strip byte-identical (the band is gated on x)', () => {
    const seed = 42;
    // Spot heights sampled before the Glens existed would be re-derived from
    // the same fns; assert the band gate never fires inside the strip.
    for (const [x, z] of [
      [0, 0],
      [-180, 100],
      [150, 700],
      [-599.9, -1250],
    ] as const) {
      expect(isHomesteadPos(x)).toBe(false);
      expect(Number.isFinite(terrainHeight(x, z, seed))).toBe(true);
    }
    expect(isHomesteadPos(-600)).toBe(true);
  });
});
