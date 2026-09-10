import assert from 'node:assert/strict';
import { createGlbIO, indexClip, samplePose } from './pose_blend.mjs';

const doc = await (await createGlbIO()).read(
  'public/models/chars/players/warrior_contact_anims.glb',
);
const root = doc.getRoot(),
  nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const names = [
  'Iron_Bellow',
  'Direhowl',
  'Emboldening_Roar',
  'Defiant_Bellow',
  'Valor_Roar',
  'Intimidating_Shout',
  'Piercing_Howl',
];
for (const name of names) {
  const clip = indexClip(root, `Warrior_${name}`),
    duration = name === 'Piercing_Howl' ? 0.57 : 0.72;
  const initial = samplePose(clip, 0);
  function apply(time) {
    for (const [key, values] of samplePose(clip, time)) {
      const [bone, path] = key.split('|'),
        node = nodes.get(bone);
      if (path === 'rotation') node.setRotation(values);
      if (path === 'translation') node.setTranslation(values);
    }
    return ['foot.r', 'foot.l'].map((bone) => nodes.get(bone).getWorldMatrix().slice(12, 15));
  }
  const feet = apply(0),
    hip = nodes.get('hips').getTranslation()[1];
  let drift = 0,
    load = 0;
  for (let frame = 0; frame <= Math.round(duration * 100); frame++) {
    const actual = apply(frame / 100);
    for (let side = 0; side < 2; side++)
      drift = Math.max(drift, Math.hypot(...actual[side].map((v, i) => v - feet[side][i])));
    load = Math.max(load, hip - nodes.get('hips').getTranslation()[1]);
  }
  assert(drift < 0.012, `${name}: foot drift ${drift}`);
  assert(load > 0.04, `${name}: missing braced body load ${load}`);
  const end = samplePose(clip, duration);
  for (const [key, values] of initial) {
    const last = end.get(key),
      sign =
        key.endsWith('|rotation') && values.reduce((sum, v, i) => sum + v * last[i], 0) < 0
          ? -1
          : 1;
    for (let i = 0; i < values.length; i++)
      assert(Math.abs(values[i] - last[i] * sign) < 0.001, `${name}: recovery drift ${key}`);
  }
  console.log(
    JSON.stringify({ name, duration, footDrift: drift, hipLoad: load, recovery: 'neutral' }),
  );
}
