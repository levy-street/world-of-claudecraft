// The Masterless Strength's woken stars' procedural bodies (final_stars_fx.ts
// draws them): the Smith's great sword of ice a Crossing Blade flies, built
// once at the painter's construction. The guardian's own painted sword
// (quench_env_kit.ts Env_IceSword) lives in its lake's kit, landing late and
// on its room's materials; the Heart's flying blade is its own crisp
// faceted crystal, the same silhouette (a long diamond blade, a spiked
// guard, a wrapped grip, a pommel), so it costs no late kit upload in a
// live fight.
//
// Every piece is a spindle: stations along an axis, each a diamond (or a
// hexagon) of two half widths, faces flat-shaded (non-indexed, face
// normals) so the ice reads as cut crystal.

import * as THREE from 'three';

/** The blade's drawn length from its guard to its point (yards). */
export const ICE_SWORD_BLADE = 8.4;

interface Station {
  /** Along the axis. */
  at: number;
  /** Half widths across (a) and through (b) the piece. */
  a: number;
  b: number;
}

/** Push a spindle's faces into `out` (x, y, z triples): `sides` round, its
 *  axis `axis` ('y' up the blade, 'x' across it), at `offset`. */
function spindle(
  out: number[],
  stations: readonly Station[],
  sides: 4 | 6,
  axis: 'x' | 'y',
  offset: readonly [number, number, number] = [0, 0, 0],
): void {
  const ring = (s: Station): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2;
      const u = Math.cos(ang) * s.a;
      const v = Math.sin(ang) * s.b;
      pts.push(
        axis === 'y'
          ? [offset[0] + u, offset[1] + s.at, offset[2] + v]
          : [offset[0] + s.at, offset[1] + u, offset[2] + v],
      );
    }
    return pts;
  };
  const rings = stations.map(ring);
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    for (let k = 0; k < sides; k++) {
      const a = r0[k];
      const b = r0[(k + 1) % sides];
      const c = r1[(k + 1) % sides];
      const d = r1[k];
      out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
}

/** The great sword of ice, its guard at y 0, its blade up +y to its point
 *  (ICE_SWORD_BLADE), its grip and pommel below. Flat-shaded. */
export function iceSwordGeometry(): THREE.BufferGeometry {
  const L = ICE_SWORD_BLADE;
  const pos: number[] = [];
  // The blade: a long diamond, broad at the guard, a slight waist, then a
  // long point.
  spindle(
    pos,
    [
      { at: 0, a: 0.62, b: 0.15 },
      { at: L * 0.18, a: 0.58, b: 0.14 },
      { at: L * 0.5, a: 0.5, b: 0.13 },
      { at: L * 0.78, a: 0.44, b: 0.11 },
      { at: L * 0.92, a: 0.2, b: 0.06 },
      { at: L, a: 0.001, b: 0.001 },
    ],
    4,
    'y',
  );
  // The guard: a crystal bar across the blade, swept to points.
  spindle(
    pos,
    [
      { at: -1.9, a: 0.001, b: 0.001 },
      { at: -1.5, a: 0.24, b: 0.22 },
      { at: -0.4, a: 0.2, b: 0.3 },
      { at: 0, a: 0.28, b: 0.34 },
      { at: 0.4, a: 0.2, b: 0.3 },
      { at: 1.5, a: 0.24, b: 0.22 },
      { at: 1.9, a: 0.001, b: 0.001 },
    ],
    4,
    'x',
    [0, -0.1, 0],
  );
  // The grip and its pommel.
  spindle(
    pos,
    [
      { at: -0.2, a: 0.17, b: 0.17 },
      { at: -1.7, a: 0.15, b: 0.15 },
      { at: -1.85, a: 0.32, b: 0.32 },
      { at: -2.15, a: 0.36, b: 0.36 },
      { at: -2.5, a: 0.001, b: 0.001 },
    ],
    6,
    'y',
  );
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) {
    uv[i * 2] = pos[i * 3] * 0.5 + 0.5;
    uv[i * 2 + 1] = (pos[i * 3 + 1] + 2.5) / (L + 2.5);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
