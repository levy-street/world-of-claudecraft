// node compose.mjs <body.glb> <donor.glb> <out.glb>: the body with the donor's clips
// replacing its own by name (what the game draws), for Blender review.
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const [bodyP, donorP, outP] = process.argv.slice(2);
const body = await io.readBinary(new Uint8Array(readFileSync(bodyP)));
const donor = await io.readBinary(new Uint8Array(readFileSync(donorP)));
const root = body.getRoot();
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];
for (const from of donor.getRoot().listAnimations()) {
  const name = from.getName();
  const old = root.listAnimations().find((a) => a.getName() === name);
  if (old) {
    for (const s of old.listSamplers()) s.dispose();
    for (const c of old.listChannels()) c.dispose();
    old.dispose();
  }
  const to = body.createAnimation(name);
  for (const ch of from.listChannels()) {
    const node = byName.get(ch.getTargetNode()?.getName() ?? '');
    if (!node) continue;
    const s = ch.getSampler();
    const inp = body
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Float32Array(s.getInput().getArray()))
      .setBuffer(buffer);
    const src = s.getOutput();
    let arr = src.getArray();
    if (src.getNormalized() || !(arr instanceof Float32Array)) {
      const n = src.getCount(),
        k = src.getElementSize();
      const f = new Float32Array(n * k);
      const el = [];
      for (let i = 0; i < n; i++) {
        src.getElement(i, el);
        for (let j = 0; j < k; j++) f[i * k + j] = el[j];
      }
      arr = f;
    }
    const out = body
      .createAccessor()
      .setType(src.getType())
      .setArray(new Float32Array(arr))
      .setBuffer(buffer);
    const sm = body
      .createAnimationSampler()
      .setInput(inp)
      .setOutput(out)
      .setInterpolation(s.getInterpolation());
    to.addSampler(sm);
    to.addChannel(
      body
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath(ch.getTargetPath())
        .setSampler(sm),
    );
  }
  console.log('clip', name, to.listChannels().length);
}
for (const e of root.listExtensionsUsed())
  if (/meshopt|quantization/.test(e.extensionName)) e.dispose();
await body.transform(dequantize());
writeFileSync(outP, await io.writeBinary(body));
console.log('wrote', outP);
