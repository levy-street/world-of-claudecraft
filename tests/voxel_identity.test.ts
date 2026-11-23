import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoxelIdentityRegistry } from '../src/render/voxel_identity_core';
import type { TerrainCut } from '../src/sim/types';

const volume = (): TerrainCut => ({ shape: 'voxel', x: 0, y: 0, z: 0, radius: 1 });

let voxelIdentity: ReturnType<typeof createVoxelIdentityRegistry>;
beforeEach(() => {
  voxelIdentity = createVoxelIdentityRegistry();
});
afterEach(() => vi.restoreAllMocks());

describe('voxel worker identities', () => {
  it('allocates stable worker identities without random draws', () => {
    const random = vi.spyOn(Math, 'random');
    const cut = volume();
    const first = voxelIdentity(cut);
    expect(voxelIdentity(cut)).toEqual(first);
    expect(random).not.toHaveBeenCalled();
  });

  it('keeps the identity when a volume revision advances without mutating the document', () => {
    const cut = volume();
    const first = voxelIdentity(cut);
    expect(cut).not.toHaveProperty('vid');
    cut.vrev = 3;
    expect(voxelIdentity(cut)).toEqual({ vid: first.vid, vrev: 3 });
    expect(createVoxelIdentityRegistry()(volume())).toEqual(first);
  });

  it('does not alias a cloned volume carrying an old runtime id', () => {
    const first = { ...volume(), vid: 'v1', vrev: 2 };
    const copy = { ...first };
    expect(voxelIdentity(first).vid).not.toBe(voxelIdentity(copy).vid);
  });
});
