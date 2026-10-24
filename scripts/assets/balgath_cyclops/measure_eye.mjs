// The Barrowglass in the Head bone's own frame (the VisualDef eyeGlow.offset the
// renderer hangs the eye glow and the ward reticle on), measured off the exported
// GLB's rest pose rather than guessed.
//
//   node scripts/assets/balgath_cyclops/measure_eye.mjs <balgath.glb> [eyeX eyeY eyeZ]
//
// The eye centre is given in Blender coordinates (anatomy.py EYE, +Z up, facing -Y);
// glTF is +Y up, facing +Z, so (x, y, z) becomes (x, z, -y). Also prints the bone's
// world scale, the factor that turns a bone-local radius into yards at rest.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [file, ex = '0', ey = '-2.02', ez = '12.72'] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const head = doc
  .getRoot()
  .listNodes()
  .find((n) => n.getName() === 'Head');
if (!head) throw new Error('no Head bone');
const m = head.getWorldMatrix();
// invert the 4x4 (column-major) world matrix
const inv = (a) => {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d,
    (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d,
    (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d,
    (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d,
    (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d,
    (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d,
    (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d,
    (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d,
    (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
};
const im = inv(m);
const p = [Number(ex), Number(ez), -Number(ey)];
const local = [0, 1, 2].map((i) => im[i] * p[0] + im[4 + i] * p[1] + im[8 + i] * p[2] + im[12 + i]);
const scale = Math.hypot(m[0], m[1], m[2]);
console.log(
  'EYE_LOCAL',
  local.map((v) => v.toFixed(4)).join(', '),
  'HEAD_WORLD_SCALE',
  scale.toFixed(4),
);
