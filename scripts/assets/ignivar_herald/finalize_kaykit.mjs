// Finalize the user-approved KayKit-native Ignivar candidate for the game.
// Paid image-to-model generation remains human-gated. This deterministic stage
// annotates the locally Rig_Medium-skinned candidate, authors encounter VFX
// sockets, and enforces the repository's KTX2 shipping texture contract.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { IGNIVAR_REPO_ROOT, ignivarSourceFingerprint } from './source_fingerprint.mjs';

const source = path.resolve(
  IGNIVAR_REPO_ROOT,
  process.argv[2] ?? 'tmp/asset_src/ignivar_herald/ignivar_herald_kaykit_custom.glb',
);
const output = path.resolve(
  IGNIVAR_REPO_ROOT,
  process.argv[3] ?? 'public/models/creatures/ignivar_herald.glb',
);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const document = await io.readBinary(readFileSync(source));
const root = document.getRoot();
const scene = root.listScenes()[0];
if (!scene) throw new Error('Ignivar KayKit candidate has no scene');

// manual_rig starts from the KayKit reference document so its skeleton and
// animation clips remain byte-for-byte compatible. Strip the now-empty visual
// nodes and their unused variant skins before shipping; only the generated
// `body` mesh and the first Rig_Medium skin belong to Ignivar.
for (const node of root.listNodes()) {
  if (node.getName().startsWith('Knight_') && !node.getMesh()) node.dispose();
}
const [bodySkin, ...unusedSkins] = root.listSkins();
if (!bodySkin) throw new Error('Ignivar source has no KayKit skin');
for (const skin of unusedSkins) skin.dispose();
const body = root.listNodes().find((node) => node.getName() === 'body');
if (!body?.getMesh()) throw new Error('Ignivar source has no generated body mesh');
body.setSkin(bodySkin);

// The distance solver is intentionally soft for organic joints, but Ignivar's
// helmet is one rigid low-poly shell. Mixed head/chest/arm weights made pieces
// of the crown lag behind during locomotion and ForgeSlam. Select the centered
// upper shell in normalized model space so shoulder plates stay articulated,
// then keep that helmet region on the head joint alone.
const joints = bodySkin.listJoints();
const headJoint = joints.findIndex((joint) => joint.getName() === 'head');
if (headJoint < 0) throw new Error('Ignivar KayKit candidate is missing Rig_Medium head');
let rigidHeadVertices = 0;
for (const primitive of body.getMesh().listPrimitives()) {
  const positions = primitive.getAttribute('POSITION');
  const jointIndices = primitive.getAttribute('JOINTS_0');
  const weights = primitive.getAttribute('WEIGHTS_0');
  if (!positions || !jointIndices || !weights) {
    throw new Error('Ignivar body primitive is missing skin attributes');
  }
  const position = new Array(3);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let vertex = 0; vertex < positions.getCount(); vertex++) {
    positions.getElement(vertex, position);
    minX = Math.min(minX, position[0]);
    maxX = Math.max(maxX, position[0]);
    minY = Math.min(minY, position[1]);
    maxY = Math.max(maxY, position[1]);
  }
  const normalizedScale = 2 / (maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  for (let vertex = 0; vertex < positions.getCount(); vertex++) {
    positions.getElement(vertex, position);
    const normalizedX = (position[0] - centerX) * normalizedScale;
    const normalizedY = (position[1] - centerY) * normalizedScale;
    if (normalizedY < 0.2 || Math.abs(normalizedX) > 0.375) continue;
    jointIndices.setElement(vertex, [headJoint, 0, 0, 0]);
    weights.setElement(vertex, [1, 0, 0, 0]);
    rigidHeadVertices++;
  }
}
if (rigidHeadVertices < 1_700) {
  throw new Error(`Ignivar rigid-head selection was unexpectedly small: ${rigidHeadVertices}`);
}

const nodes = new Map(root.listNodes().map((node) => [node.getName(), node]));
const chest = nodes.get('chest');
if (!chest) throw new Error('Ignivar KayKit candidate is missing Rig_Medium chest');
for (const name of ['Socket_ChestCore', 'Socket_ShoulderLeft', 'Socket_ShoulderRight']) {
  nodes.get(name)?.dispose();
}
for (const [name, translation] of [
  ['Socket_ChestCore', [0, 0.02, 0.18]],
  ['Socket_ShoulderLeft', [-0.3, 0.13, 0.02]],
  ['Socket_ShoulderRight', [0.3, 0.13, 0.02]],
]) {
  chest.addChild(
    document
      .createNode(name)
      .setTranslation(translation)
      .setExtras({ socketType: 'vfx-emitter', animatedParent: 'chest' }),
  );
}

const fingerprint = ignivarSourceFingerprint(IGNIVAR_REPO_ROOT);
const shippedClips = new Set([
  'ForgeIdle',
  'Walking_A',
  'Running_A',
  'ForgeSlam',
  'ForgeCast',
  'ForgeHit',
  'Hit_A',
  'Death_A',
  'Cheer',
]);
for (const animation of root.listAnimations()) {
  if (!shippedClips.has(animation.getName())) animation.dispose();
}
const clipNames = root.listAnimations().map((animation) => animation.getName());
for (const required of shippedClips) {
  if (!clipNames.includes(required)) throw new Error(`missing restrained boss clip ${required}`);
}

const originalChildren = [...scene.listChildren()];
const ignivar = document.createNode('IgnivarHerald').setExtras({
  assetId: 'ignivar_herald',
  assetType: 'kaykit-native-skinned-raid-boss',
  designRevision: 'approved-kaykit-v2',
  frontAxis: [0, 0, 1],
  rig: 'KayKit Rig_Medium',
  rigMethod: 'local distance-to-bone bind with rigid helmet',
  rigidHeadVertices,
  clips: clipNames,
  sourceTask: 'faec579d-0f72-4dbb-a11a-8c7578bb1699',
});
for (const child of originalChildren) {
  scene.removeChild(child);
  ignivar.addChild(child);
}
scene.addChild(ignivar);
root.setExtras({ sourceFingerprint: fingerprint });
root.getAsset().extras = { sourceFingerprint: fingerprint };

mkdirSync(path.dirname(output), { recursive: true });
await io.write(output, document);
execFileSync(
  process.execPath,
  [path.join(IGNIVAR_REPO_ROOT, 'scripts/assets/compress_glb_textures.mjs'), output],
  { cwd: IGNIVAR_REPO_ROOT, stdio: 'inherit' },
);
console.log(
  JSON.stringify({ source, output, sourceFingerprint: fingerprint, clips: clipNames }, null, 2),
);
