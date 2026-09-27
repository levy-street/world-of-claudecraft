import { describe, expect, it } from 'vitest';
import { spawnGroundObjects } from '../src/sim/ground_object_spawns';
import type { Entity, GroundObjectDef } from '../src/sim/types';

describe('authored ground-object transforms', () => {
  it.each([
    { y: Number.NaN },
    { y: Number.POSITIVE_INFINITY },
    { facing: Number.NEGATIVE_INFINITY },
    { facing: Number.NaN },
    { scale: 0 },
    { scale: -1 },
    { scale: Number.NaN },
    { scale: Number.POSITIVE_INFINITY },
  ])('rejects invalid transforms %j before allocating or spawning any objects', (transform) => {
    const entities = new Map<number, Entity>();
    let nextId = 1;
    expect(() =>
      spawnGroundObjects(
        [
          { itemId: 'valid', name: 'Valid', positions: [{ x: 1, z: 2 }] },
          { itemId: 'invalid', name: 'Invalid', positions: [{ x: 3, z: 4, ...transform }] },
        ],
        {
          entities,
          allocateEntityId: () => nextId++,
          groundPos: (x, z) => ({ x, y: 7, z }),
          addEntity: (entity) => {
            entities.set(entity.id, entity);
          },
        },
      ),
    ).toThrow('Invalid authored ground object transform: invalid');
    expect(entities.size).toBe(0);
    expect(nextId).toBe(1);
  });

  it('uses exact optional transforms while retaining terrain and constructor defaults', () => {
    const entities = new Map<number, Entity>();
    let nextId = 1;
    const definitions: GroundObjectDef[] = [
      {
        itemId: 'wreckfield_flotsam_crate',
        name: 'Shipwreck Debris',
        positions: [
          { x: 12, z: 34 },
          { x: 13, y: -4.5, z: 35, facing: Math.PI / 2, scale: 2 },
          { x: 14, y: 0, z: 36, facing: 0, scale: 1 },
        ],
      },
    ];
    spawnGroundObjects(definitions, {
      entities,
      allocateEntityId: () => nextId++,
      groundPos: (x, z) => ({ x, y: 7, z }),
      addEntity: (entity) => {
        entities.set(entity.id, entity);
      },
    });
    expect(entities.get(1)).toMatchObject({
      pos: { x: 12, y: 7, z: 34 },
      prevPos: { x: 12, y: 7, z: 34 },
      spawnPos: { x: 12, y: 7, z: 34 },
      facing: 0,
      prevFacing: 0,
      scale: 1,
    });
    expect(entities.get(2)).toMatchObject({
      pos: { x: 13, y: -4.5, z: 35 },
      prevPos: { x: 13, y: -4.5, z: 35 },
      spawnPos: { x: 13, y: -4.5, z: 35 },
      facing: Math.PI / 2,
      prevFacing: Math.PI / 2,
      scale: 2,
    });
    expect(entities.get(3)).toMatchObject({
      pos: { x: 14, y: 0, z: 36 },
      prevPos: { x: 14, y: 0, z: 36 },
      spawnPos: { x: 14, y: 0, z: 36 },
      facing: 0,
      prevFacing: 0,
      scale: 1,
    });
    expect(entities.get(2)?.pos).not.toBe(entities.get(2)?.prevPos);
    expect(entities.get(2)?.pos).not.toBe(entities.get(2)?.spawnPos);
  });
});
