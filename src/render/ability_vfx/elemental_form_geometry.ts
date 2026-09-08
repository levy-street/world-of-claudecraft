import * as THREE from 'three';
import type { ElementalForm } from './elemental_performance_core';

const TAU = Math.PI * 2;
type Point = [number, number, number];

/** Sculpted pieces retain their own origin and departure vector, allowing ice
 * to grow, hold and fracture instead of scaling a static crown as one object. */
export function buildElementalForm(kind: ElementalForm, detailed: boolean): THREE.BufferGeometry {
  const p: number[] = [],
    uv: number[] = [],
    centers: number[] = [],
    pieces: number[] = [],
    indices: number[] = [];
  let piece = 0;
  function surface(
    rows: number,
    sides: number,
    center: Point,
    sample: (u: number, v: number) => Point,
    delay = 0,
  ) {
    const start = p.length / 3,
      seed = (piece++ * 0.61803398875) % 1;
    for (let r = 0; r <= rows; r++)
      for (let s = 0; s <= sides; s++) {
        const u = r / rows,
          v = s / sides,
          at = sample(u, v);
        p.push(...at);
        uv.push(u, v);
        centers.push(...center);
        pieces.push(seed, delay, u);
        if (r < rows && s < sides) {
          const a = start + r * (sides + 1) + s;
          indices.push(a, a + sides + 1, a + 1, a + 1, a + sides + 1, a + sides + 2);
        }
      }
  }
  function tube(path: (t: number) => Point, radius: (t: number) => number, delay = 0, sides = 6) {
    const center = path(0);
    surface(
      detailed ? 36 : 16,
      sides,
      center,
      (u, v) => {
        const a = path(u),
          b = path(Math.min(1, u + 0.001)),
          prev = path(Math.max(0, u - 0.001));
        const direction = new THREE.Vector3(
          b[0] - prev[0],
          b[1] - prev[1],
          b[2] - prev[2],
        ).normalize();
        const side = new THREE.Vector3()
          .crossVectors(
            direction,
            Math.abs(direction.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0),
          )
          .normalize();
        const up = new THREE.Vector3().crossVectors(side, direction).normalize();
        const theta = v * TAU,
          r = radius(u);
        return [
          a[0] + (side.x * Math.cos(theta) + up.x * Math.sin(theta)) * r,
          a[1] + (side.y * Math.cos(theta) + up.y * Math.sin(theta)) * r,
          a[2] + (side.z * Math.cos(theta) + up.z * Math.sin(theta)) * r,
        ];
      },
      delay,
    );
  }
  const count = detailed ? 11 : 5;
  if (kind === 'glacier' || kind === 'fault') {
    for (let k = 0; k < count; k++) {
      const a = k * 2.399963,
        r = 0.52 + (k % 3) * 0.32,
        h = 0.85 + ((k * 7) % 9) * 0.14;
      const center: Point = [Math.cos(a) * r, 0, Math.sin(a) * r];
      surface(
        3,
        5,
        center,
        (u, v) => {
          const width = (u < 0.67 ? 0.2 + u * 0.08 : (1 - u) * 0.77) * (kind === 'fault' ? 1.6 : 1);
          const theta = v * TAU + k * 0.7;
          return [
            center[0] + Math.cos(theta) * width + Math.cos(a) * u * 0.45,
            u * h * (kind === 'fault' ? 0.47 : 1),
            center[2] + Math.sin(theta) * width + Math.sin(a) * u * 0.45,
          ];
        },
        (k % 3) * 0.038,
      );
    }
  } else if (kind === 'thunder') {
    for (let k = 0; k < (detailed ? 7 : 3); k++) {
      const a = k * 2.399963;
      tube(
        (t) => {
          const jitter = Math.sin(t * 91 + k) * Math.sin(t * 41 + k * 3) * 0.18;
          const r = t * (k % 2 ? 1.8 : 1.2);
          return [
            Math.cos(a) * r + jitter,
            (1 - t) * (k % 2 ? 0.8 : 3.1) + Math.sin(t * Math.PI) * 0.4,
            Math.sin(a) * r + jitter * 0.7,
          ];
        },
        (t) => 0.026 * (1 - t * 0.72),
        k * 0.006,
        4,
      );
      if (detailed)
        for (let j = 0; j < 2; j++) {
          const y = 1.65 - j * 0.68;
          tube(
            (t) => [
              Math.cos(a + 0.6) * t * 0.95,
              y * (1 - t) + Math.sin(t * 63 + k) * 0.1,
              Math.sin(a + 0.6) * t * 0.95,
            ],
            (t) => 0.012 * (1 - t * 0.8),
            0.02,
            4,
          );
        }
    }
  } else if (kind === 'judgement') {
    for (let k = 0; k < (detailed ? 5 : 3); k++) {
      const a = (k * TAU) / (detailed ? 5 : 3);
      tube(
        (t) => {
          const across = (t * 2 - 1) * 0.8,
            r = 1.05;
          return [
            Math.cos(a) * r + Math.sin(a) * across,
            0.18 + (1 - Math.abs(2 * t - 1) ** 0.8) * 2.7,
            Math.sin(a) * r - Math.cos(a) * across,
          ];
        },
        (t) => 0.038 + Math.sin(t * Math.PI) * 0.018,
        k * 0.028,
        4,
      );
      if (detailed)
        tube(
          (t) => [Math.cos(a) * (0.4 + t * 0.3), 0.3 + t * 3.1, Math.sin(a) * (0.4 + t * 0.3)],
          (t) => Math.sin(t * Math.PI) * 0.018,
          0.1,
          4,
        );
    }
  } else if (kind === 'rift') {
    // Three torn, differently inclined rims describe a vertical aperture.
    for (let k = 0; k < (detailed ? 7 : 3); k++) {
      tube(
        (t) => {
          const a = t * TAU * 0.86 + k * 2.399963,
            r = 0.88 + k * 0.075;
          return [
            Math.cos(a) * r,
            1.25 + Math.sin(a) * r * 1.4,
            Math.sin(t * Math.PI) * (k % 2 ? 0.42 : -0.38),
          ];
        },
        (t) => Math.sin(t * Math.PI) * (k < 3 ? 0.065 : 0.025),
        k * 0.02,
      );
    }
    surface(
      20,
      40,
      [0, 1.25, 0],
      (u, v) => [
        Math.cos(v * TAU) * u * 0.94,
        1.25 + Math.sin(v * TAU) * u * 1.31,
        -0.24 * (1 - u * u),
      ],
      0.035,
    );
  } else if (kind === 'tide' || kind === 'grove') {
    for (let k = 0; k < (detailed ? 7 : 3); k++) {
      const a = k * 2.399963;
      tube(
        (t) => {
          const r = 0.9 * (1 - t * 0.76),
            theta = a + t * Math.PI * 1.35;
          return [Math.cos(theta) * r, t * (1.8 + (k % 3) * 0.24), Math.sin(theta) * r];
        },
        (t) => (kind === 'tide' ? 0.1 : 0.045) * Math.sin(t * Math.PI) + 0.012,
        k * 0.025,
        8,
      );
      for (let j = 0; j < (detailed ? 3 : 1); j++) {
        const a1 = a + j * 0.7,
          center: Point = [Math.cos(a1) * 0.65, 0.45 + j * 0.52, Math.sin(a1) * 0.65];
        surface(
          8,
          8,
          center,
          (u, v) => {
            const theta = v * TAU,
              rr = Math.sin(u * Math.PI) * (kind === 'tide' ? 0.075 : 0.14);
            return [
              center[0] + rr * Math.cos(theta),
              center[1] + (u - 0.5) * (kind === 'tide' ? 0.17 : 0.32),
              center[2] + rr * Math.sin(theta),
            ];
          },
          j * 0.03,
        );
      }
    }
  } else {
    for (let k = 0; k < (detailed ? 9 : 4); k++) {
      const a = k * 2.399963;
      tube(
        (t) => {
          const r = 0.25 + Math.sin(t * Math.PI * 0.8) * (0.75 + (k % 3) * 0.2),
            theta = a + t * 1.9;
          return [Math.cos(theta) * r, 0.08 + t * (1.6 + (k % 3) * 0.3), Math.sin(theta) * r];
        },
        (t) => Math.sin(t * Math.PI) * 0.19 * (1 - t * 0.4),
        k * 0.012,
        8,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('aCenter', new THREE.Float32BufferAttribute(centers, 3));
  geometry.setAttribute('aPiece', new THREE.Float32BufferAttribute(pieces, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
