import { describe, expect, it } from 'vitest';
import { computeHeroicLeapLanding } from '../src/sim/combat/heroic_leap';
import { PLAYER_START } from '../src/sim/data';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { bareClient } from './helpers/bare_client';

const EPSILON_DIGITS = 6;

describe('Heroic Leap placement preview', () => {
  const groundedFrom = (x: number, z: number) => ({
    x,
    y: groundHeight(x, z, WORLD_SEED),
    z,
    onGround: true,
  });

  it('keeps an open-ground target unchanged', () => {
    const target = { x: PLAYER_START.x + 8, z: PLAYER_START.z };
    const landing = computeHeroicLeapLanding(
      WORLD_SEED,
      groundedFrom(PLAYER_START.x, PLAYER_START.z),
      target,
    );

    expect(landing.x).toBeCloseTo(target.x, EPSILON_DIGITS);
    expect(landing.z).toBeCloseTo(target.z, EPSILON_DIGITS);
  });

  it('diverts before deep water and matches the resolved Sim landing', () => {
    const from = groundedFrom(-43, 88);
    const target = { x: -68, z: 88 };
    const targetGround = groundHeight(target.x, target.z, WORLD_SEED);
    expect(targetGround).toBeLessThan(
      waterLevelAt(target.x, target.z, WORLD_SEED) - PLAYER_SWIM_DEPTH,
    );

    const preview = computeHeroicLeapLanding(WORLD_SEED, from, target);
    const targetDistance = Math.hypot(target.x - from.x, target.z - from.z);
    const previewDistance = Math.hypot(preview.x - from.x, preview.z - from.z);
    expect(previewDistance).toBeLessThan(targetDistance);

    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(MAX_LEVEL);
    const player = sim.player;
    player.pos = { x: from.x, y: groundHeight(from.x, from.z, WORLD_SEED), z: from.z };
    player.prevPos = { ...player.pos };
    player.fallStartY = player.pos.y;
    player.onGround = true;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.gcdRemaining = 0;

    const facetPreview = sim.groundAimPlacementPreview('heroic_leap', target);
    expect(facetPreview.x).toBeCloseTo(preview.x, EPSILON_DIGITS);
    expect(facetPreview.z).toBeCloseTo(preview.z, EPSILON_DIGITS);

    sim.castAbilityAt('heroic_leap', target);
    expect(player.leap).not.toBeNull();
    for (let tick = 0; tick < 40 && player.leap; tick++) sim.tick();

    expect(player.leap).toBeNull();
    expect(player.pos.x).toBeCloseTo(preview.x, EPSILON_DIGITS);
    expect(player.pos.z).toBeCloseTo(preview.z, EPSILON_DIGITS);
  });

  it('returns non-leap placement points unchanged in both worlds', () => {
    const point = { x: 12.5, z: -7.25 };
    const original = { ...point };
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    const client = bareClient(1);

    expect(sim.groundAimPlacementPreview('charge', point)).toBe(point);
    expect(client.groundAimPlacementPreview('charge', point)).toBe(point);
    expect(point).toEqual(original);
  });
});
