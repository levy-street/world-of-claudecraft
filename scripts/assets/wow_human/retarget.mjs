// Offline retargeting: Source Z-up/-Y-forward to WOC Y-up/+Z-forward.
// Align anatomical directions before transferring world-space bone motion.
import { Quaternion, Vector3 } from 'three';

const AXIS = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
// These MDLs compile their sequences facing +X, while the bind mesh faces -Y.
const ANIM_AXIS = new Quaternion()
  .setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2)
  .multiply(AXIS);
const vec = (v) => new Vector3(...v);
const quat = (q) => new Quaternion(...q).normalize();
const PAIRS = {
  male: {
    hips: ['2', '3'],
    spine: ['8', '15'],
    chest: ['15', '22'],
    neck: ['28', '38'],
    head: ['38', null],
    'clavicle.l': ['20', '26'],
    'upperarm.l': ['26', '34'],
    'lowerarm.l': ['34', '40'],
    'wrist.l': ['40', '94'],
    'clavicle.r': ['21', '27'],
    'upperarm.r': ['27', '35'],
    'lowerarm.r': ['35', '46'],
    'wrist.r': ['46', '104'],
    'upperleg.l': ['6', '12'],
    'lowerleg.l': ['12', '25'],
    'foot.l': ['25', '31'],
    'toes.l': ['31', null],
    'upperleg.r': ['5', '11'],
    'lowerleg.r': ['11', '24'],
    'foot.r': ['24', '30'],
    'toes.r': ['30', null],
  },
  female: {
    hips: ['2', '3'],
    spine: ['9', '16'],
    chest: ['16', '25'],
    neck: ['32', '42'],
    head: ['42', null],
    'clavicle.l': ['21', '29'],
    'upperarm.l': ['29', '37'],
    'lowerarm.l': ['37', '43'],
    'wrist.l': ['43', '90'],
    'clavicle.r': ['22', '30'],
    'upperarm.r': ['30', '39'],
    'lowerarm.r': ['39', '49'],
    'wrist.r': ['49', '100'],
    'upperleg.l': ['8', '14'],
    'lowerleg.l': ['14', '28'],
    'foot.l': ['28', '34'],
    'toes.l': ['34', null],
    'upperleg.r': ['6', '13'],
    'lowerleg.r': ['13', '27'],
    'foot.r': ['27', '33'],
    'toes.r': ['33', null],
  },
};
const CHILD = {
  hips: 'spine',
  spine: 'chest',
  chest: 'neck',
  neck: 'head',
  ...Object.fromEntries(
    ['l', 'r'].flatMap((s) => [
      [`clavicle.${s}`, `upperarm.${s}`],
      [`upperarm.${s}`, `lowerarm.${s}`],
      [`lowerarm.${s}`, `wrist.${s}`],
      [`wrist.${s}`, `hand.${s}`],
      [`upperleg.${s}`, `lowerleg.${s}`],
      [`lowerleg.${s}`, `foot.${s}`],
      [`foot.${s}`, `toes.${s}`],
    ]),
  ),
};

export function worldPose(bones, tracks = {}, frame = 0) {
  const cache = new Map();
  function visit(i) {
    const b = bones[i];
    if (cache.has(b.name)) return cache.get(b.name);
    const tr = tracks[b.name];
    const p = vec(tr ? tr.t[Math.min(frame, tr.t.length - 1)] : b.t);
    const q = quat(tr ? tr.q[Math.min(frame, tr.q.length - 1)] : b.q);
    if (b.parent >= 0) {
      const parent = visit(b.parent);
      p.applyQuaternion(parent.q).add(parent.p);
      q.premultiply(parent.q);
    }
    const result = { p, q };
    cache.set(b.name, result);
    return result;
  }
  bones.forEach((_, i) => {
    visit(i);
  });
  return cache;
}

export function retargetClip(source, target, fit, clip) {
  const pairs = PAIRS[fit];
  if (!pairs) throw new Error(`Unknown body fit: ${fit}`);
  const restS = worldPose(source.bones);
  const restT = worldPose(target);
  const correction = new Map();
  for (const [name, [from, tip]] of Object.entries(pairs)) {
    const s = restS.get(from),
      t = restT.get(name);
    if (!s || !t) throw new Error(`Missing retarget bone: ${name}/${from}`);
    const match = t.q.clone();
    // Tiny pelvis helper offsets are not reliable anatomical aim axes.
    if (tip && name !== 'hips') {
      const td = restT.get(CHILD[name]).p.clone().sub(t.p).normalize();
      const sd = restS.get(tip).p.clone().sub(s.p).applyQuaternion(AXIS).normalize();
      match.premultiply(new Quaternion().setFromUnitVectors(td, sd));
    }
    correction.set(name, s.q.clone().premultiply(AXIS).invert().multiply(match));
  }
  const tracks = Object.fromEntries(target.map((b) => [b.name, { t: [], q: [] }]));
  const sourceHip = restS.get(pairs.hips[0]).p.clone().applyQuaternion(AXIS);
  const targetHip = restT.get('hips').p;
  const scale = targetHip.y / sourceHip.y;
  for (let frame = 0; frame < clip.frames; frame++) {
    const sw = worldPose(source.bones, clip.tracks, frame);
    const tw = new Map();
    const visit = (i) => {
      const b = target[i];
      if (tw.has(b.name)) return tw.get(b.name);
      const parent = b.parent >= 0 ? visit(b.parent) : { p: new Vector3(), q: new Quaternion() };
      const p = vec(b.t),
        q = quat(b.q);
      const pair = pairs[b.name];
      if (pair) {
        q.copy(sw.get(pair[0]).q).premultiply(ANIM_AXIS).multiply(correction.get(b.name));
        q.premultiply(parent.q.clone().invert());
        if (b.name === 'hips') {
          p.copy(sw.get(pair[0]).p)
            .applyQuaternion(ANIM_AXIS)
            .sub(sourceHip)
            .multiplyScalar(scale)
            .add(targetHip);
          p.sub(parent.p).applyQuaternion(parent.q.clone().invert());
        }
      } else if (b.name.startsWith('armor_shoulder.')) {
        const arm = `upperarm.${b.name.at(-1)}`;
        q.copy(visit(target.findIndex((x) => x.name === arm)).q).premultiply(
          parent.q.clone().invert(),
        );
      } else if (b.name.startsWith('skirt.') || b.name.startsWith('tassel.side.')) {
        // Apply the leg delta in hips space to each plate's own bind rotation.
        const legIndex = target.findIndex((n) => n.name === `upperleg.${b.name.at(-1)}`);
        const delta = visit(legIndex)
          .q.clone()
          .premultiply(parent.q.clone().invert())
          .multiply(quat(target[legIndex].q).invert());
        const amount = b.name.startsWith('tassel.') ? 0.4 : 1;
        q.premultiply(new Quaternion().slerp(delta, amount));
      }
      const out = tracks[b.name];
      if (out.q.length && q.dot(quat(out.q.at(-1))) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      out.t.push(p.toArray());
      out.q.push(q.toArray());
      const world = {
        p: p.clone().applyQuaternion(parent.q).add(parent.p),
        q: q.clone().premultiply(parent.q),
      };
      tw.set(b.name, world);
      return world;
    };
    target.forEach((_, i) => {
      visit(i);
    });
  }
  return { name: `WoW_${clip.name}`, fps: clip.fps, frames: clip.frames, loop: clip.loop, tracks };
}

/** Median planted-foot travel speed, in world yards/second at the body scale.
 * Exclude lifted feet and the swing phase; those move forward, not against travel. */
export function gaitSpeed(bones, clip, worldScale, backwards = false) {
  // Sample between authored frames too: short contacts must not be lost to
  // the source frame rate or the final 30 Hz animation timeline.
  const subdivisions = 8;
  const dense = Object.fromEntries(
    Object.entries(clip.tracks).map(([name, track]) => {
      const t = [],
        q = [];
      for (let i = 0; i < clip.frames - 1; i++) {
        for (let step = 0; step < subdivisions; step++) {
          const alpha = step / subdivisions;
          t.push(
            vec(track.t[i])
              .lerp(vec(track.t[i + 1]), alpha)
              .toArray(),
          );
          q.push(
            quat(track.q[i])
              .slerp(quat(track.q[i + 1]), alpha)
              .toArray(),
          );
        }
      }
      return [name, { t, q }];
    }),
  );
  const poses = Array.from({ length: (clip.frames - 1) * subdivisions }, (_, i) =>
    worldPose(bones, dense, i),
  );
  const speeds = [];
  for (const name of ['foot.l', 'foot.r']) {
    const feet = poses.map((p) => p.get(name).p);
    const low = Math.min(...feet.map((p) => p.y));
    for (let i = 1; i < feet.length; i++) {
      const a = feet[i - 1],
        b = feet[i];
      const speed = (b.z - a.z) * clip.fps * subdivisions;
      if (Math.max(a.y, b.y) < low + 0.05 && (backwards ? speed > 0 : speed < 0)) {
        speeds.push(Math.abs(speed) * worldScale);
      }
    }
  }
  if (speeds.length < 3) throw new Error(`No planted gait samples: ${clip.name}`);
  speeds.sort((a, b) => a - b);
  return speeds[Math.floor(speeds.length / 2)];
}
