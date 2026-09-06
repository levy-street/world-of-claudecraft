// Build the druid Strider Form's six shipped clips (the Longstride).
//
// The body came off the asset pipeline (Tripo image-to-model, biped auto-rig)
// with the generic `preset:biped:*` retargets. Those presets are authored for a
// PERSON, and a person's whole head sits on one short neck bone, so a preset
// that turns the neck reads as a head turn. On this rig that same bone carries
// the moa's entire neck AND its long beak: measured off the shipped rig,
// NeckTwist01's rest length is 0.111 in a model 0.998 tall, and the neck and
// bill geometry are skinned to NeckTwist01/NeckTwist02/Head rather than to a
// long bone chain. The idle preset opens with a 77 degree rotation on that one
// bone (frame 0 quaternion w = 0.778), which swings the whole head and bill
// down and back behind the flank. The result is a bird with no visible head in
// EVERY one of the eight presets, which is why none of them ship as authored.
//
// The fix keeps what the presets get right and re-authors only what they get
// wrong. A moa's gait is genuinely bipedal, so the LEG and root channels come
// from the preset UNCHANGED: the stride and the weight shift read correctly and
// cost nothing to keep. The torso, neck, head and wing channels are authored
// here, off the rig's own rest pose, which is the correct standing bird (the
// pipeline's bind-pose turnarounds show the neck up and the bill forward, so
// rest is the pose to hold, not one to invent).
//
// The four beats the concept asks for, and where each one lives:
//
//   Beak as compass. Idle holds the neck at rest (head up, bill angled down).
//   Walk pitches it part way, Run pitches it fully forward so the bill points
//   dead ahead along the travel direction. That is one authored pitch per gait
//   rather than a new clip, and it is the read a pursuer gets from behind.
//
//   Two-beat gait, big amplitude. Inherited from the preset legs; the body is
//   small and slung high, so the leg cycle already carries the motion.
//
//   Wings as counterweights. Pinned: the clavicle and arm chain is held at rest
//   in every clip, which is what "vestigial wing pinned to the flank" means.
//   The presets swing them like human arms, which is the other half of why the
//   raw retargets read wrong.
//
//   Strider_Peck and Strider_Topple are bespoke, because no preset on this rig
//   contains a usable pose to sample. Attack was `preset:biped:slash`, a 6.6s
//   ARM swing on a body whose arms are vestigial stubs. Death was
//   `preset:biped:defeat_02`, 8.5s of a bird that never falls.
//
// Usage: node scripts/build_longstride_anims.mjs [--preview]
// Output: public/models/creatures/longstride_anims.glb (0 meshes/skins, 6 clips)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  createGlbIO,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  samplePose,
  slerpQ,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/models/creatures/longstride.glb');
const OUT = resolve(ROOT, 'public/models/creatures/longstride_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/longstride_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

// Sampling rate for the baked clips. The game plays these through the shared
// AnimationMixer with LINEAR interpolation, so 30 Hz is well above the 20 Hz
// sim tick and holds the leg cycle's shape without inflating the file.
const FPS = 30;

// The chain the presets break, and the chain this script owns. Everything not
// listed here is taken from the donor preset verbatim.
//
// TORSO is held at its REST rotation rather than the donor's. A running human
// pitches the torso forward and the head stays level on top; a running bird
// holds the body level and lets the legs do all of it. Keeping the donor's
// torso pitch is what threw the first pass off: with the spine rotated 24
// degrees, an identity neck no longer means "the rest carriage", it means "the
// rest carriage plus 24 degrees", and the bill ended up pointing at the sky.
// Holding the torso level makes the rest frame the frame the neck pitch is
// authored in, which is the frame the bind-pose turnarounds show as correct.
const TORSO = ['Waist', 'Spine01', 'Spine02'];
const NECK = ['NeckTwist01', 'NeckTwist02', 'Head'];
const WING = [
  'L_Clavicle',
  'L_Upperarm',
  'L_Forearm',
  'L_ForearmTwist01',
  'L_ForearmTwist02',
  'L_Hand',
  'L_UpperarmTwist01',
  'L_UpperarmTwist02',
  'R_Clavicle',
  'R_Upperarm',
  'R_UpperarmTwist01',
  'R_UpperarmTwist02',
  'R_Forearm',
  'R_ForearmTwist01',
  'R_ForearmTwist02',
  'R_Hand',
];
const IDENTITY = [0, 0, 0, 1];

/** Rest rotation per joint, filled from the rig once the source is read. */
const REST = new Map();

/** Quaternion for `angle` radians about the local X axis. The neck chain's rest
 *  frame runs along local +Y (NeckTwist01/02 and Head all carry a pure +Y rest
 *  translation and an identity rest rotation), so local X is the pitch axis:
 *  positive drops the bill toward the ground, negative lifts it. */
function pitchX(angle) {
  const h = angle / 2;
  return [Math.sin(h), 0, 0, Math.cos(h)];
}

/** Quaternion for `angle` radians about the Z axis. */
function rollZ(angle) {
  const h = angle / 2;
  return [0, 0, Math.sin(h), Math.cos(h)];
}

/** Hamilton product, a then b applied in b's frame (b * a). */
function qmul(b, a) {
  return [
    b[3] * a[0] + b[0] * a[3] + b[1] * a[2] - b[2] * a[1],
    b[3] * a[1] - b[0] * a[2] + b[1] * a[3] + b[2] * a[0],
    b[3] * a[2] + b[0] * a[1] - b[1] * a[0] + b[2] * a[3],
    b[3] * a[3] - b[0] * a[0] - b[1] * a[1] - b[2] * a[2],
  ];
}

/** The root's rest rotation with `angle` of topple COMPOSED onto it, in the
 *  root's parent (model) frame. Writing the topple absolutely would throw the
 *  rig's own facing away: Root's rest is a 120 degree rotation, not identity,
 *  so an absolute write lays the bird flat on frame 0 before it has fallen. */
function rootTopple(angle) {
  return qmul(rollZ(angle), REST.get('Root') ?? IDENTITY);
}

/** The neck pose for a given forward pitch, in radians, split down the chain.
 *  A bird levelling its neck bends it along its whole length rather than
 *  hinging at one joint, and the head then counter-rotates so the bill finishes
 *  level instead of pointing at the floor. */
function neckPose(pitch) {
  return new Map([
    ['NeckTwist01|rotation', pitchX(pitch * 0.55)],
    ['NeckTwist02|rotation', pitchX(pitch * 0.45)],
    // The bill rides the chain, so the head takes back most of the pitch: at a
    // full lower the neck is down but the bill points forward, not down.
    ['Head|rotation', pitchX(-pitch * 0.52)],
  ]);
}

/** Wings pinned flat to the flank, and the torso held level: each bone's own
 *  REST rotation, read off the rig rather than assumed to be identity (the
 *  waist's rest carries the model's facing, so identity there would spin it). */
function restPose(names) {
  return new Map(names.map((n) => [`${n}|rotation`, REST.get(n) ?? IDENTITY]));
}

function upperPose(pitch) {
  return new Map([...restPose(TORSO), ...restPose(WING), ...neckPose(pitch)]);
}

/** Even time samples across `duration`, always including both ends. */
function sampleTimes(duration) {
  const n = Math.max(2, Math.round(duration * FPS) + 1);
  return Array.from({ length: n }, (_, i) => (duration * i) / (n - 1));
}

/** A locomotion clip: donor legs, authored torso, neck and wings.
 *  `pitch` is the constant forward neck pitch that gait carries.
 *  `speedUp` compresses the cycle in time (see CADENCE below). */
function locomotion(doc, root, { donorName, clipName, pitch, speedUp = 1 }) {
  const donor = indexClip(root, donorName);
  const duration = Math.max(...[...donor.values()].map((c) => c.times[c.times.length - 1]));
  const pose = upperPose(pitch);
  const timeline = sampleTimes(duration).map((t) => {
    // Every channel needs a value at every key, so the donor is resampled at
    // the same times and the authored torso, neck and wing values are laid over
    // it. The clip's own key TIMES are then divided by speedUp, which is what
    // raises the cadence without touching a single pose.
    const donorPose = samplePose(donor, t);
    return [t / speedUp, (key) => pose.get(key) ?? donorPose.get(key) ?? null];
  });
  return bakeClip(doc, {
    clipName,
    channelKeys: donor.keys(),
    timeline,
    donorFor: (key) => donor.get(key),
  });
}

/** A bespoke clip: the whole body is held at one donor pose (the still frame
 *  the motion departs from), and `rows` supply the authored overrides. */
function bespoke(doc, root, { donorName, donorTime, clipName, rows }) {
  const donor = indexClip(root, donorName);
  const held = samplePose(donor, donorTime);
  const timeline = rows.map(([t, pose]) => [t, (key) => pose.get(key) ?? held.get(key) ?? null]);
  return bakeClip(doc, {
    clipName,
    channelKeys: donor.keys(),
    timeline,
    donorFor: (key) => donor.get(key),
  });
}

/** Ramp a pose value across a set of rows, easing between keyframe poses. */
function ramp(from, to, t, ease) {
  const e = ease(t);
  const out = new Map();
  for (const [key, a] of from) {
    const b = to.get(key) ?? a;
    out.set(key, slerpQ(a, b, e));
  }
  for (const [key, b] of to) if (!out.has(key)) out.set(key, b);
  return out;
}

/** Build a keyframed timeline from [time, pose] stops, resampled at FPS. */
function keyframed(stops, ease = easeInOutQuad) {
  const rows = [];
  const end = stops[stops.length - 1][0];
  for (const t of sampleTimes(end)) {
    let i = 0;
    while (i < stops.length - 2 && stops[i + 1][0] < t) i++;
    const [t0, p0] = stops[i];
    const [t1, p1] = stops[i + 1] ?? stops[i];
    const u = t1 === t0 ? 1 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    rows.push([t, ramp(p0, p1, u, ease)]);
  }
  return rows;
}

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

for (const joint of root.listSkins()[0].listJoints()) {
  REST.set(joint.getName(), [...joint.getRotation()]);
}

const built = [];

// ---- locomotion -----------------------------------------------------------
// Idle holds the rest neck: head up, bill angled down, which is the pose the
// concept's plate I shows. Walk takes a third of the way down. Run levels it
// fully forward, which is the beak-as-compass read.
const RUN_PITCH = 1.35; // radians, measured against the bill finishing level
//
// CADENCE. `locomotionTimeScale` plays a gait at speed/ref and clamps to
// [0.6, 1.6] for run and [0.6, 1.8] for walk, so a foot only skates when the
// clamp bites: inside the band the played foot rate equals body speed exactly.
// That makes the ref the speed the clip is AUTHORED for, which is why the
// engine's own defaults are DEFAULT_RUN_REF 7 against RUN_SPEED 7.
//
// This form travels at RUN_SPEED * 1.4 = 9.8 yd/s, and walks at the same 1.4
// over the 2.2 walk reference, so 3.08 yd/s. The raw Tripo presets are authored
// far slower than that: measured off the baked clips at height 2.1 (a planted
// foot slides backwards relative to the hips at exactly body speed), the walk
// runs at 1.61 yd/s and the run at 4.17. Shipping those refs would peg the run
// at the 1.6 clamp and skate the feet badly, which is the same defect the
// chicken-cow had from carrying no refs at all.
//
// The cycles are therefore COMPRESSED to the speeds this form actually moves
// at, rather than the refs being bent to fit a slow clip. A long-legged bird
// covering ground raises cadence, so a faster leg cycle is the correct read,
// not a workaround. The re-measured rates after compression become the refs
// below, which puts normal travel at timeScale 1.0 and leaves the whole clamp
// band for snares and speed buffs.
const WALK_SPEEDUP = 1.91; // 3.08 / 1.61
const RUN_SPEEDUP = 2.35; // 9.80 / 4.17
built.push(locomotion(doc, root, { donorName: 'Idle', clipName: 'Strider_Idle', pitch: 0 }));
built.push(
  locomotion(doc, root, {
    donorName: 'Walk',
    clipName: 'Strider_Walk',
    pitch: RUN_PITCH * 0.38,
    speedUp: WALK_SPEEDUP,
  }),
);
built.push(
  locomotion(doc, root, {
    donorName: 'Run',
    clipName: 'Strider_Run',
    pitch: RUN_PITCH,
    speedUp: RUN_SPEEDUP,
  }),
);
built.push(locomotion(doc, root, { donorName: 'Jump', clipName: 'Strider_Jump', pitch: 0 }));

// ---- the peck -------------------------------------------------------------
// Cock the neck back, drive the bill forward at its own height, hold, recover.
// The bill leads and the body stays put: a moa's reach is its neck, and a bird
// that commits its whole body to a peck drives the bill into the floor.
built.push(
  bespoke(doc, root, {
    donorName: 'Idle',
    donorTime: 0,
    clipName: 'Strider_Peck',
    rows: keyframed(
      [
        [0.0, upperPose(0)],
        [0.22, upperPose(-0.42)], // cock back, bill lifts
        [0.44, upperPose(1.05)], // drive forward, bill level and out
        [0.62, upperPose(1.05)], // hold the strike
        [0.95, upperPose(0)], // recover to carry
      ],
      easeOutCubic,
    ),
  }),
);

// ---- the topple -----------------------------------------------------------
// No preset on this rig contains a lying-down pose to sample, so the fall is
// computed rather than borrowed: the body pivots rigidly about the Root, which
// sits at ground level between the feet, so the silhouette goes from a standing
// vertical to a flat horizontal without a ragdoll. The neck goes slack forward
// on the way down, which is what sells it as a fall rather than a lie-down.
const TOPPLE = 1.35; // radians of rigid body rotation, upright to flat
function toppleRows() {
  const stops = [];
  for (const [t, frac, pitch] of [
    [0.0, 0, 0],
    [0.35, -0.08, -0.2], // teeter: rock back, head comes up
    [1.4, 0.75, 0.85], // the fall
    [2.0, 1, 1.0], // flat, neck slack
  ]) {
    stops.push([t, new Map([...upperPose(pitch), ['Root|rotation', rootTopple(TOPPLE * frac)]])]);
  }
  return keyframed(stops, easeInOutQuad);
}
built.push(
  bespoke(doc, root, {
    donorName: 'Idle',
    donorTime: 0,
    clipName: 'Strider_Topple',
    rows: toppleRows(),
  }),
);

// ---- emit -----------------------------------------------------------------
// Animations only: this rides longstride.glb through the VisualDef's animUrls
// the same way kiwi_form_anims.glb rides the kiwi body, so the clip donor
// carries no duplicate mesh, skin or texture bytes.
stripToAnimationsOnly(
  doc,
  built.map((b) => b.animation),
);
await doc.transform(dedup(), prune());
await io.write(PREVIEW ? PREVIEW_OUT : OUT, doc);

for (const b of built) {
  console.log(`${b.animation.getName().padEnd(16)} ${b.authored} channels, ${b.times.length} keys`);
}
console.log(`wrote ${PREVIEW ? PREVIEW_OUT : OUT}`);
