// GENERATES src/render/streetlamp_fixture.generated.ts — per-style fixture
// measurements in the SAME normalized space prepareStreetlampAsset
// (src/render/streetlamp_assets.ts) builds at runtime: height scaled to
// STREETLAMP_FIXTURE_HEIGHT, footprint clamped to MAX_FOOTPRINT, XZ centred on
// the full footprint, base at y=0.
//
// Why a build-time table: promoting streetlamps to editable placements needs
// each fixture's light AXIS (foot-of-post -> LIGHT_SOCKET, the direction
// lampFixtureYaw swings over the road) at document-creation time, which is
// synchronous — the runtime measurement only exists after the GLB loads. The
// socket and unitHeight ride along so the promoted night-light lane can anchor
// the road light without loading fixtures either.
//
// The vertex walk mirrors the runtime exactly: meshopt-compressed bufferviews
// are decoded with three's own MeshoptDecoder, KHR_mesh_quantization normalized
// ints divide by the component range (clamped at -1, three's getComponent
// contract), and every position runs through the node's world matrix.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from '../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors src/render/streetlamp_assets.ts (TARGET_HEIGHT reads
// STREETLAMP_FIXTURE_HEIGHT) and src/render/asset_scale.ts TARGET_HEIGHT.
const FIXTURE_HEIGHT = 5.5;
const MAX_FOOTPRINT = 2.0;
const FOOT_BAND = 0.12;
const PLACED_TARGET_HEIGHT = 2.2;

/** The { style: url } table, read out of streetlamp_assets.ts. */
function styleUrls() {
  const src = readFileSync(path.join(root, 'src/render/streetlamp_assets.ts'), 'utf8');
  const out = new Map();
  const re = /(\w+)\s*:\s*\{\s*\n\s*url:\s*'([^']+)'/g;
  let m = re.exec(src);
  while (m) {
    if (m[2].includes('/streetlamp_')) out.set(m[1], m[2]);
    m = re.exec(src);
  }
  if (out.size === 0) throw new Error('no streetlamp urls found in streetlamp_assets.ts');
  return out;
}

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < view.byteLength) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a)
      json = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + start, len).toString('utf8'));
    if (type === 0x004e4942)
      bin = new Uint8Array(bytes.buffer, bytes.byteOffset + start, len);
    offset = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new Error('missing GLB chunk');
  return { json, bin };
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

function applyPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

const COMPONENT = {
  5120: { size: 1, read: (dv, o) => dv.getInt8(o), divisor: 127 },
  5121: { size: 1, read: (dv, o) => dv.getUint8(o), divisor: 255 },
  5122: { size: 2, read: (dv, o) => dv.getInt16(o, true), divisor: 32767 },
  5123: { size: 2, read: (dv, o) => dv.getUint16(o, true), divisor: 65535 },
  5125: { size: 4, read: (dv, o) => dv.getUint32(o, true), divisor: 1 },
  5126: { size: 4, read: (dv, o) => dv.getFloat32(o, true), divisor: 1 },
};

/** Raw bytes of a bufferView, meshopt-decoded when the extension says so. */
function bufferViewBytes(json, bin, viewIndex) {
  const view = json.bufferViews[viewIndex];
  const compressed = view.extensions?.EXT_meshopt_compression;
  if (!compressed) {
    return {
      bytes: bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength),
      byteStride: view.byteStride,
    };
  }
  const target = new Uint8Array(compressed.count * compressed.byteStride);
  MeshoptDecoder.decodeGltfBuffer(
    target,
    compressed.count,
    compressed.byteStride,
    bin.subarray(
      compressed.byteOffset ?? 0,
      (compressed.byteOffset ?? 0) + compressed.byteLength,
    ),
    compressed.mode,
    compressed.filter,
  );
  return { bytes: target, byteStride: compressed.byteStride };
}

/** Every position of a VEC3 accessor, dequantized like three's getComponent. */
function readPositions(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const comp = COMPONENT[accessor.componentType];
  if (!comp || accessor.type !== 'VEC3') throw new Error('unsupported POSITION accessor');
  const { bytes, byteStride } = bufferViewBytes(json, bin, accessor.bufferView);
  const stride = byteStride ?? comp.size * 3;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = accessor.byteOffset ?? 0;
  const out = new Array(accessor.count);
  const deq = (v) => (accessor.normalized ? Math.max(v / comp.divisor, -1) : v);
  for (let i = 0; i < accessor.count; i++) {
    const o = base + i * stride;
    out[i] = [deq(comp.read(dv, o)), deq(comp.read(dv, o + comp.size)), deq(comp.read(dv, o + comp.size * 2))];
  }
  return out;
}

function measure(json, bin) {
  const verts = [];
  let socket = null;
  const visit = (nodeIndex, parent) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const world = multiply(parent, composeTRS(node));
    if (node.name === 'LIGHT_SOCKET' || node.extras?.woc_light_socket === true) {
      socket ??= applyPoint(world, 0, 0, 0);
    }
    const mesh = node.mesh !== undefined ? json.meshes?.[node.mesh] : null;
    for (const prim of mesh?.primitives ?? []) {
      if (prim.attributes?.POSITION === undefined) continue;
      for (const [x, y, z] of readPositions(json, bin, prim.attributes.POSITION)) {
        verts.push(applyPoint(world, x, y, z));
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const scene of json.scenes ?? []) for (const n of scene.nodes ?? []) visit(n, identity());
  if (verts.length === 0) throw new Error('no positions');

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  }
  const nativeHeight = max[1] - min[1];
  const nativeWidth = max[0] - min[0];
  const nativeDepth = max[2] - min[2];
  const uniform = FIXTURE_HEIGHT / nativeHeight;
  const radial = Math.min(
    1,
    MAX_FOOTPRINT / Math.max(nativeWidth * uniform, nativeDepth * uniform, 1e-4),
  );
  const centerX = (min[0] + max[0]) * 0.5;
  const centerZ = (min[2] + max[2]) * 0.5;
  const fx = (x) => (x - centerX) * uniform * radial;
  const fy = (y) => (y - min[1]) * uniform;
  const fz = (z) => (z - centerZ) * uniform * radial;

  // Foot band over the FINAL-space vertices, exactly like footprintCentre.
  const ceiling = FIXTURE_HEIGHT * FOOT_BAND;
  let footMinX = Infinity;
  let footMaxX = -Infinity;
  let footMinZ = Infinity;
  let footMaxZ = -Infinity;
  for (const [x, y, z] of verts) {
    if (fy(y) > ceiling) continue;
    const px = fx(x);
    const pz = fz(z);
    if (px < footMinX) footMinX = px;
    if (px > footMaxX) footMaxX = px;
    if (pz < footMinZ) footMinZ = pz;
    if (pz > footMaxZ) footMaxZ = pz;
  }
  const foot =
    footMinX > footMaxX
      ? [0, 0]
      : [(footMinX + footMaxX) * 0.5, (footMinZ + footMaxZ) * 0.5];

  // The socket is consumed by the PROMOTED night-light lane, where the fixture
  // is a plain placed GLB with no radial footprint clamp — so it lives in the
  // unclamped space (radial scales X and Z equally, so the axis DIRECTION the
  // clamped runtime resolves yaw from is identical either way).
  const socketFinal = socket
    ? [(socket[0] - centerX) * uniform, fy(socket[1]), (socket[2] - centerZ) * uniform]
    : null;
  const maxDim = Math.max(nativeWidth, nativeHeight, nativeDepth);
  return {
    socket: socketFinal,
    axis: socketFinal ? [socketFinal[0] - foot[0], socketFinal[2] - foot[1]] : [0, 0],
    // Rendered height of the raw GLB under the placed-asset rule
    // (targetHeightFor / largest dimension) at placement scale 1.
    unitHeight: nativeHeight * (PLACED_TARGET_HEIGHT / maxDim),
    radialClamped: radial < 1,
  };
}

await MeshoptDecoder.ready;
const rows = {};
for (const [style, url] of [...styleUrls()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const file = path.join(root, 'public', url.replace(/^\//, ''));
  const { json, bin } = parseGlb(readFileSync(file));
  const m = measure(json, bin);
  if (!m.socket) throw new Error(`${style}: no LIGHT_SOCKET`);
  if (m.radialClamped)
    console.log(`note: ${style} footprint radially clamped at runtime (promoted copy is wider)`);
  rows[style] = m;
}

const round = (v) => Number(v.toFixed(4));
const lines = [
  '// GENERATED by scripts/gen_streetlamp_fixture.mjs - do not edit by hand.',
  '// Per-style streetlamp fixture measurements in the normalized space',
  '// prepareStreetlampAsset builds at runtime (height 5.5, base at y=0, XZ',
  '// centred on the full footprint). `axis` is foot-of-post -> LIGHT_SOCKET in',
  '// XZ (what lampFixtureYaw swings over the road); `socket` is the authored',
  '// light anchor; `unitHeight` is the rendered height of the raw GLB under the',
  '// placed-asset normalization (targetHeightFor / largest dimension) at',
  '// placement scale 1, so a promoted placement can be scaled to match the',
  '// fixture height exactly.',
  '',
  'export interface StreetlampFixtureMeasure {',
  '  axis: readonly [number, number];',
  '  socket: readonly [number, number, number];',
  '  unitHeight: number;',
  '}',
  '',
  'export const STREETLAMP_FIXTURE: Readonly<Record<string, StreetlampFixtureMeasure>> = {',
  ...Object.entries(rows).map(
    ([style, m]) =>
      `  ${style}: { axis: [${round(m.axis[0])}, ${round(m.axis[1])}], socket: [${m.socket
        .map(round)
        .join(', ')}], unitHeight: ${round(m.unitHeight)} },`,
  ),
  '};',
  '',
];
writeFileSync(path.join(root, 'src/render/streetlamp_fixture.generated.ts'), lines.join('\n'));
console.log(
  `wrote src/render/streetlamp_fixture.generated.ts (${Object.keys(rows).length} styles)`,
);
