// The far-LOD reveal rule (src/render/characters/far_lod_reveal_core.ts): the
// baked far mesh may only stand in for the articulated rig once it exists AND
// its freshly minted materials have linked behind the compile gate; the far
// shadow proxy follows the same readiness but the renderer's own shadow plan.
import { describe, expect, it } from 'vitest';
import {
  farLodReady,
  farMeshShown,
  shadowProxyShown,
} from '../src/render/characters/far_lod_reveal_core';

describe('farLodReady', () => {
  it('needs a mesh whose materials are no longer linking', () => {
    expect(farLodReady(true, false)).toBe(true);
    expect(farLodReady(true, true)).toBe(false);
    expect(farLodReady(false, false)).toBe(false);
    expect(farLodReady(false, true)).toBe(false);
  });
});

describe('farMeshShown', () => {
  it('shows the far mesh only when the LOD wants it AND it is ready', () => {
    expect(farMeshShown(true, true, false)).toBe(true);
    // the compile gate still linking: the rig keeps drawing (no hole, no cold link)
    expect(farMeshShown(true, true, true)).toBe(false);
    // no bake at all (a look that bakes to nothing, or a bake still budgeted)
    expect(farMeshShown(true, false, false)).toBe(false);
    // near: never, whatever the mesh state
    expect(farMeshShown(false, true, false)).toBe(false);
    expect(farMeshShown(false, true, true)).toBe(false);
  });
});

describe('shadowProxyShown', () => {
  it('follows the shadow plan, gated on the far bake being ready, NOT on far', () => {
    // the plan may want the proxy for a near body in the proxy band
    expect(shadowProxyShown(true, true, false)).toBe(true);
    expect(shadowProxyShown(true, true, true)).toBe(false);
    expect(shadowProxyShown(true, false, false)).toBe(false);
    expect(shadowProxyShown(false, true, false)).toBe(false);
  });
});
