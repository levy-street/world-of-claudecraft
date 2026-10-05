// The WOC_lod glTF extension (scripts/assets/woc_character/woc_lod_extension.mjs): written with
// glTF-Transform and read back, the levels keep their accessors and recorded deviations through
// prune, dedup and the meshopt transform (their vertices followed through meshopt's reorder by
// keepLodIndices, each list compressed with the TRIANGLES codec), the extension is listed as
// used and never as required, a dropped primitive takes its levels' accessors with it, and a
// renumbering outside keepLodIndices fails the write instead of shipping wrong triangles. The
// last block holds every shipped WOC base, armor and head file to the contract the runtime reads.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Accessor, Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addLodIndices,
  LOD_LEVELS,
  verifyLodIndices,
} from '../scripts/assets/woc_character/lod_indices.mjs';
import {
  keepLodIndices,
  LOD_VERTEX_TAG,
  WOC_LOD,
  type WocLod,
  WocLodExtension,
} from '../scripts/assets/woc_character/woc_lod_extension.mjs';
import { WOC_SPLIT_DIR } from '../src/render/characters/woc_armor_core';
import { gridPrimitive, hang, waves } from './helpers/woc_lod_fixtures';

beforeAll(async () => {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
});

const quiet = new Logger(Logger.Verbosity.ERROR);

const lodIo = () =>
  new NodeIO()
    .setLogger(quiet)
    .registerExtensions([...ALL_EXTENSIONS, WocLodExtension])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

interface GlbJson {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  accessors: { bufferView?: number; componentType: number; count: number }[];
  bufferViews: { target?: number; extensions?: Record<string, { mode?: string }> }[];
  meshes: {
    primitives: {
      indices?: number;
      attributes: Record<string, number>;
      targets?: Record<string, number>[];
      extensions?: Record<string, { levels: { indices: number; maxDeviation: number }[] }>;
    }[];
  }[];
}

function glbJson(bytes: Uint8Array): GlbJson {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

/** Two pieces (a face with a morph slider, a bumpy plate on a scaled node) with their levels. */
async function fixture(): Promise<Document> {
  const doc = new Document().setLogger(quiet);
  doc.createBuffer();
  const face = gridPrimitive(doc, {
    n: 18,
    height: waves,
    morph: (x, z) => [0, 0.01 * Math.exp(-6 * (x * x + z * z)), 0],
  });
  hang(doc, 'face', face).mesh.setExtras({ targetNames: ['FS_Chin_Softness'] });
  const plate = gridPrimitive(doc, { n: 14, height: (x, z) => 0.05 * Math.sin(6 * x + 2 * z) });
  hang(doc, 'plate', plate).node.setScale([0.5, 0.5, 0.5]).setTranslation([0, 1, 0]);
  await addLodIndices(doc, { height: 1 });
  return doc;
}

/** Each level of each primitive as triangles of grid vertices (a fixture vertex is named by its
 *  uv: column and row over 126, which both grids divide and which the 12-bit uv quantization
 *  cannot blur), corners rotated to a canonical start, sorted: two documents compare whatever
 *  their vertex numbering and triangle order. */
function levelTriangles(doc: Document): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const mesh of doc.getRoot().listMeshes()) {
    mesh.listPrimitives().forEach((prim, p) => {
      const uv = prim.getAttribute('TEXCOORD_0') as Accessor;
      const el: number[] = [];
      const key = (v: number) => {
        uv.getElement(v, el);
        return `${Math.round(el[0] * 126)},${Math.round(el[1] * 126)}`;
      };
      const lod = prim.getExtension(WOC_LOD) as WocLod | null;
      out.set(
        `${mesh.getName()}#${p}`,
        (lod?.listLevels() ?? []).map((level) => {
          const ix = level.getIndices()?.getArray() as ArrayLike<number>;
          const tris: string[] = [];
          for (let t = 0; t < ix.length; t += 3) {
            const c = [key(ix[t]), key(ix[t + 1]), key(ix[t + 2])];
            const first = c.indexOf([...c].sort()[0]);
            tris.push([0, 1, 2].map((k) => c[(first + k) % 3]).join(' '));
          }
          return tris.sort();
        }),
      );
    });
  }
  return out;
}

describe('WOC_lod extension: the file', () => {
  it('round-trips the levels, listed as used and never as required', async () => {
    const io = lodIo();
    const doc = await fixture();
    const bytes = await io.writeBinary(doc);
    const json = glbJson(bytes);
    expect(json.extensionsUsed).toContain(WOC_LOD);
    expect(json.extensionsRequired ?? []).not.toContain(WOC_LOD);
    const def = json.meshes[0].primitives[0].extensions?.[WOC_LOD];
    expect(Object.keys(def ?? {})).toEqual(['levels']);
    expect(def?.levels).toHaveLength(2);
    for (const level of def?.levels ?? []) {
      expect(Object.keys(level).sort()).toEqual(['indices', 'maxDeviation']);
      expect(json.accessors[level.indices].componentType).toBe(
        Accessor.ComponentType.UNSIGNED_SHORT,
      );
      expect(json.bufferViews[json.accessors[level.indices].bufferView ?? -1]?.target).toBe(34963);
    }
    const back = await io.readBinary(bytes);
    expect(levelTriangles(back)).toEqual(levelTriangles(doc));
    const read = back.getRoot().listMeshes()[0].listPrimitives()[0].getExtension(WOC_LOD) as WocLod;
    const made = doc.getRoot().listMeshes()[0].listPrimitives()[0].getExtension(WOC_LOD) as WocLod;
    expect(read.listLevels().map((l) => l.getMaxDeviation())).toEqual(
      made.listLevels().map((l) => l.getMaxDeviation()),
    );
    // a reader without the extension still loads the file and draws level 0
    const plain = new NodeIO()
      .setLogger(quiet)
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const level0 = (await plain.readBinary(bytes)).getRoot().listMeshes()[0].listPrimitives()[0];
    expect(level0.getIndices()?.getCount()).toBe(2 * 18 * 18 * 3);
    expect(() => doc.createExtension(WocLodExtension).setRequired(true)).toThrow(/never required/);
  });

  it('keeps the levels through prune, dedup and meshopt, compressed with the triangle codec', async () => {
    const io = lodIo();
    const doc = await fixture();
    const before = levelTriangles(doc);
    await doc.transform(
      prune(),
      dedup(),
      keepLodIndices([meshopt({ encoder: MeshoptEncoder, level: 'high' })], {
        encoder: MeshoptEncoder,
      }),
    );
    // no vertex tag survives the step
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives())
        expect(prim.getAttribute(LOD_VERTEX_TAG)).toBeNull();
    }
    const bytes = await io.writeBinary(doc);
    const json = glbJson(bytes);
    expect(json.extensionsUsed).toEqual(
      expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization', WOC_LOD]),
    );
    expect(json.extensionsRequired ?? []).not.toContain(WOC_LOD);
    let levels = 0;
    for (const mesh of json.meshes) {
      for (const prim of mesh.primitives) {
        for (const level of prim.extensions?.[WOC_LOD]?.levels ?? []) {
          levels++;
          const view = json.bufferViews[json.accessors[level.indices].bufferView ?? -1];
          expect(view.extensions?.EXT_meshopt_compression?.mode).toBe('TRIANGLES');
          expect(view.target).toBe(34963);
        }
      }
    }
    expect(levels).toBe(4);
    // the same triangles over the same (now quantized and renumbered) vertices
    const back = await io.readBinary(bytes);
    expect(levelTriangles(back)).toEqual(before);
    // and every level re-measured over the quantized file is within what it records
    const { rows, failures } = verifyLodIndices(back, { tolerance: 2e-4 });
    expect(failures).toEqual([]);
    expect(rows).toHaveLength(4);
  });

  it('refuses to write levels whose vertices were renumbered outside keepLodIndices', async () => {
    const doc = await fixture();
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await expect(lodIo().writeBinary(doc)).rejects.toThrow(/keepLodIndices/);
  });

  it('drops the levels of a pruned primitive with it, and copies the rest with a document', async () => {
    const io = lodIo();
    const doc = await fixture();
    const clone = cloneDocument(doc);
    expect(levelTriangles(clone)).toEqual(levelTriangles(doc));
    // the split's cut: one piece's node goes, prune takes its mesh, primitive and levels
    const face = clone
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'face');
    face?.dispose();
    await clone.transform(prune({ keepLeaves: true }));
    const json = glbJson(await io.writeBinary(clone));
    const used = new Set<number>();
    for (const mesh of json.meshes) {
      for (const prim of mesh.primitives) {
        if (prim.indices !== undefined) used.add(prim.indices);
        for (const a of Object.values(prim.attributes)) used.add(a);
        for (const t of prim.targets ?? []) for (const a of Object.values(t)) used.add(a);
        for (const level of prim.extensions?.[WOC_LOD]?.levels ?? []) used.add(level.indices);
      }
    }
    expect(json.meshes).toHaveLength(1);
    expect(json.accessors.map((_a, i) => i).filter((i) => !used.has(i))).toEqual([]);
    expect(json.meshes[0].primitives[0].extensions?.[WOC_LOD]?.levels).toHaveLength(2);
  });

  it('does not list itself when no primitive carries a level', async () => {
    const doc = new Document().setLogger(quiet);
    doc.createBuffer();
    hang(doc, 'plain', gridPrimitive(doc, { n: 2 }));
    const ext = doc.createExtension(WocLodExtension);
    doc.getRoot().listMeshes()[0].listPrimitives()[0].setExtension(WOC_LOD, ext.createLod());
    const json = glbJson(await lodIo().writeBinary(doc));
    expect(json.extensionsUsed ?? []).not.toContain(WOC_LOD);
    expect(json.meshes[0].primitives[0].extensions?.[WOC_LOD]).toBeUndefined();
  });

  it('names one accessor for a far level that could not beat the mid one, through meshopt', async () => {
    const doc = new Document().setLogger(quiet);
    doc.createBuffer();
    hang(doc, 'surface', gridPrimitive(doc, { n: 16, height: waves }));
    // a far run held to the mid settings can only match the mid level: it reuses it
    const [mid] = LOD_LEVELS;
    const report = await addLodIndices(doc, { height: 1, levels: [mid, { ...mid, name: 'far' }] });
    expect(report.primitives[0].far?.sharesMid).toBe(true);
    await doc.transform(
      keepLodIndices([meshopt({ encoder: MeshoptEncoder, level: 'high' })], {
        encoder: MeshoptEncoder,
      }),
    );
    const levels = glbJson(await lodIo().writeBinary(doc)).meshes[0].primitives[0].extensions?.[
      WOC_LOD
    ]?.levels;
    expect(levels).toHaveLength(2);
    expect(levels?.[1].indices).toBe(levels?.[0].indices);
    expect(levels?.[1].maxDeviation).toBe(levels?.[0].maxDeviation);
  });
});

describe('WOC_lod in the shipped WOC character files', () => {
  const dir = path.resolve(__dirname, '..', 'public', WOC_SPLIT_DIR);
  const files = [
    ...readdirSync(dir).filter((f) => f.endsWith('.glb') && !f.startsWith('anims_')),
    ...readdirSync(path.join(dir, 'armor'))
      .filter((f) => f.endsWith('.glb'))
      .map((f) => `armor/${f}`),
  ].sort();
  // the bound of the far level, on the taller fit (its height in file units), plus rounding
  const farBound = LOD_LEVELS[1].limit * 1.2 + 1e-6;
  const midBound = LOD_LEVELS[0].limit * 1.2 + 1e-6;

  it('covers every base, armor and head file', () => {
    expect(files.filter((f) => f.startsWith('base_'))).toHaveLength(2);
    expect(files.filter((f) => f.startsWith('armor/'))).toHaveLength(54);
    expect(files.filter((f) => f.startsWith('head_type_')).length).toBeGreaterThanOrEqual(26);
  });

  it.each(files)('%s carries the contract', (file) => {
    const json = glbJson(new Uint8Array(readFileSync(path.join(dir, file))));
    expect(json.extensionsRequired ?? []).not.toContain(WOC_LOD);
    let levels = 0;
    for (const mesh of json.meshes ?? []) {
      for (const prim of mesh.primitives) {
        const lod = prim.extensions?.[WOC_LOD];
        if (!lod) continue;
        expect(lod.levels.length, file).toBeGreaterThanOrEqual(1);
        expect(lod.levels.length, file).toBeLessThanOrEqual(2);
        const vertices = json.accessors[prim.attributes.POSITION].count;
        const triangles = json.accessors[prim.indices ?? -1].count / 3;
        const counts = lod.levels.map((level) => {
          const accessor = json.accessors[level.indices];
          expect(accessor.componentType, file).toBe(
            vertices > 65535
              ? Accessor.ComponentType.UNSIGNED_INT
              : Accessor.ComponentType.UNSIGNED_SHORT,
          );
          expect(accessor.count % 3, file).toBe(0);
          // a kept level saves at least a tenth of its primitive's triangles
          expect(accessor.count / 3, file).toBeLessThanOrEqual(0.9 * triangles);
          const view = json.bufferViews[accessor.bufferView ?? -1];
          expect(view.target, file).toBe(34963);
          expect(view.extensions?.EXT_meshopt_compression?.mode, file).toBe('TRIANGLES');
          expect(level.maxDeviation, file).toBeGreaterThanOrEqual(0);
          expect(level.maxDeviation, file).toBeLessThanOrEqual(farBound);
          return accessor.count;
        });
        // mid first: never coarser than the far level after it, within the tighter bound
        if (counts.length === 2) {
          expect(counts[0], file).toBeGreaterThanOrEqual(counts[1]);
          expect(lod.levels[0].maxDeviation, file).toBeLessThanOrEqual(midBound);
        }
        levels += lod.levels.length;
      }
    }
    // the top files carry no geometry and no levels; every other file has them
    const top = file.endsWith('_top.glb');
    expect(levels > 0, file).toBe(!top);
    expect((json.extensionsUsed ?? []).includes(WOC_LOD), file).toBe(!top);
  });
});
