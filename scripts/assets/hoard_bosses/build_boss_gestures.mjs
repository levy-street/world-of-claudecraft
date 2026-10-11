// Authored body gestures for the hoard bosses on the local KayKit rig (Emberforge
// Tyrant, Archon Nyxaris, Tempest Vharok): the clip each plays for his own
// mechanic instead of the rig's generic spell wave.
//
// Their shipped GLBs carry KTX2 textures, which Blender cannot import, and these
// clips are skeleton-only data anyway, so they are authored straight into the
// GLB: every frame starts from the rig's own Idle stance and TURNS named joints
// about the character's axes (he faces +Z, +Y is up, +X is his left), forward
// kinematics resolving each turn into the joint's local rotation. Baking goes
// through scripts/anim/pose_blend.mjs like every other authored clip. The script
// is idempotent: a rerun replaces the clips it owns.
//
//   node scripts/assets/hoard_bosses/build_boss_gestures.mjs
//
//   CallHammer     Emberforge: the maul thrust at the sky and held, then driven down
//   CallStorm      Vharok: both claws thrown wide to the sky, head back, then slammed
//   PulsarChannel  Nyxaris: a held, slowly breathing channel (4 s, loops) for the
//                  whole Pulsar Overload bar
import { bakeClip, createGlbIO, indexClip } from '../../anim/pose_blend.mjs';

const FPS = 24;
const AXIS = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qAxis = (axis, degrees) => {
  const half = (degrees * Math.PI) / 360;
  const s = Math.sin(half);
  return [AXIS[axis][0] * s, AXIS[axis][1] * s, AXIS[axis][2] * s, Math.cos(half)];
};
const ease = (a, b, t) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const wave = (t, hz, lag = 0) => Math.sin(2 * Math.PI * (t * hz - lag));

// ---- the clips: t in seconds -> { turns: { joint: [[axis, degrees], ...] }, drop }
// A turn about X by a NEGATIVE angle lifts a hanging arm forward and up; about Z a
// POSITIVE angle lifts his LEFT arm out to the side (negative, his right); a
// positive X turn on the spine leans him forward. `drop` lowers the hips, as a
// share of their standing height.
function callHammer(t) {
  const raise = ease(0, 0.4, t);
  const slam = ease(1.15, 1.34, t);
  const live = 1 - ease(1.55, 2.0, t);
  const hold = raise * (1 - slam);
  const tremble = hold * wave(t, 9);
  return {
    turns: {
      spine: [['X', (-9 * hold + 20 * slam) * live]],
      chest: [['X', (-6 * hold + 12 * slam) * live]],
      head: [['X', (-16 * hold + 8 * slam) * live]],
      'upperarm.r': [
        ['Z', (-14 * hold + 2 * tremble) * live],
        ['X', -(160 * hold + 58 * slam) * live],
      ],
      'lowerarm.r': [['X', 18 * hold * live]],
      'upperarm.l': [
        ['Z', 28 * raise * live],
        ['X', -22 * raise * live],
      ],
    },
    drop: 0.05 * slam * live,
  };
}

function callStorm(t) {
  const up = ease(0, 0.45, t);
  const slam = ease(1.3, 1.5, t);
  const live = 1 - ease(1.7, 2.2, t);
  const hold = up * (1 - slam);
  // Arms and head only: the torso lean, the crouch and the tremor made his whole
  // body wobble in play. He plants his feet and throws his claws up.
  const arm = (side) => [
    ['Z', side * (112 * hold + 24 * slam) * live],
    ['X', -(26 * hold + 66 * slam) * live],
  ];
  return {
    turns: {
      head: [['X', (-20 * hold + 8 * slam) * live]],
      'upperarm.l': arm(1),
      'upperarm.r': arm(-1),
      'lowerarm.l': [['Z', 26 * hold * live]],
      'lowerarm.r': [['Z', -26 * hold * live]],
    },
    drop: 0,
  };
}

function pulsarChannel(t) {
  // Every term closes on the clip's four seconds, so it loops without a seam.
  const breath = wave(t, 0.25);
  const pulse = wave(t, 0.5, 0.1);
  const arm = (side) => [
    ['Z', side * (72 + 4 * breath)],
    ['X', -(24 + 3 * pulse)],
  ];
  return {
    turns: {
      spine: [['X', -8 - 1.5 * breath]],
      chest: [['X', -5 - 1 * breath]],
      head: [['X', -12 + 1.5 * pulse]],
      'upperarm.l': arm(1),
      'upperarm.r': arm(-1),
      'lowerarm.l': [['Z', 34 + 4 * pulse]],
      'lowerarm.r': [['Z', -(34 + 4 * pulse)]],
      'wrist.l': [['Y', 12 * breath]],
      'wrist.r': [['Y', -12 * breath]],
    },
    drop: 0,
  };
}

const BOSSES = [
  {
    file: 'public/models/creatures/hoard_emberforge_tyrant.glb',
    clips: [['CallHammer', callHammer, 2.0]],
  },
  {
    file: 'public/models/creatures/hoard_tempest_vharok.glb',
    clips: [['CallStorm', callStorm, 2.2]],
  },
  {
    file: 'public/models/creatures/hoard_archon_nyxaris.glb',
    clips: [['PulsarChannel', pulsarChannel, 4.0]],
  },
];

const io = createGlbIO();
for (const boss of BOSSES) {
  const doc = await io.read(boss.file);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    if (!boss.clips.some(([name]) => name === anim.getName())) continue;
    for (const channel of anim.listChannels()) channel.dispose();
    for (const sampler of anim.listSamplers()) sampler.dispose();
    anim.dispose();
  }
  const idle = indexClip(root, 'Idle');
  // The stance is Idle's first key, read through the accessor: rig-manual ships
  // quantized (normalized int16) rotations, which the raw arrays do not decode.
  const stance = new Map();
  const idleClip = root.listAnimations().find((anim) => anim.getName() === 'Idle');
  for (const channel of idleClip.listChannels()) {
    const key = `${channel.getTargetNode().getName()}|${channel.getTargetPath()}`;
    stance.set(key, channel.getSampler().getOutput().getElement(0, []));
  }
  const joints = root.listSkins()[0].listJoints();
  const jointSet = new Set(joints);
  const local = (joint, path) => stance.get(`${joint.getName()}|${path}`);
  // Parents before children: a joint's posed world rotation needs its parent's.
  const ordered = [];
  const visit = (node) => {
    if (jointSet.has(node)) ordered.push(node);
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of root.listScenes()) for (const node of scene.listChildren()) visit(node);

  for (const [clipName, fn, seconds] of boss.clips) {
    const frames = Math.round(seconds * FPS);
    const timeline = [];
    for (let f = 0; f <= frames; f++) {
      const time = f / FPS;
      const pose = fn(time);
      const world = new Map();
      const values = new Map();
      for (const joint of ordered) {
        const parent = joint.getParentNode();
        const parentWorld = world.get(parent) ?? parent?.getWorldRotation() ?? [0, 0, 0, 1];
        const base = local(joint, 'rotation') ?? joint.getRotation();
        let posed = qMul(parentWorld, base);
        for (const [axis, degrees] of pose.turns[joint.getName()] ?? []) {
          posed = qMul(qAxis(axis, degrees), posed);
        }
        world.set(joint, posed);
        values.set(`${joint.getName()}|rotation`, qMul(qInv(parentWorld), posed));
      }
      const hips = stance.get('hips|translation');
      if (hips) values.set('hips|translation', [hips[0], hips[1] * (1 - pose.drop), hips[2]]);
      timeline.push([time, (key) => values.get(key) ?? stance.get(key)]);
    }
    const baked = bakeClip(doc, {
      clipName,
      channelKeys: idle.keys(),
      timeline,
      donorFor: (key) => idle.get(key),
    });
    console.log(
      `${boss.file}: ${clipName} ${seconds}s, ${baked.authored} channels, ${frames + 1} keys`,
    );
  }
  await io.write(boss.file, doc);
}
