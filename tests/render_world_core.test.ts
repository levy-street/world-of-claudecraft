import { describe, expect, it } from 'vitest';
import {
  RENDER_DIRTY_FACING,
  RENDER_DIRTY_NEW,
  RENDER_DIRTY_POSITION,
  RENDER_ENTITY_ACTIONABLE,
  type RenderEntityLike,
  RenderWorldCore,
} from '../src/render/runtime/render_world_core';

function entity(
  id: number,
  x: number,
  overrides: Partial<RenderEntityLike> = {},
): RenderEntityLike {
  return {
    id,
    pos: { x, y: 0, z: 0 },
    facing: 0,
    hostile: false,
    inCombat: false,
    castingAbility: null,
    ownerId: null,
    ...overrides,
  };
}

function frame(
  core: RenderWorldCore,
  entities: ReadonlyMap<number, RenderEntityLike>,
  targetId: number | null = null,
) {
  return core.update(entities, {
    originX: 0,
    originZ: 0,
    selfId: 1,
    targetId,
    createRangeSq: 100,
    destroyRangeSq: 400,
  });
}

describe('RenderWorldCore', () => {
  it('keeps slots stable and reports only changed hot fields', () => {
    const core = new RenderWorldCore(2);
    const first = entity(1, 2);
    frame(core, new Map([[1, first]]));
    const slot = core.slotFor(1);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(core.dirty[slot]! & RENDER_DIRTY_NEW).not.toBe(0);

    frame(core, new Map([[1, first]]));
    expect(core.slotFor(1)).toBe(slot);
    expect(core.dirty[slot]).toBe(0);

    first.pos.x = 3;
    first.facing = 1;
    frame(core, new Map([[1, first]]));
    expect(core.slotFor(1)).toBe(slot);
    expect(core.dirty[slot]! & RENDER_DIRTY_POSITION).not.toBe(0);
    expect(core.dirty[slot]! & RENDER_DIRTY_FACING).not.toBe(0);
  });

  it('uses actionable flags to admit important entities outside the create range', () => {
    const core = new RenderWorldCore();
    const farTarget = entity(2, 30);
    const result = frame(core, new Map([[2, farTarget]]), 2);
    const slot = core.slotFor(2);

    expect(result.admissionCount).toBe(1);
    expect(core.admissionIds[0]).toBe(2);
    expect(core.flags[slot]! & RENDER_ENTITY_ACTIONABLE).not.toBe(0);
  });

  it('does not bypass spatial admission for a merely hostile far entity', () => {
    const core = new RenderWorldCore();
    const farHostile = entity(2, 30, { hostile: true });
    const result = frame(core, new Map([[2, farHostile]]));
    const slot = core.slotFor(2);

    expect(core.flags[slot]! & RENDER_ENTITY_ACTIONABLE).not.toBe(0);
    expect(result.admissionCount).toBe(0);
  });

  it('separates view eviction from removal and preserves attached actionable views', () => {
    const core = new RenderWorldCore();
    const far = entity(2, 30);
    frame(core, new Map([[2, far]]));
    core.markViewAttached(2, true);

    const evicted = frame(core, new Map([[2, far]]));
    expect(evicted.evictionCount).toBe(1);
    expect(core.evictionIds[0]).toBe(2);

    const retained = frame(core, new Map([[2, far]]), 2);
    expect(retained.evictionCount).toBe(0);

    const removed = frame(core, new Map());
    expect(removed.removalCount).toBe(1);
    expect(core.removalIds[0]).toBe(2);
    expect(core.slotFor(2)).toBe(-1);
  });

  it('grows capacity and rejects stale slot ownership with generations', () => {
    const core = new RenderWorldCore(1);
    const many = new Map<number, RenderEntityLike>();
    for (let id = 1; id <= 40; id++) many.set(id, entity(id, id));
    frame(core, many);

    expect(core.activeCount).toBe(40);
    expect(core.capacity).toBeGreaterThanOrEqual(40);

    const oldSlot = core.slotFor(5);
    const oldGeneration = core.generation[oldSlot]!;
    many.delete(5);
    frame(core, many);
    many.set(99, entity(99, 1));
    frame(core, many);

    expect(core.slotFor(99)).toBe(oldSlot);
    expect(core.generation[oldSlot]).toBeGreaterThan(oldGeneration);
  });

  it('produces deterministic admission order from the world roster', () => {
    const core = new RenderWorldCore();
    const roster = new Map<number, RenderEntityLike>([
      [7, entity(7, 1)],
      [3, entity(3, 2)],
      [11, entity(11, 3)],
    ]);
    const result = frame(core, roster);

    expect(result.admissionCount).toBe(3);
    expect(Array.from(core.admissionIds.subarray(0, result.admissionCount))).toEqual([7, 3, 11]);
  });
});
