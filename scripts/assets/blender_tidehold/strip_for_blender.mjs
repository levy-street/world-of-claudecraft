import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [src, dst] = process.argv.slice(2);
const doc = await io.read(src);
await doc.transform(dequantize());
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(ext.extensionName))
    ext.dispose();
}
// webp -> png so Blender can read
for (const t of doc.getRoot().listTextures()) {
  if (t.getMimeType() === 'image/webp') {
    t.setImage(await sharp(Buffer.from(t.getImage())).png().toBuffer());
    t.setMimeType('image/png');
    const u = t.getURI();
    if (u) t.setURI(u.replace(/\.\w+$/, '.png'));
  }
}
for (const ext of doc.getRoot().listExtensionsUsed())
  if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
await io.write(dst, doc);
console.log('wrote', dst);
