import { createHash } from 'node:crypto';
import { getBounds, PropertyType } from '@gltf-transform/core';
import {
  optimizeFoliageVertexDocument,
  primitiveTriangleAttributeFingerprint,
} from './foliage_vertex_pipeline.mjs';

/** Relative simplifier error large enough that the triangle target, not the
 *  error bound, stops the collapse (the foliage bench's count-decides value). */
export const FOLIAGE_BARK_SIMPLIFY_ERROR = 4;
/** How far under its budget a simplified bark may stop. */
export const FOLIAGE_BARK_TRIANGLE_SHORTFALL = 4;
/** Largest world-space shift of any model bounds face, in model units. */
export const FOLIAGE_BARK_BOUNDS_TOLERANCE = 0.05;

// Sources are the shipped tree GLBs; outputs are the world foliage field's
// copies. Every other consumer of the sources keeps the full-detail file.
export const FOLIAGE_FIELD_BARK_ASSETS = Object.freeze([
  {
    sourcePath: 'models/foliage/pine_1.glb',
    sourceSha256: '18d21cee2d4141a31ca6c238836e66242d4ca259a874eb2c53c120ba94491f2d',
    barkTriangleBudget: 1200,
    outputPath: 'models/foliage/pine_1_field.glb',
    outputSha256: 'b2de7d8d93daa807835d42ea92aa0fb5817adce00a57e7c9e1365fbedf15a1b0',
  },
  {
    sourcePath: 'models/foliage/pine_2.glb',
    sourceSha256: 'e3c2d2a2b06b7ad2fb9d186e72797a00287b786d595539c0994880cbcc944bb5',
    barkTriangleBudget: 1200,
    outputPath: 'models/foliage/pine_2_field.glb',
    outputSha256: 'bac6680a8c26a13d19ff5bb58a8ec0331b7976978e2213ed81959a0191474da7',
  },
  {
    sourcePath: 'models/foliage/pine_4.glb',
    sourceSha256: '25b84be096d31f1ff8d542fd4c5fadb7b1c68f9aa15e3e558625d0ecde5378be',
    barkTriangleBudget: 1200,
    outputPath: 'models/foliage/pine_4_field.glb',
    outputSha256: '26982681dd59ecfb996ad77a3f764eb276b99074fd88f9edb06afd36f8be9618',
  },
  {
    sourcePath: 'models/foliage/oak_1.glb',
    sourceSha256: '9510f3ba02e6395e7ea0b4f766652d9159efcd9593ac56b5f907f7553d6dc5e1',
    barkTriangleBudget: 1600,
    outputPath: 'models/foliage/oak_1_field.glb',
    outputSha256: '81898a4faeb28a10a0a6b9afea6e3a5ea6fa311990555043a9b2453bdfea881d',
  },
  {
    sourcePath: 'models/foliage/oak_2.glb',
    sourceSha256: 'eeea227bbd3779ed6b932aa75d9170b49a601743af2eee055e52ef97803f7bc6',
    barkTriangleBudget: 1600,
    outputPath: 'models/foliage/oak_2_field.glb',
    outputSha256: '261c498990b3a6e653b1e9be8ec7df32996ab3e7d04585c39aacc7badb22bc03',
  },
  {
    sourcePath: 'models/foliage/oak_4.glb',
    sourceSha256: 'a8d015f28af796a92bbfa083f50b5d53f187c9db12bc04ebefe8a3b8269fb0e7',
    barkTriangleBudget: 1600,
    outputPath: 'models/foliage/oak_4_field.glb',
    outputSha256: 'a460a56a29ff568587bd7bc56a2fc8c4012aed8267b8111ea853413a91506a9c',
  },
  {
    sourcePath: 'models/foliage/oak_5.glb',
    sourceSha256: '6de684b3a783d6406444c351bc55fedd2a467ddc71840174c9bf9c45438173ae',
    barkTriangleBudget: 1600,
    outputPath: 'models/foliage/oak_5_field.glb',
    outputSha256: '6cc4d1c19cc6a44e331866e60e40121d5d10605d62264fb1783b888bde060c05',
  },
  {
    sourcePath: 'models/foliage/twisted_1.glb',
    sourceSha256: '1f63852b64aa9cb4401325da3c7044c8c4e6039a3392956585523177d508afba',
    barkTriangleBudget: 1800,
    outputPath: 'models/foliage/twisted_1_field.glb',
    outputSha256: '9e6114cac7cfcab7310453aab1e3419548c100a5353adc477a14b0ca2fc042bf',
  },
  {
    sourcePath: 'models/foliage/twisted_2.glb',
    sourceSha256: '6ff31dcb2a9c36ea57c039a1902d2521cc4a3a980bf3c255817ab0a17cb260cd',
    barkTriangleBudget: 1800,
    outputPath: 'models/foliage/twisted_2_field.glb',
    outputSha256: '9e1f2b279fb020e967c7df18d549aa6f134e91593f3f804113f54171966faaed',
  },
  {
    sourcePath: 'models/foliage/twisted_3.glb',
    sourceSha256: '1f337078cda9d799c289159b53e62f00237115e9d7b1253a0ebb3920057fec41',
    barkTriangleBudget: 1800,
    outputPath: 'models/foliage/twisted_3_field.glb',
    outputSha256: '6573b1ffdabfd42b0c19f06be24908cacdd9e2318479b530051e6f954c2856ba',
  },
]);

const FIELD_COPY_CATALOG_IDS = new Set(
  FOLIAGE_FIELD_BARK_ASSETS.map(({ outputPath }) =>
    outputPath.replace(/^models\//, '').replace(/\.glb$/, ''),
  ),
);

/** Whether an editor asset catalog id (`foliage/pine_1_field`, as
 *  scripts/gen_asset_catalog.mjs derives it) names one of the stage outputs. */
export function isFoliageFieldCopyCatalogId(id) {
  return FIELD_COPY_CATALOG_IDS.has(id);
}

/** The trunk materials of the tree kit (the non-leaf `Bark_*` names of foliage.ts MAT_POLICY). */
export function isFoliageBarkMaterial(name) {
  return name.startsWith('Bark_');
}

function denormalize(value, array) {
  if (array instanceof Float32Array) return value;
  if (array instanceof Uint16Array) return value / 65535.0;
  if (array instanceof Uint8Array) return value / 255.0;
  if (array instanceof Int16Array) return Math.max(value / 32767.0, -1.0);
  if (array instanceof Int8Array) return Math.max(value / 127.0, -1.0);
  throw new Error(`Unsupported POSITION array ${array.constructor.name}`);
}

/**
 * POSITION baked to float32 world space with the exact arithmetic of the
 * renderer's bake (foliage.ts bakeGeometry: three's attribute denormalize,
 * then Vector3.applyMatrix4), so the simplifier sees the same bits the
 * approved bench arm did.
 */
function bakedPositions(accessor, matrix) {
  const array = accessor.getArray();
  const normalized = accessor.getNormalized();
  const count = accessor.getCount();
  const float = (value) => Math.fround(normalized ? denormalize(value, array) : value);
  const out = new Float32Array(count * 3);
  const e = matrix;
  for (let i = 0; i < count; i++) {
    const x = float(array[i * 3]);
    const y = float(array[i * 3 + 1]);
    const z = float(array[i * 3 + 2]);
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    out[i * 3] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    out[i * 3 + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    out[i * 3 + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  }
  return out;
}

function meshWorldMatrix(mesh) {
  const nodes = mesh.listParents().filter((parent) => parent.propertyType === PropertyType.NODE);
  if (nodes.length !== 1) {
    throw new Error(`Bark mesh ${mesh.getName()} is instanced by ${nodes.length} nodes`);
  }
  return nodes[0].getWorldMatrix();
}

function classifyPrimitives(document) {
  const bark = [];
  const other = [];
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const name = primitive.getMaterial()?.getName() ?? '';
      (isFoliageBarkMaterial(name) ? bark : other).push({ mesh, primitive });
    }
  }
  return { bark, other };
}

function textureDigests(document) {
  return document
    .getRoot()
    .listTextures()
    .map((texture) => {
      const image = texture.getImage();
      if (!image) throw new Error(`Texture ${texture.getName()} has no image`);
      const sha256 = createHash('sha256').update(image).digest('hex');
      return `${texture.getName()}|${texture.getMimeType()}|${sha256}`;
    });
}

function documentBounds(document) {
  const scenes = document.getRoot().listScenes();
  if (scenes.length !== 1) throw new Error(`Expected one scene, found ${scenes.length}`);
  return getBounds(scenes[0]);
}

function indexedBounds(positions, indices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const vertex of indices) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[vertex * 3 + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

function largestBoundsShift(before, after) {
  let shift = 0;
  for (const face of ['min', 'max']) {
    for (let axis = 0; axis < 3; axis++) {
      shift = Math.max(shift, Math.abs(before[face][axis] - after[face][axis]));
    }
  }
  return shift;
}

/**
 * Simplify the one bark primitive of a foliage tree to its triangle budget,
 * as the approved foliage bench arm did at runtime: a permissive
 * meshoptimizer collapse over the renderer-baked positions, the count
 * deciding. The collapse keeps original vertices only; the vertex pipeline
 * that finishes the document drops the ones it no longer references. Every
 * other primitive, material, texture and extension is kept. Throws when an
 * invariant does not hold.
 */
export async function decimateFoliageBarkDocument(
  document,
  { barkTriangleBudget, simplifier, encoder },
) {
  const { bark, other } = classifyPrimitives(document);
  if (bark.length !== 1) throw new Error(`Expected one bark primitive, found ${bark.length}`);
  if (other.length === 0) throw new Error('Expected leaf primitives next to the bark');
  const barkPrimitive = bark[0].primitive;
  const otherFingerprints = other.map(({ primitive }) =>
    primitiveTriangleAttributeFingerprint(primitive),
  );
  const texturesBefore = textureDigests(document);
  const boundsBefore = documentBounds(document);

  const indices = barkPrimitive.getIndices();
  const position = barkPrimitive.getAttribute('POSITION');
  if (!indices || !position) throw new Error('Bark primitive is not indexed or has no POSITION');
  const sourceTriangles = indices.getCount() / 3;
  const sourceVertices = position.getCount();
  if (barkTriangleBudget >= sourceTriangles) {
    throw new Error(`Bark budget ${barkTriangleBudget} is not below ${sourceTriangles}`);
  }
  const positions = bakedPositions(position, meshWorldMatrix(bark[0].mesh));
  const [simplified, relativeError] = simplifier.simplify(
    Uint32Array.from(indices.getArray()),
    positions,
    3,
    barkTriangleBudget * 3,
    FOLIAGE_BARK_SIMPLIFY_ERROR,
    ['Permissive'],
  );
  const barkTriangles = simplified.length / 3;
  if (
    barkTriangles > barkTriangleBudget ||
    barkTriangles < barkTriangleBudget - FOLIAGE_BARK_TRIANGLE_SHORTFALL
  ) {
    throw new Error(`Bark simplified to ${barkTriangles} triangles, budget ${barkTriangleBudget}`);
  }
  // The far-trunk proxy and the shadow caster bounds read the bark alone.
  const barkBoundsShift = largestBoundsShift(
    indexedBounds(positions, indices.getArray()),
    indexedBounds(positions, simplified),
  );
  if (barkBoundsShift > FOLIAGE_BARK_BOUNDS_TOLERANCE) {
    throw new Error(`Bark bounds moved by ${barkBoundsShift}`);
  }
  // The simplifier returns source vertex ids, so they fit the source index type.
  indices.setArray(indices.getArray().constructor.from(simplified));
  await optimizeFoliageVertexDocument(document, encoder);

  // Safety checks against a future vertex pipeline: today's weld and reorder
  // cannot change the primitive set, the bark triangle count, the textures or
  // the bounds. The non-bark check also catches a leaf sharing the bark's
  // index accessor.
  const after = classifyPrimitives(document);
  if (after.bark.length !== 1 || after.other.length !== other.length) {
    throw new Error('Primitive set changed during decimation');
  }
  const finishedBark = after.bark[0].primitive;
  if (finishedBark.getIndices().getCount() / 3 !== barkTriangles) {
    throw new Error('Vertex pipeline changed the bark triangle count');
  }
  for (const [index, { primitive }] of after.other.entries()) {
    if (primitiveTriangleAttributeFingerprint(primitive) !== otherFingerprints[index]) {
      throw new Error(`Non-bark primitive ${index} changed`);
    }
  }
  const texturesAfter = textureDigests(document);
  if (texturesAfter.join('\n') !== texturesBefore.join('\n')) {
    throw new Error('Texture images changed');
  }
  const boundsAfter = documentBounds(document);
  const boundsShift = largestBoundsShift(boundsBefore, boundsAfter);
  if (boundsShift > FOLIAGE_BARK_BOUNDS_TOLERANCE) {
    throw new Error(`Model bounds moved by ${boundsShift}`);
  }
  return {
    sourceTriangles,
    sourceVertices,
    barkTriangles,
    barkVertices: finishedBark.getAttribute('POSITION').getCount(),
    relativeError,
    absoluteError: relativeError * simplifier.getScale(positions, 3),
    boundsShift,
    barkBoundsShift,
  };
}
