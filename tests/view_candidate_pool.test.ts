import { describe, expect, it } from 'vitest';
import {
  finishViewCandidates,
  type ViewCandidate,
  writeViewCandidate,
} from '../src/render/view_candidate_pool_core';

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
