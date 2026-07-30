import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FishingBobberVisual } from '../src/render/fishing_bobber';
import { LAKE } from '../src/sim/content/zone1';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { FISHING_SAMPLE_DISTANCES } from '../src/sim/professions/fishing';
import { Sim } from '../src/sim/sim';
import { FISHING_CAST_ID } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEED = 1;

function fishingShoreSpot(): { x: number; z: number; facing: number } {
  for (let r = LAKE.radius * 0.7; r <= LAKE.radius * 1.8; r += 1) {
    for (let i = 0; i < 72; i++) {
      const angle = (i / 72) * Math.PI * 2;
      const x = LAKE.x + Math.cos(angle) * r;
      const z = LAKE.z + Math.sin(angle) * r;
      if (groundHeight(x, z, SEED) < waterLevelAt(x, z)) continue;
      const facing = Math.atan2(LAKE.x - x, LAKE.z - z);
      const sin = Math.sin(facing);
      const cos = Math.cos(facing);
      const hasFishableSample = FISHING_SAMPLE_DISTANCES.some((distance) => {
        const sampleX = x + sin * distance;
        const sampleZ = z + cos * distance;
        return (
          groundHeight(sampleX, sampleZ, SEED) < waterLevelAt(sampleX, sampleZ) - PLAYER_SWIM_DEPTH
        );
      });
      if (hasFishableSample) return { x, z, facing };
    }
  }
  throw new Error('no fishable shore spot at the test seed');
}

describe('FishingBobberVisual water feedback', () => {
  it('emits one bite, periodic bite, and cast-end splash without duplicating sink feedback', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'mage' });
    const player = sim.player;
    const spot = fishingShoreSpot();
    player.pos.x = spot.x;
    player.pos.y = groundHeight(spot.x, spot.z, SEED);
    player.pos.z = spot.z;
    player.prevPos = { ...player.pos };
    player.facing = spot.facing;
    player.prevFacing = spot.facing;
    player.castingAbility = FISHING_CAST_ID;

    const strengths: number[] = [];
    const visual = new FishingBobberVisual(new THREE.Scene(), (_x, _z, _radius, strength) => {
      strengths.push(strength);
    });

    visual.update(0.01, sim.entities, SEED);
    expect(strengths).toEqual([]);

    visual.bite(player.id);
    expect(strengths).toEqual([0.65]);

    visual.update(0.55, sim.entities, SEED);
    expect(strengths).toEqual([0.65, 0.38]);

    player.castingAbility = null;
    visual.update(0.1, sim.entities, SEED);
    expect(strengths).toEqual([0.65, 0.38, 0.35]);

    visual.update(0.1, sim.entities, SEED);
    expect(strengths).toEqual([0.65, 0.38, 0.35]);
  });
});
