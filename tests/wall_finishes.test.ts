import { describe, expect, it } from 'vitest';
import { placementBatchable } from '../src/render/placed_batch_core';
import {
  cloneWallFinishes,
  sanitizeWallFinishes,
  wallFinishTextureRefs,
} from '../src/sim/wall_finishes';

describe('wall finish document contract', () => {
  it('retains two independent sides, bounds numbers, and drops unknown fields', () => {
    expect(
      sanitizeWallFinishes({
        front: { texture: 'Bricks001', tileSize: 0.1, color: -1, path: '/private' },
        back: { color: 0xffffff + 1, tileSize: 80 },
        other: { color: 0 },
      }),
    ).toEqual({
      front: { texture: 'Bricks001', tileSize: 0.5, color: 0 },
      back: { color: 0xffffff, tileSize: 64 },
    });
  });

  it.each([null, [], 3, {}, { front: {} }, { front: { tileSize: 1 } }, { back: { color: NaN } }])(
    'omits empty or malformed finishes %j',
    (value) => expect(sanitizeWallFinishes(value)).toBeUndefined(),
  );

  it.each([
    'https://example.com/image.png',
    '../Stone001',
    'custom:bad',
    `custom:${'A'.repeat(64)}`,
    'x'.repeat(33),
  ])('never accepts an external path or malformed reference %s', (texture) => {
    expect(sanitizeWallFinishes({ front: { texture } })).toBeUndefined();
  });

  it('copies nested records and discovers imported dependencies only once', () => {
    const sha = 'a'.repeat(64);
    const input = {
      front: { texture: `custom:${sha}`, color: 12 },
      back: { texture: `custom:${sha}` },
    };
    const copy = cloneWallFinishes(input);
    if (!copy?.front) throw new Error('Expected cloned front finish');
    copy.front.color = 24;
    expect(input.front.color).toBe(12);
    expect(copy.back).not.toBe(input.back);
    expect(wallFinishTextureRefs(copy)).toEqual([sha]);
    expect(wallFinishTextureRefs(undefined)).toEqual([]);
    expect(wallFinishTextureRefs({ front: { texture: 'Bricks001' } })).toEqual([]);
  });

  it('keeps finished placements out of shared batches', () => {
    const placed = { path: '/wall.glb', x: 0, z: 0, rotY: 0, scale: 1 };
    expect(placementBatchable(placed)).toBe(true);
    expect(placementBatchable({ ...placed, wallFinishes: { back: { color: 0 } } })).toBe(false);
  });
});
