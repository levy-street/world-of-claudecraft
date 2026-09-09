// The far bake's group layout. A wrong slot map is silent: the distant body
// keeps drawing, in the wrong colours, from the first coalesced group on.
import { describe, expect, it } from 'vitest';
import {
  coalesceFarBakeGroups,
  farBakeGroupRanges,
} from '../src/render/characters/far_bake_groups_core';

describe('coalesceFarBakeGroups', () => {
  it('gives every distinct key one group, in first-seen order', () => {
    const grouping = coalesceFarBakeGroups(['skin', 'hair', 'skin', 'skin', 'hair']);

    expect(grouping.groups).toEqual([
      [0, 2, 3],
      [1, 4],
    ]);
    expect(grouping.slots).toEqual([0, 1]);
  });

  it('orders the merge by group, so a group is contiguous in the buffer', () => {
    // One addGroup covers a RUN; interleaved members could not be one group.
    const grouping = coalesceFarBakeGroups(['a', 'b', 'a', 'b', 'c']);

    expect(grouping.mergeOrder).toEqual([0, 2, 1, 3, 4]);
  });

  it('is the identity when no two meshes share a key', () => {
    const grouping = coalesceFarBakeGroups(['a', 'b', 'c']);

    expect(grouping.groups).toEqual([[0], [1], [2]]);
    expect(grouping.mergeOrder).toEqual([0, 1, 2]);
    expect(grouping.slots).toEqual([0, 1, 2]);
  });

  it('names each group by its FIRST member, the slot its material was captured under', () => {
    const grouping = coalesceFarBakeGroups(['x', 'y', 'y', 'x']);

    expect(grouping.slots).toEqual([0, 1]);
  });

  it('handles an empty walk', () => {
    const grouping = coalesceFarBakeGroups([]);

    expect(grouping.groups).toEqual([]);
    expect(grouping.mergeOrder).toEqual([]);
    expect(grouping.slots).toEqual([]);
  });
});

describe('farBakeGroupRanges', () => {
  it('offsets by the MERGE order, never the source order', () => {
    // Sources 0 and 2 are one group and are merged adjacently, so the second
    // group starts after both of them, not after source 1.
    const grouping = coalesceFarBakeGroups(['a', 'b', 'a']);

    const ranges = farBakeGroupRanges(grouping, [10, 20, 30]);

    expect(ranges).toEqual([
      { start: 0, count: 40, materialIndex: 0 },
      { start: 40, count: 20, materialIndex: 1 },
    ]);
  });

  it('covers the whole buffer exactly once', () => {
    const counts = [4, 9, 6, 3, 12];
    const grouping = coalesceFarBakeGroups(['a', 'b', 'a', 'c', 'b']);

    const ranges = farBakeGroupRanges(grouping, counts);

    const total = counts.reduce((a, b) => a + b, 0);
    expect(ranges.reduce((sum, r) => sum + r.count, 0)).toBe(total);
    let expected = 0;
    for (const range of ranges) {
      expect(range.start).toBe(expected);
      expected += range.count;
    }
    expect(expected).toBe(total);
  });

  it('numbers material indices by group, so slot N draws material N', () => {
    const grouping = coalesceFarBakeGroups(['a', 'b', 'c', 'a']);

    expect(farBakeGroupRanges(grouping, [1, 1, 1, 1]).map((r) => r.materialIndex)).toEqual([
      0, 1, 2,
    ]);
  });
});
