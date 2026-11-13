import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundSetFromQuery } from '../src/render/ground_set_core';
import { SPLAT_NORMAL_LAYERS, terrainInternalsForTest } from '../src/render/terrain';

// The painted ground wears flat detail normals on purpose (terrain.ts
// buildSplatNormalArray): its normal maps ship as PNG, the packer only takes
// compressed layers, and the ground was signed off looking that way. Two things
// are pinned: the flat array is the FINISHED answer (it used to be rebuilt on
// every material, as a pack that might still complete), and it stays flat even
// when four packable layers are present, so the look cannot change by accident
// the day someone drops compressed siblings beside the PNGs.

function compressedLayer(): THREE.CompressedTexture {
  const mip = (size: number) => ({ data: new Uint8Array(size * size), width: size, height: size });
  return new THREE.CompressedTexture(
    [mip(4), mip(2), mip(1)] as unknown as THREE.CompressedTextureMipmap[],
    4,
    4,
    THREE.RGBA_ASTC_4x4_Format,
    THREE.UnsignedByteType,
  );
}

describe('the painted ground detail normals', () => {
  it('is the set a host without an address bar wears', () => {
    // this suite runs in node, where terrain.ts reads no location: the default set
    expect(typeof location).toBe('undefined');
    expect(groundSetFromQuery('')).toBe('Painted');
  });

  it('packs one flat texel per layer and counts it finished', () => {
    const packed = terrainInternalsForTest.splatNormalArray({});
    expect(packed.complete).toBe(true);
    const texture = packed.texture as THREE.DataArrayTexture;
    expect(texture.isDataArrayTexture).toBe(true);
    expect(texture.image.width).toBe(1);
    expect(texture.image.height).toBe(1);
    expect(texture.image.depth).toBe(SPLAT_NORMAL_LAYERS.length);
    // a tangent-space normal pointing straight out of the surface, in every layer
    expect(Array.from(texture.image.data as Uint8Array)).toEqual(
      SPLAT_NORMAL_LAYERS.flatMap(() => [128, 128, 255, 255]),
    );
    // finished means built once: the next material gets the very same texture
    expect(terrainInternalsForTest.splatNormalArray({}).texture).toBe(texture);
  });

  it('stays flat when four packable layers are loaded', () => {
    const before = terrainInternalsForTest.splatNormalArray({}).texture;
    const layers = Object.fromEntries(SPLAT_NORMAL_LAYERS.map((key) => [key, compressedLayer()]));
    const packed = terrainInternalsForTest.splatNormalArray(layers);
    expect(packed.texture).toBe(before);
    expect((packed.texture as THREE.DataArrayTexture).isDataArrayTexture).toBe(true);
    expect(
      (packed.texture as { isCompressedArrayTexture?: boolean }).isCompressedArrayTexture,
    ).toBeUndefined();
  });
});
