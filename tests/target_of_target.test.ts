import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import { targetOfTargetId } from '../src/ui/target_of_target';

const ent = (over: Partial<Entity>): Entity =>
  ({ aggroTargetId: null, targetId: null, ...over }) as Entity;

describe('targetOfTargetId', () => {
  it('returns null for no entity', () => {
    expect(targetOfTargetId(null)).toBeNull();
    expect(targetOfTargetId(undefined)).toBeNull();
  });

  it('returns a mob hate-target (aggroTargetId)', () => {
    expect(targetOfTargetId(ent({ aggroTargetId: 42 }))).toBe(42);
  });

  it('returns a player target (targetId) when there is no aggro target', () => {
    expect(targetOfTargetId(ent({ targetId: 7 }))).toBe(7);
  });

  it('prefers the mob hate-target over a stray targetId', () => {
    expect(targetOfTargetId(ent({ aggroTargetId: 5, targetId: 9 }))).toBe(5);
  });

  it('returns null when the entity is targeting nothing', () => {
    expect(targetOfTargetId(ent({}))).toBeNull();
  });
});
