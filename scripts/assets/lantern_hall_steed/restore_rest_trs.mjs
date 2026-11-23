// Put the valorsteed's own resting node transforms back on the Lantern Hall Destrier GLB.
//
// The destrier is the valorsteed body, rig and clips re-exported from Blender with its barding
// (build_steed.py). Blender rebuilds every joint's resting transform from the skin's inverse
// bind matrices, but the valorsteed's GLB keeps resting TRS that do NOT match them (the source
// rig's `_rootJoint` rests at the origin while its bind sits 0.73 units forward), and its clips
// never key those joints: the authored strides are only right on the source's own rest values.
// Re-exported as Blender sees it, the whole horse plays every clip 0.73 units ahead of and 0.17
// above its own origin, so the rider sits behind the saddle. Copying the source's resting TRS
// back onto every joint the clips do not animate restores the shipped motion exactly; the joints
// the clips DO key, and the new lantern bones, keep what the export wrote.
//
//   node scripts/assets/lantern_hall_steed/restore_rest_trs.mjs <source.glb> <target.glb>
//
// Rewrites <target.glb> in place, after build_assets.mjs has optimized it.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) {
  console.error('usage: restore_rest_trs.mjs <source.glb> <target.glb>');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const source = await io.read(sourcePath);
const target = await io.read(targetPath);

const animated = new Set();
for (const clip of target.getRoot().listAnimations())
  for (const channel of clip.listChannels())
    animated.add(`${channel.getTargetNode()?.getName()}:${channel.getTargetPath()}`);

const restBy = new Map(
  source
    .getRoot()
    .listNodes()
    .map((n) => [n.getName(), n]),
);
let restored = 0;
for (const node of target.getRoot().listNodes()) {
  const rest = restBy.get(node.getName());
  if (!rest) continue;
  for (const [path, get, set] of [
    ['translation', (n) => n.getTranslation(), (n, v) => n.setTranslation(v)],
    ['rotation', (n) => n.getRotation(), (n, v) => n.setRotation(v)],
    ['scale', (n) => n.getScale(), (n, v) => n.setScale(v)],
  ]) {
    if (animated.has(`${node.getName()}:${path}`)) continue;
    const want = get(rest);
    const have = get(node);
    if (want.some((v, i) => Math.abs(v - have[i]) > 1e-6)) {
      set(node, [...want]);
      restored++;
    }
  }
}
await io.write(targetPath, target);
console.log(`restored ${restored} resting transforms on ${targetPath}`);
