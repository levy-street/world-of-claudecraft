// The WOC_lod reader (src/render/assets/woc_lod_plugin.ts): tiny GLBs written with gltf-transform
// to the file contract, parsed in Node by the same GLTFLoader (and meshopt decoder) the game
// assembles, the plugin registered as loader.ts registers it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import type * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { geometryLodOf } from '../src/render/assets/geometry_lod';
import { WOC_LOD_EXTENSION, wocLodPlugin } from '../src/render/assets/woc_lod_plugin';
import { glbJson, patchGlbJson, quadRow, WOC_LOD, wocLodGlb } from './helpers/woc_lod_glb';

async function parse(glb: ArrayBuffer, plugin = true): Promise<GLTF> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (plugin) loader.register(wocLodPlugin);
  return loader.parseAsync(glb, '');
}

function meshNamed(gltf: GLTF, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // a mesh of several primitives is a group of meshes named after it
    if (mesh.name === name || mesh.parent?.name === name) out.push(mesh);
  });
  return out;
}

const listOf = (attribute: THREE.BufferAttribute | undefined | null): number[] | null =>
  attribute ? [...attribute.array] : null;

const row = quadRow(4); // 10 vertices, 8 triangles
const MID = row.index.slice(0, 12);
const FAR = row.index.slice(0, 6);

describe('the fixture is the contract', () => {
  it('lists WOC_lod as used, never required', async () => {
    const json = glbJson(
      await wocLodGlb([{ name: 'A', primitives: [{ ...row, levels: [MID, FAR] }] }]),
    );
    expect(json.extensionsUsed).toContain(WOC_LOD);
    expect(json.extensionsRequired ?? []).not.toContain(WOC_LOD);
    expect(WOC_LOD_EXTENSION).toBe(WOC_LOD);
  });
});

describe('levels land on the geometry each primitive was parsed into', () => {
  it('names a list of two mid then far, and a list of one far', async () => {
    const gltf = await parse(
      await wocLodGlb([
        { name: 'Both', primitives: [{ ...row, levels: [MID, FAR] }] },
        { name: 'FarOnly', primitives: [{ ...row, levels: [FAR] }] },
        { name: 'None', primitives: [{ ...row }] },
      ]),
    );
    const [both] = meshNamed(gltf, 'Both');
    expect(listOf(geometryLodOf(both.geometry)?.mid)).toEqual(MID);
    expect(listOf(geometryLodOf(both.geometry)?.far)).toEqual(FAR);
    // the levels are index lists, as three draws an index
    expect(geometryLodOf(both.geometry)?.mid?.itemSize).toBe(1);
    expect(geometryLodOf(both.geometry)?.mid?.array).toBeInstanceOf(Uint16Array);
    const [farOnly] = meshNamed(gltf, 'FarOnly');
    expect(geometryLodOf(farOnly.geometry)?.mid).toBeUndefined();
    expect(listOf(geometryLodOf(farOnly.geometry)?.far)).toEqual(FAR);
    const [none] = meshNamed(gltf, 'None');
    expect(geometryLodOf(none.geometry)).toBeNull();
    // level 0 is untouched
    expect(listOf(both.geometry.index)).toEqual(row.index);
  });

  it('reads each primitive of a mesh of several, and 32-bit lists', async () => {
    const gltf = await parse(
      await wocLodGlb([
        {
          name: 'Multi',
          primitives: [
            { ...row, levels: [MID, FAR] },
            { ...row, wide: true, levels: [FAR] },
          ],
        },
      ]),
    );
    const [first, second] = meshNamed(gltf, 'Multi');
    expect(listOf(geometryLodOf(first.geometry)?.mid)).toEqual(MID);
    expect(geometryLodOf(second.geometry)?.mid).toBeUndefined();
    expect(geometryLodOf(second.geometry)?.far?.array).toBeInstanceOf(Uint32Array);
    expect(listOf(geometryLodOf(second.geometry)?.far)).toEqual(FAR);
  });

  it('decodes a meshopt-compressed file the same way', async () => {
    const glb = await wocLodGlb([{ name: 'A', primitives: [{ ...row, levels: [MID, FAR] }] }], {
      meshopt: true,
    });
    expect(glbJson(glb).extensionsRequired).toContain('EXT_meshopt_compression');
    const [mesh] = meshNamed(await parse(glb), 'A');
    expect(listOf(geometryLodOf(mesh.geometry)?.mid)).toEqual(MID);
    expect(listOf(geometryLodOf(mesh.geometry)?.far)).toEqual(FAR);
  });
});

describe('one owner per list', () => {
  it('copies a level that names an accessor another geometry already draws as its index', async () => {
    // a file whose mid level names the primitive's own index accessor (the build never writes
    // one, a level that saves nothing is left out; the reader must not share it all the same)
    const glb = patchGlbJson(
      await wocLodGlb([{ name: 'Own', primitives: [{ ...row, levels: [MID, FAR] }] }]),
      (json) => {
        const primitive = (json.meshes ?? [])[0].primitives[0] as {
          indices?: number;
          extensions?: Record<string, { levels: { indices: number }[] }>;
        };
        const levels = primitive.extensions?.[WOC_LOD]?.levels;
        if (levels && primitive.indices !== undefined) levels[0].indices = primitive.indices;
      },
    );
    const [mesh] = meshNamed(await parse(glb), 'Own');
    const mid = geometryLodOf(mesh.geometry)?.mid;
    expect(listOf(mid)).toEqual(row.index);
    expect(mid).not.toBe(mesh.geometry.index);
    expect(listOf(geometryLodOf(mesh.geometry)?.far)).toEqual(FAR);
  });

  it('copies a list two levels name, so each level owns its own', async () => {
    const glb = patchGlbJson(
      await wocLodGlb([{ name: 'Twice', primitives: [{ ...row, levels: [MID, FAR] }] }]),
      (json) => {
        const primitive = (json.meshes ?? [])[0].primitives[0] as {
          extensions?: Record<string, { levels: { indices: number }[] }>;
        };
        const levels = primitive.extensions?.[WOC_LOD]?.levels;
        // a far level that could not beat the mid one names the mid list again
        if (levels) levels[1].indices = levels[0].indices;
      },
    );
    const [mesh] = meshNamed(await parse(glb), 'Twice');
    const lod = geometryLodOf(mesh.geometry);
    expect(listOf(lod?.mid)).toEqual(MID);
    expect(listOf(lod?.far)).toEqual(MID);
    expect(lod?.far).not.toBe(lod?.mid);
  });

  it('reads nothing of a file that does not list the extension as used', async () => {
    const glb = patchGlbJson(
      await wocLodGlb([{ name: 'Unlisted', primitives: [{ ...row, levels: [MID, FAR] }] }]),
      (json) => {
        json.extensionsUsed = (json.extensionsUsed ?? []).filter((n) => n !== WOC_LOD);
      },
    );
    const [mesh] = meshNamed(await parse(glb), 'Unlisted');
    expect(geometryLodOf(mesh.geometry)).toBeNull();
  });
});

describe('fail soft', () => {
  it('drops a level that is not a triangle list over its own vertices, and still loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const gltf = await parse(
        await wocLodGlb([
          // an index past the 10 vertices, then a partial triangle
          { name: 'OutOfRange', primitives: [{ ...row, levels: [[0, 1, 99], FAR] }] },
          { name: 'Partial', primitives: [{ ...row, levels: [[0, 1, 2, 3], FAR] }] },
        ]),
      );
      const [outOfRange] = meshNamed(gltf, 'OutOfRange');
      expect(geometryLodOf(outOfRange.geometry)?.mid).toBeUndefined();
      expect(listOf(geometryLodOf(outOfRange.geometry)?.far)).toEqual(FAR);
      const [partial] = meshNamed(gltf, 'Partial');
      expect(geometryLodOf(partial.geometry)?.mid).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('drops a level written as a vertex stream (meshopt, the accessors left unmarked)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const glb = await wocLodGlb(
        [{ name: 'Stream', primitives: [{ ...quadRow(12), levels: [MID, FAR] }] }],
        { meshopt: true, markIndexUsage: false },
      );
      const [mesh] = meshNamed(await parse(glb), 'Stream');
      // what the broken encoding reads back: in range, whole triangles, a zero after each entry
      expect(geometryLodOf(mesh.geometry)).toBeNull();
      expect(warn.mock.calls.some(([m]) => String(m).includes('degenerate'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves a file without the extension exactly as the loader alone parses it', async () => {
    const glb = await wocLodGlb([{ name: 'Plain', primitives: [{ ...row }] }]);
    expect(glbJson(glb).extensionsUsed ?? []).not.toContain(WOC_LOD);
    const [withPlugin] = meshNamed(await parse(glb), 'Plain');
    const [without] = meshNamed(await parse(glb, false), 'Plain');
    expect(geometryLodOf(withPlugin.geometry)).toBeNull();
    expect(listOf(withPlugin.geometry.index)).toEqual(listOf(without.geometry.index));
    expect(Object.keys(withPlugin.geometry.attributes)).toEqual(
      Object.keys(without.geometry.attributes),
    );
    expect([...withPlugin.geometry.getAttribute('position').array]).toEqual([
      ...without.geometry.getAttribute('position').array,
    ]);
  });

  it('parses a file with levels without the plugin too, drawing level 0', async () => {
    const glb = await wocLodGlb([{ name: 'A', primitives: [{ ...row, levels: [MID, FAR] }] }]);
    const [mesh] = meshNamed(await parse(glb, false), 'A');
    expect(geometryLodOf(mesh.geometry)).toBeNull();
    expect(listOf(mesh.geometry.index)).toEqual(row.index);
  });
});

describe('the game loader registers it', () => {
  it('loader.ts registers the plugin on the one GLTFLoader it assembles', () => {
    const source = readFileSync(
      path.resolve(__dirname, '..', 'src', 'render', 'assets', 'loader.ts'),
      'utf8',
    );
    const assemble = source.slice(source.indexOf('function loader()'));
    expect(assemble.slice(0, assemble.indexOf('gltfLoader = assembled'))).toContain(
      'assembled.register(wocLodPlugin)',
    );
  });
});
