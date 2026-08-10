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

const dmg = (
  sourceId: number,
  targetId: number,
  amount: number,
  ability: string | null = null,
): SimEvent =>
  ({
    type: 'damage',
    sourceId,
    targetId,
    amount,
    crit: false,
    school: 'physical',
    ability,
    kind: 'hit',
  }) as SimEvent;
// `ability` sits ahead of `cueOnly`: the per-ability breakdown reads it on most
// calls, while the audio-only HoT cue is the single case that needs the flag.
const heal = (
  sourceId: number,
  targetId: number,
  amount: number,
  ability = 'Heal',
  cueOnly = false,
): SimEvent =>
  ({ type: 'heal2', sourceId, targetId, amount, crit: false, ability, cueOnly }) as SimEvent;

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

  it('ignores a cueOnly heal2 (the HoT-application sound cue): no encounter opens, no tally, no lastActivity bump', () => {
    const w = fakeWorld();
    const party = new Set([1, 2]);
    const m = new MeterData(0);
    m.onEvent(heal(2, 1, 0, 'Heal', true), w, party, 1000);
    expect(m.current).toBeNull();
    expect(m.allTime.tallies.has(2)).toBe(false);
    // a real event afterward opens the encounter fresh, proving the cue left no trace
    m.onEvent(heal(2, 1, 30), w, party, 2000);
    expect(m.current).not.toBeNull();
    expect(m.current!.startedAt).toBe(2000);
    expect(m.current!.tallies.get(2)!.heal).toBe(30);
  });

  it('a genuine amount:0 direct heal (no cueOnly flag) still keeps the encounter alive, just untallied', () => {
    // Distinguishes the cueOnly flag from amount === 0 itself: a real heal
    // that lands for 0 (full HP, fully absorbed) is still party activity,
    // unlike the HoT-application cue above.
    const w = fakeWorld();
    const party = new Set([1, 2]);
    const m = new MeterData(0);
    m.onEvent(heal(2, 1, 0), w, party, 1000);
    expect(m.current).not.toBeNull();
    expect(m.current!.startedAt).toBe(1000);
    expect(m.allTime.tallies.has(2)).toBe(false); // 0-amount still untallied
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

  it('folds controlled pet damage into its owner row instead of giving the pet its own', () => {
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
    m.onEvent(dmg(1, 50, 30, 'Aimed Shot'), w, party, 1000);
    m.onEvent(dmg(3, 50, 18, 'Claw'), w, party, 1100);
    // one row, the owner's, carrying both their own and their pet's damage
    expect(m.current!.tallies.size).toBe(1);
    expect(m.current!.tallies.has(3)).toBe(false);
    const hunter = m.current!.tallies.get(1)!;
    expect(hunter.name).toBe('Hero');
    expect(hunter.dmg).toBe(48);
    // the pet's damage is still attributable in the hover breakdown
    const rows = [...hunter.dmgByAbility.values()];
    expect(rows).toContainEqual({ ability: 'Aimed Shot', petName: null, amount: 30 });
    expect(rows).toContainEqual({ ability: 'Claw', petName: 'Wolf Pet', amount: 18 });
    // the folded pet damage counts toward the owner on the threat-tab fallback
    expect(hunter.dmgByMob.get(50)).toBe(48);
  });

  it('breaks a member damage and healing down per ability, merging repeat casts', () => {
    const w = fakeWorld();
    const party = new Set([1, 2]);
    const m = new MeterData(0);
    m.onEvent(dmg(1, 50, 10), w, party, 1000); // melee swing: ability null
    m.onEvent(dmg(1, 50, 12), w, party, 1500);
    m.onEvent(dmg(1, 50, 40, 'Mortal Strike'), w, party, 2000);
    m.onEvent(heal(2, 1, 30, 'Flash Heal'), w, party, 2500);
    m.onEvent(heal(2, 1, 20, 'Flash Heal'), w, party, 3000);
    m.onEvent(heal(2, 1, 15, 'Renew'), w, party, 3500);
    const warrior = m.current!.tallies.get(1)!;
    expect([...warrior.dmgByAbility.values()]).toEqual([
      { ability: null, petName: null, amount: 22 },
      { ability: 'Mortal Strike', petName: null, amount: 40 },
    ]);
    expect(warrior.healByAbility.size).toBe(0);
    const priest = m.current!.tallies.get(2)!;
    expect([...priest.healByAbility.values()]).toEqual([
      { ability: 'Flash Heal', petName: null, amount: 50 },
      { ability: 'Renew', petName: null, amount: 15 },
    ]);
    // all-time accumulates the same split
    expect([...m.allTime.tallies.get(2)!.healByAbility.values()]).toEqual([
      { ability: 'Flash Heal', petName: null, amount: 50 },
      { ability: 'Renew', petName: null, amount: 15 },
    ]);
  });

  it('folds a pet heal into its owner row too', () => {
    const w = fakeWorld();
    const party = new Set([1, 2, 4]);
    (w.entities as Map<number, any>).set(4, {
      id: 4,
      kind: 'mob',
      name: 'Voidwalker',
      templateId: 'voidwalker',
      ownerId: 2,
    });
    const m = new MeterData(0);
    m.onEvent(heal(4, 1, 25, 'Consume Shadows'), w, party, 1000);
    expect(m.current!.tallies.has(4)).toBe(false);
    const owner = m.current!.tallies.get(2)!;
    expect(owner.name).toBe('Pal');
    expect(owner.heal).toBe(25);
    expect([...owner.healByAbility.values()]).toEqual([
      { ability: 'Consume Shadows', petName: 'Voidwalker', amount: 25 },
    ]);
  });

  it('credits temporary guardian damage to its player owner', () => {
    const w = fakeWorld();
    (w.entities as Map<number, any>).set(4, {
      id: 4,
      kind: 'mob',
      name: 'Tithefiend',
      templateId: 'guardian_tithefiend',
      ownerId: 2,
    });
    const party = new Set([1, 2, 4]);
    const m = new MeterData(0);

    m.onEvent(dmg(4, 50, 22), w, party, 1000);

    expect(m.current).not.toBeNull();
    expect(m.current!.tallies.get(2)).toMatchObject({ name: 'Pal', cls: 'priest', dmg: 22 });
    expect(m.current!.tallies.has(4)).toBe(false);
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

  it('routes two live same-named pets to their own owners, never onto one shared row', () => {
    const w = fakeWorld();
    // two warlocks running the same demon template both have a pet named
    // "Imp" (createDemonPet sets pet.name = template.name), each with its
    // own live pid. Folding by name alone would merge them; folding by ownerId
    // keeps each imp's damage on the warlock that summoned it.
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
    m.onEvent(dmg(10, 50, 20, 'Firebolt'), w, party, 1000);
    m.onEvent(dmg(11, 50, 30, 'Firebolt'), w, party, 1500);
    m.onEvent(dmg(10, 50, 5, 'Firebolt'), w, party, 2000);
    expect(m.current!.tallies.size).toBe(2);
    expect(m.current!.tallies.get(1)!.dmg).toBe(25);
    expect(m.current!.tallies.get(2)!.dmg).toBe(30);
    expect([...m.current!.tallies.get(1)!.dmgByAbility.values()]).toEqual([
      { ability: 'Firebolt', petName: 'Imp', amount: 25 },
    ]);
  });

  it('leaves an unowned mob and a pet whose owner is outside the party off the meter', () => {
    const w = fakeWorld();
    const party = new Set([1, 2]);
    (w.entities as Map<number, any>).set(12, {
      id: 12,
      kind: 'mob',
      name: 'Imp',
      templateId: 'imp',
      ownerId: 99, // a rival warlock's pet: neither it nor its owner is in the party
    });
    const m = new MeterData(0);
    m.onEvent(dmg(12, 50, 40, 'Firebolt'), w, party, 1000);
    // neither side of that hit is ours, so it does not even open an encounter
    expect(m.current).toBeNull();
    // and it must not fold onto pid 99 or onto anyone once the party IS fighting
    m.onEvent(dmg(1, 50, 10), w, party, 1100);
    m.onEvent(dmg(12, 50, 40, 'Firebolt'), w, party, 1200);
    expect([...m.current!.tallies.keys()]).toEqual([1]);
    expect(m.current!.tallies.get(1)!.dmg).toBe(10);
  });
});
