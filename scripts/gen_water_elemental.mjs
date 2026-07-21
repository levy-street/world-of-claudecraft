// Generate the Frost mage's Water Elemental as a translucent animated GLB.
// The body is layered water, foam and glow. Gold cuffs are its only solid parts.
// Node-transform clips keep the asset lightweight and compatible with CharacterVisual.
//
//   node scripts/gen_water_elemental.mjs

import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import {
  KHRMaterialsIOR,
  KHRMaterialsTransmission,
  KHRMaterialsVolume,
} from '@gltf-transform/extensions';

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');
const transmissionExtension = doc.createExtension(KHRMaterialsTransmission);
const volumeExtension = doc.createExtension(KHRMaterialsVolume);
const iorExtension = doc.createExtension(KHRMaterialsIOR);

const waterMaterial = (name, color, alpha, emissive, roughness = 0.16) =>
  doc
    .createMaterial(name)
    .setBaseColorFactor([...color, alpha])
    .setEmissiveFactor(emissive)
    .setRoughnessFactor(roughness)
    .setMetallicFactor(0)
    .setAlphaMode('BLEND')
    .setDoubleSided(true);

const physicalWaterMaterial = (name, color, transmission, attenuation, emissive) => {
  const material = doc
    .createMaterial(name)
    .setBaseColorFactor([...color, 1])
    .setEmissiveFactor(emissive)
    .setRoughnessFactor(0.08)
    .setMetallicFactor(0)
    .setDoubleSided(true);
  material.setExtension(
    'KHR_materials_transmission',
    transmissionExtension.createTransmission().setTransmissionFactor(transmission),
  );
  material.setExtension(
    'KHR_materials_volume',
    volumeExtension
      .createVolume()
      .setThicknessFactor(0.24)
      .setAttenuationDistance(4.5)
      .setAttenuationColor(attenuation),
  );
  material.setExtension('KHR_materials_ior', iorExtension.createIOR().setIOR(1.333));
  return material;
};

const water = physicalWaterMaterial(
  'living_water',
  [0.2, 0.68, 0.9],
  0.9,
  [0.14, 0.7, 0.94],
  [0.008, 0.07, 0.12],
);
const deepWater = physicalWaterMaterial(
  'deep_water',
  [0.02, 0.2, 0.42],
  0.72,
  [0.03, 0.36, 0.66],
  [0.002, 0.018, 0.05],
);
const foam = waterMaterial('foam', [0.7, 0.96, 1], 0.3, [0.04, 0.16, 0.24], 0.1);
const glow = waterMaterial('water_core', [0.42, 0.94, 1], 0.92, [0.3, 0.85, 1], 0.08);
const gold = doc
  .createMaterial('enchanted_gold')
  .setBaseColorFactor([0.92, 0.63, 0.12, 1])
  .setEmissiveFactor([0.08, 0.035, 0])
  .setRoughnessFactor(0.28)
  .setMetallicFactor(0.72)
  .setDoubleSided(true);
const gem = waterMaterial('cuff_gem', [0.05, 0.42, 0.72], 0.95, [0.05, 0.4, 0.8], 0.08);

function primitive(pos, nrm, idx) {
  return doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer),
    )
    .setIndices(
      doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer),
    );
}

function ellipsoid(rx, ry, rz, segments = 18, rings = 12) {
  const pos = [];
  const nrm = [];
  const idx = [];
  for (let i = 0; i <= rings; i++) {
    const theta = (i / rings) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let j = 0; j <= segments; j++) {
      const phi = (j / segments) * Math.PI * 2;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      const x = st * cp * rx;
      const y = ct * ry;
      const z = st * sp * rz;
      pos.push(x, y, z);
      const nx = x / (rx * rx);
      const ny = y / (ry * ry);
      const nz = z / (rz * rz);
      const length = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / length, ny / length, nz / length);
    }
  }
  const stride = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return primitive(pos, nrm, idx);
}

function frustum(r0, r1, height, segments = 16) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const slope = Math.atan2(r0 - r1, height);
  const ny = Math.sin(slope);
  const nr = Math.cos(slope);
  for (let j = 0; j <= segments; j++) {
    const phi = (j / segments) * Math.PI * 2;
    const x = Math.cos(phi);
    const z = Math.sin(phi);
    pos.push(x * r0, 0, z * r0, x * r1, height, z * r1);
    nrm.push(x * nr, ny, z * nr, x * nr, ny, z * nr);
  }
  for (let j = 0; j < segments; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return primitive(pos, nrm, idx);
}

function torus(radius, tube, segments = 24, tubeSegments = 10) {
  const pos = [];
  const nrm = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= tubeSegments; j++) {
      const v = (j / tubeSegments) * Math.PI * 2;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      pos.push((radius + tube * cv) * cu, tube * sv, (radius + tube * cv) * su);
      nrm.push(cv * cu, sv, cv * su);
    }
  }
  const stride = tubeSegments + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < tubeSegments; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return primitive(pos, nrm, idx);
}

let meshIndex = 0;
function part(name, shape, material, translation = [0, 0, 0], rotation = null) {
  shape.setMaterial(material);
  const mesh = doc.createMesh(`${name}_${meshIndex++}`).addPrimitive(shape);
  const node = doc.createNode(name).setMesh(mesh).setTranslation(translation);
  if (rotation) node.setRotation(rotation);
  return node;
}

function group(name, translation = [0, 0, 0], rotation = null) {
  const node = doc.createNode(name).setTranslation(translation);
  if (rotation) node.setRotation(rotation);
  return node;
}

const qx = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
const qz = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

function quatY(direction) {
  const length = Math.hypot(...direction) || 1;
  const d = direction.map((value) => value / length);
  if (d[1] > 0.9999) return [0, 0, 0, 1];
  if (d[1] < -0.9999) return [1, 0, 0, 0];
  const axis = [d[2], 0, -d[0]];
  const axisLength = Math.hypot(...axis);
  const angle = Math.acos(d[1]);
  const s = Math.sin(angle / 2);
  return [(axis[0] / axisLength) * s, 0, (axis[2] / axisLength) * s, Math.cos(angle / 2)];
}

function waterBone(name, start, end, r0, r1, material = water) {
  const direction = end.map((value, i) => value - start[i]);
  const length = Math.hypot(...direction);
  return part(name, frustum(r0, r1, length), material, start, quatY(direction));
}

const root = group('WaterElemental');
const pose = group('pose');
const body = group('body');
scene.addChild(root);
root.addChild(pose);
pose.addChild(body);

// A tapering lower body and overlapping current rings remove any hint of legs.
body.addChild(part('vortex', frustum(0.12, 0.58, 0.92), deepWater, [0, 0.1, 0]));
body.addChild(part('vortex_shell', frustum(0.08, 0.66, 0.82), water, [0, 0.18, 0]));
const swirl = group('swirl');
body.addChild(swirl);
swirl.addChild(part('swirl_low', torus(0.36, 0.085), foam, [0, 0.16, 0], qx(0.08)));
swirl.addChild(part('swirl_mid', torus(0.48, 0.065), water, [0, 0.34, 0], qx(-0.12)));
swirl.addChild(part('swirl_high', torus(0.54, 0.05), foam, [0, 0.58, 0], qx(0.1)));

// Layered torso: a dark core beneath a translucent outer water mass.
body.addChild(part('torso_core', ellipsoid(0.48, 0.66, 0.4), deepWater, [0, 1.22, 0]));
body.addChild(part('torso_water', ellipsoid(0.68, 0.75, 0.5), water, [0, 1.28, 0]));
body.addChild(part('shoulder_foam_l', ellipsoid(0.24, 0.08, 0.27), foam, [0.54, 1.7, 0]));
body.addChild(part('shoulder_foam_r', ellipsoid(0.24, 0.08, 0.27), foam, [-0.54, 1.7, 0]));
for (const side of [-1, 1]) {
  body.addChild(
    part(
      'shoulder_splash',
      frustum(0.11, 0, 0.42),
      water,
      [side * 0.57, 1.72, 0],
      qz(side * -0.68),
    ),
  );
  body.addChild(
    part(
      'shoulder_splash_foam',
      frustum(0.065, 0, 0.28),
      foam,
      [side * 0.48, 1.76, 0.13],
      qz(side * -0.34),
    ),
  );
}

const head = group('head', [0, 1.92, 0.02]);
body.addChild(head);
head.addChild(part('head_core', ellipsoid(0.3, 0.3, 0.27), deepWater));
head.addChild(part('head_water', ellipsoid(0.4, 0.35, 0.33), water));
head.addChild(part('brow', ellipsoid(0.22, 0.055, 0.07), foam, [0, 0.075, 0.31]));
head.addChild(part('eye_l', ellipsoid(0.055, 0.06, 0.035, 12, 8), glow, [0.14, 0.02, 0.31]));
head.addChild(part('eye_r', ellipsoid(0.055, 0.06, 0.035, 12, 8), glow, [-0.14, 0.02, 0.31]));
for (const [x, y, tilt] of [
  [0, 0.28, 0],
  [0.2, 0.2, -0.38],
  [-0.2, 0.2, 0.38],
]) {
  head.addChild(part('crest', frustum(0.1, 0, 0.34), foam, [x, y, 0], qz(tilt)));
}

function arm(side) {
  const armRoot = group(side > 0 ? 'arm_l' : 'arm_r', [side * 0.5, 1.65, 0]);
  body.addChild(armRoot);
  const elbow = [side * 0.38, -0.24, 0.02];
  const wrist = [side * 0.68, -0.5, 0.13];
  armRoot.addChild(waterBone('upper_arm', [0, 0, 0], elbow, 0.24, 0.2));
  armRoot.addChild(part('elbow_foam', ellipsoid(0.24, 0.22, 0.24), foam, elbow));
  armRoot.addChild(waterBone('forearm', elbow, wrist, 0.25, 0.18));
  const direction = wrist.map((value, i) => value - elbow[i]);
  armRoot.addChild(part('cuff', torus(0.22, 0.065), gold, wrist, quatY(direction)));
  armRoot.addChild(
    part('cuff_gem', ellipsoid(0.075, 0.045, 0.09), gem, [wrist[0], wrist[1], wrist[2] + 0.2]),
  );
  const palm = [side * 0.8, -0.64, 0.2];
  armRoot.addChild(part('hand', ellipsoid(0.3, 0.24, 0.24), water, palm));
  armRoot.addChild(
    part('hand_foam', ellipsoid(0.26, 0.09, 0.2), foam, [palm[0], palm[1] - 0.13, palm[2]]),
  );
  for (let finger = -1; finger <= 1; finger++) {
    const start = [palm[0] + side * 0.12, palm[1] - 0.06, palm[2] + finger * 0.09];
    const end = [
      palm[0] + side * (0.3 + 0.04 * (1 - Math.abs(finger))),
      palm[1] - 0.18,
      palm[2] + finger * 0.13,
    ];
    armRoot.addChild(waterBone('finger', start, end, 0.055, 0.01, foam));
  }
  return armRoot;
}

const armL = arm(1);
const armR = arm(-1);

// A few solid bubbles reinforce water without relying on particles or textures.
for (const [x, y, z, radius] of [
  [0.72, 1.95, -0.1, 0.07],
  [-0.78, 1.78, 0.08, 0.055],
  [0.48, 0.88, 0.35, 0.045],
  [-0.4, 1.08, -0.36, 0.06],
]) {
  body.addChild(part('bubble', ellipsoid(radius, radius, radius, 10, 7), foam, [x, y, z]));
}

function track(animation, node, path, times, values) {
  const input = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Float32Array(times))
    .setBuffer(buffer);
  const output = doc
    .createAccessor()
    .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
    .setArray(new Float32Array(values.flat()))
    .setBuffer(buffer);
  const sampler = doc
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation('LINEAR');
  animation
    .addSampler(sampler)
    .addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
    );
}

const clip = (name) => doc.createAnimation(name);

{
  const animation = clip('Idle');
  track(
    animation,
    body,
    'translation',
    [0, 1.2, 2.4],
    [
      [0, 0, 0],
      [0, 0.07, 0],
      [0, 0, 0],
    ],
  );
  track(
    animation,
    body,
    'scale',
    [0, 1.2, 2.4],
    [
      [1, 1, 1],
      [1.03, 0.97, 1.03],
      [1, 1, 1],
    ],
  );
  track(animation, swirl, 'rotation', [0, 1.2, 2.4], [qz(0), qz(0.16), qz(0)]);
  track(animation, armL, 'rotation', [0, 1.2, 2.4], [qz(0.05), qz(-0.08), qz(0.05)]);
  track(animation, armR, 'rotation', [0, 1.2, 2.4], [qz(-0.05), qz(0.08), qz(-0.05)]);
}

{
  const animation = clip('Move');
  track(
    animation,
    body,
    'translation',
    [0, 0.45, 0.9],
    [
      [0, 0, 0],
      [0, 0.1, 0.04],
      [0, 0, 0],
    ],
  );
  track(
    animation,
    body,
    'scale',
    [0, 0.45, 0.9],
    [
      [1, 1, 1],
      [0.96, 1.06, 0.96],
      [1, 1, 1],
    ],
  );
  track(animation, swirl, 'rotation', [0, 0.45, 0.9], [qz(0), qz(0.38), qz(0)]);
  track(animation, armL, 'rotation', [0, 0.45, 0.9], [qz(0.08), qz(-0.16), qz(0.08)]);
  track(animation, armR, 'rotation', [0, 0.45, 0.9], [qz(-0.08), qz(0.16), qz(-0.08)]);
}

{
  const animation = clip('Cast');
  track(animation, armL, 'rotation', [0, 0.22, 0.52, 0.78], [qz(0), qz(0.5), qz(-0.28), qz(0)]);
  track(animation, armR, 'rotation', [0, 0.22, 0.52, 0.78], [qz(0), qz(-0.5), qz(0.28), qz(0)]);
  track(
    animation,
    body,
    'scale',
    [0, 0.3, 0.78],
    [
      [1, 1, 1],
      [1.08, 1.08, 1.08],
      [1, 1, 1],
    ],
  );
  track(animation, head, 'rotation', [0, 0.3, 0.78], [qx(0), qx(-0.18), qx(0)]);
}

// Water Jet's held channel pose is intentionally separate from the short
// Waterbolt cast above. Both arms stay projected toward the victim for the
// entire looping clip, with a small pressure recoil instead of returning to
// idle after each pulse.
{
  const animation = clip('Channel');
  track(animation, armL, 'rotation', [0, 0.5, 1], [qx(-1.02), qx(-1.16), qx(-1.02)]);
  track(animation, armR, 'rotation', [0, 0.5, 1], [qx(-1.02), qx(-1.16), qx(-1.02)]);
  track(
    animation,
    body,
    'translation',
    [0, 0.5, 1],
    [
      [0, 0, 0.04],
      [0, -0.025, 0.11],
      [0, 0, 0.04],
    ],
  );
  track(
    animation,
    body,
    'scale',
    [0, 0.5, 1],
    [
      [1.03, 0.98, 1.05],
      [1.1, 0.94, 1.12],
      [1.03, 0.98, 1.05],
    ],
  );
  track(animation, head, 'rotation', [0, 0.5, 1], [qx(-0.13), qx(-0.2), qx(-0.13)]);
  track(animation, swirl, 'rotation', [0, 0.5, 1], [qz(-0.14), qz(0.22), qz(-0.14)]);
}

{
  const animation = clip('Hit');
  track(
    animation,
    pose,
    'translation',
    [0, 0.12, 0.35],
    [
      [0, 0, 0],
      [0, -0.08, -0.1],
      [0, 0, 0],
    ],
  );
  track(
    animation,
    pose,
    'scale',
    [0, 0.12, 0.35],
    [
      [1, 1, 1],
      [1.12, 0.83, 1.12],
      [1, 1, 1],
    ],
  );
}

{
  const animation = clip('Death');
  track(
    animation,
    pose,
    'translation',
    [0, 0.5, 1.1],
    [
      [0, 0, 0],
      [0, -0.25, 0],
      [0, -0.75, 0],
    ],
  );
  track(
    animation,
    pose,
    'scale',
    [0, 0.5, 1.1],
    [
      [1, 1, 1],
      [1.22, 0.68, 1.22],
      [0.08, 0.04, 0.08],
    ],
  );
  track(animation, swirl, 'rotation', [0, 0.5, 1.1], [qz(0), qz(0.7), qz(1.5)]);
}

const glb = await new NodeIO()
  .registerExtensions([KHRMaterialsTransmission, KHRMaterialsVolume, KHRMaterialsIOR])
  .writeBinary(doc);
const output = 'public/models/creatures/water_elemental.glb';
fs.writeFileSync(output, glb);
console.log(
  `wrote ${output} (${(glb.length / 1024).toFixed(1)} KB, ${doc.getRoot().listAnimations().length} clips)`,
);
