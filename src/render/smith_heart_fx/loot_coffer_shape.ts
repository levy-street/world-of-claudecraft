// The Smith's Heart loot coffer's geometry (procedural, the house's painted
// iron and bronze): a forge reliquary on a basalt plinth. Dark iron body
// banded and cornered in bronze, a gold clasp plate, a barrel lid on a hinge
// at the back of the rim, the molten inlays (a seam round the body, the
// clasp's diamond rune, the lid's ring rune, the plinth's slits) and the
// heap of gold inside. Builders only: loot_coffer_fx.ts owns the materials,
// the transforms and the lifetime.
//
// Local frame: yards, the origin on the floor under the coffer's centre, +z
// its front, +y up. Every part is baked with a vertex colour gradient (dark
// at its foot, lit at its crown: the painted look), so the body and the lid
// each draw as one mesh.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The coffer's measures (yards). */
export const COFFER = {
  width: 2.3,
  depth: 1.4,
  plinthH: 0.28,
  plinthR: 1.78,
  feetH: 0.16,
  bodyH: 1.1,
  /** The lid's squash on its half-round barrel. */
  lidSquash: 0.62,
} as const;

/** The whole coffer's scale in the world: a raid's hoard stands a head
 *  over the raiders who loot it. Its stage carries it; the measures above
 *  and below are the model's own. */
export const COFFER_SCALE = 1.45;

/** The body's floor (top of the feet) and its rim. */
export const COFFER_BASE_Y = COFFER.plinthH + COFFER.feetH;
export const COFFER_RIM_Y = COFFER_BASE_Y + COFFER.bodyH;
/** The lid's hinge line, at the back of the rim. */
export const COFFER_HINGE = { y: COFFER_RIM_Y, z: -COFFER.depth / 2 } as const;
/** The heart of its light: inside, just under the rim. */
export const COFFER_HEART_Y = COFFER_RIM_Y - 0.05;
/** The lid's height over the hinge line. */
export const COFFER_LID_H = (COFFER.depth / 2) * COFFER.lidSquash;

const IRON: readonly [number, number] = [0x161616, 0x4a4846];
const PANEL: readonly [number, number] = [0x0f0e0e, 0x302d2b];
const RIVET: readonly [number, number] = [0x8a6630, 0xf0cc80];
const BRONZE: readonly [number, number] = [0x6a4a26, 0xb88e4c];
const GOLD: readonly [number, number] = [0x9a7434, 0xe6be6a];
const POST: readonly [number, number] = [0x2a2016, 0x6a5232];
const BASALT: readonly [number, number] = [0x1c1714, 0x40362f];
const HOLD: readonly [number, number] = [0x0e0a08, 0x1e1712];
const HANDLE: readonly [number, number] = [0x1c1d22, 0x50535c];

const _c0 = new THREE.Color();
const _c1 = new THREE.Color();
const _c = new THREE.Color();

/** A part baked for merging: non-indexed, no uv, its colour a gradient over
 *  its own height. */
function part(
  geo: THREE.BufferGeometry,
  colors: readonly [number, number],
  place?: (g: THREE.BufferGeometry) => void,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  place?.(g);
  g.computeBoundingBox();
  const box = g.boundingBox as THREE.Box3;
  const lo = box.min.y;
  const span = Math.max(1e-4, box.max.y - lo);
  _c0.setHex(colors[0]);
  _c1.setHex(colors[1]);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) - lo) / span;
    _c.copy(_c0).lerp(_c1, k * k * (3 - 2 * k));
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colors: readonly [number, number],
): THREE.BufferGeometry {
  return part(new THREE.BoxGeometry(w, h, d), colors, (g) => g.translate(x, y, z));
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('loot coffer: parts did not merge');
  merged.computeBoundingSphere();
  return merged;
}

/** The half-round barrel of the lid, its axis along x, its flat side down on
 *  y = 0, centred on z = 0 (a radius `r`, `len` long). */
function barrel(r: number, len: number, segs: number): THREE.BufferGeometry {
  // A cylinder's points sit at (r sin t, y, r cos t); turned onto the x axis
  // the half with t in [pi, 2 pi] is the one above the floor.
  const g = new THREE.CylinderGeometry(r, r, len, segs, 1, false, Math.PI, Math.PI);
  g.rotateZ(-Math.PI / 2);
  g.scale(1, COFFER.lidSquash, 1);
  return g;
}

export interface LootCofferShapes {
  /** The plinth, feet, body, bands, rims, clasp, handles and hold. */
  body: THREE.BufferGeometry;
  /** The lid, in its hinge's frame (the hinge line on the x axis). */
  lid: THREE.BufferGeometry;
  /** The body's molten inlays (the seam, the clasp rune, the plinth slits). */
  inlay: THREE.BufferGeometry;
  /** The lid's ring rune, in the hinge's frame. */
  lidInlay: THREE.BufferGeometry;
  /** The heap of gold inside. */
  hoard: THREE.BufferGeometry;
  /** The click proxy: the coffer's whole bulk. */
  proxy: THREE.BufferGeometry;
  /** The floor ring and pool (a flat square, the shader draws the round). */
  floor: THREE.BufferGeometry;
  /** The shaft and its halo: an open tapering tube, its foot at y = 0. */
  shaft: THREE.BufferGeometry;
  /** A billboard card. */
  card: THREE.BufferGeometry;
}

export function buildLootCofferShapes(): LootCofferShapes {
  const W = COFFER.width;
  const D = COFFER.depth;
  const B = COFFER_BASE_Y;
  const H = COFFER.bodyH;
  const R = COFFER_RIM_Y;
  const floorIn = R - 0.18;

  // ---- the body ----
  const bodyParts: THREE.BufferGeometry[] = [];
  // Plinth: an octagon of basalt, a flat face to the front.
  bodyParts.push(
    part(
      new THREE.CylinderGeometry(COFFER.plinthR - 0.16, COFFER.plinthR, COFFER.plinthH, 8),
      BASALT,
      (g) => {
        g.rotateY(Math.PI / 8);
        g.translate(0, COFFER.plinthH / 2, 0);
      },
    ),
  );
  // Feet.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      bodyParts.push(
        box(
          0.32,
          COFFER.feetH,
          0.32,
          sx * (W / 2 - 0.1),
          COFFER.plinthH + COFFER.feetH / 2,
          sz * (D / 2 - 0.1),
          BRONZE,
        ),
      );
  // The iron body up to the hold's floor, and its walls round the hold.
  bodyParts.push(box(W, floorIn - B, D, 0, (B + floorIn) / 2, 0, IRON));
  const wall = 0.09;
  const wallH = R - floorIn;
  bodyParts.push(box(W, wallH, wall, 0, floorIn + wallH / 2, D / 2 - wall / 2, IRON));
  bodyParts.push(box(W, wallH, wall, 0, floorIn + wallH / 2, -D / 2 + wall / 2, IRON));
  bodyParts.push(box(wall, wallH, D, W / 2 - wall / 2, floorIn + wallH / 2, 0, IRON));
  bodyParts.push(box(wall, wallH, D, -W / 2 + wall / 2, floorIn + wallH / 2, 0, IRON));
  // The hold's dark floor.
  bodyParts.push(box(W - 2 * wall, 0.02, D - 2 * wall, 0, floorIn + 0.01, 0, HOLD));
  // Bronze bands round the body, the corner posts, the rims.
  for (const sx of [-1, 1])
    bodyParts.push(box(0.2, H + 0.02, D + 0.06, sx * 0.72, B + H / 2, 0, BRONZE));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      bodyParts.push(box(0.14, H + 0.05, 0.14, sx * (W / 2), B + H / 2, sz * (D / 2), POST));
  bodyParts.push(box(W + 0.07, 0.12, D + 0.07, 0, B + 0.06, 0, BRONZE));
  const rimY = R - 0.05;
  bodyParts.push(box(W + 0.07, 0.1, 0.1, 0, rimY, D / 2, BRONZE));
  bodyParts.push(box(W + 0.07, 0.1, 0.1, 0, rimY, -D / 2, BRONZE));
  bodyParts.push(box(0.1, 0.1, D + 0.07, W / 2, rimY, 0, BRONZE));
  bodyParts.push(box(0.1, 0.1, D + 0.07, -W / 2, rimY, 0, BRONZE));
  // Sunk panels on the front and back between the bands (depth in the
  // iron), and the bands' rivets.
  for (const sz of [-1, 1]) {
    for (const px of [-1.0, 0, 1.0]) {
      const pw = px === 0 ? 1.0 : 0.24;
      bodyParts.push(box(pw, H * 0.52, 0.02, px, B + H * 0.42, sz * (D / 2 + 0.006), PANEL));
    }
    for (const sx of [-1, 1])
      for (const ry of [0.16, 0.46, 0.92])
        bodyParts.push(
          part(new THREE.SphereGeometry(0.045, 6, 4), RIVET, (g) =>
            g.translate(sx * 0.72, B + H * ry, sz * (D / 2 + 0.035)),
          ),
        );
  }
  // The clasp plate on the front.
  const claspY = R - 0.36;
  bodyParts.push(box(0.52, 0.5, 0.07, 0, claspY, D / 2 + 0.04, GOLD));
  // Iron ring handles on the flanks.
  for (const sx of [-1, 1])
    bodyParts.push(
      part(new THREE.TorusGeometry(0.17, 0.038, 6, 14), HANDLE, (g) => {
        g.rotateY(Math.PI / 2);
        g.translate(sx * (W / 2 + 0.07), B + H * 0.58, 0);
      }),
    );
  const body = merge(bodyParts);

  // ---- the lid, in the hinge's frame ----
  const r = D / 2;
  const lidParts: THREE.BufferGeometry[] = [];
  lidParts.push(part(barrel(r, W, 16), IRON, (g) => g.translate(0, 0, r)));
  // Its underside (seen when it opens): dark hold iron.
  lidParts.push(box(W - 0.02, 0.03, D - 0.02, 0, 0.015, r, HOLD));
  for (const sx of [-1, 1])
    lidParts.push(part(barrel(r + 0.035, 0.2, 16), BRONZE, (g) => g.translate(sx * 0.72, 0, r)));
  // Its rim, and the hasp hanging over the clasp.
  lidParts.push(box(W + 0.07, 0.08, 0.1, 0, 0.04, D, BRONZE));
  lidParts.push(box(W + 0.07, 0.08, 0.1, 0, 0.04, 0, BRONZE));
  lidParts.push(box(0.1, 0.08, D + 0.07, W / 2, 0.04, r, BRONZE));
  lidParts.push(box(0.1, 0.08, D + 0.07, -W / 2, 0.04, r, BRONZE));
  lidParts.push(box(0.26, 0.34, 0.06, 0, -0.1, D + 0.08, GOLD));
  const lid = merge(lidParts);

  // ---- the inlays (one material: the accent's molten light) ----
  const inlayParts: THREE.BufferGeometry[] = [];
  // The molten seam round the body, under the rim.
  inlayParts.push(box(W + 0.012, 0.05, D + 0.012, 0, B + H * 0.76, 0, [0xffffff, 0xffffff]));
  // The clasp's diamond rune.
  inlayParts.push(
    part(new THREE.BoxGeometry(0.2, 0.2, 0.02), [0xffffff, 0xffffff], (g) => {
      g.rotateZ(Math.PI / 4);
      g.translate(0, claspY, D / 2 + 0.085);
    }),
  );
  // A slit of light on each face of the plinth.
  const apothem = (COFFER.plinthR - 0.08) * Math.cos(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    inlayParts.push(
      part(new THREE.BoxGeometry(0.5, 0.05, 0.03), [0xffffff, 0xffffff], (g) => {
        g.rotateY(a);
        g.translate(
          Math.sin(a) * (apothem + 0.005),
          COFFER.plinthH * 0.5,
          Math.cos(a) * (apothem + 0.005),
        );
      }),
    );
  }
  const inlay = merge(inlayParts);
  // The lid's ring rune, on its front slope.
  const phi = 0.9;
  const lidInlay = merge([
    part(new THREE.TorusGeometry(0.16, 0.026, 6, 22), [0xffffff, 0xffffff], (g) => {
      g.rotateX(-(Math.PI / 2 - phi) * 0.75);
      g.translate(
        0,
        Math.cos(phi) * (r + 0.012) * COFFER.lidSquash + 0.01,
        r + Math.sin(phi) * (r + 0.012),
      );
    }),
  ]);

  // ---- the hoard: a heap of gold in the hold ----
  const hoard = merge([
    part(
      new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      [0xa87428, 0xffe08a],
      (g) => {
        g.scale((W - 0.3) / 2, 0.3, (D - 0.3) / 2);
        g.translate(0, floorIn + 0.02, 0);
      },
    ),
  ]);

  const proxy = new THREE.BoxGeometry(W + 0.4, R + COFFER_LID_H + 0.3, D + 0.7);
  proxy.translate(0, (R + COFFER_LID_H + 0.3) / 2, 0.15);

  const floor = new THREE.PlaneGeometry(2, 2);
  floor.rotateX(-Math.PI / 2);

  const shaft = new THREE.CylinderGeometry(1, 0.62, 1, 24, 1, true);
  shaft.translate(0, 0.5, 0);

  const card = new THREE.PlaneGeometry(1, 1);

  return { body, lid, inlay, lidInlay, hoard, proxy, floor, shaft, card };
}
