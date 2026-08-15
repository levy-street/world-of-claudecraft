import { describe, expect, it } from 'vitest';

import { spawnWidowHatchlingOnEggDeath } from '../src/sim/mob/egg_hatchling';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

// Direct unit coverage for the one new rng-drawing module of the dedupe pass:
// a destroyed Broodmother egg has a 50% chance to hatch a widow hatchling that
// swarms the destroying player. The rng stub counts draws so the
// determinism-relevant case (no draw at all when the owner cannot be credited)
// is pinned, not just the spawn outcomes.
describe('egg hatchling spawn (spawnWidowHatchlingOnEggDeath)', () => {
  const makeCtx = (opts: { chance: boolean; owner?: Entity | null }) => {
    const added: Entity[] = [];
    const entities = new Map<number, Entity>();
    if (opts.owner) entities.set(opts.owner.id, opts.owner);
    let draws = 0;
    const ctx = {
      entities,
      nextId: 100,
      rng: {
        chance: () => {
          draws++;
          return opts.chance;
        },
      },
      addEntity: (e: Entity) => {
        added.push(e);
        entities.set(e.id, e);
      },
    } as unknown as SimContext;
    return { ctx, added, draws: () => draws };
  };
  const egg = {
    id: 50,
    kind: 'mob',
    templateId: 'spider_egg',
    pos: { x: 3, y: 0, z: 4 },
  } as unknown as Entity;
  const player = (over: Partial<Entity> = {}): Entity =>
    ({
      id: 1,
      kind: 'player',
      dead: false,
      ownerId: null,
      pos: { x: 0, y: 0, z: 0 },
      ...over,
    }) as unknown as Entity;

  it('hatches a widow hatchling on the 50% roll, aggroed onto the destroyer', () => {
    const owner = player();
    const { ctx, added, draws } = makeCtx({ chance: true, owner });
    spawnWidowHatchlingOnEggDeath(ctx, egg, owner);
    expect(draws()).toBe(1);
    expect(added).toHaveLength(1);
    const hatchling = added[0];
    expect(hatchling.templateId).toBe('widow_hatchling');
    expect(hatchling.summonedAdd).toBe(true);
    expect(hatchling.leashDespawnSecs).toBe(120);
    expect(hatchling.aggroTargetId).toBe(owner.id);
    expect(hatchling.pos.x).toBe(egg.pos.x);
    expect(hatchling.pos.z).toBe(egg.pos.z);
  });

  it('spawns nothing when the roll misses', () => {
    const owner = player();
    const { ctx, added, draws } = makeCtx({ chance: false, owner });
    spawnWidowHatchlingOnEggDeath(ctx, egg, owner);
    expect(draws()).toBe(1);
    expect(added).toHaveLength(0);
  });

  it('credits a pet kill to the pet owner', () => {
    const owner = player();
    const { ctx, added } = makeCtx({ chance: true, owner });
    const pet = {
      id: 9,
      kind: 'mob',
      ownerId: owner.id,
      pos: { x: 0, y: 0, z: 0 },
    } as unknown as Entity;
    spawnWidowHatchlingOnEggDeath(ctx, egg, pet);
    expect(added).toHaveLength(1);
    expect(added[0].aggroTargetId).toBe(owner.id);
  });

  it('draws NO rng when the destroying owner is dead or missing', () => {
    // Determinism-relevant: the draw is conditionally skipped identically on
    // every host, so the skip conditions are part of the shared-stream contract.
    const dead = player({ dead: true });
    const deadCase = makeCtx({ chance: true, owner: dead });
    spawnWidowHatchlingOnEggDeath(deadCase.ctx, egg, dead);
    expect(deadCase.draws()).toBe(0);
    expect(deadCase.added).toHaveLength(0);
    const orphanPet = {
      id: 9,
      kind: 'mob',
      ownerId: 77,
      pos: { x: 0, y: 0, z: 0 },
    } as unknown as Entity;
    const missingCase = makeCtx({ chance: true, owner: null });
    spawnWidowHatchlingOnEggDeath(missingCase.ctx, egg, orphanPet);
    expect(missingCase.draws()).toBe(0);
    expect(missingCase.added).toHaveLength(0);
  });
});
