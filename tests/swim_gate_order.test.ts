// isSubmerged / isSwimming test the water line BEFORE they sample the ground
// (src/sim/player_motion.ts): the HUD breath bar asks isSubmerged every frame, and
// on dry land the ground sample was pure waste. The pin: across lake basins,
// their shores, and dry land, at feet heights spanning both lines, both answer
// exactly what the original sample-first expressions answered.
import { describe, expect, it } from 'vitest';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { isSubmerged, isSwimming, SWIM_SUBMERGE_EPS } from '../src/sim/player_motion';
import type { Entity } from '../src/sim/types';
import { groundHeightAtBody, waterBodies, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const seed = WORLD_SEED;

// The pre-change bodies, verbatim in effect: sample the ground first, then test.
const swimsAtRef = (y: number, ground: number, level: number) =>
  ground < level - PLAYER_SWIM_DEPTH && y <= level - 0.75 + 0.15;
const submergedRef = (x: number, y: number, z: number) => {
  const ground = groundHeightAtBody(x, z, seed, y);
  const level = waterLevelAt(x, z, seed);
  return swimsAtRef(y, ground, level) && y < level - 0.75 - SWIM_SUBMERGE_EPS;
};
const swimmingRef = (x: number, y: number, z: number) =>
  swimsAtRef(y, groundHeightAtBody(x, z, seed, y), waterLevelAt(x, z, seed));

const body = (x: number, y: number, z: number) => ({ pos: { x, y, z } }) as unknown as Entity;

describe('the swim gates test the water line first', () => {
  it('answer exactly what the sample-first forms answered, wet and dry', () => {
    const lakes = waterBodies().slice(0, 6);
    expect(lakes.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    let cases = 0;
    for (const lake of lakes) {
      // Centre, mid-basin, shoreline and well past the rim: deep water, shallows, dry land.
      for (const f of [0, 0.4, 0.8, 1, 1.3, 2.5]) {
        const x = lake.x + lake.radius * f;
        const z = lake.z;
        const level = waterLevelAt(x, z, seed);
        const ground = groundHeightAtBody(x, z, seed, 0);
        const base = Number.isFinite(level) ? level : ground;
        for (let dy = -4; dy <= 1.5; dy += 0.05) {
          const y = base + dy;
          const sub = isSubmerged(body(x, y, z), seed);
          const swim = isSwimming(body(x, y, z), seed);
          expect(sub).toBe(submergedRef(x, y, z));
          expect(swim).toBe(swimmingRef(x, y, z));
          seen.add(`sub:${sub}`);
          seen.add(`swim:${swim}`);
          // The case the reorder must not get wrong: feet below the line over SHALLOW
          // ground, where the line passes and the ground sample is what says no.
          if (!swim && Number.isFinite(level) && y <= level - 0.6) seen.add('line-only');
          cases++;
        }
      }
    }
    expect([...seen].sort()).toEqual(
      ['line-only', 'sub:false', 'sub:true', 'swim:false', 'swim:true'].sort(),
    );
    expect(cases).toBeGreaterThan(500);
  });
});
