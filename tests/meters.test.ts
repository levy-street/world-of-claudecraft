import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { MeterData } from '../src/ui/meters';
import type { IWorld } from '../src/world_api';

// minimal IWorld stand-in: entity map + player + party
function fakeWorld(): IWorld {
  const entities = new Map<number, any>();
  entities.set(1, { id: 1, kind: 'player', name: 'Hero', templateId: 'warrior' });
  entities.set(2, { id: 2, kind: 'player', name: 'Pal', templateId: 'priest' });
  entities.set(50, { id: 50, kind: 'mob', name: 'Wolf', maxHp: 60, dead: false, aggroTargetId: 1 });
  entities.set(51, {
    id: 51,
    kind: 'mob',
    name: 'Gorrak',
    maxHp: 400,
    dead: false,
    aggroTargetId: 1,
  });
  return {
    entities,
    player: entities.get(1),
    partyInfo: {
      leader: 1,
      raid: false,
      members: [{ pid: 2, name: 'Pal', cls: 'priest', group: 1 }],
    },
  } as unknown as IWorld;
}

const dmg = (sourceId: number, targetId: number, amount: number): SimEvent =>
  ({
    type: 'damage',
    sourceId,
    targetId,
    amount,
    crit: false,
    school: 'physical',
    ability: null,
    kind: 'hit',
  }) as SimEvent;
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

  it('measures DPS against a training dummy and retains the segment after combat ends', () => {
    const w = fakeWorld();
    // a training dummy never holds aggro on a party member (aggroTargetId stays null),
    // so it never keeps the encounter artificially open.
    (w.entities as Map<number, any>).set(70, {
      id: 70,
      kind: 'mob',
      name: 'Training Dummy',
      maxHp: 999999,
      dead: false,
      aggroTargetId: null,
    });
    const party = new Set([1]);
    const m = new MeterData(0);
    // 1000 damage across a 10s window of attacking -> 100 DPS.
    m.onEvent(dmg(1, 70, 400), w, party, 1000);
    m.onEvent(dmg(1, 70, 600), w, party, 11_000);
    m.update(w, party, 11_000);
    expect(m.current!.tallies.get(1)!.dmg).toBe(1000);
    expect(m.current!.label).toBe('Training Dummy');
    // No other mob is engaged (the dummy itself never aggros), so once the inactivity
    // window (ENCOUNTER_END_SECONDS = 5s) elapses the segment closes, landing in history
    // with its measured duration so the meter retains the finished fight's DPS.
    (w.entities.get(50) as any).aggroTargetId = null;
    (w.entities.get(51) as any).aggroTargetId = null;
    m.update(w, party, 11_000 + 5000 + 1);
    expect(m.current).toBeNull();
    expect(m.history.length).toBe(1);
    expect(m.history[0].tallies.get(1)!.dmg).toBe(1000);
    expect(m.history[0].duration).toBe(10); // 1000 dmg / 10s = 100 DPS, retained
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
    (w.entities as Map<number, any>).set(3, {
      id: 3,
      kind: 'mob',
      name: 'Wolf Pet',
      templateId: 'forest_wolf',
      ownerId: 1,
    });
    const m = new MeterData(0);
    m.onEvent(dmg(3, 50, 18), w, party, 1000);
    expect(m.current).not.toBeNull();
    expect(m.current!.tallies.get(3)!.name).toBe('Wolf Pet');
    expect(m.current!.tallies.get(3)!.dmg).toBe(18);
  });

  it('merges a reconnecting party member into one row instead of duplicating them under their new pid', () => {
    const w = fakeWorld();
    const party = new Set([1, 2]);
    const m = new MeterData(0);
    // "Pal" deals damage under their original pid (2)...
    m.onEvent(dmg(2, 50, 20), w, party, 1000);
    // ...then relogs: the server issues a new entity id (3) for the same
    // character, still named "Pal", and the HUD's party-pid set now includes it.
    (w.entities as Map<number, any>).set(3, {
      id: 3,
      kind: 'player',
      name: 'Pal',
      templateId: 'priest',
    });
    (w.partyInfo as any).members = [{ pid: 3, name: 'Pal', cls: 'priest', group: 1 }];
    const party2 = new Set([1, 3]);
    m.onEvent(dmg(3, 50, 30), w, party2, 2000);
    expect(m.current!.tallies.size).toBe(1); // one merged "Pal" row, not two
    const palRows = [...m.current!.tallies.values()].filter((t) => t.name === 'Pal');
    expect(palRows.length).toBe(1);
    expect(palRows[0].dmg).toBe(50);
  });

  it('keeps two live same-named pets in separate rows instead of merging them by name', () => {
    const w = fakeWorld();
    // two warlocks running the same demon template both have a pet named
    // "Imp" (createDemonPet sets pet.name = template.name), each with its
    // own live pid. Both stay in the party set the whole time, so this must
    // never look like a reconnect.
    (w.entities as Map<number, any>).set(10, {
      id: 10,
      kind: 'mob',
      name: 'Imp',
      templateId: 'imp',
      ownerId: 1,
    });
    (w.entities as Map<number, any>).set(11, {
      id: 11,
      kind: 'mob',
      name: 'Imp',
      templateId: 'imp',
      ownerId: 2,
    });
    const party = new Set([1, 2, 10, 11]);
    const m = new MeterData(0);
    m.onEvent(dmg(10, 50, 20), w, party, 1000);
    m.onEvent(dmg(11, 50, 30), w, party, 1500);
    m.onEvent(dmg(10, 50, 5), w, party, 2000);
    expect(m.current!.tallies.size).toBe(2);
    expect(m.current!.tallies.get(10)!.dmg).toBe(25);
    expect(m.current!.tallies.get(11)!.dmg).toBe(30);
  });
});
