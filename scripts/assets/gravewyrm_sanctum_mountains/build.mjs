// Ship the Gravewyrm Sanctum's cirque: the eroded heightfield
// (docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_mountains.py) as
// ONE mesh with two KTX2 textures:
//   baseColorTexture  the slate, snow, ice and glacier paint (ETC1S)
//   occlusionTexture  NOT occlusion: the 1 yd field's OBJECT-SPACE normals
//                     (y up), kept in this linear slot so the pipeline
//                     encodes all three channels as UASTC (the normal slot's
//                     encoder assumes tangent space). A painter reads it
//                     as an object-space normal map, as the Foundry's does
//                     (src/render/stormbrass_foundry/foundry_mountains.ts).
// The mesh is in instance-local yards (z north) round the field's centre
// (meta.json centerX, centerZ): place it at the instance origin.
//
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_mountains.py -- --out tmp/gravewyrm_sanctum_mountains
//   KTX_BIN=<ktx bin dir> node scripts/assets/gravewyrm_sanctum_mountains/build.mjs [srcDir]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Mode, toktx } from '@gltf-transform/cli';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const ASSET = {
  source: 'tmp/gravewyrm_sanctum_mountains',
  target: 'public/models/props/gravewyrm_sanctum_mountains.glb',
  node: 'GravewyrmSanctumMountains',
  material: 'GravewyrmMountainRock',
};

/** The generator and this script (the raw field is a local intermediate). */
export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  for (const file of [
    'docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_mountains.py',
    'scripts/assets/gravewyrm_sanctum_mountains/build.mjs',
  ]) {
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(path.join(root, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

export async function buildMountains(srcDir, root = ROOT) {
  // The exact Sharp the gltf-transform CLI owns (a second one fails to load on
  // Windows), and the ktx tool on PATH only after it is resident.
  const rootRequire = createRequire(import.meta.url);
  const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
  const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
  if (process.env.KTX_BIN)
    process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);

  const meta = JSON.parse(readFileSync(path.join(srcDir, 'meta.json'), 'utf8'));
  const raw = readFileSync(path.join(srcDir, 'heights.f32'));
  const heights = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const { meshX: nx, meshZ: nz, meshCell: cell, halfX, halfZ, centerX, centerZ } = meta;
  if (heights.length !== nx * nz) throw new Error('heights.f32 does not match meta.json');

  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const at = (ix, iz) =>
    heights[Math.min(nz - 1, Math.max(0, iz)) * nx + Math.min(nx - 1, Math.max(0, ix))];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      positions.set([centerX - halfX + ix * cell, heights[i], centerZ - halfZ + iz * cell], i * 3);
      const gx = (at(ix + 1, iz) - at(ix - 1, iz)) / (2 * cell);
      const gz = (at(ix, iz + 1) - at(ix, iz - 1)) / (2 * cell);
      const len = Math.hypot(gx, 1, gz);
      normals.set([-gx / len, 1 / len, -gz / len], i * 3);
      // Row 0 of the textures is the field's south edge (glTF's v runs down).
      uvs.set([ix / (nx - 1), iz / (nz - 1)], i * 2);
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let iz = 0; iz + 1 < nz; iz++) {
    for (let ix = 0; ix + 1 < nx; ix++) {
      const a = iz * nx + ix;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Split each cell along its flatter diagonal (crisper ridgelines).
      if (Math.abs(heights[a] - heights[d]) < Math.abs(heights[b] - heights[c])) {
        indices.set([a, c, d, a, d, b], o);
      } else {
        indices.set([a, c, b, b, c, d], o);
      }
      o += 6;
    }
  }

  const png = (file) =>
    sharp(readFileSync(path.join(srcDir, file)), {
      raw: { width: meta.texX, height: meta.texZ, channels: 3 },
    })
      .png()
      .toBuffer();
  const doc = new Document();
  const buffer = doc.createBuffer();
  const albedo = doc
    .createTexture('MountainAlbedo')
    .setMimeType('image/png')
    .setImage(await png('albedo.rgb'));
  const objectNormals = doc
    .createTexture('MountainObjectNormals')
    .setMimeType('image/png')
    .setImage(await png('normal.rgb'));
  const material = doc
    .createMaterial(ASSET.material)
    .setBaseColorTexture(albedo)
    .setOcclusionTexture(objectNormals)
    .setRoughnessFactor(1)
    .setMetallicFactor(0);
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer),
    );
  const mesh = doc.createMesh(ASSET.node).addPrimitive(prim);
  doc.createScene().addChild(doc.createNode(ASSET.node).setMesh(mesh));
  doc.getRoot().setExtras({
    sourceFingerprint: sourceFingerprint(root),
    authoring: 'heightfield',
    centerX,
    centerZ,
    halfX,
    halfZ,
    minY: meta.minY,
    maxY: meta.maxY,
  });
  await doc.transform(
    toktx({ mode: Mode.UASTC, slots: /^occlusionTexture$/, jobs: 2, encoder: sharp }),
    toktx({ mode: Mode.ETC1S, jobs: 2, encoder: sharp }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srcDir = path.resolve(ROOT, process.argv[2] ?? ASSET.source);
  const bytes = await buildMountains(srcDir);
  mkdirSync(path.dirname(path.join(ROOT, ASSET.target)), { recursive: true });
  writeFileSync(path.join(ROOT, ASSET.target), bytes);
  console.log(
    `${ASSET.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}
