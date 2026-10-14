// GENERATES src/render/prop_natural_size.generated.ts, the world-space size of
// every PROP_ASSET_DEFS model at scale 1.
//
// props.ts draws decorProps at the model's OWN units (propAsset bakes the def's
// yaw into the geometry and applies the record's `scale` on top), while the
// editor's placement pipeline normalizes a catalogue GLB to
// targetHeightFor(path) first. Promoting a decorProp to a placement therefore
// needs the natural size to convert between the two, without it a flower bed
// promoted from the world lands at a different size than the game draws.
//
// The bbox is computed from the GLB itself: POSITION accessor min/max per
// primitive, walked through the node hierarchy with each node's transform, so
// authored node scaling counts exactly as three.js applies it.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The { key: url } table, read out of props.ts rather than duplicated here. */
function propAssetUrls() {
  const src = readFileSync(path.join(root, 'src/render/props.ts'), 'utf8');
  const start = src.indexOf('export const PROP_ASSET_DEFS');
  if (start < 0) throw new Error('PROP_ASSET_DEFS not found in src/render/props.ts');
  // Walk to the closing brace of the object literal.
  const i = src.indexOf('{', start);
  let depth = 0;
  let end = i;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(i, end + 1);
  const out = new Map();
  const re = /(\w+)\s*:\s*\{[^}]*?url:\s*'([^']+)'/g;
  let m = re.exec(body);
  while (m) {
    out.set(m[1], m[2]);
    m = re.exec(body);
  }
  return out;
}

// KHR_mesh_quantization: a normalized integer accessor stores positions as
// fractions of the component's range, and the node's scale carries the real
// size. Without dividing here every model reads as tens of thousands of yards.
const NORMALIZED_DIVISOR = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let offset = 12;
  let json = null;
  while (offset < view.byteLength) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a)
      json = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + start, len).toString('utf8'));
    offset = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('no JSON chunk');
  return json;
}

// --- tiny 4x4 column-major matrix helpers (three.js convention) -------------
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function composeTRS(node) {
  if (node.matrix) return [...node.matrix];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function applyPoint(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function modelSize(json) {
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const expand = (p) => {
    for (let i = 0; i < 3; i++) {
      box.min[i] = Math.min(box.min[i], p[i]);
      box.max[i] = Math.max(box.max[i], p[i]);
    }
  };
  const visit = (nodeIndex, parent) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const world = multiply(parent, composeTRS(node));
    const mesh = node.mesh !== undefined ? json.meshes?.[node.mesh] : null;
    for (const prim of mesh?.primitives ?? []) {
      const accessor = json.accessors?.[prim.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      const divisor = accessor.normalized ? (NORMALIZED_DIVISOR[accessor.componentType] ?? 1) : 1;
      const deq = (v) => (divisor === 1 ? v : Math.max(v / divisor, -1));
      const [x0, y0, z0] = accessor.min.map(deq);
      const [x1, y1, z1] = accessor.max.map(deq);
      for (const corner of [
        [x0, y0, z0],
        [x1, y0, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y1, z0],
        [x1, y0, z1],
        [x0, y1, z1],
        [x1, y1, z1],
      ]) {
        expand(applyPoint(world, corner));
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const scene of json.scenes ?? []) for (const n of scene.nodes ?? []) visit(n, identity());
  if (!Number.isFinite(box.min[0])) return null;
  const round = (v) => Number(v.toFixed(4));
  return {
    x: round(Math.max(1e-4, box.max[0] - box.min[0])),
    y: round(Math.max(1e-4, box.max[1] - box.min[1])),
    z: round(Math.max(1e-4, box.max[2] - box.min[2])),
  };
}

const urls = propAssetUrls();
const sizes = {};
const missing = [];
for (const [key, url] of [...urls].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const file = path.join(root, 'public', url.replace(/^\//, ''));
  try {
    const size = modelSize(parseGlb(readFileSync(file)));
    if (size) sizes[key] = size;
    else missing.push(`${key} (no positions)`);
  } catch (err) {
    missing.push(`${key} (${String(err.message ?? err)})`);
  }
}

const lines = [
  '// GENERATED by scripts/gen_prop_natural_size.mjs - do not edit by hand.',
  '// The world-space bounding size of every PROP_ASSET_DEFS model at scale 1.',
  '//',
  "// props.ts draws a decorProp at the model's own units; the editor's placement",
  '// pipeline normalizes a catalogue GLB to targetHeightFor(path) first. This is',
  '// the conversion between them, so a world prop promoted to an editable',
  '// placement lands at the size the game draws it.',
  '',
  'export interface PropNaturalSize {',
  '  x: number;',
  '  y: number;',
  '  z: number;',
  '}',
  '',
  'export const PROP_NATURAL_SIZE: Readonly<Record<string, PropNaturalSize>> = {',
  ...Object.entries(sizes).map(
    ([key, s]) =>
      `  ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: { x: ${s.x}, y: ${s.y}, z: ${s.z} },`,
  ),
  '};',
  '',
];
writeFileSync(path.join(root, 'src/render/prop_natural_size.generated.ts'), lines.join('\n'));
console.log(
  `wrote src/render/prop_natural_size.generated.ts (${Object.keys(sizes).length} models)`,
);
if (missing.length > 0) console.log(`skipped ${missing.length}: ${missing.slice(0, 8).join(', ')}`);
