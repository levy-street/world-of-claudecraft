import assert from 'node:assert/strict';
import { createGlbIO, indexClip, samplePose } from './pose_blend.mjs';

const doc = await (await createGlbIO()).read('public/models/chars/players/warrior_fury_anims.glb');
const root = doc.getRoot(),
  nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const clip = indexClip(root, 'Fury_Red_Harvest');
const apply = (time) => {
  for (const [key, values] of samplePose(clip, time)) {
    const [name, path] = key.split('|'),
      node = nodes.get(name);
    if (path === 'rotation') node.setRotation(values);
    if (path === 'translation') node.setTranslation(values);
  }
  return ['foot.r', 'foot.l'].map((name) => nodes.get(name).getWorldMatrix().slice(12, 15));
};
const feet = apply(0),
  initialHip = nodes.get('hips').getTranslation().slice();
let error = 0,
  compression = 0;
for (let frame = 0; frame <= 72; frame++) {
  const actual = apply(frame / 100);
  for (let foot = 0; foot < 2; foot++)
    error = Math.max(error, Math.hypot(...actual[foot].map((v, i) => v - feet[foot][i])));
  compression = Math.max(compression, initialHip[1] - nodes.get('hips').getTranslation()[1]);
}
assert(error < 0.012, `Foot slide exceeds 0.012 native units: ${error}`);
assert(compression > 0.06, `Missing deep final loading stance: ${compression}`);
const end = samplePose(clip, 0.72),
  begin = samplePose(clip, 0);
for (const [key, values] of begin) {
  const ending = end.get(key);
  // Quaternions q and -q represent the same orientation after compression.
  const sign =
    key.endsWith('|rotation') && values.reduce((sum, v, i) => sum + v * ending[i], 0) < 0 ? -1 : 1;
  for (let i = 0; i < values.length; i++)
    assert(Math.abs(values[i] - ending[i] * sign) < 0.001, `Recovery drift: ${key}`);
}
console.log(JSON.stringify({ footDrift: error, hipCompression: compression, recovery: 'neutral' }));
