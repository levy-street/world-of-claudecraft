import { describe, expect, it } from 'vitest';
import {
  createdViewType,
  finishViewCandidates,
  sampleCreatedViewType,
  VIEW_CREATED_TYPE_SAMPLE_LIMIT,
  type ViewCandidate,
  writeViewCandidate,
} from '../src/render/view_candidate_pool_core';
import type { Entity } from '../src/sim/types';

describe('view candidate pool lifetime', () => {
  it('retains no entity objects after a high candidate count falls to zero', () => {
    const entities = Array.from({ length: 300 }, (_, index) => ({
      id: index + 1,
      graph: { label: `entity-${index + 1}` },
    }));
    const pool: ViewCandidate[] = [];
    const active: ViewCandidate[] = [];

    for (const entity of entities) {
      writeViewCandidate(pool, active, active.length, entity.id, entity.id * 2, 3);
    }
    finishViewCandidates(active, entities.length);
    expect(active).toHaveLength(300);
    expect(pool).toHaveLength(300);
    const pooledSlots = [...pool];

    finishViewCandidates(active, 0);

    expect(active).toHaveLength(0);
    const oldEntities = new Set<unknown>(entities);
    for (const candidate of pool) {
      for (const value of Object.values(candidate)) {
        expect(oldEntities.has(value)).toBe(false);
      }
    }

    for (const entity of entities) {
      writeViewCandidate(pool, active, active.length, entity.id + 1_000, entity.id * 3, 4);
    }
    finishViewCandidates(active, entities.length);
    for (let index = 0; index < pool.length; index++) {
      expect(pool[index]).toBe(pooledSlots[index]);
    }
  });
});

describe('created-view type samples for the perf reporter', () => {
  const entity = (kind: string, templateId: string): Entity =>
    ({ id: 1, kind, templateId }) as unknown as Entity;

  it('keeps at most 24 samples per frame', () => {
    expect(VIEW_CREATED_TYPE_SAMPLE_LIMIT).toBe(24);
  });

  it('names a sample `kind:templateId`, falling back to the kind alone, cut at 64 chars', () => {
    expect(createdViewType(entity('mob', 'forest_wolf'))).toBe('mob:forest_wolf');
    expect(createdViewType(entity('player', 'warrior'))).toBe('player:warrior');
    expect(createdViewType(entity('object', ''))).toBe('object:object');
    expect(createdViewType({ id: 1, kind: 'object' } as unknown as Entity)).toBe('object:object');
    const long = createdViewType(entity('mob', 'x'.repeat(100)));
    expect(long).toHaveLength(64);
    expect(long).toBe(`mob:${'x'.repeat(60)}`);
  });

  it('samples up to the limit and drops everything past it', () => {
    const into: string[] = [];
    for (let index = 0; index < VIEW_CREATED_TYPE_SAMPLE_LIMIT; index++) {
      sampleCreatedViewType(into, entity('mob', `wolf_${index}`));
    }
    expect(into).toHaveLength(24);
    expect(into[0]).toBe('mob:wolf_0');
    expect(into[23]).toBe('mob:wolf_23');
    // the 25th push does not land
    sampleCreatedViewType(into, entity('mob', 'wolf_24'));
    expect(into).toHaveLength(24);
    expect(into).not.toContain('mob:wolf_24');
    // a fresh frame's list samples again
    const next: string[] = [];
    sampleCreatedViewType(next, entity('mob', 'wolf_24'));
    expect(next).toEqual(['mob:wolf_24']);
  });
});
