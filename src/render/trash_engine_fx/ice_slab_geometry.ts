// The procedural body of a combat wall (the Ogre Sledge-Hauler's Ice Slab): a
// hauled, cracked block of lake ice crashed into the snow, built to its
// collider box (trash_engine_fx_core.ts wallBox, the sim's
// COMBAT_WALL_SHAPES): the block fills the footprint the sim blocks, never
// much past it, so a player reads exactly where it stops them. Rough-hewn
// faces (a deterministic jitter keyed on each vertex's spot, so shared corners
// stay welded), chipped top corners, a slight crashed-in tilt, a snow cap on
// every upward face, frost creeping up from the base, dark crack seams, and
// drifted snow and ice rubble heaped round its foot, and the hauler's iron
// banding still round it (a belt and two straps on each broad face, the haul
// ring the ogre carried it by): a man-made block of cover, never a stray
// lump of scenery (the playtest asked what it was for). Vertex colours only,
// so it draws through the shared `surfaceMat` program.
//
// Deterministic (no Math.random): the same box always builds the same slab.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WallBox } from './trash_engine_fx_core';

/** How deep the block is sunk into the snow (yards below its base). */
export const SLAB_SINK = 0.35;
/** The most any face is pushed past the collider footprint (yards). */
export const SLAB_OVERHANG = 0.12;

function hash3(x: number, y: number, z: number, salt: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + salt * 19.19) * 43758.5453;
  return s - Math.floor(s);
}

const ICE_DEEP = new THREE.Color(0x3f86b4);
const ICE = new THREE.Color(0x8fcbea);
const ICE_PALE = new THREE.Color(0xcdeaf8);
const SNOW = new THREE.Color(0xf3f9ff);
const SEAM = new THREE.Color(0x1d4d72);
const IRON = new THREE.Color(0x2c3036);
const IRON_WORN = new THREE.Color(0x5a5f66);

/** The block's faces wander round the collider box: pushed out up to
 *  SLAB_OVERHANG plus a bulge of SLAB_BULGE, in up to about 0.19 yd. The iron
 *  bands are seated across that whole band of wander (from SLAB_BAND_BITE
 *  inside the nominal face to SLAB_BAND_PROUD outside it) and share the
 *  block's tilt, so the ice never pokes through the iron and the iron never
 *  floats clear of the ice. */
const SLAB_BULGE = 0.07;
const SLAB_TILT_X = 0.025;
const SLAB_TILT_Z = -0.02;
/** How far the iron banding stands out of the collider box (yards). */
export const SLAB_BAND_PROUD = 0.2;
/** How far the bands reach in under the nominal face (yards). */
export const SLAB_BAND_BITE = 0.22;

/** The block: jittered, chipped, tilted, coloured. Non-indexed (flat faces). */
function blockGeometry(box: WallBox): THREE.BufferGeometry {
  const { hw, hd, height } = box;
  const total = height + SLAB_SINK;
  const g = new THREE.BoxGeometry(hw * 2, total, hd * 2, 4, 5, 3).translate(
    0,
    total / 2 - SLAB_SINK,
    0,
  );
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const kx = Math.round(x * 100);
    const ky = Math.round(y * 100);
    const kz = Math.round(z * 100);
    // Faces pushed in and out a hand (mostly in: the footprint is the box).
    const jx = (hash3(kx, ky, kz, 1) - 0.62) * 0.3;
    const jz = (hash3(kx, ky, kz, 2) - 0.62) * 0.3;
    let nx = x + Math.sign(x) * Math.min(SLAB_OVERHANG, jx) * (Math.abs(x) > hw * 0.99 ? 1 : 0.4);
    let nz = z + Math.sign(z) * Math.min(SLAB_OVERHANG, jz) * (Math.abs(z) > hd * 0.99 ? 1 : 0.4);
    let ny = y;
    const top = y > height - 0.01;
    if (top) {
      // A broken, uneven top, its corners chipped away.
      ny += (hash3(kx, ky, kz, 3) - 0.5) * 0.4;
      const cx = Math.abs(x) / hw;
      const cz = Math.abs(z) / hd;
      if (cx > 0.7 && cz > 0.6) ny -= 0.55 * (cx + cz - 1.3);
    } else if (y > -SLAB_SINK + 0.01) {
      // Sides bulge and pinch along their height (a hauled, hacked block).
      const bulge = Math.sin((y / height) * Math.PI) * (hash3(kx, 0, kz, 4) - 0.5) * SLAB_BULGE * 2;
      nx += Math.sign(x) * Math.min(SLAB_OVERHANG, bulge) * (Math.abs(x) > hw * 0.99 ? 1 : 0);
      nz += Math.sign(z) * Math.min(SLAB_OVERHANG, bulge) * (Math.abs(z) > hd * 0.99 ? 1 : 0);
    }
    pos.setXYZ(i, nx, ny, nz);
  }
  // Crashed in at an angle: a slight lean, the low edge buried in the snow.
  g.rotateX(SLAB_TILT_X);
  g.rotateZ(SLAB_TILT_Z);
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  const p = flat.getAttribute('position') as THREE.BufferAttribute;
  const n = flat.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    // One colour decision per face (flat-shaded facets read as cut ice).
    const fx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const fy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const fz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const up = n.getY(i);
    const t = Math.min(1, Math.max(0, fy / height));
    const h = hash3(Math.round(fx * 10), Math.round(fy * 10), Math.round(fz * 10), 5);
    c.copy(ICE_DEEP)
      .lerp(ICE, Math.min(1, t * 1.4))
      .lerp(ICE_PALE, Math.max(0, t - 0.55) * 1.2);
    c.multiplyScalar(0.86 + h * 0.28);
    // Crack seams: a few faces gone dark along hidden fracture planes.
    const seam = Math.abs(Math.sin(fx * 2.3 + fy * 1.7 - fz * 1.1));
    if (seam < 0.12 && up < 0.5) c.lerp(SEAM, 0.65);
    // Frost creeping up from the base.
    if (fy < 0.55) c.lerp(SNOW, (0.55 - fy) * 0.9 * (0.6 + h * 0.4));
    // A snow cap on every face that looks up.
    if (up > 0.55) c.copy(SNOW).multiplyScalar(0.92 + h * 0.08);
    else if (up > 0.25) c.lerp(SNOW, 0.5);
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = c.r;
      colors[(i + k) * 3 + 1] = c.g;
      colors[(i + k) * 3 + 2] = c.b;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

/** A drift of snow and a scatter of ice rubble round the foot. */
function footGeometry(box: WallBox): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const clumps = 9;
  for (let i = 0; i < clumps; i++) {
    const a = (i / clumps) * Math.PI * 2 + hash3(i, 0, 0, 6) * 0.5;
    // On the box's own outline (a little outside it), heaped against its foot.
    const ex = Math.cos(a);
    const ez = Math.sin(a);
    const k = 1 / Math.max(Math.abs(ex) / box.hw, Math.abs(ez) / box.hd);
    const snow = i % 3 !== 2;
    const r = snow ? 0.55 + hash3(i, 1, 0, 7) * 0.35 : 0.25 + hash3(i, 2, 0, 8) * 0.2;
    const geo = (snow ? new THREE.IcosahedronGeometry(1, 1) : new THREE.DodecahedronGeometry(1, 0))
      .scale(r * (snow ? 1.5 : 1), r * (snow ? 0.45 : 0.9), r * (snow ? 1.1 : 1))
      .rotateY(a)
      .translate(ex * (k + r * 0.35), snow ? 0.02 : r * 0.4, ez * (k + r * 0.35));
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    flat.computeVertexNormals();
    const col = snow ? SNOW : ICE_PALE;
    const colors = new Float32Array(flat.getAttribute('position').count * 3);
    for (let v = 0; v < colors.length; v += 3) {
      colors[v] = col.r;
      colors[v + 1] = col.g;
      colors[v + 2] = col.b;
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (flat.getAttribute('uv')) flat.deleteAttribute('uv');
    out.push(flat);
  }
  return out;
}

/** A flat-coloured, non-indexed piece of iron (worn paler on its edges). */
function ironPiece(geo: THREE.BufferGeometry, worn: number): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  if (flat.getAttribute('uv')) flat.deleteAttribute('uv');
  flat.computeVertexNormals();
  const n = flat.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(n.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    // Faces turned up catch a rime of frost; the rest is cold black iron.
    c.copy(IRON).lerp(IRON_WORN, worn * (0.5 + 0.5 * Math.abs(n.getX(i))));
    if (n.getY(i) > 0.6) c.lerp(SNOW, 0.55);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

/** The hauler's iron banding: a belt round the block, two straps up each
 *  broad face (the ±z faces, the broad face turned to the thrower), and the
 *  haul ring hanging off the belt on the front. Seated across the faces'
 *  wander and tilted with the block (see SLAB_BAND_PROUD); below the broken
 *  top. */
function bandGeometry(box: WallBox): THREE.BufferGeometry[] {
  const { hw, hd, height } = box;
  const out = SLAB_BAND_PROUD;
  const bite = SLAB_BAND_BITE;
  const t = out + bite;
  /** The centre of a bar seated on a face at `face` (signed nominal offset). */
  const seat = (face: number): number => face + Math.sign(face) * ((out - bite) / 2);
  const parts: THREE.BufferGeometry[] = [];
  const beltY = height * 0.42;
  const beltH = 0.3;
  // The belt: four bars round the block (the ±z bars wrap the corners).
  for (const side of [1, -1]) {
    parts.push(
      ironPiece(
        new THREE.BoxGeometry((hw + out) * 2, beltH, t).translate(0, beltY, seat(side * hd)),
        0.4,
      ),
      ironPiece(new THREE.BoxGeometry(t, beltH, hd * 2).translate(seat(side * hw), beltY, 0), 0.4),
    );
  }
  // Two straps up each broad face, from the snow to below the broken top.
  const strapTop = height * 0.74;
  for (const side of [1, -1])
    for (const x of [-hw * 0.48, hw * 0.48])
      parts.push(
        ironPiece(
          new THREE.BoxGeometry(0.26, strapTop + SLAB_SINK, t).translate(
            x,
            (strapTop - SLAB_SINK) / 2,
            seat(side * hd),
          ),
          0.3,
        ),
      );
  // The haul ring on the front face, hanging from a staple on the belt.
  parts.push(
    ironPiece(
      new THREE.TorusGeometry(0.42, 0.075, 6, 14).translate(0, beltY - 0.5, hd + out + 0.06),
      0.6,
    ),
    ironPiece(new THREE.BoxGeometry(0.34, 0.16, 0.14).translate(0, beltY - 0.06, hd + out), 0.5),
  );
  // The block's own crashed-in lean.
  for (const p of parts) {
    p.rotateX(SLAB_TILT_X);
    p.rotateZ(SLAB_TILT_Z);
  }
  return parts;
}

/** The whole slab for a wall box (block, banding, drift and rubble), merged. */
export function buildIceSlabGeometry(box: WallBox): THREE.BufferGeometry {
  const block = blockGeometry(box);
  if (block.getAttribute('uv')) block.deleteAttribute('uv');
  const parts = [block, ...bandGeometry(box), ...footGeometry(box)];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('ice slab geometry merge failed');
  merged.computeBoundingSphere();
  return merged;
}

/** Just the block (the glow shell rides it, never the drift). */
export function buildIceSlabShellGeometry(box: WallBox): THREE.BufferGeometry {
  const block = blockGeometry(box);
  block.deleteAttribute('color');
  if (block.getAttribute('uv')) block.deleteAttribute('uv');
  block.computeBoundingSphere();
  return block;
}
