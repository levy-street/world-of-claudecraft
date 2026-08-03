// The relocated Highwatch Stables: the fenced-paddock geometry contract and the
// ambient stable horses (purely decorative, wander the NORTH pasture only, never
// cross the divider into the south yard, never fightable).
import { describe, expect, it } from 'vitest';
import { STABLE_PADDOCK, STABLE_PASTURE } from '../src/sim/content/mounts';
import { ZONE3_PROPS } from '../src/sim/content/zone3';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';

const STABLE_HORSE = 'stable_horse';
// The live world seed (src/main.ts). The stable yard sits on open ground west of
// Highwatch at these heights (verified terrain facts in the task brief).
const WORLD_SEED = 20061;

// Ambient horses only: strip every other camp/NPC/object so the 200 s wander
// window does not run continent AI. Stable horses are ambient (private rng
// sub-stream; no shared-stream draws), so horse positions stay seed-stable
// without the rest of the overworld roster.
const STABLE_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === STABLE_HORSE),
  npcs: {},
  groundObjects: [],
};

const makeStableSim = () =>
  new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true, world: STABLE_TEST_WORLD });

const PADDOCK = STABLE_PADDOCK;
const DIVIDER = STABLE_PADDOCK.divider;

// The stable fence runs (paddock perimeter + interior divider), isolated from the
// town south-gate runs by their endpoints lying on/inside the paddock rectangle.
const inPaddockRect = (x: number, z: number): boolean =>
  x >= PADDOCK.x1 - 1 && x <= PADDOCK.x2 + 1 && z >= PADDOCK.z1 - 1 && z <= PADDOCK.z2 + 1;
const stableFences = ZONE3_PROPS.fences.filter(
  (f) => inPaddockRect(f.x1, f.z1) && inPaddockRect(f.x2, f.z2),
);

// The north pasture: inside the paddock and NORTH of (i.e. at or beyond) the divider.
const inNorthSection = (x: number, z: number): boolean =>
  x >= PADDOCK.pasture.x1 && x <= PADDOCK.x2 && z >= DIVIDER.z && z <= PADDOCK.z2;

function horses(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter((e) => e.templateId === STABLE_HORSE);
}

describe('STABLE_PADDOCK geometry contract', () => {
  it('documents the paddock and its divider', () => {
    expect(PADDOCK.x1).toBe(330);
    expect(PADDOCK.x2).toBe(426);
    expect(PADDOCK.z1).toBe(546);
    expect(PADDOCK.z2).toBe(606);
    expect(PADDOCK.pasture).toEqual({ x1: 380 });
    expect(PADDOCK.entrance).toEqual({ x1: 360, x2: 370 });
    expect(DIVIDER).toEqual({ z: 588 });
  });

  it('derives the pasture from the paddock (north of the divider, inset)', () => {
    expect(STABLE_PASTURE.xMin).toBeGreaterThan(PADDOCK.pasture.x1);
    expect(STABLE_PASTURE.xMax).toBeLessThan(PADDOCK.x2);
    expect(STABLE_PASTURE.zMin).toBeGreaterThan(DIVIDER.z);
    expect(STABLE_PASTURE.zMax).toBeLessThan(PADDOCK.z2);
  });

  it('follows the L-shaped perimeter around the narrower north pasture', () => {
    expect(stableFences.length).toBe(7);
    const north = stableFences.filter((f) => f.z1 === PADDOCK.z2 && f.z2 === PADDOCK.z2);
    expect(north).toEqual([
      { x1: PADDOCK.pasture.x1, z1: PADDOCK.z2, x2: PADDOCK.x2, z2: PADDOCK.z2 },
    ]);
    const west = stableFences.find((f) => f.x1 === PADDOCK.x1 && f.x2 === PADDOCK.x1);
    expect(west?.z2).toBe(DIVIDER.z);
    const notch = stableFences.find(
      (f) => f.x1 === PADDOCK.pasture.x1 && f.x2 === PADDOCK.pasture.x1,
    );
    expect(notch?.z1).toBe(DIVIDER.z);
    expect(notch?.z2).toBe(PADDOCK.z2);
  });

  it('places the barn cluster in the opened northwest notch', () => {
    expect(ZONE3_PROPS.buildings).toContainEqual({
      kind: 'inn',
      x: 352,
      z: 598,
      w: 10,
      d: 8,
      rot: 2.7,
    });
    expect(ZONE3_PROPS.tents).toContainEqual({ x: 375, z: 612, rot: 2.2, scale: 1 });
    expect(ZONE3_PROPS.stalls).toContainEqual({ x: 365, z: 603, rot: 1.2, r: 1.6 });
    expect(ZONE3_PROPS.wells).toContainEqual({ x: 375, z: 603, r: 1.5 });
  });

  it('fully closes the horse pasture and leaves one entrance beside the barn', () => {
    const dividerRuns = stableFences.filter((f) => f.z1 === DIVIDER.z && f.z2 === DIVIDER.z);
    expect(dividerRuns).toHaveLength(2);
    // The two runs cover the yard's north edge except for its intentional entrance.
    // The east run continues across the whole pasture divider, leaving no horse gap.
    const west = dividerRuns.find((f) => f.x1 === PADDOCK.x1);
    const east = dividerRuns.find((f) => f.x2 === PADDOCK.x2);
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    expect(west!.x2).toBe(PADDOCK.entrance.x1);
    expect(east!.x1).toBe(PADDOCK.entrance.x2);
    expect(east!.x1).toBeLessThan(PADDOCK.pasture.x1);
  });
});

describe('ambient stable horses', () => {
  it('spawns exactly three, all in the north pasture', () => {
    const sim = makeStableSim();
    const hs = horses(sim);
    expect(hs).toHaveLength(3);
    for (const h of hs) {
      expect(inNorthSection(h.pos.x, h.pos.z), `horse spawn ${h.pos.x},${h.pos.z}`).toBe(true);
    }
  });

  // 90s budget: this drives a long real-world tick run (7 to 8s locally) and
  // has hit the 30s default under CI core contention.
  it('stays non-hostile, idle, and in the north pasture over a long run, and wanders', () => {
    const sim = makeStableSim();
    const hs = horses(sim);
    const spawns = hs.map((h) => ({ x: h.pos.x, z: h.pos.z }));
    let maxDisplacement = 0;
    for (let t = 0; t < 20 * 200; t++) {
      sim.tick();
      hs.forEach((h, i) => {
        expect(h.hostile, 'horse never hostile').toBe(false);
        expect(h.inCombat, 'horse never in combat').toBe(false);
        expect(h.aiState, 'horse stays idle').toBe('idle');
        expect(h.dead, 'horse never dies').toBe(false);
        // Never cross the divider south into the open yard.
        expect(
          h.pos.z,
          `horse ${i} stays north of the divider at ${h.pos.x},${h.pos.z}`,
        ).toBeGreaterThanOrEqual(DIVIDER.z);
        expect(
          inNorthSection(h.pos.x, h.pos.z),
          `horse ${i} in pasture at ${h.pos.x},${h.pos.z}`,
        ).toBe(true);
        maxDisplacement = Math.max(
          maxDisplacement,
          Math.hypot(h.pos.x - spawns[i].x, h.pos.z - spawns[i].z),
        );
      });
    }
    // They actually amble (the wander drew rng and moved a horse off its spawn).
    expect(maxDisplacement).toBeGreaterThan(1);
  }, 90_000);

  it('cannot be targeted as an enemy, attacked, or damaged by a player', () => {
    const sim = makeStableSim();
    for (let t = 0; t < 5; t++) sim.tick(); // let the ambient arm settle hostility
    const horse = horses(sim)[0];
    const p = sim.player;
    // Stand the player right on top of the horse.
    p.pos = { ...horse.pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);

    // Tab / nearest-enemy must skip it (isHostileTo is false for a non-hostile mob).
    p.targetId = null;
    sim.targetNearestEnemy(p.id);
    expect(p.targetId).not.toBe(horse.id);

    // Even hard-selected, auto-attack is refused with an error and the horse is
    // never pulled into combat.
    sim.targetEntity(horse.id, p.id);
    const events = sim.tick();
    sim.startAutoAttack(p.id);
    const afterAttack = sim.tick();
    expect(p.autoAttack).toBe(false);
    expect([...events, ...afterAttack].some((e) => e.type === 'error')).toBe(true);
    expect(horse.aggroTargetId).toBeNull();

    const hpBefore = horse.hp;
    for (let t = 0; t < 40; t++) sim.tick();
    expect(horse.hp).toBe(hpBefore);
    expect(horse.dead).toBe(false);
    expect(horse.hostile).toBe(false);
  }, 15000);

  it('is deterministic (same seed -> same horse positions)', () => {
    const run = () => {
      const sim = makeStableSim();
      for (let t = 0; t < 20 * 30; t++) sim.tick();
      return horses(sim)
        .map((h) => `${h.pos.x.toFixed(4)},${h.pos.z.toFixed(4)}`)
        .join('|');
    };
    expect(run()).toBe(run());
  }, 15000);
});
