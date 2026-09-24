// Author Shadewolf on its own Tripo quadruped rig. The pipeline's temporary
// Walk aliases are replaced with a planted breathing idle, grounded IK walk
// and gallop, braced head strike and a one-shot resting collapse.
// Usage: node scripts/build_shaman_wolf_anims.mjs <assembled.glb> <output.glb>
// Offline only: no runtime rig changes, API calls or new animation dispatch.

import { dedup, prune, resample, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Quaternion, Vector3 } from 'three';
import { bakeClip, createGlbIO, indexClip } from './anim/pose_blend.mjs';
import { createWolfGait } from './anim/shaman_wolf_gait.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Expected input.glb output.glb');
const io = createGlbIO(),
  doc = await io.read(input),
  root = doc.getRoot();
const walk = indexClip(root, 'Walk');
const planted = new Map();
for (const [key, ch] of walk) {
  // Bind stance has four grounded paws. Averaging a lifted gait can leave a
  // permanently bent rear leg, so it must never supply the stationary pose.
  const v =
    ch.path === 'rotation'
      ? ch.node.getRotation()
      : ch.path === 'translation'
        ? ch.node.getTranslation()
        : ch.node.getScale();
  planted.set(key, v);
}
const gait = createWolfGait(root, walk, planted);
for (const a of root.listAnimations()) {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}
const rotate = (q, axis, angle) =>
  new Quaternion(...q)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(...axis), angle))
    .toArray();
function bake(name, seconds, pose) {
  const frames = Math.ceil(seconds * 120);
  bakeClip(doc, {
    clipName: name,
    channelKeys: walk.keys(),
    donorFor: (key) => walk.get(key),
    timeline: Array.from({ length: frames + 1 }, (_, i) => {
      const u = i / frames,
        p = pose(u);
      return [u * seconds, (key) => p.get(key)];
    }),
  });
}
bake('Idle', 4, (u) => {
  const p = new Map(planted),
    breath = Math.sin(u * Math.PI * 2);
  for (const [key, ch] of walk) {
    if (ch.path !== 'rotation') continue;
    const name = ch.node.getName();
    if (name.includes('Head_0')) p.set(key, rotate(planted.get(key), [0, 0, 1], breath * 0.018));
    if (name.includes('Spine_3')) p.set(key, rotate(planted.get(key), [0, 0, 1], breath * 0.009));
    if (name.includes('Tail_'))
      p.set(
        key,
        rotate(
          planted.get(key),
          [0, 0, 1],
          Math.sin(u * Math.PI * 2 - Number(name.at(-1)) * 0.35) * 0.025,
        ),
      );
  }
  return p;
});
bake('Walk', 0.9, (u) => gait(u, false));
bake('Run', 0.5, (u) => gait(u, true));
bake('Attack', 0.7, (u) => {
  const p = new Map(planted);
  const wind = Math.sin((Math.min(1, u / 0.38) * Math.PI) / 2);
  const strike =
    u < 0.38
      ? -0.12 * wind
      : u < 0.55
        ? -0.12 + ((u - 0.38) / 0.17) * 0.38
        : 0.26 * (1 - (u - 0.55) / 0.45);
  for (const [key, ch] of walk)
    if (ch.path === 'rotation' && /Head_[01]$/.test(ch.node.getName()))
      p.set(key, rotate(planted.get(key), [0, 0, 1], strike));
  return p;
});
bake('Death', 1.25, (u) => {
  const p = new Map(planted),
    fall = Math.sin((u * Math.PI) / 2) ** 2;
  for (const [key, ch] of walk) {
    if (ch.node.getName() === 'tripo::Root') {
      if (ch.path === 'rotation') p.set(key, rotate(planted.get(key), [1, 0, 0], fall * 1.42));
      if (ch.path === 'translation') {
        const t = [...planted.get(key)];
        t[1] -= fall * 0.12;
        p.set(key, t);
      }
    }
  }
  return p;
});
// Preserve skin weights/UVs while meeting the existing creature budget. The
// 14k source remains intact in its job, so this offline reduction is reversible.
await MeshoptSimplifier.ready;
await doc.transform(
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.54, error: 0.009 }),
  resample(),
  prune(),
  dedup(),
);
await io.write(output, doc);
console.log(
  JSON.stringify({ input, output, clips: root.listAnimations().map((a) => a.getName()) }),
);
