// Offline index-only LOD for distant scenery. Keep every level-0 vertex, UV,
// material and texture; the renderer draws the source at interaction distance.
import { getBounds } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { characterSpace, measureDeviation } from './woc_character/lod_indices.mjs';
import {
  indexFingerprint,
  lodIndexArrayFor,
  WocLodExtension,
} from './woc_character/woc_lod_extension.mjs';

export const SCENERY_LOD_ASSETS = [
  {
    source: 'models/props/maze_hedge_wall.glb',
    output: 'models/props/maze_hedge_wall_lod.glb',
    sha256: '57a345d29120a4f0e61db55b9f0a80a8ebc152eb7df26f1684ce97187ac44895',
  },
  {
    source: 'models/props/maze_hedge_arch.glb',
    output: 'models/props/maze_hedge_arch_lod.glb',
    sha256: '188cfccfb729ffff397ae331684d00412dd0388612b950e4e130bdf239bd615e',
  },
  {
    source: 'models/foliage/twisted_1.glb',
    output: 'models/foliage/twisted_1_lod.glb',
    sha256: '1f63852b64aa9cb4401325da3c7044c8c4e6039a3392956585523177d508afba',
    materials: ['Bark_TwistedTree'],
  },
  {
    source: 'models/biome/beach_palm_1.glb',
    output: 'models/biome/beach_palm_1_lod.glb',
    sha256: '47f48bb69a12116444485a7de8303013fdfb90dfc3e8ee251f6bf6c3ee2c1a16',
  },
  {
    source: 'models/biome/beach_palm_2.glb',
    output: 'models/biome/beach_palm_2_lod.glb',
    sha256: '3f665fdb5044181607eea5427bbd8dfa881c85e2cf8ca1eae6ec45f58084446b',
  },
  {
    source: 'models/biome/beach_palm_3.glb',
    output: 'models/biome/beach_palm_3_lod.glb',
    sha256: 'da3b3e49863ef0e8ecb3a04b0139ae33ae7c868e79319defbe2aa9abfadff977',
  },
];

const LOD_COPY_CATALOG_IDS = new Set(
  SCENERY_LOD_ASSETS.map((asset) => asset.output.replace(/^models\//, '').replace(/\.glb$/, '')),
);

/** True for a derived `<model>_lod` copy: the source plus far index levels, drawn only by the
 *  zone features. Not placeable (an authored map places the source), so the editor catalog and
 *  the collision bake skip it. */
export function isSceneryLodCopyCatalogId(id) {
  return LOD_COPY_CATALOG_IDS.has(id);
}

export async function addSceneryLod(doc, options = {}) {
  await MeshoptSimplifier.ready;
  const bounds = getBounds(doc.getRoot().listScenes()[0]);
  const height = bounds.max[1] - bounds.min[1];
  if (!(height > 0 && Number.isFinite(height))) throw Error('Invalid scenery height');
  const extension = doc.createExtension(WocLodExtension);
  const report = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const nodes = mesh.listParents().filter((parent) => parent.propertyType === 'Node');
    if (nodes.length !== 1) throw Error('Scenery LOD expects one rigid source instance');
    for (const primitive of mesh.listPrimitives()) {
      // Leaves retain their exact mesh at every distance. Their alpha-tested
      // silhouette is the landmark; only its opaque bark needs another level.
      if (options.materials && !options.materials.includes(primitive.getMaterial()?.getName())) {
        continue;
      }
      if (primitive.getMode() !== 4 || !primitive.getIndices()) {
        throw Error('Scenery LOD expects indexed triangles');
      }
      const space = characterSpace(primitive, nodes[0]);
      const base = Uint32Array.from(primitive.getIndices().getArray());
      const samples = [...new Set(base)];
      const uv = primitive.getAttribute('TEXCOORD_0');
      const attributes = new Float32Array(space.count * 5);
      const element = [];
      for (let i = 0; i < space.count; i++) {
        attributes.set(space.nrm.subarray(i * 3, i * 3 + 3), i * 5);
        uv?.getElement(i, element);
        attributes[i * 5 + 3] = element[0] ?? 0;
        attributes[i * 5 + 4] = element[1] ?? 0;
      }
      const lod = extension.createLod();
      const row = { mesh: mesh.getName(), height, triangles: base.length / 3, levels: [] };
      // Distance, not removal: the far level is restricted to the Low preset
      // beyond 180 yd from the nearest batch edge. Measure the actual surface
      // deviation; the simplifier's estimate includes attribute error.
      for (const limit of [0.025, 0.075]) {
        let best = { indices: base, deviation: 0 };
        for (const share of [0.9, 0.8, 0.7, 0.6, 0.4, 0.3, 0.2, 0.15, 0.1, 0.08]) {
          const [indices] = MeshoptSimplifier.simplifyWithAttributes(
            base,
            space.pos,
            3,
            attributes,
            5,
            [0.02, 0.02, 0.02, 0.02, 0.02],
            null,
            Math.floor((base.length * share) / 3) * 3,
            1,
            ['Permissive'],
          );
          if (!indices.length || indices.length >= best.indices.length) continue;
          const measured = measureDeviation(space.pos, samples, indices, limit * height);
          if (!measured.exceeded && measured.max <= limit * height) {
            best = { indices, deviation: measured.max };
          }
        }
        const accessor = doc
          .createAccessor('', primitive.getIndices().getBuffer())
          .setType('SCALAR')
          .setArray(lodIndexArrayFor(space.count, best.indices));
        const maxDeviation = Math.ceil(best.deviation * 1e6) / 1e6;
        lod.addLevel(extension.createLevel().setIndices(accessor).setMaxDeviation(maxDeviation));
        row.levels.push({ triangles: best.indices.length / 3, maxDeviation });
      }
      lod.setBaseIndexHash(indexFingerprint(primitive.getIndices()));
      primitive.setExtension('WOC_lod', lod);
      report.push(row);
    }
  }
  return report;
}
