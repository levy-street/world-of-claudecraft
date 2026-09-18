// The cat's shipping texture encode. Mirrors scripts/assets/compress_glb_textures.mjs
// (webp -> png -> toktx -> meshopt re-apply) but chooses ETC1S for the base color
// where the shared script's Tripo rule would pick UASTC: at 1024 the UASTC atlas
// alone is 1.19 MB, ETC1S is 169 KB, and the fur strands survive it (reviewed
// against the source at 2x). The whole GLB lands at 888 KB with the 17 clips.
//
//   KTX_BIN=<KTX-Software bin> node scripts/assets/druid_cat/encode_ktx2.mjs \
//     <built webp glb> <out etc1s glb> [<out uastc512 glb>]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Mode, toktx } from '@gltf-transform/cli';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const rootRequire = createRequire(import.meta.url);
const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const [, , input, outA, outB] = process.argv;
async function encode(out, mode, resize, quality) {
  const doc = await io.readBinary(fs.readFileSync(input));
  const transforms = [
    textureCompress({
      encoder: sharp,
      targetFormat: 'png',
      formats: /^image\/webp$/,
      ...(resize ? { resize: [resize, resize] } : {}),
    }),
  ];
  transforms.push(
    toktx({
      mode,
      slots: /baseColorTexture/,
      jobs: 2,
      encoder: sharp,
      ...(quality ? { quality, compression: 5 } : {}),
    }),
  );
  transforms.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...transforms);
  const buf = Buffer.from(await io.writeBinary(doc));
  fs.writeFileSync(out, buf);
  const j = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
  const bv = j.bufferViews[j.images[0].bufferView];
  console.log(
    out.split('/').pop(),
    'total',
    buf.length,
    'texture',
    j.images[0].mimeType,
    bv.byteLength,
    'ext',
    j.extensionsUsed.join('+'),
  );
}
await encode(outA, Mode.ETC1S, null, 255);
if (outB) await encode(outB, Mode.UASTC, 512);
