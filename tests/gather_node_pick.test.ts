// Instanced gather-node pick resolution (#1866): the tap-to-harvest raycast
// resolves instanced batch hits through instanceId against the batch's
// gatherNodeIds list, with the legacy per-object parent walk as fallback.
// Guards the contract the instancing rewrite established: renaming
// gatherNodeIds, reordering ids against instance matrices, or dropping the
// fallback must fail here.

import { describe, expect, it } from 'vitest';
import { type GatherNodePickHit, resolveGatherNodePick } from '../src/render/gather_nodes';

function instancedHit(ids: string[], instanceId?: number): GatherNodePickHit {
  return { object: { userData: { gatherNodeIds: ids } }, instanceId };
}

describe('resolveGatherNodePick', () => {
  it('resolves an instanced hit through instanceId', () => {
    expect(resolveGatherNodePick([instancedHit(['ore_a', 'ore_b', 'ore_c'], 1)])).toBe('ore_b');
  });

  it('resolves a hit on any part of a multi-part batch (same ids list per part)', () => {
    const ids = ['wood_a', 'wood_b'];
    // Two InstancedMeshes (two model parts) carry the same ids; a hit on the
    // second part must resolve identically.
    const partTwoHit = instancedHit(ids, 0);
    expect(resolveGatherNodePick([partTwoHit])).toBe('wood_a');
  });

  it('falls through an out-of-range instanceId to the next hit', () => {
    const stale = instancedHit(['herb_a'], 5);
    const good = instancedHit(['herb_a', 'herb_b'], 1);
    expect(resolveGatherNodePick([stale, good])).toBe('herb_b');
  });

  it('resolves the legacy per-object id through the parent walk', () => {
    const parent = { userData: { gatherNodeId: 'ore_legacy' } };
    const hit: GatherNodePickHit = { object: { userData: {}, parent } };
    expect(resolveGatherNodePick([hit])).toBe('ore_legacy');
  });

  it('prefers the first hit that resolves and returns null when none do', () => {
    const miss: GatherNodePickHit = { object: { userData: {} } };
    expect(resolveGatherNodePick([miss, instancedHit(['a'], 0)])).toBe('a');
    expect(resolveGatherNodePick([miss])).toBeNull();
    expect(resolveGatherNodePick([])).toBeNull();
  });

  it('ignores an instanceId on a non-instanced object and walks parents instead', () => {
    const parent = { userData: { gatherNodeId: 'from_parent' } };
    const hit: GatherNodePickHit = { object: { userData: {}, parent }, instanceId: 3 };
    expect(resolveGatherNodePick([hit])).toBe('from_parent');
  });
});
