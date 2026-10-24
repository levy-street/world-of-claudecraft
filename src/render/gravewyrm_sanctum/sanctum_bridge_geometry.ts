// The frozen, front-facing walk over the chain bridge. Built with the gates
// before the interior compile gate; its height comes from the sim walkway.
import * as THREE from 'three';
import { CHAIN_BRIDGE_DECK, chainBridgeDeckAt, chainBridgeLength } from './sanctum_gates_core';
import { sanctumHash } from './sanctum_plan_core';
import type { Rgb } from './sanctum_shapes';

const CRUST_LIFT = 0.04;

export function chainBridgeCrustGeometry(): THREE.BufferGeometry {
  const L = chainBridgeLength();
  const cols = 64;
  const W = CHAIN_BRIDGE_DECK.crustHalfWidth;
  // Cross-section across x: (x, drop below the top).
  const prof: [number, number][] = [
    [-W - 0.7, 2.4],
    [-W - 0.4, 0.9],
    [-W, 0.12],
    [-W + 0.5, 0],
    [-0.8, 0],
    [0.8, 0],
    [W - 0.5, 0],
    [W, 0.12],
    [W + 0.4, 0.9],
    [W + 0.7, 2.4],
  ];
  const v: number[] = [];
  const c: number[] = [];
  const uv: number[] = [];
  const ring = (i: number): [number, number, number][] => {
    const s = (i / cols) * L;
    const p = chainBridgeDeckAt(s);
    const top = p.y + CRUST_LIFT;
    return prof.map(([x, drop], k) => {
      const lump = k === 0 || k === prof.length - 1 ? (sanctumHash(i, k) - 0.5) * 1.2 : 0;
      const side = k === 1 || k === prof.length - 2 ? (sanctumHash(i, k + 7) - 0.5) * 0.5 : 0;
      return [x + side * Math.sign(x), top - drop - lump, p.z];
    });
  };
  const colorAt = (i: number, k: number): Rgb => {
    // Real link tops show through the crust. Painting their colour into a
    // sparse ice ribbon interpolated iron across almost the entire walk,
    // making broad artificial stripes instead of a continuous frozen path.
    if (k <= 1 || k >= prof.length - 2) return [0.36, 0.56, 0.72];
    const n = sanctumHash(i * 3.1, k);
    return [0.67 + n * 0.05, 0.79 + n * 0.04, 0.9 + n * 0.03];
  };
  let prev = ring(0);
  for (let i = 1; i <= cols; i++) {
    const cur = ring(i);
    for (let k = 0; k < prof.length - 1; k++) {
      const quad = [prev[k], cur[k + 1], prev[k + 1], prev[k], cur[k], cur[k + 1]];
      const cols4 = [
        colorAt(i - 1, k),
        colorAt(i, k + 1),
        colorAt(i - 1, k + 1),
        colorAt(i - 1, k),
        colorAt(i, k),
        colorAt(i, k + 1),
      ];
      for (let q = 0; q < 6; q++) {
        v.push(...quad[q]);
        c.push(...cols4[q]);
        uv.push(quad[q][0] * 0.25, quad[q][2] * 0.25);
      }
    }
    prev = cur;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
