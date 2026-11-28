// Build the Hammer Council's entrance clips (Smith's Heart, docs/design/raid/
// smith_heart.md section 7.1, "The entrance", "The quarry wakes"): the scene
// opens on both members asleep, the Guardian fused into a spur of the
// quarry's rock and the Seam Singer curled inside a vein of crystal, and
// breaks open as each one rips itself out on its rig's own Awaken.
//
// Both rigs ship Awaken (a still crouch, then the rise) but nothing that
// holds the crouch, so the one clip each needs is sampled off it by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs). No Blender.
//
//   Dormant (each rig): Awaken's first pose (the Guardian hunched over its
//   knees, its head bowed; the Singer folded down into herself), held
//   perfectly still with the faintest breath of a sway on its root over the
//   clip's two seconds (a sleeper, not a statue: it loops seamlessly).
//
// The bodies break out on the base GLBs' own Awaken one-shots (entered by
// the entrance's emerge stances), so the crouch the Dormant clip holds is
// exactly where Awaken starts: no pop on the break.
//
// render/smith_heart_fx/council_entrance_core.ts (COUNCIL_AWAKEN_CLIP) pins
// the Awaken beats; tests/smith_heart_council_entrance.test.ts reads this
// script's output back.
//
// Usage: node scripts/build_council_entrance_anims.mjs
// Output: public/models/creatures/heart_hammer_guardian_entrance_anims.glb and
// public/models/creatures/heart_seam_singer_entrance_anims.glb (0 meshes or
// skins, 1 clip each: Dormant)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  createGlbIO,
  indexClip,
  poseValue,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CREATURES = resolve(ROOT, 'public/models/creatures');

/** Each rig: its shipped GLB, the entrance anims it gets, the bone the sway
 *  rides. */
const RIGS = [
  { source: 'heart_slabwright.glb', out: 'heart_hammer_guardian_entrance_anims.glb', sway: 'Core' },
  { source: 'heart_seam_singer.glb', out: 'heart_seam_singer_entrance_anims.glb', sway: 'Core' },
];

/** The sway: a breath of a turn about the up axis (radians) over the loop. */
const SWAY = 0.012;
const LOOP = 2;

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
const qy = (rad) => [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];

const io = createGlbIO();
for (const rig of RIGS) {
  const doc = await io.read(resolve(CREATURES, rig.source));
  const root = doc.getRoot();
  const awakenIdx = indexClip(root, 'Awaken');
  const keys = new Set(awakenIdx.keys());
  const donorFor = (key) => awakenIdx.get(key);
  const P0 = samplePose(awakenIdx, 0);
  const swayKey = `${rig.sway}|rotation`;
  const at = (t) => (key) => {
    const v = poseValue(P0, key, P0);
    if (key !== swayKey || !v) return v;
    return qmul(qy(SWAY * Math.sin((t / LOOP) * Math.PI * 2)), v);
  };
  const timeline = [];
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * LOOP;
    timeline.push([t, at(t)]);
  }
  const { animation } = bakeClip(doc, {
    clipName: 'Dormant',
    channelKeys: keys,
    timeline,
    donorFor,
  });
  stripToAnimationsOnly(doc, [animation]);
  await doc.transform(prune(), dedup());
  const out = resolve(CREATURES, rig.out);
  await io.write(out, doc);
  const kept = root.listAnimations().map((a) => a.getName());
  console.log(`wrote ${out}`);
  console.log(`clips (${kept.length}): ${kept.join(', ')}`);
}
