// Group a segmented armor set's micro-parts into the 5 armor slots WITHOUT
// moving anything (the generated set is already in worn arrangement), merging
// each slot into one primitive textured with the ORIGINAL unsegmented model's
// atlas (segmentation preserves the shared UV layout). Output feeds rig-manual.
//
// Classification happens in the set's own T-pose frame after a yaw to face +Z:
// helm = top band, arms = x-extreme parts on the arm line, shoulders = above
// the arm line beside the neck, legs = lower body, torso = the rest.
//
// Usage: node merge_slots.mjs <parts.glb> <raw.glb> <out_rig_input.glb> [yawDeg]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [partsPath, rawPath, outPath, yawDegArg] = process.argv.slice(2);
const yawRad = ((Number(yawDegArg ?? 0) || 0) * Math.PI) / 180;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const applyM = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

const doc = await io.read(partsPath);
const raw = await io.read(rawPath);

// world-space parts, yawed to face +Z
const parts = [];
{
  const w = new Map();
  const worldOf = (node) => {
    if (w.has(node)) return w.get(node);
    const parent = node.getParentNode?.();
    const m = parent ? mul(worldOf(parent), node.getMatrix()) : node.getMatrix();
    w.set(node, m);
    return m;
  };
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      const nrmAcc = prim.getAttribute('NORMAL');
      const uvAcc = prim.getAttribute('TEXCOORD_0');
      const n = posAcc.getCount();
      const pos = new Float32Array(n * 3);
      const nrm = nrmAcc ? new Float32Array(n * 3) : null;
      const uv = uvAcc ? new Float32Array(n * 2) : null;
      const W = worldOf(node);
      const origin = applyM(W, [0, 0, 0]);
      const el = [0, 0, 0];
      const min = [1e9, 1e9, 1e9];
      const max = [-1e9, -1e9, -1e9];
      for (let v = 0; v < n; v++) {
        posAcc.getElement(v, el);
        const p = applyM(W, el);
        const x = p[0] * c + p[2] * s;
        const z = -p[0] * s + p[2] * c;
        pos.set([x, p[1], z], v * 3);
        for (let k = 0; k < 3; k++) {
          const val = pos[v * 3 + k];
          if (val < min[k]) min[k] = val;
          if (val > max[k]) max[k] = val;
        }
        if (nrm) {
          nrmAcc.getElement(v, el);
          const q = applyM(W, el);
          const r = [q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]];
          const xr = r[0] * c + r[2] * s;
          const zr = -r[0] * s + r[2] * c;
          const len = Math.hypot(xr, r[1], zr) || 1;
          nrm.set([xr / len, r[1] / len, zr / len], v * 3);
        }
        if (uv) {
          uvAcc.getElement(v, el);
          uv.set([el[0], el[1]], v * 2);
        }
      }
      const idxAcc = prim.getIndices();
      const indices = idxAcc ? Array.from(idxAcc.getArray()) : [...Array(n).keys()];
      const srcTex = prim.getMaterial()?.getBaseColorTexture();
      parts.push({
        pos,
        nrm,
        uv,
        indices,
        min,
        max,
        n,
        tex: srcTex ? { img: srcTex.getImage(), mime: srcTex.getMimeType() } : null,
      });
    }
  }
}
console.log(`${parts.length} parts read`);

// frame metrics
const U = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
for (const p of parts)
  for (let k = 0; k < 3; k++) {
    if (p.min[k] < U.min[k]) U.min[k] = p.min[k];
    if (p.max[k] > U.max[k]) U.max[k] = p.max[k];
  }
const H = U.max[1] - U.min[1];
const halfW = (U.max[0] - U.min[0]) / 2;
const cX = (U.min[0] + U.max[0]) / 2;
let armYSum = 0;
let armYN = 0;
for (const p of parts) {
  for (let v = 0; v < p.pos.length; v += 3) {
    if (Math.abs(p.pos[v] - cX) > 0.88 * halfW) {
      armYSum += p.pos[v + 1];
      armYN++;
    }
  }
}
const armY = armYSum / Math.max(1, armYN);
console.log(`H=${H.toFixed(2)} halfW=${halfW.toFixed(2)} armY=${((armY - U.min[1]) / H).toFixed(2)}H`);

function classify(p) {
  const cx = (p.min[0] + p.max[0]) / 2;
  const cy = (p.min[1] + p.max[1]) / 2;
  const relY = (cy - U.min[1]) / H;
  const relArmY = (armY - U.min[1]) / H;
  const xOff = Math.abs(cx - cX) / halfW;
  if (relY > relArmY + 0.13) return 'Helm';
  if (xOff > 0.5 && Math.abs(relY - relArmY) < 0.11) return 'Arms';
  if (relY > relArmY - 0.04 && xOff > 0.2) return 'Shoulders';
  if (relY < 0.42) return 'Legs';
  return 'Torso';
}
const slots = {};
for (const p of parts) (slots[classify(p)] ??= []).push(p);
for (const [slot, list] of Object.entries(slots)) {
  console.log(`${slot}: ${list.length} parts, ${list.reduce((s, p) => s + p.n, 0)} verts`);
}

// Output doc: one mesh per slot, one prim PER PART, each with its own material
// and texture (segmentation re-atlases per-part UVs, so a shared atlas cannot
// be used). A sidecar JSON records the prim order per slot so the rigged
// 'body' mesh can be split back into slot nodes after rig-manual.
const { Document } = await import('@gltf-transform/core');
const odoc = new Document();
const buffer = odoc.createBuffer();
const scene = odoc.createScene();
odoc.getRoot().setDefaultScene(scene);
const manifest = [];
for (const [slot, list] of Object.entries(slots)) {
  const mesh = odoc.createMesh(slot);
  let idx = 0;
  for (const p of list) {
    const mkAcc = (arr, type) =>
      odoc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
    const mat = odoc
      .createMaterial(`${slot}_${idx}`)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.85);
    if (p.tex) {
      const tex = odoc.createTexture(`${slot}_${idx}`).setImage(p.tex.img).setMimeType(p.tex.mime);
      mat.setBaseColorTexture(tex);
    }
    const prim = odoc
      .createPrimitive()
      .setMode(4)
      .setMaterial(mat)
      .setAttribute('POSITION', mkAcc(p.pos, 'VEC3'))
      .setAttribute('NORMAL', mkAcc(p.nrm ?? new Float32Array(p.n * 3), 'VEC3'))
      .setIndices(mkAcc(new Uint32Array(p.indices), 'SCALAR'));
    if (p.uv) prim.setAttribute('TEXCOORD_0', mkAcc(p.uv, 'VEC2'));
    mesh.addPrimitive(prim);
    manifest.push({ slot, verts: p.n });
    idx++;
  }
  const node = odoc.createNode(slot).setMesh(mesh);
  scene.addChild(node);
  console.log(`merged ${slot}: ${list.length} prims, ${list.reduce((s, p) => s + p.n, 0)} verts`);
}
await io.write(outPath, odoc);
const { writeFile } = await import('node:fs/promises');
await writeFile(outPath.replace(/\.glb$/, '.slots.json'), JSON.stringify(manifest));
console.log('wrote', outPath, 'and slot manifest');
