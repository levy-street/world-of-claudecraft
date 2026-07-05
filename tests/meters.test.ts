import { describe, expect, it } from 'vitest';
import { MeterData } from '../src/ui/meters';
import type { IWorld } from '../src/world_api';
import type { SimEvent } from '../src/sim/types';

// minimal IWorld stand-in: entity map + player + party
function fakeWorld(): IWorld {
  const entities = new Map<number, any>();
  entities.set(1, { id: 1, kind: 'player', name: 'Hero', templateId: 'warrior' });
  entities.set(2, { id: 2, kind: 'player', name: 'Pal', templateId: 'priest' });
  entities.set(50, { id: 50, kind: 'mob', name: 'Wolf', maxHp: 60, dead: false, aggroTargetId: 1 });
  entities.set(51, { id: 51, kind: 'mob', name: 'Gorrak', maxHp: 400, dead: false, aggroTargetId: 1 });
  return {
    entities,
    player: entities.get(1),
    partyInfo: { leader: 1, raid: false, members: [{ pid: 2, name: 'Pal', cls: 'priest', group: 1 }] },
  } as unknown as IWorld;
}

const dmg = (sourceId: number, targetId: number, amount: number): SimEvent =>
  ({ type: 'damage', sourceId, targetId, amount, crit: false, school: 'physical', ability: null, kind: 'hit' }) as SimEvent;
const heal = (sourceId: number, targetId: number, amount: number): SimEvent =>
  ({ type: 'heal2', sourceId, targetId, amount, crit: false, ability: 'Heal' }) as SimEvent;

describe('combat meters', () => {
  it('tallies party damage and healing into the current encounter and all-time', () => {
    const w = fakeWorld();
    const party = new Set([1, 2]);
    const m = new MeterData(0);
    m.onEvent(dmg(1, 50, 25), w, party, 1000);
    m.onEvent(dmg(1, 51, 40), w, party, 2000);
    m.onEvent(heal(2, 1, 30), w, party, 2500);
    m.onEvent(dmg(99, 50, 500), w, party, 2600); // outsider — ignored
    expect(m.current).not.toBeNull();
    expect(m.current!.tallies.get(1)!.dmg).toBe(65);
    expect(m.current!.tallies.get(2)!.heal).toBe(30);
    expect(m.current!.tallies.has(99)).toBe(false);
    expect(m.allTime.tallies.get(1)!.dmg).toBe(65);
    // label follows the beefiest mob fought
    expect(m.current!.label).toBe('Gorrak');
    expect(m.current!.mainMobId).toBe(51);
  });

  it('ends the encounter after inactivity once no mob holds aggro, keeping history + all-time', () => {
    const w = fakeWorld();
    const party = new Set([1, 2]);
    const m = new MeterData(0);
    m.onEvent(dmg(1, 50, 10), w, party, 1000);
    // mob still chasing: stays open past the timeout
    m.update(w, party, 10_000);
    expect(m.current).not.toBeNull();
    // mob gives up / dies -> encounter closes
    (w.entities.get(50) as any).aggroTargetId = null;
    (w.entities.get(51) as any).aggroTargetId = null;
    m.update(w, party, 10_001);
    expect(m.current).toBeNull();
    expect(m.history.length).toBe(1);
    expect(m.history[0].tallies.get(1)!.dmg).toBe(10);
    // a new fight starts a fresh encounter; all-time keeps accumulating
    m.onEvent(dmg(1, 50, 7), w, party, 20_000);
    expect(m.current!.tallies.get(1)!.dmg).toBe(7);
    expect(m.allTime.tallies.get(1)!.dmg).toBe(17);
  });

  it('damage taken by a party member keeps the encounter alive but adds no damage row', () => {
    const w = fakeWorld();
    const party = new Set([1, 2]);
    const m = new MeterData(0);
    m.onEvent(dmg(50, 1, 12), w, party, 1000); // wolf bites the tank
    expect(m.current).not.toBeNull();
    expect(m.current!.tallies.size).toBe(0);
  });

  it('can tally controlled pet damage when the HUD includes the pet in the party set', () => {
    const w = fakeWorld();
    const party = new Set([1, 2, 3]);
    (w.entities as Map<number, any>).set(3, { id: 3, kind: 'mob', name: 'Wolf Pet', templateId: 'forest_wolf', ownerId: 1 });
    const m = new MeterData(0);
    m.onEvent(dmg(3, 50, 18), w, party, 1000);
    expect(m.current).not.toBeNull();
    expect(m.current!.tallies.get(3)!.name).toBe('Wolf Pet');
    expect(m.current!.tallies.get(3)!.dmg).toBe(18);
  });
});
