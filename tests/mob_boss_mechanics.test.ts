// Direct unit tests for the boss support kit module (src/sim/mob/boss_mechanics.ts),
// extracted from Sim in session M5. These import the module entry points and drive
// them against a real Sim's SimContext (so applyHeal / addEntity / groundPos /
// delveRunForMob + the rng/emit/grid/playerGrid/entities/instances/nextId primitives
// resolve through the live seam), the mob_lifecycle (M4) template. They prove the
// slice in isolation: a mendAlly support pulse heals a wounded same-faction neighbor
// through ctx.applyHeal + ctx.rng once its telegraph expires (and never before), and
// spawnBossAdds erupts a wave that lands in the roster, on the boss's summon ledger,
// and in combat with the nearest live player. The behavioral depth (thresholds,
// enrage, ward, rally, warcry, the channel ramp) stays with the existing facade
// suites (mob_rally / mob_ward_allies / mob_mend_ally / mob_desperate_heal /
// mob_warcry / summon_threat_seed), which reach the same bodies through Sim's thin
// delegates.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { spawnBossAdds, updateBossMechanics } from '../src/sim/mob/boss_mechanics';
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

describe('boss_mechanics module: the mendAlly support pulse', () => {
  it('heals a wounded same-faction neighbor once the telegraph expires', () => {
    const sim = makeSim();
    const mender = spawn(sim, 'gravecaller_mender', 12, 0, 0);
    const wounded = spawn(sim, 'forest_wolf', 5, 2, 0);
    mender.hostile = true;
    wounded.hostile = true; // same faction as the mender
    wounded.hp = 1;
    mender.mendTimer = 0; // the telegraph has counted down to the pulse

    updateBossMechanics(ctxOf(sim), mender);

    const def = MOBS.gravecaller_mender.mendAlly!;
    // The heal rides ctx.applyHeal off a ctx.rng roll inside [healMin, healMax].
    expect(wounded.hp).toBeGreaterThanOrEqual(1 + def.healMin);
    expect(wounded.hp).toBeLessThanOrEqual(1 + def.healMax);
    expect(mender.mendTimer).toBe(def.every); // the telegraph re-armed
    const evs = (sim as any).drainEvents() as any[];
    expect(
      evs.some(
        (e) =>
          e.type === 'log' && typeof e.text === 'string' && e.text.includes(`channels ${def.name}`),
      ),
    ).toBe(true);
  });

  it('never pulses while the telegraph is still counting down', () => {
    const sim = makeSim();
    const mender = spawn(sim, 'gravecaller_mender', 12, 0, 0);
    const wounded = spawn(sim, 'forest_wolf', 5, 2, 0);
    mender.hostile = true;
    wounded.hostile = true;
    wounded.hp = 1;
    // createMob seeded mendTimer to the full interval; one call only burns DT.

    updateBossMechanics(ctxOf(sim), mender);

    expect(wounded.hp).toBe(1); // untouched
    const evs = (sim as any).drainEvents() as any[];
    expect(evs.some((e) => e.type === 'log')).toBe(false);
  });
});

describe('boss_mechanics module: spawnBossAdds', () => {
  it('erupts the wave into the roster, the summon ledger, and combat with the nearest player', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const boss = spawn(sim, 'forest_wolf', 8, p.pos.x + 3, p.pos.z);
    boss.hostile = true;

    spawnBossAdds(ctxOf(sim), boss, 'forest_wolf', 2);

    expect(boss.summonedIds.length).toBe(2);
    for (const id of boss.summonedIds) {
      const add = (sim as any).entities.get(id);
      expect(add).toBeTruthy();
      expect(add.summonedAdd).toBe(true); // unravels with its corpse, never respawns
      expect(add.aggroTargetId).toBe(p.id); // the closest-live-player fallback
      expect(add.inCombat).toBe(true);
      expect(add.leashAnchor).toEqual(add.spawnPos); // anchored where it ERUPTED
    }
    const evs = (sim as any).drainEvents() as any[];
    expect(
      evs.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('calls for aid'),
      ),
    ).toBe(true);
  });

  it('an unknown add template spawns nothing and stays silent', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const boss = spawn(sim, 'forest_wolf', 8, p.pos.x + 3, p.pos.z);

    spawnBossAdds(ctxOf(sim), boss, 'no_such_template', 2);

    expect(boss.summonedIds.length).toBe(0);
    const evs = (sim as any).drainEvents() as any[];
    expect(evs.length).toBe(0);
  });
});
