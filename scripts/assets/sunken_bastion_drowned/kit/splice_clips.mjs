// Splice named clips from a raw Blender export into a shipped (KTX2 + meshopt)
// GLB without touching its meshes or textures. Authoring aid; never shipped.
//   node splice_clips.mjs <shipped.glb> <raw.glb> <Clip,Clip> <out.glb>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [, , shippedPath, rawPath, clipList, outPath] = process.argv;
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const shipped = await io.readBinary(fs.readFileSync(shippedPath));
const raw = await io.readBinary(fs.readFileSync(rawPath));
const names = clipList.split(',');
// Resample only the raw side (the shipped clips stay byte-identical in data).
await raw.transform(resample({ tolerance: 1e-4 }));
const root = shipped.getRoot();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];
for (const old of root.listAnimations()) if (names.includes(old.getName())) old.dispose();
for (const name of names) {
  const src = raw
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === name);
  if (!src) throw new Error(`raw has no clip ${name}`);
  const anim = shipped.createAnimation(name);
  const copies = new Map();
  const copyAcc = (a) => {
    if (copies.has(a)) return copies.get(a);
    const c = shipped
      .createAccessor(a.getName())
      .setType(a.getType())
      .setArray(a.getArray().slice())
      .setBuffer(buffer);
    copies.set(a, c);
    return c;
  };
  for (const ch of src.listChannels()) {
    const target = nodes.get(ch.getTargetNode().getName());
    if (!target) throw new Error(`${name}: shipped has no node ${ch.getTargetNode().getName()}`);
    const s = ch.getSampler();
    const sampler = shipped
      .createAnimationSampler()
      .setInterpolation(s.getInterpolation())
      .setInput(copyAcc(s.getInput()))
      .setOutput(copyAcc(s.getOutput()));
    anim.addSampler(sampler);
    anim.addChannel(
      shipped
        .createAnimationChannel()
        .setTargetNode(target)
        .setTargetPath(ch.getTargetPath())
        .setSampler(sampler),
    );
  }
  console.log('SPLICED', name, src.listChannels().length, 'channels');
}
const out = Buffer.from(await io.writeBinary(shipped));
fs.writeFileSync(outPath, out);
const json = JSON.parse(out.toString('utf8', 20, 20 + out.readUInt32LE(12)));
console.log('WROTE', outPath, out.length, (json.animations ?? []).map((a) => a.name).join(','));
