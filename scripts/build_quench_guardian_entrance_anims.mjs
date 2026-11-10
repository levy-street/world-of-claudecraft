// Build the Guardian of the Quench's two entrance clips (Smith's Heart,
// docs/design/raid/smith_heart.md section 7.3, "The entrance"): the scene
// opens on her lying frozen under the lake's ice and breaks open with her
// bursting up out of it, rising to her full height and calling her blades.
// Her rig ships Idle and Wake (both arms raised to the sky and thrown down
// on its 4 s beat) but nothing that lies or rises, so both clips are authored
// by pose-sample-and-blend (scripts/anim/pose_blend.mjs) off those donors,
// the body laid down and lifted on its root bone. No Blender.
//
//   Frozen: Idle's first pose laid on her back (her face to the sky, her
//   feet toward the way she faces, her head away and a little raised), sunk
//   a little into the ice, perfectly still: the stance the scene opens on.
//   Emerge: from that, she bursts up out of the ice (her upper body flung up
//   in a breath), rises slowly to her full height while her arms gather and
//   climb to the sky (Wake's raise), holds them there while her blades rise
//   round her, throws them down at the raid (Wake's throw, landing on
//   THROW, the line's "forgive"), then settles into Idle's first pose
//   so the base idle picks up seamlessly.
//
// The clip's beats are pinned by render/smith_heart_fx/quench_entrance_core.ts
// (QUENCH_EMERGE_CLIP) and tests/smith_heart_quench_entrance.test.ts reads
// this file's output back.
//
// Usage: node scripts/build_quench_guardian_entrance_anims.mjs [--preview]
// Output: public/models/creatures/smith_heart_quench_guardian_entrance_anims.glb
// (0 meshes/skins, 2 clips: Frozen, Emerge)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  blendValue,
  createGlbIO,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  mergePoses,
  poseValue,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/models/creatures/smith_heart_quench_guardian.glb');
const OUT = resolve(ROOT, 'public/models/creatures/smith_heart_quench_guardian_entrance_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/quench_guardian_entrance_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const wakeIdx = indexClip(root, 'Wake');
const allKeys = new Set([...idleIdx.keys(), ...wakeIdx.keys()]);
const donorFor = (key) => idleIdx.get(key) ?? wakeIdx.get(key);

const P_idle = samplePose(idleIdx, 0);
const P_all = mergePoses(P_idle, samplePose(wakeIdx, 0));

// ---- the root: laid down, lifted ---------------------------------------------------------
// The root's rest rotation (the rig's Blender frame turned y-up) and the
// hips' place at rest in the model's frame (y up, her face toward +z).
const R0 = P_idle.get('root|rotation');
const HIPS_AT_REST = [0, 5, -0.05];

function qmul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
/** A turn of `deg` about the model's x axis (negative: her face to the sky). */
const qx = (deg) => {
  const h = (deg * Math.PI) / 360;
  return [Math.sin(h), 0, 0, Math.cos(h)];
};
/** `v` turned `deg` about x. */
function rx(deg, [x, y, z]) {
  const a = (deg * Math.PI) / 180;
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}
/** The root's translation and rotation that lay the body at `tilt` degrees
 *  (-90 flat on her back, 0 standing) with her hips at `hips`. */
function rootAt(tilt, hips) {
  const h = rx(tilt, HIPS_AT_REST);
  return {
    t: [hips[0] - h[0], hips[1] - h[1], hips[2] - h[2]],
    r: qmul(qx(tilt), R0),
  };
}

/** Lying on her back, her head a little raised (her face and crown toward
 *  the raid), her hips a breath under the ice, her feet sunk in it. */
const LIE = { tilt: -80, hips: [0, -0.25, 0] };
/** The burst: her upper body flung up out of the ice. */
const BURST = { tilt: -56, hips: [0, 1.7, 0.45] };
const STAND = { tilt: 0, hips: HIPS_AT_REST };

const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));

// ---- Frozen --------------------------------------------------------------------------------
const lying = rootAt(LIE.tilt, LIE.hips);
const frozenAt = (key) => {
  if (key === 'root|translation') return lying.t;
  if (key === 'root|rotation') return lying.r;
  return poseValue(P_idle, key, P_all);
};
const { animation: frozenAnim } = bakeClip(doc, {
  clipName: 'Frozen',
  channelKeys: allKeys,
  timeline: [
    [0, frozenAt],
    [2, frozenAt],
  ],
  donorFor,
});

// ---- Emerge --------------------------------------------------------------------------------
// Beats (seconds into the clip; render/smith_heart_fx/quench_entrance_core.ts
// QUENCH_EMERGE_CLIP pins the same numbers).
const BURST_END = 0.45;
const RISE_END = 2.7;
const THROW = 4.18;
const SETTLE = 5.35;
const END = 5.8;

/** The root along the rise: the burst (eased out, violent), then the slow
 *  climb to her full height (eased in and out). */
function rootOn(t) {
  if (t <= BURST_END) {
    const k = easeOutCubic(t / BURST_END);
    return rootAt(lerp(LIE.tilt, BURST.tilt, k), lerp3(LIE.hips, BURST.hips, k));
  }
  const k = easeInOutQuad(Math.min(1, (t - BURST_END) / (RISE_END - BURST_END)));
  return rootAt(lerp(BURST.tilt, STAND.tilt, k), lerp3(BURST.hips, STAND.hips, k));
}

/** Wake's time for clip time `t` (the arms' story): gathered low through
 *  the burst, climbing to the sky as she reaches her height, held up while
 *  the blades rise, thrown down on THROW, the throw's lean played out. */
const WAKE_MAP = [
  [0, 0.5],
  [BURST_END, 1.0],
  [2.0, 1.9],
  [3.3, 3.0],
  [THROW - 0.12, 3.6],
  [THROW + 0.08, 3.9],
  [SETTLE, 5.0],
];
function wakeTime(t) {
  for (let i = 1; i < WAKE_MAP.length; i++) {
    const [t0, w0] = WAKE_MAP[i - 1];
    const [t1, w1] = WAKE_MAP[i];
    if (t <= t1) return lerp(w0, w1, Math.max(0, (t - t0) / (t1 - t0)));
  }
  return WAKE_MAP[WAKE_MAP.length - 1][1];
}

const emerge = [];
const STEP = 1 / 15;
for (let i = 0; i * STEP <= END + 1e-9; i++) {
  const t = Math.min(END, i * STEP);
  const r = rootOn(t);
  // The body: Idle's pose under the ice, easing into Wake's story through
  // the burst; after the throw, eased back into Idle.
  const pose = samplePose(wakeIdx, wakeTime(t));
  const fromIdle = t < BURST_END ? 1 - easeOutCubic(t / BURST_END) : 0;
  const toIdle = t > SETTLE ? easeInOutQuad((t - SETTLE) / (END - SETTLE)) : 0;
  emerge.push([
    t,
    (key) => {
      if (key === 'root|translation') return r.t;
      if (key === 'root|rotation') return r.r;
      const w = poseValue(pose, key, P_all);
      const idle = poseValue(P_idle, key, P_all);
      if (!w || !idle) return w ?? idle;
      const k = Math.max(fromIdle, toIdle);
      return k > 0 ? blendValue(key, w, idle, k) : w;
    },
  ]);
}
const { animation: emergeAnim } = bakeClip(doc, {
  clipName: 'Emerge',
  channelKeys: allKeys,
  timeline: emerge,
  donorFor,
});

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, [frozenAnim, emergeAnim]);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
