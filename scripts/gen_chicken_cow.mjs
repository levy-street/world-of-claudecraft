// Procedurally generate a low-poly "chicken cow" GLB for the druid Travel Form.
// Smooth-shaded ellipsoids / tapered "bones" (NOT boxes) to match the game's
// organic low-poly creatures (Quaternius bull/velociraptor). An elongated white
// cow body scattered with black spots, little horns and a pink udder, riding two
// jointed digitigrade chicken/raptor legs, with a red comb, orange beak, wattle,
// flappy wings and fanned tail feathers.
// Pure node-transform animation (no skinning): Idle/Walk/Run/Attack/Death/Jump.
//   node scripts/gen_chicken_cow.mjs
// Writes public/models/creatures/chicken_cow.glb. Re-run, then `npm run build`.
import { Document, NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');

const M = (name, rgb, rough = 0.9) =>
  doc.createMaterial(name).setBaseColorFactor([...rgb, 1]).setRoughnessFactor(rough)
    .setMetallicFactor(0).setDoubleSided(true);
const matBody = M('body', [0.93, 0.91, 0.85]);
const matSpot = M('spot', [0.16, 0.15, 0.17]);
const matUdder = M('udder', [0.94, 0.55, 0.61]);
const matBeak = M('beak', [0.95, 0.61, 0.12]);
const matLeg = M('leg', [0.94, 0.67, 0.16]);
const matHoof = M('hoof', [0.85, 0.58, 0.12]);
const matComb = M('comb', [0.84, 0.13, 0.13]);
const matHorn = M('horn', [0.80, 0.76, 0.68]);
const matEye = M('eye', [0.05, 0.05, 0.06]);
// Bright gold that reads even without strong reflections (lower metalness so it
// isn't dark in flat lighting); the in-game HDRI/bloom adds the shine.
const matGold = doc.createMaterial('gold').setBaseColorFactor([0.97, 0.80, 0.27, 1]).setRoughnessFactor(0.30).setMetallicFactor(0.45).setDoubleSided(true);
const matStrap = M('strap', [0.36, 0.22, 0.12], 0.85);

// ---- smooth-shaded primitives ----------------------------------------------
function ellipsoid(rx, ry, rz, seg = 14, ring = 10) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= ring; i++) {
    const theta = (i / ring) * Math.PI, st = Math.sin(theta), ct = Math.cos(theta);
    for (let j = 0; j <= seg; j++) {
      const phi = (j / seg) * 2 * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
      const px = st * cp * rx, py = ct * ry, pz = st * sp * rz;
      pos.push(px, py, pz);
      let ex = px / (rx * rx), ey = py / (ry * ry), ez = pz / (rz * rz);
      const L = Math.hypot(ex, ey, ez) || 1;
      nrm.push(ex / L, ey / L, ez / L);
    }
  }
  const s = seg + 1;
  for (let i = 0; i < ring; i++) for (let j = 0; j < seg; j++) {
    const a = i * s + j, b = a + 1, c = a + s, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return geo(pos, nrm, idx);
}
// Tapered cylinder / cone (r1=0) along +Y, base at y=0, smooth side normals.
function frustum(r0, r1, h, seg = 12) {
  const pos = [], nrm = [], idx = [];
  const slant = Math.atan2(r0 - r1, h), ny = Math.sin(slant), nr = Math.cos(slant);
  for (let j = 0; j <= seg; j++) {
    const phi = (j / seg) * 2 * Math.PI, cx = Math.cos(phi), cz = Math.sin(phi);
    pos.push(cx * r0, 0, cz * r0); nrm.push(cx * nr, ny, cz * nr);
    pos.push(cx * r1, h, cz * r1); nrm.push(cx * nr, ny, cz * nr);
  }
  for (let j = 0; j < seg; j++) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const cap = (y, r, dir) => {
    if (r <= 1e-4) return;
    const c = pos.length / 3; pos.push(0, y, 0); nrm.push(0, dir, 0);
    const rim = pos.length / 3;
    for (let j = 0; j <= seg; j++) { const phi = (j / seg) * 2 * Math.PI; pos.push(Math.cos(phi) * r, y, Math.sin(phi) * r); nrm.push(0, dir, 0); }
    for (let j = 0; j < seg; j++) dir < 0 ? idx.push(c, rim + j, rim + j + 1) : idx.push(c, rim + j + 1, rim + j);
  };
  cap(0, r0, -1); cap(h, r1, 1);
  return geo(pos, nrm, idx);
}
// Torus (ring in the XZ plane, around +Y), smooth normals. R=ring, r=tube.
function torus(R, r, segU = 18, segV = 9) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * 2 * Math.PI, cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * 2 * Math.PI, cv = Math.cos(v), sv = Math.sin(v);
      pos.push((R + r * cv) * cu, r * sv, (R + r * cv) * su);
      nrm.push(cv * cu, sv, cv * su);
    }
  }
  const s = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = i * s + j, b = a + 1, c = a + s, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return geo(pos, nrm, idx);
}
function geo(pos, nrm, idx) {
  return doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer));
}
let n = 0;
function part(name, prim, mat, t = [0, 0, 0], r = null) {
  prim.setMaterial(mat);
  const mesh = doc.createMesh(`${name}_${n++}`).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh).setTranslation(t);
  if (r) node.setRotation(r);
  return node;
}
const group = (name, t = [0, 0, 0], r = null) => { const g = doc.createNode(name).setTranslation(t); if (r) g.setRotation(r); return g; };
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
// quaternion rotating +Y onto unit dir
function quatY(d) {
  const dot = d[1];
  if (dot > 0.9999) return [0, 0, 0, 1];
  if (dot < -0.9999) return [1, 0, 0, 0];
  const ax = [d[2], 0, -d[0]]; const L = Math.hypot(ax[0], ax[1], ax[2]); // cross(Y,d)
  const a = Math.acos(dot), s = Math.sin(a / 2);
  return [ax[0] / L * s, ax[1] / L * s, ax[2] / L * s, Math.cos(a / 2)];
}
// A tapered "bone" frustum spanning p0->p1.
function bone(name, p0, p1, r0, r1, mat) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const u = [d[0] / len, d[1] / len, d[2] / len];
  const node = group(name, p0, quatY(u));
  node.addChild(part(name + '_m', frustum(r0, r1, len), mat, [0, 0, 0]));
  return node;
}

// ---- assemble ---------------------------------------------------------------
const root = group('ChickenCow'); scene.addChild(root);
const pose = group('pose'); root.addChild(pose);   // death/jump
const body = group('body'); pose.addChild(body);   // idle bob + waddle

// elongated cow torso (egg/barrel, not a ball) + scattered black spots
const BY = 1.00;
body.addChild(part('torso', ellipsoid(0.45, 0.42, 0.72), matBody, [0, BY, 0]));
const SPOTS = [
  [0.37, 1.10, 0.22, 0.13, 0.15], [0.32, 0.86, -0.30, 0.12, 0.13],
  [-0.36, 1.02, 0.06, 0.14, 0.16], [-0.30, 1.18, -0.24, 0.10, 0.12],
  [0.10, 1.36, -0.02, 0.13, 0.10], [0.06, 0.74, 0.40, 0.12, 0.13],
  [-0.12, 0.80, -0.46, 0.11, 0.12], [0.34, 1.06, -0.42, 0.10, 0.11],
  [-0.40, 0.92, -0.40, 0.09, 0.10],
];
for (const [x, y, z, rxz, ry] of SPOTS) body.addChild(part('spot', ellipsoid(rxz, ry, rxz, 10, 7), matSpot, [x, y, z]));

// udder + teats (rear underside)
body.addChild(part('udder', ellipsoid(0.18, 0.14, 0.20), matUdder, [0, 0.64, -0.20]));
for (const dx of [-0.08, 0.08]) for (const dz of [-0.07, 0.07])
  body.addChild(part('teat', frustum(0.035, 0.02, 0.09), matUdder, [dx, 0.50, -0.20 + dz]));

// wings (flap about z)
const wingL = group('wingL', [0.39, 1.08, 0.0]); body.addChild(wingL);
wingL.addChild(part('wingLm', ellipsoid(0.07, 0.22, 0.38), matBody, [0.04, -0.13, 0]));
const wingR = group('wingR', [-0.39, 1.08, 0.0]); body.addChild(wingR);
wingR.addChild(part('wingRm', ellipsoid(0.07, 0.22, 0.38), matBody, [-0.04, -0.13, 0]));

// fanned tail feathers
const tail = group('tail', [0, 1.10, -0.64], qx(0.8)); body.addChild(tail);
tail.addChild(part('tf0', ellipsoid(0.05, 0.03, 0.26), matBody, [0, 0.02, 0]));
tail.addChild(part('tfL', ellipsoid(0.045, 0.03, 0.22), matSpot, [0.12, 0, -0.02], qz(0.4)));
tail.addChild(part('tfR', ellipsoid(0.045, 0.03, 0.22), matSpot, [-0.12, 0, -0.02], qz(-0.4)));

// short neck -> head (peck/bob about x)
body.addChild(part('neck', frustum(0.18, 0.12, 0.32), matBody, [0, 1.00, 0.40], qx(0.95)));
const head = group('head', [0, 1.26, 0.60]); body.addChild(head);
head.addChild(part('skull', ellipsoid(0.21, 0.23, 0.24), matBody, [0, 0, 0]));
head.addChild(part('beak', frustum(0.09, 0.0, 0.24), matBeak, [0, -0.03, 0.16], qx(Math.PI / 2)));
head.addChild(part('wattle', ellipsoid(0.05, 0.09, 0.05), matComb, [0, -0.18, 0.16]));
for (const dz of [-0.10, 0, 0.10]) head.addChild(part('comb', ellipsoid(0.05, 0.11, 0.08), matComb, [0, 0.24, dz]));
head.addChild(part('eyeL', ellipsoid(0.045, 0.055, 0.035), matEye, [0.13, 0.05, 0.16]));
head.addChild(part('eyeR', ellipsoid(0.045, 0.055, 0.035), matEye, [-0.13, 0.05, 0.16]));
head.addChild(part('hornL', frustum(0.045, 0.0, 0.18), matHorn, [0.15, 0.17, -0.03], qz(-0.55)));
head.addChild(part('hornR', frustum(0.045, 0.0, 0.18), matHorn, [-0.15, 0.17, -0.03], qz(0.55)));

// classic cow collar + dangling gold bell, hung at the front of the chest where
// it clears the round body. Two leather straps rise over the shoulders to read
// as the collar; the bell is its own node so it jingles when moving.
const bell = group('bell', [0, 0.92, 0.70]); body.addChild(bell);
bell.addChild(bone('strapL', [0, 0.07, 0], [0.24, 0.26, -0.30], 0.024, 0.018, matStrap));
bell.addChild(bone('strapR', [0, 0.07, 0], [-0.24, 0.26, -0.30], 0.024, 0.018, matStrap));
bell.addChild(part('bellLoop', torus(0.024, 0.009, 12, 7), matGold, [0, 0.06, 0], qx(Math.PI / 2)));
bell.addChild(part('bellBody', frustum(0.085, 0.042, 0.155), matGold, [0, -0.13, 0]));
bell.addChild(part('bellRim', torus(0.082, 0.017, 16, 7), matGold, [0, -0.13, 0]));
bell.addChild(part('clapper', ellipsoid(0.022, 0.028, 0.022, 8, 6), matHorn, [0, -0.155, 0]));

// two jointed digitigrade legs (thigh -> shin -> tarsus -> foot), bull/raptor
// style: thick angled thigh, a backward knee bend, then forward to a hoofed foot.
// The whole leg swings about x at the hip for walk/run.
function leg(name, side) {
  const hip = group(name, [side * 0.15, 0.66, 0.02]); pose.addChild(hip);
  const knee = [0, -0.28, 0.12], ankle = [0, -0.50, -0.06], footEnd = [0, -0.66, 0.06];
  // thin, scaly chicken-stick legs: a slim drumstick mostly tucked into the belly,
  // then a stick-thin shank and ankle down to splayed thin toes (no chunky foot).
  hip.addChild(bone(`${name}_thigh`, [0, 0, 0], knee, 0.062, 0.042, matLeg));
  hip.addChild(bone(`${name}_shin`, knee, ankle, 0.038, 0.03, matLeg));
  hip.addChild(bone(`${name}_tarsus`, ankle, footEnd, 0.03, 0.026, matLeg));
  hip.addChild(part(`${name}_knee`, ellipsoid(0.04, 0.04, 0.04, 8, 6), matLeg, knee));
  hip.addChild(part(`${name}_ankle`, ellipsoid(0.032, 0.032, 0.032, 8, 6), matLeg, ankle));
  // three splayed front toes lying along the ground + a small back toe
  for (const [tx, tz] of [[-0.07, 0.0], [0, 0.02], [0.07, 0.0]])
    hip.addChild(part(`${name}_toe`, frustum(0.02, 0.0, 0.17), matHoof, [footEnd[0] + tx, footEnd[1] + 0.005, footEnd[2] + tz], qx(Math.PI / 2.1)));
  hip.addChild(part(`${name}_spur`, frustum(0.016, 0.0, 0.09), matHoof, [footEnd[0], footEnd[1] + 0.01, footEnd[2] - 0.09], qx(-Math.PI / 2.1)));
  return hip;
}
const legL = leg('legL', 1), legR = leg('legR', -1);

// ---- animation --------------------------------------------------------------
function track(anim, node, path, times, values, interp = 'LINEAR') {
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
  const output = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array(values.flat())).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(interp);
  anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
}
const clip = (name) => doc.createAnimation(name);

{ const a = clip('Idle');
  track(a, body, 'translation', [0, 1, 2], [[0, 0, 0], [0, 0.03, 0], [0, 0, 0]]);
  track(a, head, 'rotation', [0, 1, 2], [qx(0.04), qx(-0.05), qx(0.04)]);
  track(a, wingL, 'rotation', [0, 1, 2], [qz(0.04), qz(0.12), qz(0.04)]);
  track(a, wingR, 'rotation', [0, 1, 2], [qz(-0.04), qz(-0.12), qz(-0.04)]);
  track(a, bell, 'rotation', [0, 1, 2], [qx(0.03), qx(-0.05), qx(0.03)]); }
function gait(name, T, swing, bob, flap) {
  const a = clip(name), t = [0, T * 0.25, T * 0.5, T * 0.75, T];
  track(a, legL, 'rotation', t, [qx(0), qx(swing), qx(0), qx(-swing), qx(0)]);
  track(a, legR, 'rotation', t, [qx(0), qx(-swing), qx(0), qx(swing), qx(0)]);
  track(a, body, 'translation', t, [[0, 0, 0], [0, bob, 0], [0, 0, 0], [0, bob, 0], [0, 0, 0]]);
  track(a, body, 'rotation', t, [qz(0), qz(0.06), qz(0), qz(-0.06), qz(0)]);
  track(a, wingL, 'rotation', t, [qz(0.08), qz(0.08 + flap), qz(0.08), qz(0.08 + flap), qz(0.08)]);
  track(a, wingR, 'rotation', t, [qz(-0.08), qz(-0.08 - flap), qz(-0.08), qz(-0.08 - flap), qz(-0.08)]);
  track(a, head, 'rotation', t, [qx(0.05), qx(-0.02), qx(0.05), qx(-0.02), qx(0.05)]);
  track(a, bell, 'rotation', t, [qx(0.12), qx(-0.16), qx(0.12), qx(-0.16), qx(0.12)]); // jingle
}
gait('Walk', 0.7, 0.5, 0.04, 0.16);
gait('Run', 0.45, 0.85, 0.09, 0.45);
{ const a = clip('Attack');
  track(a, head, 'rotation', [0, 0.18, 0.4], [qx(0), qx(0.9), qx(0)]);
  track(a, body, 'translation', [0, 0.18, 0.4], [[0, 0, 0], [0, 0, 0.12], [0, 0, 0]]); }
{ const a = clip('Jump');
  track(a, pose, 'translation', [0, 0.15, 0.45, 0.7], [[0, 0, 0], [0, -0.08, 0], [0, 0.2, 0], [0, 0, 0]]);
  track(a, legL, 'rotation', [0, 0.45, 0.7], [qx(0), qx(0.9), qx(0)]);
  track(a, legR, 'rotation', [0, 0.45, 0.7], [qx(0), qx(0.9), qx(0)]); }
{ const a = clip('Death');
  track(a, pose, 'rotation', [0, 0.5, 1.0], [qx(0), qx(-0.9), qx(-1.5)]);
  track(a, pose, 'translation', [0, 0.5, 1.0], [[0, 0, 0], [0, -0.05, -0.1], [0, -0.2, -0.2]]);
  track(a, legL, 'rotation', [0, 1.0], [qx(0), qx(0.6)]);
  track(a, legR, 'rotation', [0, 1.0], [qx(0), qx(0.6)]); }

const glb = await new NodeIO().writeBinary(doc);
const out = 'public/models/creatures/chicken_cow.glb';
fs.writeFileSync(out, glb);
console.log(`wrote ${out} (${(glb.length / 1024).toFixed(1)} KB, ${doc.getRoot().listAnimations().length} clips)`);
