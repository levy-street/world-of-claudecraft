// The Guardian of the Heat's procedural shapes, shared by its painters
// (heat_fx.ts, heat_well_fx.ts, heat_cinder_fx.ts): the
// Hearth's hexagonal basalt columns and crystal prisms with the vertex shade
// the Heart kit's slot materials and the vein glow read, a rolling wave's
// wall, and a ring for a floor band. Built once in each painter's
// constructor (never on the frame path); the painter owns and disposes what
// it builds. No state, no light.

import * as THREE from 'three';

/** Give a geometry a vertex shade (the `color` attribute the Heart kit's
 *  materials read): dark at `y0`, light at `y1`, a hashed flicker per vertex. */
export function shadeByHeight(
  g: THREE.BufferGeometry,
  y0: number,
  y1: number,
  lo: number,
  hi: number,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.max(0, Math.min(1, (pos.getY(i) - y0) / Math.max(1e-3, y1 - y0)));
    const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const s = lo + (hi - lo) * k + 0.06 * jitter;
    col[i * 3] = s;
    col[i * 3 + 1] = s;
    col[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A copy of a kit rock's geometry repainted the Hearth's sooted basalt: its
 *  painted value kept, its colour mapped from `shade` (dark) to `basalt`
 *  (lit). The caller owns and disposes the copy. */
export function basaltRepaint(
  src: THREE.BufferGeometry,
  basalt: readonly [number, number, number],
  shade: readonly [number, number, number],
): THREE.BufferGeometry {
  const g = src.clone();
  const col = g.getAttribute('color');
  if (col) {
    for (let i = 0; i < col.count; i++) {
      const v = Math.min(1, col.getX(i) * 1.4);
      col.setXYZ(
        i,
        shade[0] + (basalt[0] - shade[0]) * v,
        shade[1] + (basalt[1] - shade[1]) * v,
        shade[2] + (basalt[2] - shade[2]) * v,
      );
    }
    col.needsUpdate = true;
  }
  return g;
}

/** A hexagonal basalt column, its foot at y 0, `h` tall, `r` across its
 *  flats' circle, its head bevelled (one unit's shape: scale it). */
export function basaltColumn(r = 0.5, h = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.92, r, h, 6, 2).translate(0, h / 2, 0);
  return shadeByHeight(g, 0, h, 0.45, 0.85);
}

/** A crystal prism of the first flame: a hexagonal body and a pointed tip,
 *  its foot at y 0, `h` tall (merged into one geometry). */
export function crystalPrism(r = 0.35, h = 1.6): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(r, r * 1.12, h * 0.72, 6, 1).translate(0, h * 0.36, 0);
  const tip = new THREE.ConeGeometry(r, h * 0.28, 6, 1).translate(0, h * 0.86, 0);
  const merged = mergeSimple([body, tip]);
  body.dispose();
  tip.dispose();
  return shadeByHeight(merged, 0, h, 0.6, 1);
}

/** Merge non-indexed copies of simple geometries (position, normal, uv). */
export function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let count = 0;
  for (const p of flat) count += p.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const p of flat) {
    const pa = p.getAttribute('position') as THREE.BufferAttribute;
    const na = p.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const ua = p.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pa.count; i++) {
      pos[(o + i) * 3] = pa.getX(i);
      pos[(o + i) * 3 + 1] = pa.getY(i);
      pos[(o + i) * 3 + 2] = pa.getZ(i);
      if (na) {
        nrm[(o + i) * 3] = na.getX(i);
        nrm[(o + i) * 3 + 1] = na.getY(i);
        nrm[(o + i) * 3 + 2] = na.getZ(i);
      }
      if (ua) {
        uv[(o + i) * 2] = ua.getX(i);
        uv[(o + i) * 2 + 1] = ua.getY(i);
      }
    }
    o += pa.count;
  }
  for (let i = 0; i < flat.length; i++) if (flat[i] !== parts[i]) flat[i].dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * A rolling wave's wall in its lane's frame: across x -1..1, up y 0..1 (its
 * height), along z: the back slope from -1 (the wall's depth behind the
 * crest, scaled by the painter) rising to the crest near 0 and curling over
 * it. `uv.x` runs across, `uv.y` along the profile from the back's foot (0)
 * over the crest to the curl's lip (1).
 */
export function swellWallGeometry(across = 18, profile = 16): THREE.BufferGeometry {
  // The profile: (z, y) from the back's foot up over the crest to the lip.
  const P: [number, number][] = [];
  for (let i = 0; i <= profile; i++) {
    const t = i / profile;
    if (t < 0.62) {
      // The back slope: a rising swell.
      const k = t / 0.62;
      P.push([-1 + k * 0.92, Math.sin((k * Math.PI) / 2) ** 1.4]);
    } else {
      // The crest curling forward and down over its own front.
      const k = (t - 0.62) / 0.38;
      const a = k * Math.PI * 0.85;
      P.push([-0.08 + Math.sin(a) * 0.32, 1 - (1 - Math.cos(a)) * 0.42]);
    }
  }
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((across + 1) * (profile + 1) * 3);
  const uv = new Float32Array((across + 1) * (profile + 1) * 2);
  let k = 0;
  for (let j = 0; j <= profile; j++) {
    for (let i = 0; i <= across; i++) {
      const x = -1 + (2 * i) / across;
      // The ends of the wall droop a little (a wave, not a box).
      const droop = 1 - 0.25 * Math.abs(x) ** 3;
      pos[k * 3] = x;
      pos[k * 3 + 1] = P[j][1] * droop;
      pos[k * 3 + 2] = P[j][0];
      uv[k * 2] = i / across;
      uv[k * 2 + 1] = j / profile;
      k++;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < profile; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i;
      const b = a + across + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A flat ring (annulus) on the floor from `inner` to 1 (scale it to the
 *  outer radius), `uv.x` its angle (0..1), `uv.y` inner (0) to outer (1). */
export function floorRingGeometry(inner: number, segments = 96): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, 1, segments, 2).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
    uv.setXY(i, a, (r - inner) / Math.max(1e-3, 1 - inner));
  }
  uv.needsUpdate = true;
  return g;
}
