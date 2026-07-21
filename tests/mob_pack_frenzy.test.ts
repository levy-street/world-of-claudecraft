// Classic beast "Frenzy": when a wild mob carrying the packFrenzy trait dies,
// nearby living same-family hostile packmates fly into a brief attack-speed
// frenzy. Forest Wolves (a pack mob) carry the trait; killing one should hasten
// the survivors next to it, but not distant ones, other families, or pets.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

function wolves(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && e.ownerId === null,
  );
}

// Lethally strike a target so handleDeath (and frenzyPackmates) runs.
function kill(sim: Sim, victim: Entity) {
  victim.aiState = 'idle';
  victim.auras = [];
  (sim as any).dealDamage(sim.player, victim, victim.hp + 1000, false, 'physical', null, 'hit', true);
}

function frenzy(e: Entity) {
  return e.auras.find((a) => a.id === 'pack_frenzy');
}

describe('pack frenzy on packmate death', () => {
  it('forest_wolf carries the packFrenzy trait', () => {
    expect(MOBS.forest_wolf.packFrenzy).toEqual({ radius: 12, hasteMult: 1.3, duration: 8 });
  });

  it('a nearby wolf frenzies when a packmate dies', () => {
    const sim = makeSim();
    const [victim, survivor] = wolves(sim);
    survivor.pos = { x: victim.pos.x + 4, z: victim.pos.z, y: victim.pos.y };
    survivor.auras = [];
    sim.tick(); // re-bucket the spatial grid so the radius query sees the survivor

    kill(sim, victim);

    const aura = frenzy(survivor);
    expect(aura).toBeTruthy();
    expect(aura!.kind).toBe('buff_haste');
    expect(aura!.value).toBe(1.3);
    expect(aura!.remaining).toBe(8);
  });

  it('the frenzy actually shortens the swing interval', () => {
    const sim = makeSim();
    const [victim, survivor] = wolves(sim);
    survivor.pos = { x: victim.pos.x + 4, z: victim.pos.z, y: victim.pos.y };
    sim.tick();
    const before = (sim as any).swingIntervalMult(survivor);

    kill(sim, victim);

    const after = (sim as any).swingIntervalMult(survivor);
    expect(after).toBeCloseTo(before / 1.3, 5);
  });

  it('does not frenzy a wolf outside the trait radius', () => {
    const sim = makeSim();
    const [victim, survivor] = wolves(sim);
    survivor.pos = { x: victim.pos.x + 50, z: victim.pos.z, y: victim.pos.y }; // > 12yd away
    survivor.auras = [];
    sim.tick();

    kill(sim, victim);

    expect(frenzy(survivor)).toBeUndefined();
  });

  it('refreshes rather than stacks on a second loss', () => {
    const sim = makeSim();
    const ws = wolves(sim);
    const survivor = ws[0];
    const a = ws[1];
    const b = ws[2];
    for (const v of [a, b]) v.pos = { x: survivor.pos.x + 3, z: survivor.pos.z, y: survivor.pos.y };
    survivor.auras = [];
    sim.tick();

    kill(sim, a);
    survivor.auras.find((au) => au.id === 'pack_frenzy')!.remaining = 2; // let it tick down
    kill(sim, b);

    const matches = survivor.auras.filter((au) => au.id === 'pack_frenzy');
    expect(matches.length).toBe(1); // one aura, refreshed
    expect(matches[0].remaining).toBe(8);
  });

  it('does not frenzy a different creature type', () => {
    const sim = makeSim();
    const [victim] = wolves(sim);
    const boar = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'wild_boar' && e.ownerId === null,
    )!;
    boar.pos = { x: victim.pos.x + 4, z: victim.pos.z, y: victim.pos.y };
    boar.auras = [];
    sim.tick();

    kill(sim, victim);

    expect(frenzy(boar)).toBeUndefined();
  });

  it('a dying pet does not frenzy wild mobs', () => {
    const sim = makeSim();
    const [victim, survivor] = wolves(sim);
    survivor.pos = { x: victim.pos.x + 4, z: victim.pos.z, y: victim.pos.y };
    survivor.auras = [];
    victim.ownerId = sim.playerId; // make the victim a pet
    sim.tick();

    kill(sim, victim);

    expect(frenzy(survivor)).toBeUndefined();
  });
});
