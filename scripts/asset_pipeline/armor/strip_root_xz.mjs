// Lock root-joint horizontal motion in every clip (the sim owns movement):
// X/Z of each root-joint translation track are pinned to their first-frame
// values, Y (crouch/jump bob) is kept. Same convention as
// combine_fbx_to_glb --strip-root and the shipped character assets.
// Usage: node strip_root_xz.mjs <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [inPath, outPath] = process.argv.slice(2);
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inPath);
const root = doc.getRoot();
const joints = root.listSkins().flatMap((s) => s.listJoints());
const parents = new Set();
for (const j of joints) for (const c of j.listChildren()) parents.add(c);
const rootJoints = new Set(joints.filter((j) => !parents.has(j)));
for (const j of joints) if (/(root|hips|pelvis|armature)/i.test(j.getName())) rootJoints.add(j);

let touched = 0;
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    if (ch.getTargetPath() !== 'translation') continue;
    const node = ch.getTargetNode();
    if (!node || !rootJoints.has(node)) continue;
    const out = ch.getSampler()?.getOutput();
    if (!out) continue;
    const el = [0, 0, 0];
    out.getElement(0, el);
    const [x0, , z0] = el;
    for (let i = 0; i < out.getCount(); i++) {
      out.getElement(i, el);
      el[0] = x0;
      el[2] = z0;
      out.setElement(i, el);
    }
    touched++;
  }
}
await io.write(outPath, doc);
console.log(`stripped root XZ on ${touched} channels -> ${outPath}`);
