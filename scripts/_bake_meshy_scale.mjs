// Bake the Meshy rig's centimeter scale into a meters/unit-scale GLB.
//
// Meshy rig exports use an Armature root with scale 0.01 over centimeter-space
// bones, geometry, inverse bind matrices, and animation translation tracks.
// The KayKit/Quaternius assets this game's character pipeline is tuned for are
// meter-space with unit node scales, and src/render/characters/assets.ts's
// normalize measurement disagrees with the GPU skinning path about that 0.01
// (the visual renders ~100x too small). Baking the scale away makes every code
// path agree by construction: uniform scale commutes with rotations, so scaling
// all node translations, vertex positions, IBM translation parts, and animation
// translation outputs by S while zeroing the armature scale is exact.
//
//   node scripts/_bake_meshy_scale.mjs <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: node scripts/_bake_meshy_scale.mjs <in.glb> <out.glb>');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();

// Find the scaled armature root (uniform, non-unit scale).
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const armature = scene.listChildren().find((n) => {
  const s = n.getScale();
  return Math.abs(s[0] - 1) > 1e-6 && Math.abs(s[0] - s[1]) < 1e-9 && Math.abs(s[0] - s[2]) < 1e-9;
});
if (!armature) {
  console.log('no uniformly scaled root node found, nothing to bake');
  process.exit(0);
}
const S = armature.getScale()[0];
console.log(`baking scale ${S} from node "${armature.getName()}"`);
armature.setScale([1, 1, 1]);
armature.setTranslation(armature.getTranslation().map((v) => v));

// 1. Every node translation in the subtree scales by S.
const scaleNode = (node) => {
  node.setTranslation(node.getTranslation().map((v) => v * S));
  for (const c of node.listChildren()) scaleNode(c);
};
for (const c of armature.listChildren()) scaleNode(c);

// 2. Vertex positions (and morph target positions) scale by S.
const seen = new Set();
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (pos && !seen.has(pos)) {
      seen.add(pos);
      const arr = pos.getArray().slice();
      for (let i = 0; i < arr.length; i++) arr[i] *= S;
      pos.setArray(arr);
    }
    for (const target of prim.listTargets()) {
      const tpos = target.getAttribute('POSITION');
      if (tpos && !seen.has(tpos)) {
        seen.add(tpos);
        const arr = tpos.getArray().slice();
        for (let i = 0; i < arr.length; i++) arr[i] *= S;
        tpos.setArray(arr);
      }
    }
  }
}

// 3. Inverse bind matrices: translation components (rows 12-14) scale by S.
for (const skin of root.listSkins()) {
  const ibm = skin.getInverseBindMatrices();
  if (!ibm || seen.has(ibm)) continue;
  seen.add(ibm);
  const arr = ibm.getArray().slice();
  for (let m = 0; m < arr.length; m += 16) {
    arr[m + 12] *= S;
    arr[m + 13] *= S;
    arr[m + 14] *= S;
  }
  ibm.setArray(arr);
}

// 4. Animation translation outputs scale by S; rotation/scale tracks untouched.
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    if (ch.getTargetPath() !== 'translation') continue;
    const out = ch.getSampler().getOutput();
    if (seen.has(out)) continue;
    seen.add(out);
    const arr = out.getArray().slice();
    for (let i = 0; i < arr.length; i++) arr[i] *= S;
    out.setArray(arr);
  }
}

// 5. Rebind to the conventional layout the game's character pipeline expects
// (KayKit-style: IBM = inverse(joint bind world), O(1) values, vertices in
// bind-world space). After steps 1-4 the file is VALID glTF but carries the
// old 100x factor inside the IBMs' 3x3 block (vertices meters, IBMs 100x),
// which plain three renders fine but confuses downstream tooling. Bake the
// current skinning at bind pose into the vertices, then recompute each IBM
// from the meter-space node hierarchy.
const m4 = {
  mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  },
  // general 4x4 inverse (column-major), enough for TRS matrices
  invert(m) {
    const inv = new Array(16);
    inv[0] =
      m[5] * m[10] * m[15] -
      m[5] * m[11] * m[14] -
      m[9] * m[6] * m[15] +
      m[9] * m[7] * m[14] +
      m[13] * m[6] * m[11] -
      m[13] * m[7] * m[10];
    inv[4] =
      -m[4] * m[10] * m[15] +
      m[4] * m[11] * m[14] +
      m[8] * m[6] * m[15] -
      m[8] * m[7] * m[14] -
      m[12] * m[6] * m[11] +
      m[12] * m[7] * m[10];
    inv[8] =
      m[4] * m[9] * m[15] -
      m[4] * m[11] * m[13] -
      m[8] * m[5] * m[15] +
      m[8] * m[7] * m[13] +
      m[12] * m[5] * m[11] -
      m[12] * m[7] * m[9];
    inv[12] =
      -m[4] * m[9] * m[14] +
      m[4] * m[10] * m[13] +
      m[8] * m[5] * m[14] -
      m[8] * m[6] * m[13] -
      m[12] * m[5] * m[10] +
      m[12] * m[6] * m[9];
    inv[1] =
      -m[1] * m[10] * m[15] +
      m[1] * m[11] * m[14] +
      m[9] * m[2] * m[15] -
      m[9] * m[3] * m[14] -
      m[13] * m[2] * m[11] +
      m[13] * m[3] * m[10];
    inv[5] =
      m[0] * m[10] * m[15] -
      m[0] * m[11] * m[14] -
      m[8] * m[2] * m[15] +
      m[8] * m[3] * m[14] +
      m[12] * m[2] * m[11] -
      m[12] * m[3] * m[10];
    inv[9] =
      -m[0] * m[9] * m[15] +
      m[0] * m[11] * m[13] +
      m[8] * m[1] * m[15] -
      m[8] * m[3] * m[13] -
      m[12] * m[1] * m[11] +
      m[12] * m[3] * m[9];
    inv[13] =
      m[0] * m[9] * m[14] -
      m[0] * m[10] * m[13] -
      m[8] * m[1] * m[14] +
      m[8] * m[2] * m[13] +
      m[12] * m[1] * m[10] -
      m[12] * m[2] * m[9];
    inv[2] =
      m[1] * m[6] * m[15] -
      m[1] * m[7] * m[14] -
      m[5] * m[2] * m[15] +
      m[5] * m[3] * m[14] +
      m[13] * m[2] * m[7] -
      m[13] * m[3] * m[6];
    inv[6] =
      -m[0] * m[6] * m[15] +
      m[0] * m[7] * m[14] +
      m[4] * m[2] * m[15] -
      m[4] * m[3] * m[14] -
      m[12] * m[2] * m[7] +
      m[12] * m[3] * m[6];
    inv[10] =
      m[0] * m[5] * m[15] -
      m[0] * m[7] * m[13] -
      m[4] * m[1] * m[15] +
      m[4] * m[3] * m[13] +
      m[12] * m[1] * m[7] -
      m[12] * m[3] * m[5];
    inv[14] =
      -m[0] * m[5] * m[14] +
      m[0] * m[6] * m[13] +
      m[4] * m[1] * m[14] -
      m[4] * m[2] * m[13] -
      m[12] * m[1] * m[6] +
      m[12] * m[2] * m[5];
    inv[3] =
      -m[1] * m[6] * m[11] +
      m[1] * m[7] * m[10] +
      m[5] * m[2] * m[11] -
      m[5] * m[3] * m[10] -
      m[9] * m[2] * m[7] +
      m[9] * m[3] * m[6];
    inv[7] =
      m[0] * m[6] * m[11] -
      m[0] * m[7] * m[10] -
      m[4] * m[2] * m[11] +
      m[4] * m[3] * m[10] +
      m[8] * m[2] * m[7] -
      m[8] * m[3] * m[6];
    inv[11] =
      -m[0] * m[5] * m[11] +
      m[0] * m[7] * m[9] +
      m[4] * m[1] * m[11] -
      m[4] * m[3] * m[9] -
      m[8] * m[1] * m[7] +
      m[8] * m[3] * m[5];
    inv[15] =
      m[0] * m[5] * m[10] -
      m[0] * m[6] * m[9] -
      m[4] * m[1] * m[10] +
      m[4] * m[2] * m[9] +
      m[8] * m[1] * m[6] -
      m[8] * m[2] * m[5];
    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    det = 1 / det;
    return inv.map((v) => v * det);
  },
  fromTRS(t, q, s) {
    const [x, y, z, w] = q;
    const x2 = x + x,
      y2 = y + y,
      z2 = z + z;
    const xx = x * x2,
      xy = x * y2,
      xz = x * z2;
    const yy = y * y2,
      yz = y * z2,
      zz = z * z2;
    const wx = w * x2,
      wy = w * y2,
      wz = w * z2;
    return [
      (1 - (yy + zz)) * s[0],
      (xy + wz) * s[0],
      (xz - wy) * s[0],
      0,
      (xy - wz) * s[1],
      (1 - (xx + zz)) * s[1],
      (yz + wx) * s[1],
      0,
      (xz + wy) * s[2],
      (yz - wx) * s[2],
      (1 - (yy + xx)) * s[2],
      0,
      t[0],
      t[1],
      t[2],
      1,
    ];
  },
  point(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  },
  dir(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
    ];
  },
};

function worldMatrix(node) {
  let m = m4.fromTRS(node.getTranslation(), node.getRotation(), node.getScale());
  // gltf-transform: parents via listParents; walk Node parents only
  let p = node.listParents().find((x) => x.propertyType === 'Node') ?? null;
  while (p) {
    m = m4.mul(m4.fromTRS(p.getTranslation(), p.getRotation(), p.getScale()), m);
    p = p.listParents().find((x) => x.propertyType === 'Node') ?? null;
  }
  return m;
}

for (const skin of root.listSkins()) {
  const joints = skin.listJoints();
  const jointWorld = joints.map((j) => worldMatrix(j));
  const ibmAcc = skin.getInverseBindMatrices();
  const old = ibmAcc.getArray();
  const oldIbm = joints.map((_, j) => Array.from(old.slice(j * 16, j * 16 + 16)));
  const skinMat = joints.map((_, j) => m4.mul(jointWorld[j], oldIbm[j]));

  // find the mesh primitives using this skin and LBS-bake their vertices
  for (const node of root.listNodes()) {
    if (node.getSkin() !== skin || !node.getMesh()) continue;
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nrm = prim.getAttribute('NORMAL');
      const ji = prim.getAttribute('JOINTS_0');
      const wt = prim.getAttribute('WEIGHTS_0');
      if (!pos || !ji || !wt) continue;
      const pArr = pos.getArray().slice();
      const nArr = nrm ? nrm.getArray().slice() : null;
      const j4 = [0, 0, 0, 0];
      const w4 = [0, 0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        ji.getElement(i, j4);
        wt.getElement(i, w4);
        const p = [pArr[i * 3], pArr[i * 3 + 1], pArr[i * 3 + 2]];
        const outP = [0, 0, 0];
        const n = nArr ? [nArr[i * 3], nArr[i * 3 + 1], nArr[i * 3 + 2]] : null;
        const outN = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
          const w = w4[k];
          if (w === 0) continue;
          const sm = skinMat[j4[k]];
          const tp = m4.point(sm, p);
          outP[0] += tp[0] * w;
          outP[1] += tp[1] * w;
          outP[2] += tp[2] * w;
          if (n) {
            const tn = m4.dir(sm, n);
            outN[0] += tn[0] * w;
            outN[1] += tn[1] * w;
            outN[2] += tn[2] * w;
          }
        }
        pArr[i * 3] = outP[0];
        pArr[i * 3 + 1] = outP[1];
        pArr[i * 3 + 2] = outP[2];
        if (nArr) {
          const l = Math.hypot(outN[0], outN[1], outN[2]) || 1;
          nArr[i * 3] = outN[0] / l;
          nArr[i * 3 + 1] = outN[1] / l;
          nArr[i * 3 + 2] = outN[2] / l;
        }
      }
      pos.setArray(pArr);
      if (nrm && nArr) nrm.setArray(nArr);
    }
  }

  // conventional IBMs: inverse of the joint's bind world matrix
  const fresh = new Float32Array(joints.length * 16);
  joints.forEach((_, j) => {
    fresh.set(m4.invert(jointWorld[j]), j * 16);
  });
  ibmAcc.setArray(fresh);
  console.log(`rebound skin: ${joints.length} joints, IBMs recomputed from the node tree`);
}

await io.write(outPath, doc);
console.log(`wrote ${outPath}`);
