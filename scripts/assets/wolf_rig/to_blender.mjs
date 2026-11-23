// A Blender-readable copy of a shipped creature GLB, for build.py and for looking
// at a rig in Blender. Blender's glTF importer refuses KHR_texture_basisu and cannot
// read meshopt buffers, so the KTX2 textures are decoded to PNG (ktx extract) and
// the quantization and meshopt are undone. Any extra GLBs are clip donors (mesh-free
// animation files): their clips are bound to this file's nodes by name. Nothing is written back to public/; the copy is a throwaway
// under tmp/.
//
//   node scripts/assets/wolf_rig/to_blender.mjs <out.glb> <in.glb> [<clip-donor.glb> ...]
//
// Needs the `ktx` tool (KTX-Software 4.3+) on PATH, or KTX_BIN pointing at its bin/.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const KTX = process.env.KTX_BIN ? path.join(process.env.KTX_BIN, 'ktx') : 'ktx';
const [, , out, input, ...donors] = process.argv;
if (!out || !input) {
  console.error('usage: to_blender.mjs <out.glb> <in.glb> [<clip-donor.glb> ...]');
  process.exit(1);
}

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
io.setLogger({
  debug() {},
  info() {},
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
});

const doc = await io.read(input);
const root = doc.getRoot();
const work = mkdtempSync(path.join(tmpdir(), 'wolf-ktx-'));
try {
  root.listTextures().forEach((tex, n) => {
    if (tex.getMimeType() !== 'image/ktx2') return;
    const src = path.join(work, `t${n}.ktx2`);
    const dst = path.join(work, `t${n}.png`);
    writeFileSync(src, tex.getImage());
    execFileSync(KTX, ['extract', '--transcode', 'rgba8', src, dst], { stdio: 'pipe' });
    const name = (tex.getName() || `texture_${n}`).replace(/[^\w-]+/g, '_');
    tex.setImage(readFileSync(dst)).setMimeType('image/png').setURI(`${name}.png`);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

const byName = new Map(root.listNodes().map((node) => [node.getName(), node]));
const buffer = root.listBuffers()[0];
const floatCopy = (acc) => {
  const size = acc.getElementSize();
  const arr = new Float32Array(acc.getCount() * size);
  const el = new Array(size).fill(0);
  for (let i = 0; i < acc.getCount(); i++) {
    acc.getElement(i, el);
    arr.set(el, i * size);
  }
  return doc.createAccessor().setType(acc.getType()).setArray(arr).setBuffer(buffer);
};
for (const donorPath of donors) {
  const donor = await io.read(donorPath);
  for (const anim of donor.getRoot().listAnimations()) {
    const copy = doc.createAnimation(anim.getName());
    for (const ch of anim.listChannels()) {
      const target = byName.get(ch.getTargetNode()?.getName());
      if (!target) continue;
      const s = ch.getSampler();
      const sampler = doc
        .createAnimationSampler()
        .setInput(floatCopy(s.getInput()))
        .setOutput(floatCopy(s.getOutput()))
        .setInterpolation(s.getInterpolation());
      copy.addSampler(sampler);
      copy.addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(target)
          .setTargetPath(ch.getTargetPath())
          .setSampler(sampler),
      );
    }
  }
}

await doc.transform(dequantize());
for (const ext of root.listExtensionsUsed()) {
  if (
    ['KHR_texture_basisu', 'EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(
      ext.extensionName,
    )
  ) {
    ext.dispose();
  }
}
await io.write(out, doc);
console.log(
  'wrote',
  out,
  '| clips:',
  root
    .listAnimations()
    .map((a) => a.getName())
    .join(', '),
);
