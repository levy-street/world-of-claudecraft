// Wading (MobTemplate.wadeDepth): a body tall enough to walk THROUGH the fen keeps its
// feet on the bed, while everything without the opt-in keeps the shipped rule.
//
// The failure this pins was caught on screen, not in a test: the first Balgath crossed the
// Mirefen lakes with his boots on the waterline, thirteen yards of granite floating like a
// cork, because the phasing mover's one height rule was "ride the surface". The claim worth
// holding is the byte-identical control: a phasing mover WITHOUT the field still rides the
// surface exactly as before, so every other boss in the world is untouched.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, Vec3, WorldContent } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const BALGATH = 'balgath_cyclops';
const THUNZHARR = 'thunzharr_waking_peak';
// The middle lake of Mirefen (ZONE2_ZONE.lakes): a real declared body of water.
const LAKE = { x: 60, z: 380 };

const WADE_TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

/** The two private movers the test drives directly, plus what it reads back. */
interface MoverSim {
  entities: Map<number, Entity>;
  cfg: { seed: number };
  spawnDevBoss(t: string, x: number, z: number): number;
  moveToward(e: Entity, dest: Vec3, speed: number): boolean;
}

function world(): MoverSim {
  return new Sim({
    seed: 7,
    playerClass: 'warrior',
    autoEquip: true,
    noPlayer: true,
    world: WADE_TEST_WORLD,
  }) as unknown as MoverSim;
}

/** Walk a phasing mover from the lake's east shore into its middle, sampling every tick. */
function wadeIn(
  sim: MoverSim,
  templateId: string,
): { samples: { g: number; wl: number; y: number }[] } {
  const id = sim.spawnDevBoss(templateId, LAKE.x + 40, LAKE.z);
  const mob = sim.entities.get(id) as Entity;
  const samples: { g: number; wl: number; y: number }[] = [];
  for (let i = 0; i < 20 * 12; i++) {
    sim.moveToward(mob, { x: LAKE.x, y: 0, z: LAKE.z }, 5);
    const g = groundHeight(mob.pos.x, mob.pos.z, sim.cfg.seed);
    const wl = waterLevelAt(mob.pos.x, mob.pos.z, sim.cfg.seed);
    if (g < wl) samples.push({ g, wl, y: mob.pos.y });
  }
  return { samples };
}

describe('the opt-in', () => {
  it('is declared by the wading world boss with a depth inside his own height', () => {
    const wade = MOBS[BALGATH]?.wadeDepth;
    expect(wade).toBeDefined();
    if (wade === undefined) return;
    // Deep enough to cross any Mirefen lake, shallower than his 13.4-unit body: a lake
    // deeper than the body would float him rather than drown him.
    expect(wade).toBeGreaterThan(4);
    expect(wade).toBeLessThan(3.2 * (MOBS[BALGATH]?.scale ?? 1) * 0.75);
    expect(MOBS[BALGATH]?.phasesThroughObstacles).toBe(true);
  });

  it('is absent from the other phasing world boss (the control)', () => {
    expect(MOBS[THUNZHARR]?.phasesThroughObstacles).toBe(true);
    expect(MOBS[THUNZHARR]?.wadeDepth).toBeUndefined();
  });
});

describe('a phasing mover in the Mirefen lake', () => {
  it('reaches water deep enough for the two rules to differ', () => {
    const { samples } = wadeIn(world(), BALGATH);
    expect(samples.length).toBeGreaterThan(20);
    expect(Math.max(...samples.map((s) => s.wl - s.g))).toBeGreaterThan(1);
  });

  it('keeps his feet on the bed when he wades', () => {
    const { samples } = wadeIn(world(), BALGATH);
    for (const s of samples) {
      expect(s.y, `feet left the bed at depth ${(s.wl - s.g).toFixed(2)}`).toBeCloseTo(s.g, 6);
      expect(s.y).toBeLessThan(s.wl);
    }
  });

  it('rides the surface without the opt-in, exactly as it always did', () => {
    const sim = world();
    const { samples } = wadeIn(sim, THUNZHARR);
    expect(samples.length).toBeGreaterThan(20);
    let floated = 0;
    for (const s of samples) {
      // The shipped phasing rule: max(ground, swim surface). A bed a hand under the
      // waterline is still the floor; a bed under the swim surface floats him.
      const surface = s.wl - 0.75;
      expect(s.y).toBeCloseTo(Math.max(s.g, surface), 6);
      if (s.y > s.g + 1e-6) floated++;
    }
    // The lake is deep enough that the control really did float, so the wading assertion
    // above proved something.
    expect(floated).toBeGreaterThan(10);
  });
});
