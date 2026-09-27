import * as THREE from 'three';
import type { WarriorFuryStateKind } from '../warrior_fury_state_core';

/** Small sculpted ribbons, not replacement armor. These own different silhouettes:
 * ragged weapon flame, interlaced torso stitching and a split-edged blade echo. */
export function warriorFuryStateShape(kind: WarriorFuryStateKind): THREE.BufferGeometry {
  const pos: number[] = [],
    uv: number[] = [],
    col: number[] = [];
  const color = new THREE.Color();
  const tri = (a: number[], b: number[], c: number[], tint: number, v: number) => {
    color.setHex(tint);
    for (const p of [a, b, c]) {
      pos.push(...p);
      uv.push(p[0] * 0.6 + 0.5, p[1] * 0.6 + 0.5);
      col.push(color.r * v, color.g * v, color.b * v);
    }
  };
  const strip = (points: number[][], width: number, tint: number, ridgeSign = 1) => {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        u = i / (points.length - 1),
        v = (i + 1) / (points.length - 1);
      const wa = width * Math.max(0.12, Math.sin(u * Math.PI)),
        wb = width * Math.max(0.12, Math.sin(v * Math.PI));
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy) || 1;
      const ax = (-dy / length) * wa,
        ay = (dx / length) * wa,
        bx = (-dy / length) * wb,
        by = (dx / length) * wb;
      const leftA = [a[0] + ax, a[1] + ay, a[2]],
        leftB = [b[0] + bx, b[1] + by, b[2]];
      const rightA = [a[0] - ax, a[1] - ay, a[2]],
        rightB = [b[0] - bx, b[1] - by, b[2]];
      const ridgeA = [a[0], a[1], a[2] + ridgeSign * 0.022],
        ridgeB = [b[0], b[1], b[2] + ridgeSign * 0.022];
      tri(leftA, leftB, ridgeA, tint, 0.7);
      tri(leftB, ridgeB, ridgeA, tint, 0.9);
      tri(ridgeA, ridgeB, rightA, 0xffbcae, 1);
      tri(ridgeB, rightB, rightA, tint, 1);
    }
  };
  if (kind === 0) {
    for (let tongue = 0; tongue < 3; tongue++) {
      const points = Array.from({ length: 19 }, (_, i) => {
        const u = i / 18;
        return [
          (tongue - 1) * 0.1 + Math.sin(u * 7 + tongue) * u * 0.11,
          -0.55 + u * (tongue === 1 ? 1.6 : 1.16),
          0.075 + Math.sin(u * 5 + tongue) * 0.05,
        ];
      });
      strip(points, tongue === 1 ? 0.13 : 0.075, tongue === 1 ? 0xc72343 : 0x820e2b);
    }
  } else if (kind === 1) {
    // Stitch the front and back, leaving the chest centre and silhouette open.
    for (const side of [-1, 1])
      for (let rib = 0; rib < 3; rib++)
        for (const face of [-1, 1]) {
          const points = Array.from({ length: 13 }, (_, i) => {
            const u = i / 12;
            return [
              side * (0.055 + u * 0.325),
              -0.055 - rib * 0.095 - u * 0.075,
              face > 0 ? 0.47 - u * 0.1 : -0.43 - 0.025 * Math.sin(u * Math.PI),
            ];
          });
          strip(points, 0.045, 0xd82d4c, face);
        }
    // Six inward-facing suture clamps make the defensive ribs readable
    // beyond the armor silhouette. The fitted stitches remain intact.
    for (const side of [-1, 1])
      for (let rib = 0; rib < 3; rib++) {
        const y = -0.055 - rib * 0.12;
        const a = [side * 0.78, y - 0.002, -0.35];
        const b = [side * 1.06, y - 0.04, -0.6];
        const c = [side * 1.06, y - 0.04, -0.1];
        const ridge = [side * 0.94, y + 0.04, -0.35];
        tri(a, b, ridge, 0xd82d4c, 0.9);
        tri(b, c, ridge, 0xffd6ca, 1.3);
        tri(c, a, ridge, 0xa71332, 0.8);
      }
  } else {
    strip(
      [
        [-0.14, -0.23, 0],
        [-0.15, 0.09, 0.04],
        [0.02, 0.39, 0.035],
        [0.17, 0.55, 0],
      ],
      0.075,
      0x8d162f,
    );
    strip(
      [
        [-0.02, -0.18, 0.045],
        [0.045, 0.08, 0.045],
        [0.18, 0.28, 0.025],
      ],
      0.038,
      0xc8d5e3,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
