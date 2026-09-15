// Deterministic offline stage for the world foliage field's tree copies: the
// bark primitive of each source GLB is simplified to its species budget and
// written as a sibling `<model>_field.glb`. The sources stay byte-identical
// for every other consumer (the great trees, the Thornhollow dressing, the
// oakTree prop). Table and invariants: foliage_bark_decimation.mjs.
//
// Usage: node scripts/assets/decimate_foliage_bark.mjs [--write-pins]
//   --write-pins  accept an output sha256 that differs from its pin, write it,
//                 and print the new pins plus the remaining re-pin steps
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import {
  decimateFoliageBarkDocument,
  FOLIAGE_FIELD_BARK_ASSETS,
} from './foliage_bark_decimation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const writePins = args.includes('--write-pins');
const unknown = args.filter((arg) => arg !== '--write-pins');
if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(' ')}`);

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

for (const asset of FOLIAGE_FIELD_BARK_ASSETS) {
  const sourceSha256 = sha256(path.join(ROOT, 'public', asset.sourcePath));
  if (sourceSha256 !== asset.sourceSha256) {
    throw new Error(
      `${asset.sourcePath} has unrecognized sha256 ${sourceSha256}; expected ${asset.sourceSha256}`,
    );
  }
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const repinned = [];
for (const asset of FOLIAGE_FIELD_BARK_ASSETS) {
  const sourcePath = path.join(ROOT, 'public', asset.sourcePath);
  const outputPath = path.join(ROOT, 'public', asset.outputPath);
  const document = await io.read(sourcePath);
  const report = await decimateFoliageBarkDocument(document, {
    barkTriangleBudget: asset.barkTriangleBudget,
    simplifier: MeshoptSimplifier,
    encoder: MeshoptEncoder,
  });

  const temporaryPath = `${outputPath}.bark-decimation.tmp.glb`;
  try {
    await io.write(temporaryPath, document);
    const outputSha256 = sha256(temporaryPath);
    if (outputSha256 !== asset.outputSha256) {
      if (!writePins) {
        throw new Error(
          `${asset.outputPath} produced sha256 ${outputSha256}; expected ${asset.outputSha256}`,
        );
      }
      repinned.push({ outputPath: asset.outputPath, outputSha256 });
    }
    renameSync(temporaryPath, outputPath);
    console.log(
      [
        `  ${asset.outputPath}`,
        `bark ${report.sourceTriangles} -> ${report.barkTriangles} tris`,
        `${report.sourceVertices} -> ${report.barkVertices} verts`,
        `error ${report.relativeError.toFixed(6)} (${report.absoluteError.toFixed(6)} units)`,
        `bounds shift ${report.boundsShift.toFixed(6)} (bark ${report.barkBoundsShift.toFixed(6)})`,
        `${statSync(sourcePath).size} -> ${statSync(outputPath).size} bytes`,
        outputSha256.slice(0, 12),
      ].join('  '),
    );
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

if (repinned.length > 0) {
  console.log('\nNew output pins (paste into FOLIAGE_FIELD_BARK_ASSETS):');
  for (const { outputPath, outputSha256 } of repinned) {
    console.log(`  ${outputPath}: '${outputSha256}'`);
  }
  console.log(
    [
      '\nRemaining re-pin steps:',
      '  1. paste the same outputSha256 values into EXPECTED in',
      '     tests/foliage_field_bark_decimation.test.ts, with the bark tris and verts printed above',
      '  2. node scripts/build_media_manifest.mjs generate',
      '  3. npx vitest run tests/foliage_field_bark_decimation.test.ts',
    ].join('\n'),
  );
}
