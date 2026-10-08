// Balgath's mechanics are sized by the receiving player's level
// (src/sim/mob/mechanic_level_scale.ts, content/zone2.ts mechanicLevelScale): a level 6
// takes exactly the authored range, a level 20 three times it, straight-line between.
// His melee swing, the Barrow Burden soak and anything that lands on a muster soldier
// keep today's numbers. The amounts pinned here are the ones handed to dealDamage, i.e.
// before armor, which is where the scaling applies.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 180_000 });

import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { MUSTER_CRUSH_MULT } from '../src/sim/mob/boss_collateral';
import { levelScaledMechanicDamage, mechanicLevelMult } from '../src/sim/mob/mechanic_level_scale';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, MobTemplate } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const BALGATH = 'balgath_cyclops';
const TPL = MOBS[BALGATH] as MobTemplate;
const SCALE = TPL.mechanicLevelScale;
const LAIR = { x: 147, z: 310 };

interface Internals {
  ctx: SimContext;
  spawnDevBoss(t: string, x: number, z: number): number;
  setGm(pid?: number, on?: boolean): void;
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.onGround = true;
}

interface Hit {
  targetId: number;
  amount: number;
  ability: string | null;
}

/** A solo tester of `level` beside an awake Balgath, with every dealDamage call the boss
 *  makes recorded at the amount it was handed. */
function world(level: number, gap = 8) {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.setPlayerLevel(level);
  const internals = sim as unknown as Internals;
  const id = internals.spawnDevBoss(BALGATH, LAIR.x, LAIR.z);
  const boss = sim.entities.get(id) as Entity;
  place(sim, boss, LAIR.x, LAIR.z);
  const me = sim.player;
  place(sim, me, LAIR.x + gap, LAIR.z);
  internals.setGm(me.id, true);
  const hits: Hit[] = [];
  const ctx = internals.ctx;
  const real = ctx.dealDamage;
  ctx.dealDamage = ((source: Entity | null, target: Entity, amount: number, ...rest: unknown[]) => {
    if (source?.id === boss.id)
      hits.push({ targetId: target.id, amount, ability: (rest[2] as string | null) ?? null });
    return (real as (...a: unknown[]) => unknown)(source, target, amount, ...rest);
  }) as typeof ctx.dealDamage;
  sim.drainEvents();
  return { sim, boss, me, hits };
}

function run(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 20); i++) sim.tick();
  sim.drainEvents();
}

function force(level: number, verb: string, seconds: number, gap = 8): Hit[] {
  const w = world(level, gap);
  w.sim.chat(`/dev balgath ${verb}`, w.me.id);
  run(w.sim, seconds);
  return w.hits.filter((h) => h.targetId === w.me.id);
}

// Every scaled mechanic and its authored (level-6) range.
const r = TPL.rangedMechanics;
const sw = TPL.starwake;
const RANGES: Record<string, [number, number]> = {
  'Barrow Smash': [TPL.aoePulse?.min ?? 0, TPL.aoePulse?.max ?? 0],
  'Shockwave Stomp': [TPL.stomp?.min ?? 0, TPL.stomp?.max ?? 0],
  'Foreman’s Hammer': [TPL.slams?.hammer?.min ?? 0, TPL.slams?.hammer?.max ?? 0],
  'Barrow Cleave': [TPL.slams?.cleave?.min ?? 0, TPL.slams?.cleave?.max ?? 0],
  'Boulder Toss': [r?.boulder?.min ?? 0, r?.boulder?.max ?? 0],
  'Foreman’s Glare': [r?.glare?.min ?? 0, r?.glare?.max ?? 0],
  Barrowfall: [TPL.warpath?.wreck?.min ?? 0, TPL.warpath?.wreck?.max ?? 0],
  Barrowsweep: [TPL.warpath?.swipe?.min ?? 0, TPL.warpath?.swipe?.max ?? 0],
  'Molten Fen': [sw?.pool.min ?? 0, sw?.pool.max ?? 0],
  'Star Debris': [sw?.meteors?.min ?? 0, sw?.meteors?.max ?? 0],
};

function expectScaled(hits: Hit[], name: string, mult: number, range = RANGES[name]): void {
  const mine = hits.filter((h) => h.ability === name);
  expect(mine.length, `${name} landed`).toBeGreaterThan(0);
  for (const h of mine) {
    expect(h.amount, name).toBeGreaterThanOrEqual(Math.round(range[0] * mult));
    expect(h.amount, name).toBeLessThanOrEqual(Math.round(range[1] * mult));
  }
}

describe('the level curve', () => {
  it('is the authored range at level 6 and below, x3 at 20, a straight line between', () => {
    expect(SCALE).toEqual({ fromLevel: 6, toLevel: 20, toMult: 3 });
    expect(mechanicLevelMult(SCALE, 1)).toBe(1);
    expect(mechanicLevelMult(SCALE, 6)).toBe(1);
    expect(mechanicLevelMult(SCALE, 13)).toBeCloseTo(2, 9);
    expect(mechanicLevelMult(SCALE, 20)).toBe(3);
    expect(mechanicLevelMult(SCALE, 25)).toBe(3);
    // Every level adds the same share.
    for (let lv = 6; lv < 20; lv++)
      expect(mechanicLevelMult(SCALE, lv + 1) - mechanicLevelMult(SCALE, lv)).toBeCloseTo(
        2 / 14,
        9,
      );
    // No scale, no change.
    expect(mechanicLevelMult(undefined, 20)).toBe(1);
  });

  it('touches only players, and only for a template that opts in', () => {
    const boss = createMob(1, TPL, 20, { x: 0, y: 0, z: 0 });
    const wolf = createMob(2, MOBS.forest_wolf, 20, { x: 0, y: 0, z: 0 });
    const soldier = createMob(3, MOBS.muster_footman, 12, { x: 0, y: 0, z: 0 });
    const player = { ...wolf, kind: 'player', level: 20 } as Entity;
    expect(levelScaledMechanicDamage(boss, player, 50)).toBe(150);
    expect(levelScaledMechanicDamage(boss, { ...player, level: 6 } as Entity, 50)).toBe(50);
    expect(levelScaledMechanicDamage(boss, soldier, 50)).toBe(50);
    expect(levelScaledMechanicDamage(wolf, player, 50)).toBe(50);
  });

  it('prices each mechanic for a geared level 20 at about a tenth to a quarter of the pool', () => {
    const avg = (n: string) => ((RANGES[n][0] + RANGES[n][1]) / 2) * 3;
    // The heaviest reads land near a fifth of a geared DPS pool (1200 to 1500) ...
    expect(avg('Barrow Cleave')).toBeGreaterThan(250);
    expect(avg('Barrow Cleave')).toBeLessThan(300);
    // ... and even the lightest still bites.
    expect(avg('Shockwave Stomp')).toBeGreaterThanOrEqual(60);
  });
});

describe('each mechanic, level 6 against level 20', () => {
  for (const [verb, name, seconds, gap = 8] of [
    // Inside the smash's solid disc: 8 yards out is its safe gap (sim/boss_ring_gap.ts).
    ['smash', 'Barrow Smash', 7, 3],
    ['stomp', 'Shockwave Stomp', 7, 5],
    ['hammer', 'Foreman’s Hammer', 5],
    ['cleave', 'Barrow Cleave', 5],
    ['boulder', 'Boulder Toss', 5],
    ['glare', 'Foreman’s Glare', 5],
    ['wreck', 'Barrowfall', 6],
  ] as [string, string, number, number?][]) {
    it(`${name}: authored at level 6, three times it at level 20`, () => {
      expectScaled(force(6, verb, seconds, gap), name, 1);
      expectScaled(force(20, verb, seconds, gap), name, 3);
    });
  }

  it('Wake of the Fallen Star: cracks, geysers, pools and meteors all scale', () => {
    for (const [level, mult] of [
      [6, 1],
      [20, 3],
    ] as const) {
      const hits = force(level, 'starwake', 22, 20);
      const f = sw?.fissures;
      const g = sw?.geysers;
      const star = hits.filter((h) => h.ability === 'Wake of the Fallen Star');
      expect(star.length, `level ${level} took the eruption`).toBeGreaterThan(0);
      const lo = Math.round(Math.min(f?.min ?? 0, g?.min ?? 0) * mult);
      const hi = Math.round(Math.max(f?.max ?? 0, g?.max ?? 0) * mult);
      for (const h of star) {
        expect(h.amount).toBeGreaterThanOrEqual(lo);
        expect(h.amount).toBeLessThanOrEqual(hi);
      }
      for (const name of ['Molten Fen', 'Star Debris']) {
        for (const h of hits.filter((x) => x.ability === name)) {
          expect(h.amount, name).toBeGreaterThanOrEqual(Math.round(RANGES[name][0] * mult));
          expect(h.amount, name).toBeLessThanOrEqual(Math.round(RANGES[name][1] * mult));
        }
      }
    }
  });

  it('the Barrow Burden soak stays a share of max health (never level-scaled)', () => {
    for (const level of [6, 20]) {
      const w = world(level, 3);
      w.sim.chat('/dev balgath burden', w.me.id);
      run(w.sim, 9);
      const burden = w.hits.filter((h) => h.targetId === w.me.id && h.ability === 'Barrow Burden');
      expect(burden.length).toBeGreaterThan(0);
      // The soak is a share of max health, never x3 on a level 20.
      for (const h of burden) expect(h.amount).toBeLessThanOrEqual(Math.ceil(w.me.maxHp * 1.1));
    }
  });

  it('every scaled mechanic site asks the one helper (Barrowsweep included)', () => {
    const count = (file: string) =>
      (
        readFileSync(new URL(`../src/sim/mob/${file}`, import.meta.url), 'utf8').match(
          /levelScaledMechanicDamage\(/g,
        ) ?? []
      ).length;
    expect({
      locomotion: count('locomotion.ts'),
      slams: count('boss_slams.ts'),
      ranged: count('boss_ranged_mechanics.ts'),
      starwake: count('boss_starwake.ts'),
      meteors: count('boss_starwake_meteors.ts'),
      warpath: count('warpath.ts'),
    }).toEqual({ locomotion: 2, slams: 2, ranged: 2, starwake: 3, meteors: 1, warpath: 2 });
  });
});

describe('the muster keeps its numbers', () => {
  it('a soldier in Barrow Smash is crushed exactly as before, whatever the level nearby', () => {
    // Both inside the smash's solid disc, clear of its safe gap (sim/boss_ring_gap.ts).
    const w = world(20, 3);
    const soldier = createMob(w.sim.nextId++, MOBS.muster_footman, 12, { x: 0, y: 0, z: 0 });
    w.sim.addEntity(soldier);
    place(w.sim, soldier, LAIR.x - 2, LAIR.z);
    w.sim.chat('/dev balgath smash', w.me.id);
    run(w.sim, 7);
    const onSoldier = w.hits.filter(
      (h) => h.targetId === soldier.id && h.ability === 'Barrow Smash',
    );
    expect(onSoldier.length).toBeGreaterThan(0);
    // Today's rule, untouched by the level curve: the authored midpoint times his collateral
    // share, floored at a crush of four times the soldier's pool (mob/boss_collateral.ts).
    const [lo, hi] = RANGES['Barrow Smash'];
    const today = Math.max(
      Math.max(1, Math.round(((lo + hi) / 2) * (TPL.collateral?.mult ?? 0))),
      soldier.maxHp * MUSTER_CRUSH_MULT,
    );
    for (const h of onSoldier) expect(h.amount).toBe(today);
    // The player beside him took the level-20 size of the same blast.
    expectScaled(
      w.hits.filter((h) => h.targetId === w.me.id),
      'Barrow Smash',
      3,
    );
  });
});
