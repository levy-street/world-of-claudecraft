// Procedural shapes for the Sanctum's stand-ins and render-only scenery: the
// irregular faceted ice crystal (seracs, ice walls, shards, chunks), the
// weathered rock lump (moraine, slate, cairns), a wind-carved snow drift, a
// lofted ring solid (pillars, pyres, posts that must never read as a plain
// cylinder), and a chain link. Every shape comes painted (a colour attribute)
// so the kit's slot materials draw it as they draw the real pieces.
//
// Deterministic: every jitter is a hash of the seed (never Math.random).

import * as THREE from 'three';
import { sanctumHash, sanctumNoise } from './sanctum_plan_core';

export type Rgb = readonly [number, number, number];

function paint(g: THREE.BufferGeometry, color: (x: number, y: number, z: number) => Rgb): void {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = color(pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export interface CrystalOptions {
  /** Sides of the prism (6 to 14). */
  sides?: number;
  /** 0 a needle-pointed spire, 1 a flat-topped block. */
  boxy?: number;
  /** Radial jitter of the sides (0..0.5). */
  jitter?: number;
  /** Lean of the top (yards along x and z). */
  leanX?: number;
  leanZ?: number;
  /** Colours: the body at the foot, the body at the top, the facets' rime. */
  foot?: Rgb;
  top?: Rgb;
  rime?: Rgb;
}

/**
 * An irregular faceted ice crystal or serac, `w` by `d` at the foot and `h`
 * tall, standing on y 0: a jittered prism through five rings that pinches,
 * swells and leans, closed by a chiselled cap. Flat-shaded (each facet its
 * own normal), so it reads as cut ice, not a smooth primitive.
 */
export function iceCrystal(
  w: number,
  h: number,
  d: number,
  seed: number,
  opts: CrystalOptions = {},
): THREE.BufferGeometry {
  const sides = opts.sides ?? 9;
  const boxy = opts.boxy ?? 0.4;
  const jitter = opts.jitter ?? 0.22;
  const rings = [0, 0.22, 0.5, 0.78, 1];
  const pts: THREE.Vector3[][] = [];
  for (const [ri, t] of rings.entries()) {
    const ring: THREE.Vector3[] = [];
    // The top tapers toward a ridge or a point; boxy keeps it broad.
    const taper = 1 - t ** 1.6 * (1 - boxy) * 0.92;
    const swell = 1 + 0.12 * Math.sin(t * Math.PI) * (sanctumHash(seed, ri) - 0.3);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + (sanctumHash(seed + s, 3.1) - 0.5) * 0.35;
      const j = 1 + (sanctumHash(seed * 1.7 + s, ri * 0.7 + 5) - 0.5) * 2 * jitter;
      const rx = (w / 2) * taper * swell * j;
      const rz = (d / 2) * taper * swell * j;
      const y = t * h * (ri === rings.length - 1 ? 1 - 0.18 * sanctumHash(seed + s, 11) : 1);
      ring.push(
        new THREE.Vector3(
          Math.cos(a) * rx + (opts.leanX ?? 0) * t * t,
          y,
          Math.sin(a) * rz + (opts.leanZ ?? 0) * t * t,
        ),
      );
    }
    pts.push(ring);
  }
  const verts: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let r = 0; r < pts.length - 1; r++) {
    for (let s = 0; s < sides; s++) {
      const a = pts[r][s];
      const b = pts[r][(s + 1) % sides];
      const c = pts[r + 1][(s + 1) % sides];
      const e = pts[r + 1][s];
      tri(a, c, b);
      tri(a, e, c);
    }
  }
  // The cap: a fan to an off-centre apex (a chisel, not a cone's point).
  const top = pts[pts.length - 1];
  const apex = new THREE.Vector3();
  for (const p of top) apex.add(p);
  apex.multiplyScalar(1 / top.length);
  apex.y += h * 0.06 * (1 - boxy);
  apex.x += (sanctumHash(seed, 21) - 0.5) * w * 0.2;
  for (let s = 0; s < sides; s++) tri(top[s], apex, top[(s + 1) % sides]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  const foot = opts.foot ?? [0.16, 0.36, 0.55];
  const tip = opts.top ?? [0.55, 0.78, 0.92];
  const rime = opts.rime ?? [0.82, 0.9, 0.96];
  const nor = g.getAttribute('normal');
  paint(g, (x, y, _z) => {
    const t = Math.max(0, Math.min(1, y / Math.max(0.01, h)));
    let c = mix(foot, tip, t ** 0.8);
    // Streaks of old layering down the face.
    const band = sanctumNoise(x * 0.4 + seed, y * 1.3, 4, 2);
    c = mix(c, mix(c, rime, 0.5), Math.max(0, band - 0.55) * 1.6);
    return c;
  });
  // Up-facing facets hold rime and snow.
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) {
    const up = nor.getY(i);
    if (up > 0.45) {
      const k = Math.min(1, (up - 0.45) * 2.2);
      col.setXYZ(
        i,
        col.getX(i) + (rime[0] - col.getX(i)) * k,
        col.getY(i) + (rime[1] - col.getY(i)) * k,
        col.getZ(i) + (rime[2] - col.getZ(i)) * k,
      );
    }
  }
  return g;
}

/**
 * A weathered rock lump `w` by `h` by `d` on y 0: a subdivided icosahedron
 * pushed out by noise, its foot flattened into the ground and its top caught
 * by snow. `rock` and `snow` are linear colours.
 */
export function rockLump(
  w: number,
  h: number,
  d: number,
  seed: number,
  rock: Rgb = [0.075, 0.08, 0.095],
  snow: Rgb = [0.78, 0.84, 0.9],
  detail = 2,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = sanctumNoise(v.x * 1.6 + seed, v.z * 1.6 + v.y * 0.9, seed, 3);
    // Cleavage: slate splits in flat planes, so the bumps are terraced.
    const k = 0.72 + (Math.round(n * 6) / 6) * 0.5;
    v.multiplyScalar(k);
    v.set((v.x * w) / 2, Math.max(-0.15, v.y) * h * 0.62 + h * 0.08, (v.z * d) / 2);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  const nor = flat.getAttribute('normal');
  const p2 = flat.getAttribute('position');
  const col = new Float32Array(p2.count * 3);
  for (let i = 0; i < p2.count; i++) {
    const s = 0.8 + sanctumHash(seed + i * 0.013, 7) * 0.4;
    let c: Rgb = [rock[0] * s, rock[1] * s, rock[2] * s];
    const up = nor.getY(i);
    if (up > 0.5) c = mix(c, snow, Math.min(1, (up - 0.5) * 2.6));
    col.set(c, i * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return flat;
}

/**
 * A wind-carved snow drift `length` along x, `h` high, `w` deep: a long
 * gentle windward slope, a sharp crest, a short steep lee face.
 */
export function snowDrift(
  length: number,
  h: number,
  w: number,
  seed: number,
): THREE.BufferGeometry {
  const cols = 12;
  const prof: [number, number][] = [
    [-1, 0],
    [-0.55, 0.45],
    [-0.12, 0.92],
    [0, 1],
    [0.1, 0.9],
    [0.22, 0.4],
    [0.32, 0],
  ];
  const verts: number[] = [];
  const ring = (i: number): [number, number, number][] => {
    const t = i / cols;
    const x = (t - 0.5) * length;
    const hh = h * Math.sin(Math.PI * t) ** 0.7 * (0.85 + 0.3 * sanctumHash(seed, i));
    const ww = w * (0.4 + 0.6 * Math.sin(Math.PI * t) ** 0.5);
    const lean = Math.sin(t * 4 + seed) * w * 0.12;
    return prof.map(([pz, py]) => [x, py * hh, pz * ww + lean]);
  };
  for (let i = 0; i < cols; i++) {
    const a = ring(i);
    const b = ring(i + 1);
    for (let k = 0; k < prof.length - 1; k++) {
      verts.push(...a[k], ...b[k], ...b[k + 1], ...a[k], ...b[k + 1], ...a[k + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  paint(g, (x, _y, z) => {
    const s = 0.94 + sanctumNoise(x * 0.5, z * 0.5, seed, 2) * 0.1;
    // The lee face lies in blue shadow even in the snow's own paint.
    const lee = z > 0 ? Math.min(1, z / Math.max(0.1, w * 0.3)) * 0.25 : 0;
    return [0.78 * s - lee * 0.2, 0.84 * s - lee * 0.12, 0.92 * s];
  });
  return g;
}

/**
 * A lofted solid of revolution from (radius, height) pairs with `sides`
 * facets and a hashed wobble: a pillar's shaft, a pyre's drum, a post. The
 * profile's own bands and the wobble keep it from reading as a primitive.
 */
export function ringLoft(
  profile: readonly (readonly [number, number])[],
  sides: number,
  seed: number,
  color: (y: number, t: number) => Rgb,
  wobble = 0.06,
): THREE.BufferGeometry {
  const verts: number[] = [];
  const at = (k: number, s: number): [number, number, number] => {
    const [r, y] = profile[k];
    const a = (s / sides) * Math.PI * 2;
    const j = 1 + (sanctumHash(seed + s * 1.3, k * 0.7) - 0.5) * 2 * wobble;
    return [Math.cos(a) * r * j, y, Math.sin(a) * r * j];
  };
  for (let k = 0; k < profile.length - 1; k++) {
    for (let s = 0; s < sides; s++) {
      const a = at(k, s);
      const b = at(k, s + 1);
      const c = at(k + 1, s + 1);
      const d = at(k + 1, s);
      verts.push(...a, ...c, ...b, ...a, ...d, ...c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  const ymax = profile[profile.length - 1][1] || 1;
  paint(g, (_x, y) => color(y, y / ymax));
  return g;
}

/** One chain link, its long axis along x, `len` long (centred on the origin). */
export function chainLinkGeometry(len: number, thick: number): THREE.BufferGeometry {
  const r = len / 2 - thick;
  const g = new THREE.TorusGeometry(r, thick, 6, 14);
  g.scale(1, 0.62, 1);
  return g;
}
