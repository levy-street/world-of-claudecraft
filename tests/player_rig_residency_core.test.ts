import { describe, expect, it } from 'vitest';
import { planPlayerRigResidency } from '../src/render/player_rig_residency_core';

describe('player rig residency', () => {
  it('never asks a batched-only player to retain or construct a full rig', () => {
    const releases: number[] = [];
    const acquires: number[] = [];
    planPlayerRigResidency(
      [
        { id: 10, mode: 'batchedFar' },
        { id: 11, mode: 'batchedFar' },
      ],
      new Set([10]),
      releases,
      acquires,
    );

    expect(releases).toEqual([10]);
    expect(acquires).toEqual([]);
  });

  it('clears caller-owned transition arrays on reuse', () => {
    const releases = [99];
    const acquires = [98];
    planPlayerRigResidency([{ id: 1, mode: 'rig' }], new Set<number>(), releases, acquires);
    expect(releases).toEqual([]);
    expect(acquires).toEqual([1]);
  });
});
