// Finish the Blender export of the sprite buddy for the game.
//
//   node docs/design/sprites-buddy/finish_buddy.mjs <blender.glb> <out.glb>
//   node scripts/assets/compress_glb_textures.mjs <out.glb>      (mandatory)
//
// Rigged-asset optimization, as the gold sprite mount's finish step: resample +
// prune + dedup + WebP textures at most 512 px, no meshopt (skinned and morphed
// geometry stays plainly encoded). The KTX2 pass after it is not optional:
// tests/glb_texture_compression.test.ts holds every model to KTX2. Fails if a
// clip, a face's morph targets or their animation channels did not survive.
// biome-ignore assist/source/organizeImports: sharp must initialize before @gltf-transform/functions on Windows.
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: finish_buddy.mjs <blender.glb> <out.glb>');

const CLIPS = [
  'Idle',
  'Walk',
  'Run',
  'Jump',
  'Search',
  'Idle_Nuzzle',
  'Idle_Peekaboo',
  'Idle_Dance',
  'Idle_Doze',
  'Idle_Leapfrog',
];
const MORPHS = [
  'EyesBlink',
  'EyesHappy',
  'EyesWide',
  'EyesSquint',
  'EyesLookL',
  'EyesLookR',
  'MouthBigSmile',
  'MouthO',
  'MouthFlat',
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await doc.transform(
  resample(),
  prune(),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
);

const root = doc.getRoot();
const clips = root.listAnimations().map((a) => a.getName());
for (const c of CLIPS) if (!clips.includes(c)) throw new Error(`missing clip ${c} (have ${clips})`);
const faces = root.listMeshes().filter((m) => m.getExtras()?.targetNames);
if (faces.length !== 2) throw new Error(`expected 2 face meshes, found ${faces.length}`);
for (const face of faces) {
  const names = face.getExtras().targetNames;
  for (const n of MORPHS)
    if (!names.includes(n)) throw new Error(`${face.getName()} missing morph ${n} (have ${names})`);
}
for (const a of root.listAnimations()) {
  const faceChannels = a.listChannels().filter((ch) => ch.getTargetPath() === 'weights');
  if (faceChannels.length < 2) throw new Error(`clip ${a.getName()} lost a face (weights) channel`);
}
await io.write(out, doc);
console.log('wrote', out, {
  clips: clips.length,
  faces: faces.length,
  skins: root.listSkins().length,
});
