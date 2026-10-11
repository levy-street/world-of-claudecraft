import { describe, expect, it, vi } from 'vitest';
import { TREASURE_SITES } from '../src/sim/content/treasure_maps';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { useTreasureMap } from '../src/sim/treasure_vault';
import { findHoardEntrancePosition } from '../src/sim/treasure_vault_placement';
import type { Entity } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('buried hoard placement', () => {
  it('can place a hatch at every shipped treasure site', () => {
    const ground = (x: number, z: number) => ({ x, y: groundHeight(x, z, WORLD_SEED), z });
    const water = (x: number, z: number) => waterLevelAt(x, z, WORLD_SEED);
    for (const site of TREASURE_SITES) {
      for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        expect(findHoardEntrancePosition(site, facing, ground, water), site.id).not.toBeNull();
      }
    }
  });

  it('keeps the map and progress when the dig cannot fit a safe entrance', () => {
    const site = TREASURE_SITES[3];
    const map = { rarity: 'rare' as const, seed: 17, siteId: site.id };
    // vaultAttemptSeq is the durable attempt counter (627105d708): without it
    // the dig stops at the sequence guard before it ever tries to place.
    const meta = {
      entityId: 1,
      treasureMap: map,
      wireRev: 7,
      vaultAttempt: null,
      vaultAttemptSeq: 0,
    } as unknown as PlayerMeta;
    const player = { pos: { x: site.x, y: -100, z: site.z }, facing: 0 } as Entity;
    const emit = vi.fn();
    const addEntity = vi.fn();
    const consume = vi.fn();
    const ctx = {
      cfg: { seed: WORLD_SEED },
      groundPos: (x: number, z: number) => ({ x, y: Number.NaN, z }),
      emit,
      addEntity,
      nextId: 10,
    } as unknown as SimContext;
    useTreasureMap(ctx, meta, player, 'rare', consume);
    expect(consume).not.toHaveBeenCalled();
    expect(addEntity).not.toHaveBeenCalled();
    expect(meta.treasureMap).toBe(map);
    expect(meta.wireRev).toBe(7);
    expect(meta.vaultAttempt).toBeNull();
    expect(meta.vaultAttemptSeq).toBe(0);
    expect(ctx.nextId).toBe(10);
    expect(emit).toHaveBeenCalledExactlyOnceWith({
      type: 'treasureMapRead',
      rarity: 'rare',
      siteId: site.id,
      fresh: false,
      pid: 1,
    });
  });

  it('keeps the exact five-yard forward position on safe ground', () => {
    const ground = (x: number, z: number) => ({ x, y: 4, z });
    expect(findHoardEntrancePosition({ x: 10, z: 20 }, 0, ground, () => -Infinity)).toEqual({
      x: 10,
      y: 4,
      z: 25,
    });
  });

  it('moves the real Willowfen river dig onto a dry, modest-slope footprint deterministically', () => {
    const ground = (x: number, z: number) => ({ x, y: groundHeight(x, z, WORLD_SEED), z });
    const water = (x: number, z: number) => waterLevelAt(x, z, WORLD_SEED);
    const player = { x: -266, z: 268 };
    const position = findHoardEntrancePosition(player, 0, ground, water);
    expect(position).not.toBeNull();
    expect(position).toEqual(findHoardEntrancePosition(player, 0, ground, water));
    expect(position).not.toEqual(ground(-266, 273));
    const heights: number[] = [];
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        if (x * x + z * z > 9) continue;
        const sample = ground(position!.x + x, position!.z + z);
        expect(sample.y).toBeGreaterThan(water(sample.x, sample.z) + 0.2);
        heights.push(sample.y);
      }
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1.2);
    expect(Math.hypot(position!.x - player.x, position!.z - player.z)).toBeLessThanOrEqual(20.001);
  });

  it('rejects a dry center with a flooded edge and returns null when no safe footprint exists', () => {
    const ground = (x: number, z: number) => ({ x, y: 0, z });
    const water = (x: number, z: number) => (x === 0 && z === 5 ? -Infinity : 1);
    expect(findHoardEntrancePosition({ x: 0, z: 0 }, 0, ground, water)).toBeNull();
  });
});
