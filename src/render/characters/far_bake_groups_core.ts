// How a far-LOD bake lays its source meshes out as geometry GROUPS.
//
// The far bake flattens a posed character into ONE static mesh, but every
// source primitive used to become its own group, and a group is a draw: the
// "single-draw far mesh" the crowd LOD is written around was really a draw per
// part. Meshes that resolve to the SAME far material can share one group
// instead, which is what this decides.
//
// Two outputs, and both are load bearing:
//   - the ORDER the geometries are merged in, so a group's members land
//     contiguously in the merged buffer (one addGroup can only cover a run);
//   - the SLOT MAP, group index to the index of its first member in the source
//     walk, because a composed body does not read its far materials off the
//     bake's walk at all: it looks them up per character, per slot, against the
//     materials it captured from the same walk when it was assembled. Without
//     the map, coalescing would silently shift every material after the first
//     coalesced group.
//
// Three-free: this is bookkeeping, and getting it wrong paints a distant body
// in the wrong colours, so it is decided by a plain Vitest.

export interface FarBakeGrouping {
  /** Source indices per group, in first-seen order. */
  readonly groups: readonly (readonly number[])[];
  /** Every source index, groups concatenated: the merge order. */
  readonly mergeOrder: readonly number[];
  /** Per group, the source index its material and body flag are read from. */
  readonly slots: readonly number[];
}

/** Group the source meshes whose `keys` agree, keeping first-seen order. */
export function coalesceFarBakeGroups(keys: readonly string[]): FarBakeGrouping {
  const groups: number[][] = [];
  const groupOf = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) {
    const at = groupOf.get(keys[i]);
    if (at === undefined) {
      groupOf.set(keys[i], groups.length);
      groups.push([i]);
    } else {
      groups[at].push(i);
    }
  }
  return {
    groups,
    mergeOrder: groups.flat(),
    slots: groups.map((members) => members[0]),
  };
}

export interface FarBakeGroupRange {
  start: number;
  count: number;
  materialIndex: number;
}

/**
 * The `addGroup` ranges for a grouping, given each source mesh's own draw
 * count (its index count, or its vertex count when unindexed).
 *
 * Offsets follow `mergeOrder`, never the source order: that is the whole reason
 * the merge is fed in grouped order.
 */
export function farBakeGroupRanges(
  grouping: FarBakeGrouping,
  counts: readonly number[],
): FarBakeGroupRange[] {
  const ranges: FarBakeGroupRange[] = [];
  let offset = 0;
  for (let g = 0; g < grouping.groups.length; g++) {
    let count = 0;
    for (const i of grouping.groups[g]) count += counts[i] ?? 0;
    ranges.push({ start: offset, count, materialIndex: g });
    offset += count;
  }
  return ranges;
}
