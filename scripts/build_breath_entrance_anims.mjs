// Build the Guardian of the Breath's entrance clips (Smith's Heart,
// docs/design/raid/smith_heart.md section 7.2, "The entrance", "Calm before
// the storm"): the scene opens on a dead calm with no guardian in it, a
// tornado comes down onto the Cornice, and when it bursts the guardian is
// floating where it touched down. Its rig ships no clip for being nowhere,
// nor for forming out of the wind, so both are sampled off its own Idle by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs). No Blender.
//
//   Gathered: Idle's first pose with the root drawn down to a speck at the
//   body's heart (scale GATHERED, about its chest, not its tail's tip), held
//   still over the clip's two seconds (it loops). Nothing of the body shows:
//   the guardian is still the wind.
//   Form: the root growing from that speck back to its full size about the
//   same heart (eased out, a breath of overshoot), turning a last half spin
//   about the up axis as it comes together, over Idle's own motion so it is
//   alive the whole time; it ends on Idle's pose at FORM seconds.
//
// The root bone's frame has its up along its own +Z (its rest turns it a
// quarter about X), so the shrink is about the body bone's rest offset up it.
//
// render/smith_heart_fx/breath_entrance_core.ts (BREATH_FORM_CLIP) pins the
// clip's length and its growth; tests/smith_heart_breath_entrance.test.ts
// reads this script's output back.
//
// Usage: node scripts/build_breath_entrance_anims.mjs
// Output: public/models/creatures/smith_heart_breath_guardian_entrance_anims.glb
// (0 meshes or skins, 2 clips: Gathered, Form)
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
const SOURCE = 'smith_heart_breath_guardian.glb';
const OUT = 'smith_heart_breath_guardian_entrance_anims.glb';

/** The speck it is gathered into (a share of its size). */
const GATHERED = 0.002;
/** The Form clip's length (seconds) and the share it starts from. */
const FORM = 1.6;
const FORM_FROM = 0.03;
/** The last turn it makes as it comes together (radians about up). */
const FORM_SPIN = Math.PI;
const LOOP = 2;
const FPS = 30;

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
function rotate(q, v) {
  const [x, y, z, w] = q;
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-x, -y, -z, w]);
  return [p[0], p[1], p[2]];
}

/** The growth over the Form clip (0..1 of its time): eased out, overshooting
 *  a little before it settles. Mirrored by breath_entrance_core.ts
 *  breathFormScale. */
export function formScale(k) {
  const c = Math.min(1, Math.max(0, k));
  const ease = 1 - (1 - c) ** 3;
  const over = 0.06 * Math.sin(Math.PI * Math.min(1, c / 0.92)) * c;
  return FORM_FROM + (1 - FORM_FROM) * ease + over * (1 - c);
}

const io = createGlbIO();
const doc = await io.read(resolve(CREATURES, SOURCE));
const root = doc.getRoot();
const idle = indexClip(root, 'Idle');
const keys = new Set(idle.keys());
const donorFor = (key) => idle.get(key);
const P0 = samplePose(idle, 0);
// The body's heart in the root's frame (its rest offset up the root's +Z).
const heart = poseValue(P0, 'body|translation', P0) ?? [0, 0, 4.9];

/** The pose at Idle time `t` with the root at size `s` about the heart and
 *  turned `spin` about up. */
const posed = (t, s, spin) => {
  const P = samplePose(idle, t % 4);
  return (key) => {
    const v = poseValue(P, key, P0);
    if (!v) return v;
    if (key === 'root|scale') return [v[0] * s, v[1] * s, v[2] * s];
    if (key === 'root|rotation') return qmul(qy(spin), v);
    if (key === 'root|translation') {
      const rot = qmul(qy(spin), poseValue(P, 'root|rotation', P0));
      const full = rotate(rot, heart);
      return [v[0] + full[0] * (1 - s), v[1] + full[1] * (1 - s), v[2] + full[2] * (1 - s)];
    }
    return v;
  };
};

const gathered = [];
for (let i = 0; i <= 4; i++) {
  const t = (i / 4) * LOOP;
  gathered.push([t, posed(0, GATHERED, 0)]);
}
const form = [];
const frames = Math.round(FORM * FPS);
for (let i = 0; i <= frames; i++) {
  const t = (i / frames) * FORM;
  const k = t / FORM;
  form.push([t, posed(t, formScale(k), -FORM_SPIN * (1 - k) ** 2)]);
}
const a = bakeClip(doc, { clipName: 'Gathered', channelKeys: keys, timeline: gathered, donorFor });
const b = bakeClip(doc, { clipName: 'Form', channelKeys: keys, timeline: form, donorFor });
stripToAnimationsOnly(doc, [a.animation, b.animation]);
await doc.transform(prune(), dedup());
const out = resolve(CREATURES, OUT);
await io.write(out, doc);
const kept = root.listAnimations().map((x) => x.getName());
console.log(`wrote ${out}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
