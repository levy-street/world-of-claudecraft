import { describe, expect, it } from 'vitest';
import { createCampSpawnRngSelector } from '../src/sim/camp_spawn_rng';
import { Rng } from '../src/sim/rng';

const CAMP = { center: { x: 812.5, z: -37.5 }, sharedRngCount: 2 };

describe('camp construction rng selection', () => {
  it('keeps the declared prefix on the shared stream and isolates the tail', () => {
    const shared = new Rng(17);
    let sharedDraws = 0;
    shared.setObserver(() => sharedDraws++);
    const rngForSpawn = createCampSpawnRngSelector(shared, 1337, CAMP);

    expect(rngForSpawn(0)).toBe(shared);
    expect(rngForSpawn(1)).toBe(shared);
    expect(rngForSpawn(2)).not.toBe(shared);
    expect(rngForSpawn(3)).toBe(rngForSpawn(2));
    rngForSpawn(0).next();
    rngForSpawn(1).next();
    rngForSpawn(2).next();
    rngForSpawn(3).next();
    expect(sharedDraws).toBe(2);
  });

  it('is private-tail deterministic and consumes no shared draw while selecting', () => {
    const build = () => {
      const shared = new Rng(99);
      let sharedDraws = 0;
      shared.setObserver(() => sharedDraws++);
      const select = createCampSpawnRngSelector(shared, 4242, CAMP);
      const tail = [select(2).next(), select(3).next(), select(4).next()];
      return { sharedDraws, tail, nextShared: shared.next() };
    };

    const first = build();
    const second = build();
    expect(first.tail).toEqual(second.tail);
    expect(first.sharedDraws).toBe(0);
    expect(second.sharedDraws).toBe(0);
    expect(first.nextShared).toBe(second.nextShared);
  });

  it('uses the shared stream for every spawn when no quota is declared', () => {
    const shared = new Rng(7);
    const select = createCampSpawnRngSelector(shared, 1337, {
      center: CAMP.center,
      sharedRngCount: undefined,
    });
    expect([select(0), select(50), select(500)]).toEqual([shared, shared, shared]);
  });
});
