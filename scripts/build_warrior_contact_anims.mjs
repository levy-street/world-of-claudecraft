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
import { warriorControlPerformances } from './anim/warrior_control_poses.mjs';
import { warriorReadinessPerformances } from './anim/warrior_readiness_poses.mjs';

const io = await createGlbIO();
const doc = await io.read('public/models/chars/players/knight.glb');
const root = doc.getRoot();
const donors = [
  'Idle',
  'Shield_Bash',
  '1H_Melee_Attack_Slice_Diagonal',
  '2H_Melee_Attack_Chop',
  'Dualwield_Melee_Attack_Chop',
  '1H_Melee_Attack_Slice_Horizontal',
  'Block',
  'Spellcast_Raise',
  'Cheer',
  'Punch_A',
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
const reapLoad = bladePose(5, 0.1, [0, -0.025, 0.02], -25, -4);
const reapCut = bladePose(5, 0.24, [0, -0.025, 0.02], 20, 5);
const reapFollow = bladePose(5, 0.5, [0, -0.025, 0.02], 35, 5);
const stormA = bladePose(3, 0.83, [0, -0.025, 0], -6, -3, -8);
const stormB = bladePose(3, 0.83, [0, -0.025, 0], 6, -3, -8);
const stormC = bladePose(3, 0.83, [0, -0.025, 0], 6, 3, -8);
const stormD = bladePose(3, 0.83, [0, -0.025, 0], -6, 3, -8);
function guardedCounter(time, turn, lean) {
  const pose = bladePose(5, time, [0, -0.03, 0.025], turn, lean);
  const brace = shieldPose(0.14, [0, 0, 0]);
  for (const key of keys)
    if (/^(upperarm|lowerarm|wrist|hand)\.l\|rotation$/.test(key))
      pose.set(key, [...brace.get(key)]);
  return pose;
}
function compressShield(time, hip, lean, turn = 0) {
  const pose = shieldPose(time, hip);
  for (const [name, weight] of [
    ['chest', 1],
    ['spine', 0.3],
    ['head', -0.65],
  ]) {
    const key = `${name}|rotation`;
    pose.set(
      key,
      new Quaternion()
        .fromArray(pose.get(key))
        .multiply(
          new Quaternion().setFromEuler(
            new Euler((lean * weight * Math.PI) / 180, (turn * weight * Math.PI) / 180, 0),
          ),
        )
        .normalize()
        .toArray(),
    );
  }
  return pose;
}
const revengeLoad = guardedCounter(0.12, -28, -5);
const revengeHit = guardedCounter(0.28, 18, 6);
const revengeFollow = guardedCounter(0.5, 35, 3);
const quakeLoad = compressShield(0.14, [0, -0.025, -0.03], -8);
const quakeHit = compressShield(0.32, [0, -0.085, 0.04], 14);
const quakeRecover = compressShield(0.5, [0, -0.025, 0.015], 6);
const faultLoad = compressShield(0.14, [0, -0.04, -0.045], -12, -12);
const faultHit = compressShield(0.32, [0, -0.09, 0.05], 18, 8);
const faultRecover = compressShield(0.5, [0, -0.035, 0.025], 4, 6);
const breachLoad = bladePose(3, 0.8331, [0, -0.035, -0.055], -18, -4);
const breachHit = bladePose(3, 0.8331, [0, -0.035, 0.07], 0, 0);
const breachRecover = bladePose(3, 0.8331, [0, -0.02, 0.015], 7, -5);

// Defense activations borrow only native upper-body rotations. The same
// offline planted-foot solve owns their short transition, never a long gait lock.
const guardLoad = bladePose(6, 0.12, [0, -0.015, 0], -5, -2);
const guardLock = bladePose(6, 0.3, [0, -0.018, 0], 0, 0);
const resolveLoad = compressShield(0.14, [0, -0.01, 0], -4);
const resolveLock = compressShield(0.14, [0, -0.025, 0], 5);
const swordLoad = bladePose(3, 0.8331, [0, -0.018, 0], -12, -3);
const swordLock = bladePose(3, 0.8331, [0, -0.025, 0], -35, -25, 0);

let maxGripError = 0;
/** Offline two-bone support-hand IK. Native bone lengths, hand and socket
 * transforms stay intact; the right hand remains the authority for the blade. */
function gripBlade(pose, weight) {
  if (weight <= 0) return pose;
  applyPose(pose);
  const upper = bones.get('upperarm.l'),
    lower = bones.get('lowerarm.l');
  const wrist = bones.get('wrist.l'),
    hand = bones.get('hand.l');
  const slot = bones.get('handslot.l'),
    right = bones.get('handslot.r');
  const rightQ = orientation(right),
    axis = new Vector3(0, 1, 0).applyQuaternion(rightQ);
  const target = position(slot).lerp(position(right).addScaledVector(axis, -0.15), weight);
  const socketQ = orientation(slot).slerp(
    rightQ
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (160 * Math.PI) / 180)),
    weight,
  );
  const wristQ = socketQ
    .multiply(slot.quaternion.clone().invert())
    .multiply(hand.quaternion.clone().invert());
  const offset = hand.position.clone().add(slot.position.clone().applyQuaternion(hand.quaternion));
  const wristTarget = target.clone().sub(offset.applyQuaternion(wristQ));
  const shoulder = position(upper),
    a = shoulder.distanceTo(position(lower)),
    b = position(lower).distanceTo(position(wrist));
  const aim = wristTarget.clone().sub(shoulder),
    distance = aim.length();
  if (distance >= a + b || distance <= Math.abs(a - b))
    throw new Error(`Breachmaker grip out of reach: ${distance}`);
  aim.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const pole = new Vector3(1, -0.25, -0.2);
  const bend = pole.addScaledVector(aim, -pole.dot(aim)).normalize();
  pointJoint(
    upper,
    lower,
    shoulder.clone().addScaledVector(aim, along).addScaledVector(bend, height),
  );
  pointJoint(lower, wrist, wristTarget);
  setWorldRotation(wrist, wristQ);
  maxGripError = Math.max(maxGripError, position(slot).distanceTo(target));
  for (const bone of [upper, lower, wrist])
    pose.set(`${bone.name}|rotation`, bone.quaternion.toArray());
  return pose;
}
function openAvatarArms(pose, weight, targets = null) {
  applyPose(idle);
  const wrists = ['l', 'r'].map((side) => orientation(bones.get(`wrist.${side}`)));
  applyPose(pose);
  const chest = position(bones.get('chest'));
  for (const [index, side] of ['l', 'r'].entries()) {
    const sign = side === 'l' ? 1 : -1;
    const upper = bones.get(`upperarm.${side}`),
      lower = bones.get(`lowerarm.${side}`),
      wrist = bones.get(`wrist.${side}`);
    const shoulder = position(upper),
      a = shoulder.distanceTo(position(lower)),
      b = position(lower).distanceTo(position(wrist));
    const target = position(wrist).lerp(
      chest
        .clone()
        .add(targets ? new Vector3(...targets[index]) : new Vector3(sign * 0.62, 0.06, 0.1)),
      weight,
    );
    const aim = target.clone().sub(shoulder),
      distance = aim.length();
    if (distance >= a + b || distance <= Math.abs(a - b))
      throw Error(`Avatar hand out of reach ${side}: ${distance}, ${a + b}`);
    aim.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance),
      height = Math.sqrt(Math.max(0, a * a - along * along));
    const bend = new Vector3(sign, -0.65, -0.2);
    bend.addScaledVector(aim, -bend.dot(aim)).normalize();
    pointJoint(
      upper,
      lower,
      shoulder.clone().addScaledVector(aim, along).addScaledVector(bend, height),
    );
    pointJoint(lower, wrist, target);
    setWorldRotation(wrist, orientation(wrist).slerp(wrists[index], weight));
    for (const bone of [upper, lower, wrist])
      pose.set(`${bone.name}|rotation`, bone.quaternion.toArray());
  }
  return pose;
}

// Candidate offensive-state poses: no gameplay or runtime body scaling.
const avatarLoad = openAvatarArms(bladePose(7, 0.35, [0, -0.065, 0], -6, 9), 0.3);
const avatarRise = openAvatarArms(bladePose(7, 1.8, [0, -0.005, 0], 0, -8), 1);
const recklessLoad = bladePose(8, 0.18, [0, -0.04, 0], -12, 8);
const recklessTear = bladePose(8, 0.76, [0, -0.008, 0], 12, -9);
const tollLoad = bladePose(6, 0.14, [0, -0.018, 0], -8, 3);
const tollClench = bladePose(6, 0.3, [0, -0.034, 0], -12, 9);
const seethingLoad = bladePose(4, 0.28, [0, -0.04, 0], 0, 8);
const seethingRelease = bladePose(8, 0.44, [0, -0.008, 0], 0, -5);
const goadLoad = openAvatarArms(bladePose(8, 0.18, [0, -0.03, 0], -7, 3), 1, [
  [0.44, -0.14, 0.15],
  [-0.42, -0.16, 0.2],
]);
const goadChallenge = openAvatarArms(bladePose(8, 0.44, [0, -0.025, 0.025], 4, 8), 1, [
  [0.47, -0.11, 0.12],
  [-0.43, -0.1, 0.35],
]);
const mendingLoad = openAvatarArms(bladePose(6, 0.14, [0, -0.04, 0], 0, 6), 1, [
  [0.46, -0.18, 0.2],
  [-0.46, -0.18, 0.2],
]);
const mendingLock = openAvatarArms(bladePose(6, 0.3, [0, -0.055, 0], 0, 10), 1, [
  [0.32, -0.16, 0.32],
  [-0.32, -0.16, 0.32],
]);
function retainGoadLeftGuard(pose, offset) {
  applyPose(idle);
  const upper = bones.get('upperarm.l'),
    lower = bones.get('lowerarm.l'),
    wrist = bones.get('wrist.l');
  const target = position(wrist).add(new Vector3(...offset)),
    rotation = orientation(wrist);
  applyPose(pose);
  const shoulder = position(upper),
    a = shoulder.distanceTo(position(lower)),
    b = position(lower).distanceTo(position(wrist));
  const aim = target.clone().sub(shoulder),
    distance = aim.length();
  if (distance >= a + b || distance <= Math.abs(a - b)) throw Error('Goad guard reach ' + distance);
  aim.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance),
    height = Math.sqrt(Math.max(0, a * a - along * along));
  const bend = new Vector3(1, -0.65, -0.2);
  bend.addScaledVector(aim, -bend.dot(aim)).normalize();
  pointJoint(
    upper,
    lower,
    shoulder.clone().addScaledVector(aim, along).addScaledVector(bend, height),
  );
  pointJoint(lower, wrist, target);
  setWorldRotation(wrist, rotation);
  for (const b of [upper, lower, wrist]) pose.set(b.name + '|rotation', b.quaternion.toArray());
  for (const name of ['hand.l', 'handslot.l']) {
    const key = name + '|rotation';
    if (idle.has(key)) pose.set(key, [...idle.get(key)]);
  }
  return pose;
}

function retainMendingGuard(pose, offset) {
  applyPose(idle);
  const targets = ['l', 'r'].map((side) => ({
    side,
    p: position(bones.get('wrist.' + side)).add(
      new Vector3((side === 'l' ? 1 : -1) * offset[0], offset[1], offset[2]),
    ),
    q: orientation(bones.get('wrist.' + side)),
  }));
  applyPose(pose);
  for (const { side, p: target, q: rotation } of targets) {
    const upper = bones.get('upperarm.' + side),
      lower = bones.get('lowerarm.' + side),
      wrist = bones.get('wrist.' + side),
      shoulder = position(upper),
      a = shoulder.distanceTo(position(lower)),
      b = position(lower).distanceTo(position(wrist)),
      aim = target.clone().sub(shoulder),
      distance = aim.length();
    if (distance >= a + b || distance <= Math.abs(a - b))
      throw Error('Mending guard reach ' + side + ' ' + distance);
    aim.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance),
      height = Math.sqrt(Math.max(0, a * a - along * along)),
      bend = new Vector3(side === 'l' ? 1 : -1, -0.65, -0.2);
    bend.addScaledVector(aim, -bend.dot(aim)).normalize();
    pointJoint(
      upper,
      lower,
      shoulder.clone().addScaledVector(aim, along).addScaledVector(bend, height),
    );
    pointJoint(lower, wrist, target);
    setWorldRotation(wrist, rotation);
    for (const b of [upper, lower, wrist]) pose.set(b.name + '|rotation', b.quaternion.toArray());
    for (const name of ['hand.' + side, 'handslot.' + side]) {
      const key = name + '|rotation';
      if (idle.has(key)) pose.set(key, [...idle.get(key)]);
    }
  }
  return pose;
}

const performances = [
  [
    'Warrior_Goad',
    [
      [0, idle],
      [0.075, retainGoadLeftGuard(goadLoad, [0.1, 0.14, 0.14])],
      [0.15, retainGoadLeftGuard(goadChallenge, [0.1, 0.14, 0.14])],
      [0.245, goadChallenge],
      [0.65, idle],
    ],
  ],
  [
    'Warrior_Furious_Mending',
    [
      [0, idle],
      [0.085, retainMendingGuard(mendingLoad, [0.06, 0.06, 0.02])],
      [0.15, retainMendingGuard(mendingLock, [0.12, 0.12, 0.04])],
      [0.3, mendingLock],
      [0.72, idle],
    ],
  ],
  [
    'Warrior_Bladed_Gyre',
    [
      [0, idle],
      [0.085, bladePose(4, 0.54, [0, -0.025, 0.02], 0, 0)],
      [0.15, bladePose(4, 0.46, [0, -0.025, 0.02], 0, 0)],
      [0.18, bladePose(4, 0.5, [0, -0.025, 0.02], 0, 0)],
      [0.29, bladePose(4, 0.54, [0, -0.025, 0.02], 0, 0)],
      [0.46, bladePose(4, 1.2, [0, -0.025, 0.02], 0, 0)],
      [0.72, idle],
    ],
  ],
  [
    'Warrior_Avatar',
    [
      [0, idle],
      [0.08, avatarLoad],
      [0.15, avatarRise],
      [0.29, avatarRise],
      [0.74, idle],
    ],
  ],
  [
    'Warrior_Recklessness',
    [
      [0, idle],
      [0.075, recklessLoad],
      [0.15, recklessTear],
      [0.245, recklessTear],
      [0.7, idle],
    ],
  ],
  [
    'Warrior_Blood_Toll',
    [
      [0, idle],
      [0.075, tollLoad],
      [0.15, tollClench],
      [0.225, tollClench],
      [0.58, idle],
    ],
  ],
  [
    'Warrior_Seething_Fury',
    [
      [0, idle],
      [0.07, seethingLoad],
      [0.15, seethingRelease],
      [0.205, seethingRelease],
      [0.62, idle],
    ],
  ],

  [
    'Warrior_Raised_Guard',
    [
      [0, idle],
      [0.06, guardLoad],
      [0.15, guardLock],
      [0.24, guardLock],
      [0.64, idle],
    ],
  ],
  [
    'Warrior_Iron_Resolve',
    [
      [0, idle],
      [0.08, resolveLoad],
      [0.2, resolveLock],
      [0.31, resolveLock],
      [0.68, idle],
    ],
  ],
  [
    'Warrior_Sword_Guard',
    [
      [0, idle],
      [0.075, swordLoad],
      [0.15, swordLock],
      [0.25, swordLock],
      [0.4, swordLoad],
      [0.72, idle],
    ],
  ],
  [
    'Warrior_Revenge',
    [
      [0, idle],
      [0.085, revengeLoad],
      [0.15, revengeHit],
      [0.18, revengeHit],
      [0.34, revengeFollow],
      [0.66, idle],
    ],
  ],
  [
    'Warrior_Quaking_Blow',
    [
      [0, idle],
      [0.085, quakeLoad],
      [0.15, quakeHit],
      [0.19, quakeHit],
      [0.36, quakeRecover],
      [0.68, idle],
    ],
  ],
  [
    'Warrior_Faultline',
    [
      [0, idle],
      [0.09, faultLoad],
      [0.15, faultHit],
      [0.205, faultHit],
      [0.4, faultRecover],
      [0.72, idle],
    ],
  ],
  [
    'Warrior_Breachmaker',
    [
      [0, idle],
      [0.085, breachLoad],
      [0.15, breachHit],
      [0.19, breachHit],
      [0.34, breachRecover],
      [0.68, idle],
    ],
  ],
  [
    'Warrior_Reaping_Arc',
    [
      [0, idle],
      [0.085, reapLoad],
      [0.15, reapCut],
      [0.175, reapCut],
      [0.33, reapFollow],
      [0.64, idle],
    ],
  ],
  [
    'Warrior_Bladestorm_Loop',
    [
      [0, stormA],
      [0.1125, stormB],
      [0.225, stormC],
      [0.3375, stormD],
      [0.45, stormA],
    ],
  ],
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
performances.push(...warriorControlPerformances(idle, bladePose, openAvatarArms));
performances.push(...warriorReadinessPerformances(idle, bladePose, openAvatarArms));
const clips = [],
  reports = [];
for (const [name, beats] of performances) {
  const first = plantFeet(new Map([...beats[0][1]].map(([key, value]) => [key, [...value]])));
  const timeline = [[0, (key) => first.get(key)]];
  for (let b = 1; b < beats.length; b++) {
    const [start, from] = beats[b - 1],
      [end, to] = beats[b];
    // Dense offline sampling preserves the foot lock between exported keys too.
    const steps = Math.max(2, Math.ceil((end - start) * 180));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const weight = end === 0.15 ? t * t : t * t * (3 - 2 * t);
      let pose = plantFeet(
        new Map(keys.map((key) => [key, blendValue(key, from.get(key), to.get(key), weight)])),
      );
      if (name === 'Warrior_Breachmaker' || name === 'Warrior_Sword_Guard') {
        const time = start + (end - start) * t;
        const blend = Math.min(
          1,
          Math.max(0, (time - 0.015) / 0.06),
          Math.max(0, (0.66 - time) / 0.26),
        );
        try {
          pose = gripBlade(pose, blend * blend * (3 - 2 * blend));
        } catch (error) {
          throw new Error(`${name} at ${time}s: ${error.message}`, { cause: error });
        }
      }
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
  maxGripError,
};
await writeFile(
  'tmp/warrior-contact-authoring/report.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report));
