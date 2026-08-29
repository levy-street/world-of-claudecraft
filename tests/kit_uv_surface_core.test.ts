import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  familyForUv,
  type KitSurfaceFamily,
  kitHasUvSurfaceRouting,
  splitKitSurfacesByUv,
} from '../src/render/kit_uv_surface_core';

async function readPrimitive(assetUrl: string) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
  });
  const document = await io.readBinary(
    new Uint8Array(readFileSync(path.join(__dirname, '..', 'public', assetUrl.replace(/^\//, '')))),
  );
  const meshes = document.getRoot().listMeshes();
  expect(meshes).toHaveLength(1);
  const primitives = meshes[0].listPrimitives();
  expect(primitives).toHaveLength(1);
  const uv = primitives[0].getAttribute('TEXCOORD_0');
  const indices = primitives[0].getIndices();
  if (!uv || !indices) throw new Error(`${assetUrl} is missing uvs or indices`);
  // The kit ships uvs as NORMALIZED unsigned shorts, so the raw array runs
  // 0 to 65535. getElement denormalizes to the 0..1 the router expects.
  const uvs = new Float32Array(uv.getCount() * 2);
  const scratch = [0, 0];
  for (let i = 0; i < uv.getCount(); i++) {
    uv.getElement(i, scratch);
    uvs[i * 2] = scratch[0];
    uvs[i * 2 + 1] = scratch[1];
  }
  return { uvs, indices: indices.getArray() as ArrayLike<number> };
}

describe('kit uv surface routing', () => {
  it('knows the hexagon kit and nothing it has not measured', () => {
    expect(kitHasUvSurfaceRouting('khex')).toBe(true);
    expect(kitHasUvSurfaceRouting('pirate')).toBe(false);
    expect(familyForUv('pirate', 0.8, 0.1)).toBeNull();
  });

  it('separates the light plank swatch from the sail swatch, which share a u column', () => {
    // The whole reason the rectangles are tested on BOTH axes: these two
    // samples differ only in v, and a u-only test would call the tower's
    // ladder canvas.
    expect(familyForUv('khex', 0.675, 0.13)).toBe('wood');
    expect(familyForUv('khex', 0.675, 0.63)).toBe('cloth');
  });

  it('reports a triangle whose corners disagree as unresolved rather than guessing', () => {
    // corner 0 sits in the wood block, corners 1 and 2 in the cloth block
    const uvs = [0.8, 0.1, 0.68, 0.63, 0.69, 0.64];
    const split = splitKitSurfacesByUv('khex', uvs, [0, 1, 2]);
    expect(split.unresolved).toBe(1);
    expect(split.groups.wood).toBeUndefined();
    expect(split.groups.cloth).toBeUndefined();
  });

  // The partition of the SHIPPED meshes must be exact. A nonzero `unresolved`
  // here means an asset was re-exported and the swatch table needs
  // re-measuring: that is a real signal, never something to tolerate.
  it.each([
    ['/models/biome/hex_ship_blue.glb', 1580, { wood: 774, cloth: 764, stone: 42 }],
    ['/models/biome/hex_watchtower.glb', 1490, { wood: 1144, cloth: 226, stone: 120 }],
  ] as [string, number, Record<KitSurfaceFamily, number>][])(
    'partitions %s with no ambiguous or unmapped triangle',
    async (assetUrl, triangles, expected) => {
      const { uvs, indices } = await readPrimitive(assetUrl);
      const split = splitKitSurfacesByUv('khex', uvs, indices);
      expect(split.triangles).toBe(triangles);
      expect(split.unresolved).toBe(0);
      for (const family of Object.keys(expected) as KitSurfaceFamily[]) {
        expect((split.groups[family]?.length ?? 0) / 3).toBe(expected[family]);
      }
      const sorted = Object.values(split.groups).reduce((n, list) => n + list.length / 3, 0);
      expect(sorted).toBe(triangles);
    },
  );
});
