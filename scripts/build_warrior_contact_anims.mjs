// Native shield performance with offline leg IK. No runtime solver or root motion.
// node scripts/build_warrior_contact_anims.mjs [--preview]
import { mkdir, writeFile } from 'node:fs/promises';
import { dedup, prune } from '@gltf-transform/functions';
import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import {
  bakeClip,
  blendValue,
  createGlbIO,
  indexClip,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const io = await createGlbIO();
const doc = await io.read('public/models/chars/players/knight.glb');
const root = doc.getRoot();
const donors = [
  'Idle',
  'Shield_Bash',
  '1H_Melee_Attack_Slice_Diagonal',
  '2H_Melee_Attack_Chop',
  'Dualwield_Melee_Attack_Chop',
].map((name) => indexClip(root, name));
for (const donor of donors) {
  for (const channel of donor.values()) {
    if (channel.path !== 'rotation') continue;
    const values = new Float32Array(channel.values.length);
    for (let i = 0; i < values.length; i += 4) {
      const norm = Math.hypot(...channel.values.slice(i, i + 4));
      if (!(norm > 0)) throw new Error('Invalid native quaternion');
      for (let c = 0; c < 4; c++) values[i + c] = channel.values[i + c] / norm;
    }
    channel.values = values;
  }
}
const keys = [...new Set(donors.flatMap((donor) => [...donor.keys()]))];
const idle = samplePose(donors[0], 0.3);
const rig = new Object3D();
const objects = new Map(root.listNodes().map((node) => [node, new Object3D()]));
const bones = new Map();
for (const [node, object] of objects) {
  object.name = node.getName();
  object.position.fromArray(node.getTranslation());
  object.quaternion.fromArray(node.getRotation()).normalize();
  object.scale.fromArray(node.getScale());
  (objects.get(node.getParentNode()) ?? rig).add(object);
  bones.set(object.name, object);
}
function applyPose(pose) {
  for (const [key, value] of pose) {
    const [name, path] = key.split('|');
    const bone = bones.get(name);
    if (path === 'translation') bone.position.fromArray(value);
    if (path === 'rotation') bone.quaternion.fromArray(value).normalize();
    if (path === 'scale') bone.scale.fromArray(value);
  }
  rig.updateMatrixWorld(true);
}
const position = (bone) => bone.getWorldPosition(new Vector3());
const orientation = (bone) => bone.getWorldQuaternion(new Quaternion());
applyPose(idle);
const legs = ['l', 'r'].map((side) => {
  const upper = bones.get(`upperleg.${side}`);
  const lower = bones.get(`lowerleg.${side}`);
  const foot = bones.get(`foot.${side}`);
  const hip = position(upper),
    knee = position(lower),
    ankle = position(foot);
  const axis = ankle.clone().sub(hip).normalize();
  const bend = knee
    .clone()
    .sub(hip)
    .addScaledVector(axis, -knee.clone().sub(hip).dot(axis))
    .normalize();
  return {
    upper,
    lower,
    foot,
    ankle,
    bend,
    rotation: orientation(foot),
    a: hip.distanceTo(knee),
    b: knee.distanceTo(ankle),
  };
});
function setWorldRotation(bone, rotation) {
  bone.quaternion.copy(orientation(bone.parent).invert().multiply(rotation)).normalize();
  rig.updateMatrixWorld(true);
}
function pointJoint(bone, child, target) {
  const origin = position(bone);
  const from = position(child).sub(origin).normalize();
  const to = target.clone().sub(origin).normalize();
  setWorldRotation(bone, new Quaternion().setFromUnitVectors(from, to).multiply(orientation(bone)));
}
let maxFootError = 0;
function plantFeet(pose) {
  applyPose(pose);
  for (const leg of legs) {
    const hip = position(leg.upper);
    const axis = leg.ankle.clone().sub(hip);
    const distance = axis.length();
    if (distance >= leg.a + leg.b || distance <= Math.abs(leg.a - leg.b))
      throw new Error('Authored hip pose puts planted foot outside native leg reach');
    axis.normalize();
    const along = (leg.a ** 2 - leg.b ** 2 + distance ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, leg.a ** 2 - along ** 2));
    const bend = leg.bend.clone().addScaledVector(axis, -leg.bend.dot(axis)).normalize();
    const knee = hip.clone().addScaledVector(axis, along).addScaledVector(bend, height);
    pointJoint(leg.upper, leg.lower, knee);
    pointJoint(leg.lower, leg.foot, leg.ankle);
    setWorldRotation(leg.foot, leg.rotation);
    maxFootError = Math.max(maxFootError, position(leg.foot).distanceTo(leg.ankle));
    for (const bone of [leg.upper, leg.lower, leg.foot])
      pose.set(`${bone.name}|rotation`, bone.quaternion.toArray());
  }
  return pose;
}
function shieldPose(time, hipOffset) {
  const source = samplePose(donors[1], time);
  const pose = new Map(keys.map((key) => [key, [...(source.get(key) ?? idle.get(key))]]));
  // The donor supplies native arm/chest rotations, while root, sockets and leg
  // translations retain the rest dimensions. The hips transfer weight into contact.
  for (const key of keys) if (!key.endsWith('|rotation')) pose.set(key, [...idle.get(key)]);
  pose.set(
    'hips|translation',
    idle.get('hips|translation').map((v, i) => v + hipOffset[i]),
  );
  return pose;
}
const guard = shieldPose(0, [0, -0.008, -0.01]);
const chamber = shieldPose(0.14, [0, -0.025, -0.035]);
const drive = shieldPose(0.32, [0, -0.008, 0.045]);
const recoil = shieldPose(0.5, [0, -0.012, 0.015]);
const shieldBeats = [
  [0, idle],
  [0.045, guard],
  [0.085, chamber],
  [0.15, drive],
  [0.18, drive],
  [0.275, recoil],
  [0.44, guard],
  [0.68, idle],
];
function bladePose(donor, time, hipOffset, turn, lean, roll = 0, dualGuard = false) {
  const source = samplePose(donors[donor], time);
  const guard = dualGuard ? samplePose(donors[4], 0.28) : null;
  const pose = new Map(
    keys.map((key) => {
      const [name, path] = key.split('|');
      const lower = /leg|foot|toes/.test(name) || name === 'root' || name === 'hips';
      const heldLeft = guard && /arm|hand|wrist/.test(name) && name.endsWith('.l');
      const from = lower || path !== 'rotation' ? idle : heldLeft ? guard : source;
      return [key, [...(from.get(key) ?? idle.get(key))]];
    }),
  );
  pose.set(
    'hips|translation',
    idle.get('hips|translation').map((v, i) => v + hipOffset[i]),
  );
  for (const [name, weight] of [
    ['chest', 1],
    ['spine', 0.28],
    ['head', -0.55],
  ]) {
    const key = `${name}|rotation`;
    const radians = (Math.PI / 180) * weight;
    const q = new Quaternion().fromArray(pose.get(key));
    q.multiply(
      new Quaternion().setFromEuler(new Euler(lean * radians, turn * radians, roll * radians)),
    ).normalize();
    pose.set(key, q.toArray());
  }
  return pose;
}
const maimLoad = bladePose(3, 0.3, [0.012, -0.022, -0.025], -18, -5, -20);
const maimCut = bladePose(3, 0.83, [-0.012, -0.025, 0.035], 24, 13, 25);
const maimFollow = bladePose(3, 1.12, [-0.008, -0.015, 0.025], 30, 9, 18);
const graveLoad = bladePose(3, 0.3, [0, -0.035, -0.03], 0, -11);
const graveCut = bladePose(3, 0.82, [0, -0.035, 0.04], 0, 19);
const graveExtract = bladePose(3, 1.14, [0, -0.02, 0.02], 0, 12);
const bloodLoad = bladePose(2, 0.27, [0.008, -0.018, -0.02], -26, -4, -5, true);
const bloodCut = bladePose(2, 0.39, [-0.01, -0.02, 0.03], 30, 10, 8, true);
const bloodPull = bladePose(2, 0.88, [0, -0.01, 0.01], 8, -4, 0, true);
const victoryLoad = bladePose(2, 0.5, [0, -0.027, -0.025], -18, 7, -5);
const victoryCross = bladePose(2, 0.42, [0, -0.02, 0.02], 6, 5, 3);
const victoryCut = bladePose(2, 0.39, [0, -0.015, 0.035], 20, 0, 9);
const victoryRise = bladePose(2, 0.27, [0, -0.005, 0.01], 6, -9, 0);
// Opposite travel directions from the native two-handed grip. The follow poses
// keep the actual greatblade above the ground, not merely the hand sockets.
const bruteLoad = bladePose(3, 0.3, [0, -0.025, -0.025], 8, -6, -10);
const bruteCut = bladePose(3, 0.83, [0, -0.025, 0.035], 8, 12, -10);
const bruteFollow = bladePose(3, 1, [0, -0.012, 0.02], 8, 0, -10);
const redhandLoad = bladePose(3, 0.95, [-0.012, -0.03, -0.02], -20, 6, -22);
const redhandCut = bladePose(3, 0.81, [-0.012, -0.02, 0.03], -20, 6, -22);
const redhandRise = bladePose(3, 0.7, [-0.004, -0.01, 0.015], -20, -12, 0);
const performances = [
  [
    'Warrior_Brute_Swing',
    [
      [0, idle],
      [0.085, bruteLoad],
      [0.15, bruteCut],
      [0.18, bruteCut],
      [0.32, bruteFollow],
      [0.64, idle],
    ],
  ],
  [
    'Warrior_Redhand',
    [
      [0, idle],
      [0.075, redhandLoad],
      [0.15, redhandCut],
      [0.175, redhandCut],
      [0.31, redhandRise],
      [0.62, idle],
    ],
  ],
  ['Warrior_Shieldcrack', shieldBeats],
  [
    'Warrior_Maiming_Strike',
    [
      [0, idle],
      [0.085, maimLoad],
      [0.15, maimCut],
      [0.185, maimCut],
      [0.36, maimFollow],
      [0.68, idle],
    ],
  ],
  [
    'Warrior_Early_Grave',
    [
      [0, idle],
      [0.095, graveLoad],
      [0.15, graveCut],
      [0.205, graveCut],
      [0.36, graveExtract],
      [0.7, idle],
    ],
  ],
  [
    'Warrior_Bloodletting',
    [
      [0, idle],
      [0.075, bloodLoad],
      [0.15, bloodCut],
      [0.175, bloodCut],
      [0.3, bloodPull],
      [0.66, idle],
    ],
  ],
  [
    'Warrior_Victory_Rush',
    [
      [0, idle],
      [0.085, victoryLoad],
      [0.12, victoryCross],
      [0.15, victoryCut],
      [0.185, victoryCut],
      [0.33, victoryRise],
      [0.68, idle],
    ],
  ],
];
const clips = [],
  reports = [];
for (const [name, beats] of performances) {
  const first = plantFeet(new Map([...idle].map(([key, value]) => [key, [...value]])));
  const timeline = [[0, (key) => first.get(key)]];
  for (let b = 1; b < beats.length; b++) {
    const [start, from] = beats[b - 1],
      [end, to] = beats[b];
    // Dense offline sampling preserves the foot lock between exported keys too.
    const steps = Math.max(2, Math.ceil((end - start) * 180));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const weight = end === 0.15 ? t * t : t * t * (3 - 2 * t);
      const pose = plantFeet(
        new Map(keys.map((key) => [key, blendValue(key, from.get(key), to.get(key), weight)])),
      );
      timeline.push([start + (end - start) * t, (key) => pose.get(key)]);
    }
  }
  clips.push(
    bakeClip(doc, {
      clipName: name,
      channelKeys: keys,
      timeline,
      donorFor: (key) => donors.find((donor) => donor.has(key))?.get(key),
    }).animation,
  );
  reports.push({ name, frames: timeline.length });
}
if (!Number.isFinite(maxFootError) || maxFootError > 1e-5)
  throw new Error(`Foot lock error ${maxFootError}`);
await mkdir('tmp/warrior-contact-authoring', { recursive: true });
if (process.argv.includes('--preview'))
  await io.write('tmp/warrior-contact-authoring/knight_contact_preview.glb', doc);
stripToAnimationsOnly(doc, clips);
await doc.transform(prune(), dedup());
const output = 'public/models/chars/players/warrior_contact_anims.glb';
await io.write(output, doc);
const report = {
  output,
  clips: reports,
  channels: keys.length,
  maxFootError,
};
await writeFile(
  'tmp/warrior-contact-authoring/report.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report));
