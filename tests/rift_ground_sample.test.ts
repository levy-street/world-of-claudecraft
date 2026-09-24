import { describe, expect, it } from 'vitest';
import { createRiftAwareGroundSampler } from '../src/render/rift_ground_sample';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { groundHeight } from '../src/sim/world';
import type { RiftFloorView } from '../src/world_api/dungeons';

describe('Rift aware render ground sampling', () => {
  it('lifts encounter effects onto a cave Hoard boss platform and leaves overworld ground exact', () => {
    const worldSeed = 4242;
    let seed = 0;
    let floor: ReturnType<typeof generateRiftFloor> | undefined;
    for (let random = 0; random < 500; random++) {
      const candidate = makeVaultSeed(0, random, { open: false, zoneId: 'frostveil' });
      const plan = generateRiftFloor(candidate, 20, 0);
      if (plan.platform) {
        seed = candidate;
        floor = plan;
        break;
      }
    }
    if (!floor?.platform) throw new Error('expected a deterministic cave platform seed');
    const origin = { x: 4800, z: -1600 };
    const view: RiftFloorView = {
      eventId: null,
      instanceId: 1,
      seed,
      baseLevel: 20,
      floorIndex: 0,
      floorCount: 1,
      origin,
      contentId: 'hoard-ground-test',
      contentHash: 'hoard-ground-test',
      upgrade: null,
      name: floor.name,
      themeName: floor.themeName,
      tier: 'C',
    };
    let current: RiftFloorView | null = view;
    const sample = createRiftAwareGroundSampler(
      () => worldSeed,
      () => current,
    );
    const bossX = origin.x + floor.layout.dais.x;
    const bossZ = origin.z + floor.layout.dais.z;
    expect(sample(bossX, bossZ)).toBeGreaterThan(groundHeight(bossX, bossZ, worldSeed) + 2);
    current = null;
    expect(sample(bossX, bossZ)).toBe(groundHeight(bossX, bossZ, worldSeed));
  });

  it('keeps effects on the flat ground of an outdoor valley with a raised-theme kit', () => {
    const worldSeed = 4242;
    let seed = 0;
    let floor: ReturnType<typeof generateRiftFloor> | undefined;
    for (let random = 0; random < 500; random++) {
      const candidate = makeVaultSeed(3, random, { open: true, zoneId: 'drakelands' });
      const plan = generateRiftFloor(candidate, 20, 0);
      if (plan.outdoor && plan.style.daisRaised) {
        seed = candidate;
        floor = plan;
        break;
      }
    }
    if (!floor?.outdoor) throw new Error('expected a deterministic raised-theme valley seed');
    const origin = { x: 4800, z: -1600 };
    const view: RiftFloorView = {
      eventId: null,
      instanceId: 2,
      seed,
      baseLevel: 20,
      floorIndex: 0,
      floorCount: 1,
      origin,
      contentId: 'hoard-valley-ground-test',
      contentHash: 'hoard-valley-ground-test',
      upgrade: null,
      name: floor.name,
      themeName: floor.themeName,
      tier: 'S',
    };
    const sample = createRiftAwareGroundSampler(
      () => worldSeed,
      () => view,
    );
    const bossX = origin.x + floor.layout.dais.x;
    const bossZ = origin.z + floor.layout.dais.z;
    expect(sample(bossX, bossZ)).toBeCloseTo(groundHeight(bossX, bossZ, worldSeed), 8);
  });
});
