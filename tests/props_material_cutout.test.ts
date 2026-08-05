// Regression: the prop material rebuild used to drop the alpha cutout and the
// sidedness the asset authored. Almost every prop is solid geometry, so nothing
// noticed until the placeable oak (oak_4.glb, PROP_ASSET_DEFS.oakTree) was set
// out at the Evergarden gate: its `Leaves_NormalTree` cards are glTF alphaMode
// MASK + doubleSided, and rebuilt without either they drew as opaque dark quads
// through the canopy.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { propMaterialInternalsForTest } from '../src/render/props';

const { convertMaterial } = propMaterialInternalsForTest;

/** What GLTFLoader hands back for an alphaMode MASK + doubleSided material. */
function cutoutSource(name: string): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ name, color: 0xffffff });
  mat.alphaTest = 0.2;
  mat.side = THREE.DoubleSide;
  return mat;
}

function opaqueSource(name: string): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ name, color: 0xffffff });
  mat.alphaTest = 0;
  mat.side = THREE.FrontSide;
  return mat;
}

describe('prop material conversion preserves the authored alpha cutout', () => {
  it('carries alphaTest and side across the rebuild', () => {
    const out = convertMaterial(cutoutSource('Leaves_NormalTree'), 'kfol', false);
    // The literal 0.2 is the kit's authored alphaCutoff: a cutout rebuilt at 0
    // renders every transparent texel opaque, which is the reported bug.
    expect(out.alphaTest).toBeCloseTo(0.2, 5);
    expect(out.side).toBe(THREE.DoubleSide);
  });

  it('leaves a solid prop material single-sided and uncut', () => {
    const out = convertMaterial(opaqueSource('Stone_Wall'), 'kfol', false);
    expect(out.alphaTest).toBe(0);
    expect(out.side).toBe(THREE.FrontSide);
  });

  it('never shares one cached material between a cutout and an opaque namesake', () => {
    // Same kit and same material name, differing only in cutout state: the
    // cache key must separate them or whichever built first wins for both.
    const cut = convertMaterial(cutoutSource('Shared_Name'), 'kfol', false);
    const solid = convertMaterial(opaqueSource('Shared_Name'), 'kfol', false);
    expect(cut).not.toBe(solid);
    expect(cut.alphaTest).toBeCloseTo(0.2, 5);
    expect(solid.alphaTest).toBe(0);
    expect(cut.side).toBe(THREE.DoubleSide);
    expect(solid.side).toBe(THREE.FrontSide);
  });

  it('still dedupes two identical cutout sources onto one material', () => {
    const a = convertMaterial(cutoutSource('Dedupe_Me'), 'kfol', false);
    const b = convertMaterial(cutoutSource('Dedupe_Me'), 'kfol', false);
    expect(a).toBe(b);
  });
});
