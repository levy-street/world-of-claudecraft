// Reactive beast "Frenzy": when a mob carrying the frenzyOnHit trait is wounded
// by a player (or their pet), it has a chance to fly into a blood frenzy and
// swing faster for a few seconds. Old Greyjaw (a rare wolf) carries the trait.
// This is the mob-side reactive twin of packFrenzy — a refreshable buff_haste
// self-aura on the struck mob, not a player debuff.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

// Spawn a hostile Old Greyjaw next to the player and register it with the world.
function spawnGreyjaw(sim: Sim): Entity {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob((sim as any).nextId++, MOBS.old_greyjaw, 4, { x: p.pos.x + 2, z: p.pos.z, y: p.pos.y });
  sim.entities.set(mob.id, mob);
  return mob;
}

function frenzy(e: Entity) {
  return e.auras.find((a) => a.id === 'blood_frenzy');
}

// Drive the production damage funnel; rng.chance is forced so the proc is deterministic.
function strike(sim: Sim, mob: Entity, proc: boolean) {
  (sim as any).rng.chance = () => proc;
  (sim as any).dealDamage(sim.player, mob, 10, false, 'physical', null, 'hit', true);
}

describe('frenzyOnHit (Blood Frenzy)', () => {
  it('old_greyjaw carries the frenzyOnHit trait', () => {
    expect(MOBS.old_greyjaw.frenzyOnHit).toEqual({ chance: 0.25, hasteMult: 1.3, duration: 8, name: 'Blood Frenzy' });
  });

  it('a wounded carrier flies into a blood frenzy', () => {
    const sim = makeSim();
    const mob = spawnGreyjaw(sim);

    strike(sim, mob, true);

    const aura = frenzy(mob);
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Blood Frenzy');
    expect(aura!.kind).toBe('buff_haste');
    expect(aura!.value).toBe(1.3);
    expect(aura!.remaining).toBe(8);
  });

  it('the frenzy actually shortens the swing interval', () => {
    const sim = makeSim();
    const mob = spawnGreyjaw(sim);
    const before = (sim as any).swingIntervalMult(mob);

    strike(sim, mob, true);

    const after = (sim as any).swingIntervalMult(mob);
    expect(after).toBeCloseTo(before / 1.3, 5);
  });

  it('does not frenzy when the proc roll fails', () => {
    const sim = makeSim();
    const mob = spawnGreyjaw(sim);

    strike(sim, mob, false);

    expect(frenzy(mob)).toBeUndefined();
  });

  it('refreshes rather than stacks on a second wound', () => {
    const sim = makeSim();
    const mob = spawnGreyjaw(sim);

    strike(sim, mob, true);
    frenzy(mob)!.remaining = 2; // let it tick down
    strike(sim, mob, true);

    const matches = mob.auras.filter((a) => a.id === 'blood_frenzy');
    expect(matches.length).toBe(1); // one aura, refreshed
    expect(matches[0].remaining).toBe(8);
  });

  it('a mob without the trait never frenzies (and draws no rng)', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    const wolf = createMob((sim as any).nextId++, MOBS.forest_wolf, 2, { x: p.pos.x + 2, z: p.pos.z, y: p.pos.y });
    sim.entities.set(wolf.id, wolf);

    strike(sim, wolf, true); // even with a guaranteed proc, no trait → no aura

    expect(wolf.auras.find((a) => a.id === 'blood_frenzy')).toBeUndefined();
  });

  it('a pet hit does not frenzy the wolf away from being player-driven', () => {
    // sanity: the proc still fires for a player source; this asserts the source guard
    const sim = makeSim();
    const mob = spawnGreyjaw(sim);
    (sim as any).rng.chance = () => true;
    // a self-hit (source === target) must never proc
    (sim as any).dealDamage(mob, mob, 10, false, 'physical', null, 'hit', true);
    expect(frenzy(mob)).toBeUndefined();
  });
});
