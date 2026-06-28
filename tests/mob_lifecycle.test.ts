// Direct unit tests for the mob death-lifecycle module (src/sim/mob/lifecycle.ts),
// extracted from Sim in session M4. These import the module entry points and drive
// them against a real Sim's SimContext (so dealDamage / dropEntity / rebucket /
// despawnPersistentPet / clearNonPlayerStatAuras / resetNythraxisEncounter + the
// rng/emit/grid/players/entities/cfg primitives resolve through the live seam). They
// prove the slice in isolation: a packFrenzy death buffs same-template neighbors, a
// deathThroes corpse arms then bursts the in-radius player, a slain wild mob resets to
// its spawn point, and a boss's summoned adds are despawned.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  armDeathThroes,
  despawnSummonedAdds,
  detonateCorpse,
  frenzyPackmates,
  respawnMob,
} from '../src/sim/mob/lifecycle';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const SEED = 88;

const makeSim = (cls: PlayerClass = 'warrior') => {
  const sim = new Sim({ seed: SEED, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(12);
  return sim;
};

const ctxOf = (sim: Sim) => (sim as any).ctx;

const spawn = (sim: Sim, key: string, level: number, x = 0, z = 0): any => {
  const mob = createMob((sim as any).nextId++, MOBS[key], level, { x, y: 0, z }) as any;
  (sim as any).addEntity(mob);
  return mob;
};

describe('mob_lifecycle module: frenzyPackmates', () => {
  it('a packFrenzy death gives same-template hostile neighbors the Pack Frenzy haste aura', () => {
    const sim = makeSim();
    const dead = spawn(sim, 'forest_wolf', 5, 0, 0);
    const packA = spawn(sim, 'forest_wolf', 5, 2, 0);
    const packB = spawn(sim, 'forest_wolf', 5, 4, 0);
    const boar = spawn(sim, 'wild_boar', 5, 3, 0); // different template -> unaffected
    for (const m of [packA, packB, boar]) m.hostile = true;

    frenzyPackmates(ctxOf(sim), dead);

    expect(packA.auras.some((a: any) => a.id === 'pack_frenzy' && a.kind === 'buff_haste')).toBe(
      true,
    );
    expect(packB.auras.some((a: any) => a.id === 'pack_frenzy')).toBe(true);
    expect(boar.auras.some((a: any) => a.id === 'pack_frenzy')).toBe(false);
  });

  it('a second death refreshes the aura rather than stacking it', () => {
    const sim = makeSim();
    const dead = spawn(sim, 'forest_wolf', 5, 0, 0);
    const pack = spawn(sim, 'forest_wolf', 5, 2, 0);
    pack.hostile = true;

    frenzyPackmates(ctxOf(sim), dead);
    pack.auras.find((a: any) => a.id === 'pack_frenzy').remaining = 1; // burn it down
    frenzyPackmates(ctxOf(sim), dead); // a second packmate falls

    const frenzies = pack.auras.filter((a: any) => a.id === 'pack_frenzy');
    expect(frenzies.length).toBe(1); // refreshed, not stacked
    expect(frenzies[0].remaining).toBe(MOBS.forest_wolf.packFrenzy!.duration);
  });
});

describe('mob_lifecycle module: Death Throes', () => {
  it('armDeathThroes sets the detonate fuse + emits the swell telegraph', () => {
    const sim = makeSim();
    const bog = spawn(sim, 'bog_bloat', 10, 0, 0);

    armDeathThroes(ctxOf(sim), bog);

    expect(bog.detonateTimer).toBe(MOBS.bog_bloat.deathThroes!.delay);
    const evs = (sim as any).drainEvents() as any[];
    expect(
      evs.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('begins to swell'),
      ),
    ).toBe(true);
  });

  it('detonateCorpse bursts the in-radius player for min..max damage + emits the cloud log', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const bog = spawn(sim, 'bog_bloat', 10, p.pos.x, p.pos.z); // on top of the player -> in blast radius
    const hpBefore = p.hp;

    detonateCorpse(ctxOf(sim), bog);

    expect(p.hp).toBeLessThan(hpBefore); // took the burst
    const evs = (sim as any).drainEvents() as any[];
    expect(
      evs.some(
        (e) =>
          e.type === 'log' && typeof e.text === 'string' && e.text.includes('bursts in a cloud of'),
      ),
    ).toBe(true);
    expect(evs.some((e) => e.type === 'damage' && e.targetId === p.id)).toBe(true);
  });

  it('detonateCorpse on a non-deathThroes mob is a no-op (no rng, no damage)', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const wolf = spawn(sim, 'forest_wolf', 5, p.pos.x, p.pos.z);
    const hpBefore = p.hp;

    detonateCorpse(ctxOf(sim), wolf);

    expect(p.hp).toBe(hpBefore);
  });
});

describe('mob_lifecycle module: respawnMob + despawnSummonedAdds', () => {
  it('respawnMob resets a slain wild mob to its spawn point at full hp, idle', () => {
    const sim = makeSim();
    const mob = spawn(sim, 'forest_wolf', 5, 40, 40);
    mob.spawnPos = { x: 40, y: mob.pos.y, z: 40 };
    // simulate a death far from spawn
    mob.dead = true;
    mob.hp = 0;
    mob.aiState = 'attack';
    mob.inCombat = true;
    mob.pos = { x: 55, y: mob.pos.y, z: 55 };

    respawnMob(ctxOf(sim), mob);

    expect(mob.dead).toBe(false);
    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.aiState).toBe('idle');
    expect(mob.inCombat).toBe(false);
    expect(mob.pos.x).toBe(40);
    expect(mob.pos.z).toBe(40);
    expect(mob.wanderTimer).toBeGreaterThanOrEqual(2);
    expect(mob.wanderTimer).toBeLessThanOrEqual(8);
  });

  it('respawnMob despawns any adds the mob summoned this pull', () => {
    const sim = makeSim();
    const boss = spawn(sim, 'forest_wolf', 5, 40, 40);
    boss.spawnPos = { x: 40, y: boss.pos.y, z: 40 };
    boss.dead = true;
    boss.hp = 0;
    const add = spawn(sim, 'wild_boar', 5, 42, 40);
    boss.summonedIds = [add.id];

    respawnMob(ctxOf(sim), boss);

    expect((sim as any).entities.has(add.id)).toBe(false);
    expect(boss.summonedIds.length).toBe(0);
  });

  it('despawnSummonedAdds drops every add + clears stale player target refs', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const boss = spawn(sim, 'forest_wolf', 5, 40, 40);
    const add = spawn(sim, 'wild_boar', 5, 42, 40);
    boss.summonedIds = [add.id];
    p.targetId = add.id;

    despawnSummonedAdds(ctxOf(sim), boss);

    expect((sim as any).entities.has(add.id)).toBe(false);
    expect(boss.summonedIds.length).toBe(0);
    expect(p.targetId).toBe(null);
  });

  it('despawnSummonedAdds early-returns on a mob with no summons', () => {
    const sim = makeSim();
    const mob = spawn(sim, 'forest_wolf', 5, 40, 40);
    mob.summonedIds = [];
    expect(() => despawnSummonedAdds(ctxOf(sim), mob)).not.toThrow();
    expect(mob.summonedIds.length).toBe(0);
  });
});
