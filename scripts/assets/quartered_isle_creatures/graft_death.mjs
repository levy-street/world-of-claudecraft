// Swap one clip into a shipped creature GLB without touching anything else.
//
//   node graft_death.mjs strip <shipped.glb> <plain.glb>
//     writes a copy Blender can open: meshopt decoded, textures dropped (the topple
//     only needs the rig and its clips).
//   node graft_death.mjs graft <shipped.glb> <toppled.glb> <out.glb> [clip=Death]
//     replaces the shipped file's clip with the toppled file's clip of the same name,
//     matching channels to nodes by name; the textures, mesh and every other clip stay
//     as shipped. Meshopt is re-applied losslessly (QUANTIZE, no filters).
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [, , mode, src, other, out, clipName = 'Death'] = process.argv;
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

if (mode === 'strip') {
  const doc = await io.readBinary(fs.readFileSync(src));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) {
    if (['EXT_meshopt_compression', 'KHR_texture_basisu'].includes(e.extensionName)) e.dispose();
  }
  fs.writeFileSync(other, Buffer.from(await io.writeBinary(doc)));
  console.log('wrote', other);
} else if (mode === 'graft') {
  const doc = await io.readBinary(fs.readFileSync(src));
  const donor = await io.readBinary(fs.readFileSync(other));
  const root = doc.getRoot();
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const old = root.listAnimations().find((a) => a.getName() === clipName);
  const incoming = donor
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === clipName);
  if (!old || !incoming)
    throw new Error(`${clipName} missing (shipped ${!!old}, toppled ${!!incoming})`);
  const buffer = root.listBuffers()[0];
  const anim = doc.createAnimation(clipName);
  let n = 0;
  for (const ch of incoming.listChannels()) {
    const target = nodes.get(ch.getTargetNode()?.getName());
    if (!target) continue;
    const s = ch.getSampler();
    const copy = (acc) =>
      doc
        .createAccessor()
        .setType(acc.getType())
        .setArray(acc.getArray().slice())
        .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(copy(s.getInput()))
      .setOutput(copy(s.getOutput()))
      .setInterpolation(s.getInterpolation());
    anim
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(target)
          .setTargetPath(ch.getTargetPath())
          .setSampler(sampler),
      );
    n++;
  }
  // Clips can share accessors (deduplicated keys), so drop only the clip and let prune
  // remove what nothing references any more.
  old.dispose();
  await doc.transform(prune());
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  fs.writeFileSync(out, Buffer.from(await io.writeBinary(doc)));
  console.log('grafted', clipName, n, 'channels ->', out, fs.statSync(out).size);
} else {
  throw new Error('usage: graft_death.mjs strip|graft ...');
}
