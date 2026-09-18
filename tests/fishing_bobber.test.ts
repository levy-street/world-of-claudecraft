import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FishingBobberVisual } from '../src/render/fishing_bobber';
import { LAKE } from '../src/sim/content/zone1';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { FISHING_SAMPLE_DISTANCES } from '../src/sim/professions/fishing';
import { Sim } from '../src/sim/sim';
import { FISHING_CAST_ID } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const SEED = 1;

function fishingShoreSpot(): { x: number; z: number; facing: number } {
  for (let r = LAKE.radius * 0.7; r <= LAKE.radius * 1.8; r += 1) {
    for (let i = 0; i < 72; i++) {
      const angle = (i / 72) * Math.PI * 2;
      const x = LAKE.x + Math.cos(angle) * r;
      const z = LAKE.z + Math.sin(angle) * r;
      if (groundHeight(x, z, SEED) < waterLevelAt(x, z, SEED)) continue;
      const facing = Math.atan2(LAKE.x - x, LAKE.z - z);
      const sin = Math.sin(facing);
      const cos = Math.cos(facing);
      const hasFishableSample = FISHING_SAMPLE_DISTANCES.some((distance) => {
        const sampleX = x + sin * distance;
        const sampleZ = z + cos * distance;
        return (
          groundHeight(sampleX, sampleZ, SEED) <
          waterLevelAt(sampleX, sampleZ, SEED) - PLAYER_SWIM_DEPTH
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

    // The renderer's per-view loop notes every drawn angler ahead of update.
    visual.noteAngler(player.id);
    visual.update(0.01, sim.entities, SEED);
    expect(strengths).toEqual([]);

    visual.bite(player.id);
    expect(strengths).toEqual([0.65]);

    visual.noteAngler(player.id);
    visual.update(0.55, sim.entities, SEED);
    expect(strengths).toEqual([0.65, 0.38]);

    player.castingAbility = null;
    visual.update(0.1, sim.entities, SEED);
    expect(strengths).toEqual([0.65, 0.38, 0.35]);

    visual.update(0.1, sim.entities, SEED);
    expect(strengths).toEqual([0.65, 0.38, 0.35]);
  });
});

describe('FishingBobberVisual idle frames', () => {
  it('touches no entity when nobody was noted fishing and no bobber is afloat', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'mage' });
    // Every property read on the roster counts (the map iterator the old walk
    // used, values, get, size, all of them), so any walk at all trips it.
    let touches = 0;
    const entities = new Proxy(sim.entities, {
      get(target, key) {
        touches++;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const visual = new FishingBobberVisual(new THREE.Scene());
    for (let frame = 0; frame < 30; frame++) visual.update(1 / 60, entities, SEED);
    expect(touches).toBe(0);
  });

  it('sinks the bobber of an angler the renderer stopped noting (the view left the draw range)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'mage' });
    const player = sim.player;
    const spot = fishingShoreSpot();
    player.pos.x = spot.x;
    player.pos.z = spot.z;
    player.facing = spot.facing;
    player.castingAbility = FISHING_CAST_ID;
    const strengths: number[] = [];
    const visual = new FishingBobberVisual(new THREE.Scene(), (_x, _z, _radius, strength) => {
      strengths.push(strength);
    });
    visual.noteAngler(player.id);
    visual.update(0.05, sim.entities, SEED);
    visual.update(0.05, sim.entities, SEED);
    expect(strengths).toEqual([0.35]);
  });
});

describe('the renderer is the one producer of noted anglers', () => {
  it('notes every viewed angler in the per-view loop, culled or not, before the bobbers update', () => {
    const renderer = codeWithoutLineComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    const note = renderer.indexOf(
      'if (e.castingAbility === FISHING_CAST_ID) this.fishingBobbers.noteAngler(e.id);',
    );
    expect(note).toBeGreaterThan(-1);
    // Inside the view loop, ahead of the draw-range rejection that hides a far view.
    const loop = renderer.lastIndexOf('for (const [id, v] of this.views) {', note);
    const cull = renderer.indexOf('if (!inDrawRange) {', loop);
    expect(loop).toBeGreaterThan(-1);
    expect(note).toBeLessThan(cull);
    const update = renderer.indexOf(
      'this.fishingBobbers.update(dt, this.sim.entities, this.sim.cfg.seed);',
    );
    expect(update).toBeGreaterThan(note);
    expect(renderer.split('.noteAngler(')).toHaveLength(2);
  });
});
