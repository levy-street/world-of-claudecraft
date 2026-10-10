import { AnimationMixer, LoopOnce, Quaternion, Vector3 } from 'three';
import { retargetClip } from './retarget.mjs';

// M2Loader has already converted Z-up to Y-up. Both rest and animation face +X.
const AXIS = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
const MAP = {
  male: [3, 2, 4, 11, 18, 12, 19, 29, 36, 40, 13, 20, 30, 38, 42, 7, 16, 22, 31, 8, 17, 24, 32],
  female: [3, 2, 4, 10, 20, 16, 21, 33, 39, 43, 17, 22, 34, 41, 45, 5, 11, 23, 35, 6, 12, 25, 36],
};
const NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'clavicle.l',
  'upperarm.l',
  'lowerarm.l',
  'wrist.l',
  'hand.l',
  'clavicle.r',
  'upperarm.r',
  'lowerarm.r',
  'wrist.r',
  'hand.r',
  'upperleg.l',
  'lowerleg.l',
  'foot.l',
  'toes.l',
  'upperleg.r',
  'lowerleg.r',
  'foot.r',
  'toes.r',
];
const TIPS = { hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head' };
for (const side of ['l', 'r'])
  for (const [a, b] of [
    ['clavicle', 'upperarm'],
    ['upperarm', 'lowerarm'],
    ['lowerarm', 'wrist'],
    ['wrist', 'hand'],
    ['upperleg', 'lowerleg'],
    ['lowerleg', 'foot'],
    ['foot', 'toes'],
  ])
    TIPS[`${a}.${side}`] = `${b}.${side}`;

export function retargetAutoAttack(gltf, model, target, fit, animation) {
  const ids = Object.fromEntries(NAMES.map((name, i) => [name, MAP[fit][i]]));
  const pairs = Object.fromEntries(
    NAMES.filter((n) => !n.startsWith('hand.')).map((n) => [
      n,
      [String(ids[n]), TIPS[n] ? String(ids[TIPS[n]]) : null],
    ]),
  );
  const bones = model.bones.map((b, i) => ({
    name: String(i),
    parent: b.parentBone,
    t: b.pivot.map((v, k) => v - (model.bones[b.parentBone]?.pivot[k] ?? 0)),
    q: [0, 0, 0, 1],
  }));
  const frames = Math.ceil(animation.duration * 60) + 1;
  const fps = (frames - 1) / animation.duration;
  const tracks = Object.fromEntries(bones.map((b) => [b.name, { t: [], q: [] }]));
  const mixer = new AnimationMixer(gltf.scene);
  const action = mixer.clipAction(animation).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  for (let frame = 0; frame < frames; frame++) {
    mixer.setTime(frame / fps);
    for (const b of bones) {
      const node = gltf.scene.getObjectByName(`bone_${b.name}`);
      tracks[b.name].t.push(node.position.toArray());
      tracks[b.name].q.push(node.quaternion.toArray());
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  return retargetClip(
    { bones },
    target,
    fit,
    { name: animation.name, fps, frames, loop: false, tracks },
    { pairs, bindAxis: AXIS, animationAxis: AXIS },
  );
}
