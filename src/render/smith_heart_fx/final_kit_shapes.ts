// The Masterless Strength's quarter kits' sculpted bodies (final_kit_fx.ts
// builds and owns them; their shaders are final_kit_glsl.ts): built once,
// deterministic (no rng: every jitter is hashed), Three geometry only.
//
//   anvilStone     the great anvil of Weight of the Anvil, carved from one
//                  block: a side profile (stepped feet, a waisted body, a
//                  broad face, a long tapering horn, a squared heel)
//                  extruded with chamfered edges, its stone toned per vertex
//                  (darker at the feet, lighter on the face);
//   anvilCrystals  the gold crystals set into it (on the face, the heel and
//                  the flanks), one merged geometry;
//   shellStone     Stone Shell's granite: a broken ball of plates round a
//                  player;
//   iceCrust       Encased in Rime: a cluster of tall ice facets.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fxHash } from './hammer_fx_core';

/** The anvil's size (yards): its length along the horn, its height. */
export const ANVIL_SIZE = { length: 11, height: 7.1, depth: 4 } as const;

/** The chamfer's reach past the profile (yards): the stone is lifted by it
 *  so its feet stand on y = 0. */
const BEVEL = 0.35;

/** The anvil's side profile (x along the horn, y up), its feet on y = 0. */
function anvilProfile(): THREE.Shape {
  const s = new THREE.Shape();
  // The stepped feet.
  s.moveTo(-3.9, 0);
  s.lineTo(3.9, 0);
  s.lineTo(3.9, 0.55);
  s.lineTo(3.2, 0.8);
  // The waist, curving in and up to the face.
  s.quadraticCurveTo(1.5, 1.4, 1.7, 3.2);
  // The horn's underside sweeping out to its point.
  s.quadraticCurveTo(2.4, 4.0, 4.4, 4.35);
  s.quadraticCurveTo(6.2, 4.75, 7.0, 5.55);
  // The face, flat back to the heel.
  s.lineTo(4.6, 6.4);
  s.lineTo(-4.3, 6.4);
  // The squared heel and its undercut.
  s.lineTo(-4.3, 5.2);
  s.lineTo(-3.4, 4.8);
  s.quadraticCurveTo(-1.6, 4.3, -1.7, 3.2);
  // Back down the waist to the feet.
  s.quadraticCurveTo(-1.5, 1.4, -3.2, 0.8);
  s.lineTo(-3.9, 0.55);
  s.lineTo(-3.9, 0);
  return s;
}

/** The anvil's stone: the profile extruded with chamfers, centred on its
 *  footprint (its feet on y = 0), toned per vertex in a `color` attribute
 *  (its material reads vertex colours). */
export function anvilStone(): THREE.BufferGeometry {
  const depth = ANVIL_SIZE.depth - 0.8;
  const g = new THREE.ExtrudeGeometry(anvilProfile(), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.4,
    bevelSize: BEVEL,
    bevelSegments: 2,
    curveSegments: 10,
  });
  g.translate(-1.2, BEVEL, -depth / 2);
  const geo = g.toNonIndexed();
  g.dispose();
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  // Granite: grey-brown, darker and warmer at the feet, cooler and lighter
  // on the face; each facet a hashed shade so the chisel reads.
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const k = Math.max(0, Math.min(1, y / ANVIL_SIZE.height));
    const shade = 0.86 + fxHash(i, 41) * 0.22;
    // Dark granite under the Heart's bright light: it must read as a black
    // weight against the room, never a pale block.
    const r = (0.13 + 0.1 * k) * shade;
    const gg = (0.115 + 0.09 * k) * shade;
    const b = (0.1 + 0.085 * k) * shade;
    for (let j = 0; j < 3; j++) {
      colors[(i + j) * 3] = r;
      colors[(i + j) * 3 + 1] = gg;
      colors[(i + j) * 3 + 2] = b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Where the anvil's crystals sit (x, y, z, size, lean) on its stone. */
export const ANVIL_CRYSTALS: readonly (readonly [number, number, number, number, number])[] = [
  // A cluster breaking out of the face, behind the horn.
  [0.6, 6.5, 0.4, 1.3, 0.2],
  [1.3, 6.4, -0.5, 0.9, -0.35],
  [-0.2, 6.45, -0.3, 0.75, 0.5],
  // The heel's crown.
  [-4.6, 6.0, 0.9, 1.0, 0.6],
  [-4.8, 5.6, -0.8, 0.8, -0.5],
  // Shards on the flanks, bursting out of the waist.
  [0.3, 3.0, 2.3, 1.1, 1.2],
  [-0.8, 2.4, -2.3, 1.0, -1.1],
  [2.6, 1.0, 2.2, 0.7, 0.9],
  [-2.6, 1.1, -2.2, 0.7, -0.9],
];

/** The crystals, one merged geometry (elongated faceted shards). */
export function anvilCrystals(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  ANVIL_CRYSTALS.forEach(([x, y, z, size, lean], i) => {
    const shard = new THREE.OctahedronGeometry(0.5, 0);
    shard.scale(0.75, 2.8, 0.75);
    e.set(lean * 0.6, fxHash(i, 7) * Math.PI, lean * 0.5);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x - 1.2, y + BEVEL, z), q, new THREE.Vector3(size, size, size));
    shard.applyMatrix4(m);
    parts.push(shard.toNonIndexed());
    shard.dispose();
  });
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Stone Shell's granite: a ball of plates (an icosphere pushed in and out
 *  per vertex by a hash, faceted). */
export function shellStone(): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(1.3, 1);
  const geo = base.toNonIndexed();
  base.dispose();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // One hash per position (the same corner moves the same in every face).
    const k = fxHash(Math.round(v.x * 97 + v.y * 31), Math.round(v.z * 53)) * 0.22 - 0.06;
    v.multiplyScalar(1 + k);
    v.y = v.y * 1.15 + 1.2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Encased in Rime: a cluster of tall ice facets round a player. */
export function iceCrust(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const shards: readonly (readonly [number, number, number, number, number])[] = [
    [0, 1.4, 0, 1.0, 0],
    [0.7, 1.0, 0.3, 0.7, 0.4],
    [-0.6, 0.9, 0.5, 0.65, -0.45],
    [0.2, 0.8, -0.75, 0.6, 0.3],
    [-0.5, 0.7, -0.5, 0.55, -0.3],
  ];
  shards.forEach(([x, y, z, size, lean], i) => {
    const s = new THREE.OctahedronGeometry(1, 0);
    s.scale(0.75, 1.7, 0.75);
    e.set(lean * 0.5, fxHash(i, 13) * Math.PI, lean * 0.4);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(size, size, size));
    s.applyMatrix4(m);
    parts.push(s.toNonIndexed());
    s.dispose();
  });
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}
