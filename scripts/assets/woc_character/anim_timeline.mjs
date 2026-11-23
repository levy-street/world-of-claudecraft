// The animation library's size step (scripts/assets/woc_character/build_woc_split.mjs buildBody,
// in place of gltf-transform's resample()), measured 2026-10-03: the library was 56% JSON, and
// half of that was per-channel time accessors (about a thousand per fit, most serving one
// channel). Here every clip keeps EVERY authored frame, so nothing about the motion changes:
//
//   uniformTimeline()  each channel of a clip is sampled at every frame of `fps` onto ONE input
//                      accessor the clip's channels share; a channel holding one value the whole
//                      clip keeps two keys [0, duration] on a second shared input. Rotations are
//                      sampled with slerp, the way three.js plays them, and kept sign-continuous.
//                      Never thin the frames: these clips carry deliberate one-frame snaps (up to
//                      86 degrees in a 1/60 s frame), and 30 keys a second moved the blade
//                      contacts by two frames.
//   animEncoder()      the meshopt encoder with the animation filter precision chosen
//                      (gltf-transform fixes the quaternion filter at 16 bits): 13-bit rotations
//                      are under 0.03 degrees and half a millimetre at the blade tip.
//   leanAnimJson()     drops JSON members that only restate a glTF default, applied where the
//                      build rewrites the JSON anyway.
import { Accessor, Root } from '@gltf-transform/core';
import { createTransform } from '@gltf-transform/functions';

const COMPONENTS = { rotation: 4, translation: 3, scale: 3 };

const NORMALIZED_DIVISOR = {
  [Accessor.ComponentType.BYTE]: 127,
  [Accessor.ComponentType.SHORT]: 32767,
  [Accessor.ComponentType.UNSIGNED_BYTE]: 255,
  [Accessor.ComponentType.UNSIGNED_SHORT]: 65535,
};

/** An accessor's values as floats (normalized integers divided out). */
function floats(accessor) {
  const a = accessor.getArray();
  if (a instanceof Float32Array) return a;
  const out = new Float32Array(a.length);
  const div = accessor.getNormalized() ? (NORMALIZED_DIVISOR[accessor.getComponentType()] ?? 1) : 1;
  for (let i = 0; i < a.length; i++) out[i] = a[i] / div;
  return out;
}

/** Spherical interpolation of two quaternions into out[o..o+3] (the shorter way round). */
function slerp(out, o, a, ia, b, ib, t) {
  const x0 = a[ia];
  const y0 = a[ia + 1];
  const z0 = a[ia + 2];
  const w0 = a[ia + 3];
  let x1 = b[ib];
  let y1 = b[ib + 1];
  let z1 = b[ib + 2];
  let w1 = b[ib + 3];
  let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
  if (dot < 0) {
    x1 = -x1;
    y1 = -y1;
    z1 = -z1;
    w1 = -w1;
    dot = -dot;
  }
  let s = 1 - t;
  let u = t;
  if (dot < 0.9995) {
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    s = Math.sin(s * theta) / sin;
    u = Math.sin(u * theta) / sin;
  }
  const x = x0 * s + x1 * u;
  const y = y0 * s + y1 * u;
  const z = z0 * s + z1 * u;
  const w = w0 * s + w1 * u;
  const l = Math.hypot(x, y, z, w) || 1;
  out[o] = x / l;
  out[o + 1] = y / l;
  out[o + 2] = z / l;
  out[o + 3] = w / l;
}

/** One sampler evaluated at time `t` (LINEAR or STEP) into out[o..o+n-1]. */
export function evaluateSampler(times, values, n, interpolation, isRotation, t, out, o) {
  const last = times.length - 1;
  if (t < times[0] || last === 0) {
    for (let k = 0; k < n; k++) out[o + k] = values[k];
    return;
  }
  if (t >= times[last]) {
    for (let k = 0; k < n; k++) out[o + k] = values[last * n + k];
    return;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  if (interpolation === 'STEP') {
    for (let k = 0; k < n; k++) out[o + k] = values[lo * n + k];
    return;
  }
  const u = (t - times[lo]) / (times[hi] - times[lo]);
  if (isRotation) slerp(out, o, values, lo * 4, values, hi * 4, u);
  else
    for (let k = 0; k < n; k++) out[o + k] = values[lo * n + k] * (1 - u) + values[hi * n + k] * u;
}

/** ceil(duration x fps) equal intervals ending exactly on the clip's last key (a float32
 *  duration such as 1.6000000238 must not become one interval more). */
export function frameGrid(duration, fps) {
  const n = Math.max(1, Math.ceil(duration * fps - 1e-3));
  const times = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) times[i] = (duration * i) / n;
  times[n] = duration;
  return times;
}

/** The gltf-transform step (see the header). Morph-weight channels are left as they are. */
export function uniformTimeline({ fps = 60 } = {}) {
  return createTransform('uniformTimeline', (doc) => {
    const root = doc.getRoot();
    const buffer = root.listBuffers()[0];
    for (const anim of root.listAnimations()) {
      const paths = new Map();
      for (const ch of anim.listChannels()) paths.set(ch.getSampler(), ch.getTargetPath());
      let duration = 0;
      for (const s of anim.listSamplers())
        duration = Math.max(duration, s.getInput().getMax([])[0]);
      const grid = frameGrid(duration, fps);
      let gridInput = null;
      let pairInput = null;
      for (const sampler of anim.listSamplers()) {
        const path = paths.get(sampler);
        const n = COMPONENTS[path];
        if (!n) continue;
        const isRotation = path === 'rotation';
        const input = sampler.getInput();
        const output = sampler.getOutput();
        const times = floats(input);
        const values = floats(output);
        let constant = true;
        for (let i = n; i < values.length && constant; i++) {
          if (values[i] !== values[i % n]) constant = false;
        }
        const at = constant ? Float32Array.of(0, duration) : grid;
        const out = new Float32Array(at.length * n);
        for (let i = 0; i < at.length; i++) {
          evaluateSampler(
            times,
            values,
            n,
            sampler.getInterpolation(),
            isRotation,
            at[i],
            out,
            i * n,
          );
          if (!isRotation || i === 0) continue;
          const p = (i - 1) * 4;
          const q = i * 4;
          const dot =
            out[p] * out[q] +
            out[p + 1] * out[q + 1] +
            out[p + 2] * out[q + 2] +
            out[p + 3] * out[q + 3];
          if (dot < 0) for (let k = 0; k < 4; k++) out[q + k] = -out[q + k];
        }
        if (constant) {
          pairInput ??= doc.createAccessor().setType('SCALAR').setArray(at).setBuffer(buffer);
        } else {
          gridInput ??= doc.createAccessor().setType('SCALAR').setArray(at).setBuffer(buffer);
        }
        sampler
          .setInput(constant ? pairInput : gridInput)
          .setOutput(doc.createAccessor().setType(output.getType()).setArray(out).setBuffer(buffer))
          .setInterpolation('LINEAR');
        for (const old of [input, output]) {
          if (!old.listParents().some((p) => !(p instanceof Root))) old.dispose();
        }
      }
    }
  });
}

/** The meshopt encoder with the chosen animation filter precision: register it on the IO that
 *  writes the library (`'meshopt.encoder': animEncoder(MeshoptEncoder)`). */
export function animEncoder(MeshoptEncoder, quatBits = 13, expBits = 16) {
  const encoder = Object.create(MeshoptEncoder);
  encoder.encodeFilterQuat = (src, count, stride) =>
    MeshoptEncoder.encodeFilterQuat(src, count, stride, quatBits);
  encoder.encodeFilterExp = (src, count, stride, _bits, mode) =>
    MeshoptEncoder.encodeFilterExp(src, count, stride, expBits, mode);
  return encoder;
}

/** JSON members that only restate a glTF default (accessor `normalized: false` and
 *  `byteOffset: 0`, bufferView `byteOffset: 0`, sampler `interpolation: 'LINEAR'`), dropped in
 *  place. Returns the same object. */
export function leanAnimJson(json) {
  for (const a of json.accessors ?? []) {
    if (a.normalized === false) delete a.normalized;
    if (a.byteOffset === 0) delete a.byteOffset;
  }
  for (const v of json.bufferViews ?? []) if (v.byteOffset === 0) delete v.byteOffset;
  for (const an of json.animations ?? []) {
    for (const s of an.samplers ?? []) if (s.interpolation === 'LINEAR') delete s.interpolation;
  }
  return json;
}
