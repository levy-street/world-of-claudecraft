// One-time, deterministic migration for the shipped Eastbrook Vale pine/oak
// GLBs. The raw foliage builder now runs the same finalization stage. This
// command exists so the already-shipped artifacts can be updated without the
// maintainer-local source pack.
//
// Usage: node scripts/assets/optimize_foliage_vertices.mjs
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import {
  FOLIAGE_TOWN_TREE_ASSETS,
  optimizeFoliageVertexDocument,
  triangleAttributeFingerprint,
} from './foliage_vertex_pipeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

for (const asset of FOLIAGE_TOWN_TREE_ASSETS) {
  const assetPath = path.join(ROOT, 'public', asset.path);
  const currentSha256 = sha256(assetPath);
  if (currentSha256 === asset.outputSha256) {
    console.log(`  ${asset.path}  already finalized`);
    continue;
  }
  if (currentSha256 !== asset.inputSha256) {
    throw new Error(
      `${asset.path} has unrecognized sha256 ${currentSha256}; expected source ${asset.inputSha256}`,
    );
  }

  const document = await io.read(assetPath);
  const before = triangleAttributeFingerprint(document);
  if (before !== asset.semanticSha256) {
    throw new Error(`${asset.path} source triangle fingerprint changed: ${before}`);
  }
  await optimizeFoliageVertexDocument(document, MeshoptEncoder);
  const after = triangleAttributeFingerprint(document);
  if (after !== before) {
    throw new Error(`${asset.path} changed triangle winding or corner attribute bytes`);
  }

  const temporaryPath = `${assetPath}.vertex-pipeline.tmp.glb`;
  try {
    await io.write(temporaryPath, document);
    const outputSha256 = sha256(temporaryPath);
    if (outputSha256 !== asset.outputSha256) {
      throw new Error(
        `${asset.path} produced sha256 ${outputSha256}; expected ${asset.outputSha256}`,
      );
    }
    renameSync(temporaryPath, assetPath);
    console.log(`  ${asset.path}  ${outputSha256.slice(0, 12)}`);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
