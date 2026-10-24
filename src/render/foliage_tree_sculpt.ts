// Procedural Genshin / Ghibli puffball canopy & trunk sculptor for world-field
// foliage trees (src/render/foliage.ts).
//
// The stock Quaternius tree GLBs (oak_1..5, pine_1..5) have two geometric
// problems in open meadows:
//   1. Their bark meshes (Bark_NormalTree) are thick red-brown poles whose
//      upper prongs extend to 90% of the tree height, while oak_4_field has
//      zero leaves below y = 5.81yd (reading as a 6-yard bare stick with a
//      tiny lollipop cap and branches poking through sparse simplified cards).
//   2. Their leaf meshes are a single thin shell of small flat quads shaded
//      around one tree-wide pivot, with no internal sub-lobe structure.
//
// This module transforms the extracted runtime BufferGeometries in-place:
//   - Trunks are slimmed at the shaft, given a subtle organic S-curve, and
//     their high Y-fork limbs are lowered and widened into the lower/mid
//     canopy tiers so every tree shows a sculptural branching fork underneath.
//   - Broadleaf canopies (oak_1..5) are rebuilt as plump, overlapping cumulus
//     cloud-domes (8 to 9 rounded sub-crowns clustered around a solid central
//     core so there are no see-through horizontal gaps, while outer domes bulge
//     outward into a scalloped Ghibli silhouette). Each dome carries per-lobe
//     spherical normals and a crisp painter's sunlit-crescent / cool-emerald
//     underbelly gradient so overlapping domes visually pop in 3D.

import * as THREE from 'three';

interface PuffLobe {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  cards: number;
  cardScale: number;
}

// Five distinct multi-dome cumulus crown architectures corresponding to
// oak_1..5. Each preset includes a central heart lobe plus surrounding lower,
// mid, and apex puffball domes with plump aspect ratios (rx ~ 1.35..1.52,
// ry ~ 0.90..1.06) so the crown is lush and continuous in the center while
// scalloped and multi-tiered around its silhouette.
const OAK_CROWN_PRESETS: readonly (readonly PuffLobe[])[] = [
  // Variant 1: Classic spreading Mondstadt Meadow Oak (8 plump cumulus domes)
  [
    { x: 0.0, y: 3.75, z: 0.0, rx: 1.48, ry: 1.04, rz: 1.45, cards: 30, cardScale: 1.4 },
    { x: -1.72, y: 3.05, z: 0.55, rx: 1.42, ry: 0.94, rz: 1.38, cards: 32, cardScale: 1.38 },
    { x: 1.72, y: 3.15, z: 0.45, rx: 1.4, ry: 0.94, rz: 1.36, cards: 32, cardScale: 1.38 },
    { x: 0.1, y: 2.95, z: -1.68, rx: 1.42, ry: 0.92, rz: 1.38, cards: 32, cardScale: 1.38 },
    { x: -0.15, y: 3.1, z: 1.55, rx: 1.35, ry: 0.9, rz: 1.32, cards: 28, cardScale: 1.34 },
    { x: -1.18, y: 4.35, z: -0.6, rx: 1.38, ry: 0.95, rz: 1.34, cards: 32, cardScale: 1.36 },
    { x: 1.22, y: 4.45, z: -0.5, rx: 1.36, ry: 0.95, rz: 1.32, cards: 32, cardScale: 1.36 },
    { x: 0.05, y: 5.35, z: 0.0, rx: 1.48, ry: 1.02, rz: 1.44, cards: 34, cardScale: 1.4 },
  ],
  // Variant 2: Asymmetric Twin-Crown Windrise Birch / Zelkova (8 billowing domes)
  [
    { x: -0.15, y: 3.7, z: 0.0, rx: 1.42, ry: 1.02, rz: 1.38, cards: 28, cardScale: 1.36 },
    { x: -1.85, y: 2.95, z: 0.25, rx: 1.38, ry: 0.9, rz: 1.34, cards: 30, cardScale: 1.34 },
    { x: 1.62, y: 3.2, z: -0.3, rx: 1.34, ry: 0.9, rz: 1.3, cards: 30, cardScale: 1.34 },
    { x: -0.15, y: 3.05, z: -1.62, rx: 1.36, ry: 0.9, rz: 1.32, cards: 28, cardScale: 1.34 },
    { x: 0.15, y: 3.15, z: 1.5, rx: 1.3, ry: 0.88, rz: 1.28, cards: 28, cardScale: 1.32 },
    { x: -1.22, y: 4.25, z: -0.4, rx: 1.38, ry: 0.94, rz: 1.34, cards: 32, cardScale: 1.36 },
    { x: 1.15, y: 4.5, z: 0.45, rx: 1.34, ry: 0.92, rz: 1.3, cards: 30, cardScale: 1.34 },
    { x: -0.3, y: 5.4, z: 0.1, rx: 1.44, ry: 1.0, rz: 1.4, cards: 34, cardScale: 1.38 },
  ],
  // Variant 3: Grand Spreading Ghibli Sycamore (9 plush cumulus domes)
  [
    { x: 0.0, y: 3.8, z: 0.0, rx: 1.52, ry: 1.05, rz: 1.48, cards: 30, cardScale: 1.4 },
    { x: -1.88, y: 3.0, z: 0.35, rx: 1.44, ry: 0.94, rz: 1.4, cards: 32, cardScale: 1.38 },
    { x: 1.82, y: 3.15, z: -0.35, rx: 1.42, ry: 0.94, rz: 1.38, cards: 32, cardScale: 1.38 },
    { x: 0.15, y: 3.0, z: 1.68, rx: 1.38, ry: 0.92, rz: 1.34, cards: 30, cardScale: 1.36 },
    { x: -0.2, y: 3.1, z: -1.68, rx: 1.38, ry: 0.92, rz: 1.34, cards: 30, cardScale: 1.36 },
    { x: -1.25, y: 4.35, z: -0.5, rx: 1.4, ry: 0.96, rz: 1.36, cards: 32, cardScale: 1.38 },
    { x: 1.28, y: 4.45, z: 0.45, rx: 1.38, ry: 0.96, rz: 1.34, cards: 32, cardScale: 1.38 },
    { x: -0.35, y: 5.45, z: 0.15, rx: 1.46, ry: 1.02, rz: 1.42, cards: 34, cardScale: 1.4 },
    { x: 0.65, y: 5.2, z: -0.4, rx: 1.26, ry: 0.9, rz: 1.22, cards: 28, cardScale: 1.32 },
  ],
  // Variant 4: Signature Windrise Roadside Canopy Tree (8 lush cumulus domes)
  [
    { x: 0.0, y: 3.75, z: 0.0, rx: 1.48, ry: 1.04, rz: 1.44, cards: 30, cardScale: 1.4 },
    { x: -1.78, y: 2.95, z: -0.3, rx: 1.4, ry: 0.92, rz: 1.36, cards: 32, cardScale: 1.36 },
    { x: 1.75, y: 3.05, z: 0.4, rx: 1.38, ry: 0.92, rz: 1.34, cards: 32, cardScale: 1.36 },
    { x: 0.15, y: 2.9, z: 1.62, rx: 1.36, ry: 0.9, rz: 1.32, cards: 28, cardScale: 1.34 },
    { x: -0.15, y: 3.05, z: -1.62, rx: 1.36, ry: 0.9, rz: 1.32, cards: 28, cardScale: 1.34 },
    { x: -1.18, y: 4.3, z: 0.55, rx: 1.38, ry: 0.94, rz: 1.34, cards: 32, cardScale: 1.36 },
    { x: 1.2, y: 4.4, z: -0.55, rx: 1.36, ry: 0.94, rz: 1.32, cards: 32, cardScale: 1.36 },
    { x: 0.0, y: 5.35, z: 0.05, rx: 1.48, ry: 1.02, rz: 1.44, cards: 34, cardScale: 1.4 },
  ],
  // Variant 5: Billowing Pastoral Bough Tree (8 plush rounded cloud-domes)
  [
    { x: 0.0, y: 3.7, z: 0.0, rx: 1.5, ry: 1.04, rz: 1.46, cards: 30, cardScale: 1.4 },
    { x: -1.75, y: 2.95, z: 0.65, rx: 1.42, ry: 0.94, rz: 1.38, cards: 32, cardScale: 1.38 },
    { x: 1.78, y: 3.0, z: 0.6, rx: 1.4, ry: 0.94, rz: 1.36, cards: 32, cardScale: 1.38 },
    { x: 0.0, y: 2.9, z: -1.7, rx: 1.44, ry: 0.94, rz: 1.4, cards: 32, cardScale: 1.38 },
    { x: -1.18, y: 4.3, z: -0.5, rx: 1.38, ry: 0.95, rz: 1.34, cards: 32, cardScale: 1.36 },
    { x: 1.2, y: 4.35, z: -0.45, rx: 1.36, ry: 0.95, rz: 1.32, cards: 32, cardScale: 1.36 },
    { x: 0.0, y: 4.35, z: 1.25, rx: 1.34, ry: 0.92, rz: 1.3, cards: 30, cardScale: 1.34 },
    { x: 0.0, y: 5.35, z: 0.0, rx: 1.5, ry: 1.02, rz: 1.46, cards: 34, cardScale: 1.4 },
  ],
];

// Deterministic counter PRNG so every tree variant generates identically.
function makeSculptRng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function oakVariantIndexFromUrl(url: string): number | null {
  const m = /oak_(\d)/.exec(url);
  if (!m) return null;
  const idx = Number.parseInt(m[1], 10) - 1;
  return idx >= 0 && idx < OAK_CROWN_PRESETS.length ? idx : 0;
}

function isPineUrl(url: string): boolean {
  return /pine_\d/.test(url);
}

/**
 * Slim the trunk shaft, add a graceful organic S-curve, and lower + widen the
 * high Y-fork boughs (`y > 1.4`) so even `oak_4_field` (whose raw fork sits at
 * `y = 5.0..6.9`) spreads its main limbs at `y = 2.2..3.95` directly into the
 * lower and middle cloud-domes.
 */
function sculptBroadleafBark(geo: THREE.BufferGeometry, variantIdx: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  if (!pos) return geo;
  const isSlender = variantIdx === 1 || variantIdx === 3;
  const shaftSlim = isSlender ? 0.58 : 0.68;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Lower the high fork region (raw y in [1.3, 7.2] -> [1.3, 3.95]) so the
    // branching fork sits right at the base of the lower/mid cloud-domes and
    // never pokes above the crown.
    if (y > 1.3) {
      const over = y - 1.3;
      y = 1.3 + Math.tanh(over / 3.3) * 2.65;
    }

    const rootBlend = THREE.MathUtils.smoothstep(y, 0.0, 0.7);
    const forkSpread = THREE.MathUtils.smoothstep(y, 1.8, 3.4);
    const radialScale = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.92, shaftSlim, rootBlend),
      1.18,
      forkSpread,
    );
    x *= radialScale;
    z *= radialScale;

    // Gentle organic S-curve along the trunk so no tree reads as a rigid pole.
    const bendW = THREE.MathUtils.smoothstep(y, 0.25, 2.6);
    const phase = variantIdx * 1.65;
    x += Math.sin(y * 1.05 + phase) * 0.2 * bendW;
    z += Math.cos(y * 0.95 + phase) * 0.14 * bendW;

    pos.setXYZ(i, x, y, z);

    const rootAo = THREE.MathUtils.lerp(0.56, 1.0, THREE.MathUtils.smoothstep(y, -0.1, 0.65));
    const canopyShadow = THREE.MathUtils.lerp(1.0, 0.34, THREE.MathUtils.smoothstep(y, 2.35, 3.75));
    const shade = rootAo * canopyShadow;
    const rTone = isSlender ? 0.86 : 0.78;
    const gTone = isSlender ? 0.84 : 0.74;
    const bTone = isSlender ? 0.8 : 0.68;
    colors[i * 3] = rTone * shade;
    colors[i * 3 + 1] = gTone * shade;
    colors[i * 3 + 2] = bTone * shade;
  }

  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function readUvBounds(geo: THREE.BufferGeometry): [number, number, number, number] {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv || uv.count === 0) return [0.05, 0.45, 0.05, 0.95];
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  if (!Number.isFinite(uMin) || uMax - uMin < 1e-3) return [0.05, 0.45, 0.05, 0.95];
  return [uMin, uMax, vMin, vMax];
}

/**
 * Replace a dense field broadleaf bark mesh in-place with a clean 116-triangle
 * sculpted trunk + 3-bough Y-fork for the `low` (`leanFoliage`) tier, cutting
 * per-tree trunk geometry from 1,600 triangles down to 116 (-93%).
 */
function buildLeanBroadleafBarkInPlace(
  geo: THREE.BufferGeometry,
  variantIdx: number,
): THREE.BufferGeometry {
  const [uMin, uMax, vMin, vMax] = readUvBounds(geo);
  const isSlender = variantIdx === 1 || variantIdx === 3;
  const slim = isSlender ? 0.85 : 1.0;
  const phase = variantIdx * 1.65;
  const rTone = isSlender ? 0.86 : 0.78;
  const gTone = isSlender ? 0.84 : 0.74;
  const bTone = isSlender ? 0.8 : 0.68;

  const trunkRadial = 7;
  const trunkRings = [
    { y: -0.15, r: 0.42 * slim },
    { y: 0.55, r: 0.25 * slim },
    { y: 1.4, r: 0.21 * slim },
    { y: 2.25, r: 0.24 * slim },
  ];
  const limbRadial = 5;
  const limbCount = 3;
  const limbSteps = 2; // 3 rings per limb

  const trunkVerts = (trunkRadial + 1) * trunkRings.length;
  const limbVertsPerBough = (limbRadial + 1) * (limbSteps + 1);
  const totalVerts = trunkVerts + limbCount * limbVertsPerBough;
  const trunkTris = trunkRadial * (trunkRings.length - 1) * 2;
  const limbTris = limbCount * limbRadial * limbSteps * 2;
  const totalIndices = (trunkTris + limbTris) * 3;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const colors = new Float32Array(totalVerts * 3);
  const indices = new Uint16Array(totalIndices);

  let vCursor = 0;
  let iCursor = 0;

  const writeVertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    uT: number,
    vT: number,
  ): void => {
    const len = Math.hypot(nx, ny, nz) || 1;
    positions[vCursor * 3] = x;
    positions[vCursor * 3 + 1] = y;
    positions[vCursor * 3 + 2] = z;
    normals[vCursor * 3] = nx / len;
    normals[vCursor * 3 + 1] = ny / len;
    normals[vCursor * 3 + 2] = nz / len;
    uvs[vCursor * 2] = uMin + (uMax - uMin) * uT;
    uvs[vCursor * 2 + 1] = vMin + (vMax - vMin) * vT;
    const rootAo = THREE.MathUtils.lerp(0.56, 1.0, THREE.MathUtils.smoothstep(y, -0.1, 0.65));
    const canopyShadow = THREE.MathUtils.lerp(1.0, 0.34, THREE.MathUtils.smoothstep(y, 2.35, 3.75));
    const shade = rootAo * canopyShadow;
    colors[vCursor * 3] = rTone * shade;
    colors[vCursor * 3 + 1] = gTone * shade;
    colors[vCursor * 3 + 2] = bTone * shade;
    vCursor++;
  };

  for (let ri = 0; ri < trunkRings.length; ri++) {
    const { y, r } = trunkRings[ri];
    const bendW = THREE.MathUtils.smoothstep(y, 0.25, 2.6);
    const cx = Math.sin(y * 1.05 + phase) * 0.2 * bendW;
    const cz = Math.cos(y * 0.95 + phase) * 0.14 * bendW;
    const vT = ri / (trunkRings.length - 1);
    for (let si = 0; si <= trunkRadial; si++) {
      const uT = si / trunkRadial;
      const a = uT * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      writeVertex(cx + ca * r, y, cz + sa * r, ca, 0.08, sa, uT, vT);
    }
  }

  const stride = trunkRadial + 1;
  for (let ri = 0; ri < trunkRings.length - 1; ri++) {
    for (let si = 0; si < trunkRadial; si++) {
      const a = ri * stride + si;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[iCursor++] = a;
      indices[iCursor++] = c;
      indices[iCursor++] = b;
      indices[iCursor++] = b;
      indices[iCursor++] = c;
      indices[iCursor++] = d;
    }
  }

  const topBend = THREE.MathUtils.smoothstep(2.15, 0.25, 2.6);
  const forkX = Math.sin(2.15 * 1.05 + phase) * 0.2 * topBend;
  const forkZ = Math.cos(2.15 * 0.95 + phase) * 0.14 * topBend;

  for (let bi = 0; bi < limbCount; bi++) {
    const boughBase = vCursor;
    const yaw = (bi * Math.PI * 2) / limbCount + 0.45 + variantIdx * 0.5;
    const dirX = Math.cos(yaw);
    const dirZ = Math.sin(yaw);
    for (let ri = 0; ri <= limbSteps; ri++) {
      const t = ri / limbSteps;
      const y = 2.1 + t * 1.45;
      const reach = t ** 1.15 * 1.28;
      const cx = forkX + dirX * reach;
      const cz = forkZ + dirZ * reach;
      const r = THREE.MathUtils.lerp(0.15 * slim, 0.06 * slim, t);
      for (let si = 0; si <= limbRadial; si++) {
        const uT = si / limbRadial;
        const a = uT * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        writeVertex(cx + ca * r, y, cz + sa * r, ca, 0.25, sa, uT, t);
      }
    }
    const lStride = limbRadial + 1;
    for (let ri = 0; ri < limbSteps; ri++) {
      for (let si = 0; si < limbRadial; si++) {
        const a = boughBase + ri * lStride + si;
        const b = a + 1;
        const c = a + lStride;
        const d = c + 1;
        indices[iCursor++] = a;
        indices[iCursor++] = c;
        indices[iCursor++] = b;
        indices[iCursor++] = b;
        indices[iCursor++] = c;
        indices[iCursor++] = d;
      }
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Replace a dense field conifer bark mesh in-place with a clean 48-triangle
 * tapered trunk shaft for the `low` (`leanFoliage`) tier, cutting per-tree
 * pine bark geometry from 1,200 triangles down to 48 (-96%).
 */
function buildLeanPineBarkInPlace(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const minY = bb ? bb.min.y : -0.15;
  const maxY = bb ? bb.max.y : 5.8;
  const baseR = bb ? Math.min(0.36, Math.max(0.22, (bb.max.x - bb.min.x) * 0.22)) : 0.3;
  const [uMin, uMax, vMin, vMax] = readUvBounds(geo);

  const radial = 6;
  const rings = 5;
  const rFactors = [1.0, 0.66, 0.5, 0.34, 0.14];
  const vertCount = (radial + 1) * rings;
  const idxCount = radial * (rings - 1) * 6;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = new Uint16Array(idxCount);

  let vCursor = 0;
  const topY = minY + (maxY - minY) * 0.92;
  for (let ri = 0; ri < rings; ri++) {
    const vT = ri / (rings - 1);
    const y = THREE.MathUtils.lerp(minY, topY, vT);
    const r = baseR * rFactors[ri];
    for (let si = 0; si <= radial; si++) {
      const uT = si / radial;
      const a = uT * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      positions[vCursor * 3] = ca * r;
      positions[vCursor * 3 + 1] = y;
      positions[vCursor * 3 + 2] = sa * r;
      normals[vCursor * 3] = ca;
      normals[vCursor * 3 + 1] = 0.06;
      normals[vCursor * 3 + 2] = sa;
      uvs[vCursor * 2] = uMin + (uMax - uMin) * uT;
      uvs[vCursor * 2 + 1] = vMin + (vMax - vMin) * vT;
      vCursor++;
    }
  }

  let iCursor = 0;
  const stride = radial + 1;
  for (let ri = 0; ri < rings - 1; ri++) {
    for (let si = 0; si < radial; si++) {
      const a = ri * stride + si;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[iCursor++] = a;
      indices[iCursor++] = c;
      indices[iCursor++] = b;
      indices[iCursor++] = b;
      indices[iCursor++] = c;
      indices[iCursor++] = d;
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Build a Genshin Impact / Studio Ghibli style multi-dome cumulus canopy.
 */
function buildGenshinBroadleafCanopy(variantIdx: number, lean = false): THREE.BufferGeometry {
  const rawLobes = OAK_CROWN_PRESETS[variantIdx] ?? OAK_CROWN_PRESETS[0];
  const lobes = lean
    ? rawLobes.map((l) => ({
        ...l,
        cards: Math.max(14, Math.round(l.cards * 0.56)),
        cardScale: l.cardScale * 1.18,
      }))
    : rawLobes;
  const rng = makeSculptRng(9103 + variantIdx * 1777);

  let totalCards = 0;
  let minCrownY = Infinity;
  let maxCrownY = -Infinity;
  for (const l of lobes) {
    totalCards += l.cards;
    minCrownY = Math.min(minCrownY, l.y - l.ry);
    maxCrownY = Math.max(maxCrownY, l.y + l.ry);
  }

  const vertCount = totalCards * 4;
  const idxCount = totalCards * 6;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices = new Uint16Array(idxCount);

  const uLeft = 0.088;
  const uRight = 0.888;
  const vBase = 0.985; // stem end
  const vTip = 0.015; // rounded scalloped leafy top

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const dVec = new THREE.Vector3();
  const upVec = new THREE.Vector3(0, 1, 0);
  const tRight = new THREE.Vector3();
  const tUp = new THREE.Vector3();
  const cardRight = new THREE.Vector3();
  const cardUp = new THREE.Vector3();
  const cardOut = new THREE.Vector3();
  const vPos = new THREE.Vector3();
  const lobeNrm = new THREE.Vector3();

  let cardCursor = 0;

  for (let li = 0; li < lobes.length; li++) {
    const lobe = lobes[li];
    const n = lobe.cards;

    for (let i = 0; i < n; i++) {
      const isInner = i % 4 === 3;
      const f = (i + 0.5) / n;
      const ny = -0.58 + f * 1.56;
      const radial = Math.sqrt(Math.max(0.02, 1 - ny * ny));
      const theta = i * goldenAngle + li * 1.37 + (rng() - 0.5) * 0.22;
      const nx = radial * Math.cos(theta);
      const nz = radial * Math.sin(theta);

      dVec.set(nx, ny, nz).normalize();

      if (Math.abs(dVec.y) > 0.94) {
        tRight.set(Math.cos(theta), 0, Math.sin(theta)).normalize();
      } else {
        tRight.crossVectors(upVec, dVec).normalize();
      }
      tUp.crossVectors(dVec, tRight).normalize();

      const swirl = (rng() - 0.5) * 0.85 + (isInner ? 0.7 : 0.0);
      const cs = Math.cos(swirl);
      const sn = Math.sin(swirl);
      cardRight.copy(tRight).multiplyScalar(cs).addScaledVector(tUp, sn).normalize();
      const tangentForward = tUp
        .clone()
        .multiplyScalar(cs)
        .addScaledVector(tRight, -sn)
        .normalize();

      const pitch = isInner ? 0.9 : 0.52 + (1 - Math.max(0, ny)) * 0.16;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      cardUp.copy(tangentForward).multiplyScalar(cp).addScaledVector(dVec, sp).normalize();
      cardOut.crossVectors(cardRight, cardUp).normalize();
      if (cardOut.dot(dVec) < 0) cardOut.negate();

      const shellR = isInner ? 0.58 + rng() * 0.2 : 0.86 + rng() * 0.14;
      const cx = lobe.x + dVec.x * lobe.rx * shellR;
      const cy = lobe.y + dVec.y * lobe.ry * shellR;
      const cz = lobe.z + dVec.z * lobe.rz * shellR;

      const scale = lobe.cardScale * (isInner ? 1.06 : 0.9 + rng() * 0.2);
      const halfW = scale * 0.54;
      const len = scale * 0.96;
      const cupDepth = scale * 0.21;

      const vBaseOffset = -len * 0.38;
      const vTipOffset = len * 0.62;

      const vBaseIdx = cardCursor * 4;
      for (let row = 0; row < 2; row++) {
        const alongUp = row === 0 ? vBaseOffset : vTipOffset;
        const vCoord = row === 0 ? vBase : vTip;
        const rowW = halfW * (row === 0 ? 0.82 : 1.08);
        const rowCup = cupDepth * (row === 0 ? 0.25 : 0.45);

        for (let col = 0; col < 2; col++) {
          const lateral = col === 0 ? -rowW : rowW;
          const uCoord = col === 0 ? uLeft : uRight;

          vPos.set(cx, cy, cz);
          vPos.addScaledVector(cardRight, lateral);
          vPos.addScaledVector(cardUp, alongUp);
          vPos.addScaledVector(cardOut, rowCup);

          const vi = vBaseIdx + row * 2 + col;
          positions[vi * 3] = vPos.x;
          positions[vi * 3 + 1] = vPos.y;
          positions[vi * 3 + 2] = vPos.z;

          uvs[vi * 2] = uCoord;
          uvs[vi * 2 + 1] = vCoord;

          // Pure per-lobe ellipsoid normal so every individual cloud-dome
          // shades with its own distinct sunlit cap and shaded belly.
          lobeNrm
            .set(
              (vPos.x - lobe.x) / lobe.rx,
              (vPos.y - lobe.y) / lobe.ry + 0.08,
              (vPos.z - lobe.z) / lobe.rz,
            )
            .normalize();

          normals[vi * 3] = lobeNrm.x;
          normals[vi * 3 + 1] = lobeNrm.y;
          normals[vi * 3 + 2] = lobeNrm.z;

          // Per-dome sunlit crescent + under-belly AO:
          // Combine vertical position in the dome (lobeUp) with a gentle
          // outward/sunward bias so overlapping cumulus domes have a crisp dark
          // emerald underside and a warm sunlit chartreuse-gold top crescent.
          const lx = (vPos.x - lobe.x) / lobe.rx;
          const ly = (vPos.y - lobe.y) / lobe.ry;
          const lz = (vPos.z - lobe.z) / lobe.rz;
          const domeSignal = THREE.MathUtils.clamp(ly * 0.82 + (lx - lz) * 0.18, -1, 1);
          const lowerT = THREE.MathUtils.smoothstep(domeSignal, -0.52, 0.05);
          const upperT = THREE.MathUtils.smoothstep(domeSignal, 0.12, 0.68);
          const crownT = THREE.MathUtils.clamp(
            (vPos.y - minCrownY) / Math.max(0.5, maxCrownY - minCrownY),
            0,
            1,
          );
          const innerAo = isInner ? 0.68 : 0.9 + row * 0.12;
          const crownLift = 0.82 + crownT * 0.24;

          const rMid = THREE.MathUtils.lerp(0.42, 0.86, lowerT);
          const gMid = THREE.MathUtils.lerp(0.48, 0.92, lowerT);
          const bMid = THREE.MathUtils.lerp(0.46, 0.82, lowerT);

          const rCol = THREE.MathUtils.lerp(rMid, 1.22, upperT) * innerAo * crownLift;
          const gCol = THREE.MathUtils.lerp(gMid, 1.2, upperT) * innerAo * crownLift;
          const bCol = THREE.MathUtils.lerp(bMid, 0.96, upperT) * innerAo * crownLift;

          colors[vi * 3] = rCol;
          colors[vi * 3 + 1] = gCol;
          colors[vi * 3 + 2] = bCol;
        }
      }

      const ii = cardCursor * 6;
      indices[ii] = vBaseIdx + 0;
      indices[ii + 1] = vBaseIdx + 1;
      indices[ii + 2] = vBaseIdx + 3;
      indices[ii + 3] = vBaseIdx + 0;
      indices[ii + 4] = vBaseIdx + 3;
      indices[ii + 5] = vBaseIdx + 2;

      cardCursor++;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Enhance conifer leaf tiers (Leaves_Pine) with smooth conical dome normals and
 * per-bough vertical AO vertex colors so mountain pines read as plush, layered
 * Ghibli evergreens rather than flat paper cones.
 */
function sculptPineCanopy(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  if (!pos || !nrm) return geo;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const minY = bb.min.y;
  const maxY = Math.max(minY + 0.5, bb.max.y);
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const hT = THREE.MathUtils.clamp((y - minY) / (maxY - minY), 0, 1);
    const r = Math.hypot(x, z);
    v.set(x, r * 0.55 + 0.35, z).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);

    const tipT = THREE.MathUtils.clamp(r / Math.max(0.6, 2.6 * (1 - hT * 0.65)), 0, 1);
    const shade = (0.58 + 0.42 * tipT) * (0.76 + 0.28 * hT);
    colors[i * 3] = shade * 0.92;
    colors[i * 3 + 1] = shade * 1.04;
    colors[i * 3 + 2] = shade * 0.96;
  }
  nrm.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Deterministic per-tree canopy color for Eastbrook Vale ('vale' biome) so
 * groves showcase Genshin Impact's multi-hue foliage palette:
 *   - Deep Forest Emerald-Jade (~22%)
 *   - Fresh Mondstadt Meadow Green (~28%)
 *   - Sunlit Spring Lime-Chartreuse (~28%)
 *   - Warm Golden-Yellow Birch / Ginkgo (~22%)
 */
export function resolveTreeLeafColor(
  biome: string,
  x: number,
  z: number,
  baseHex: number,
  out: THREE.Color,
  soften: number,
): THREE.Color {
  const h1 = Math.sin(x * 12.9898 + z * 78.233 + 23.47) * 43758.5453;
  const r1 = h1 - Math.floor(h1);
  const h2 = Math.sin(x * 39.346 + z * 11.135 + 73.15) * 28461.713;
  const r2 = h2 - Math.floor(h2);

  if (biome !== 'vale') {
    out.setHex(baseHex).lerp(WHITE, soften);
    out.offsetHSL((r1 - 0.5) * 0.085, (r2 - 0.5) * 0.16, (r1 - 0.5) * 0.12);
    return out;
  }

  // Leaves_NormalTree's opaque texels have linear RGB (0.099, 0.197, 0.000):
  // green is 2x red in the raw atlas. After oakSets' (1.45, 1.14, 1.15) base
  // lift, base R:G is 0.1435 : 0.2246. The multipliers below are calibrated
  // against that ratio so golden/amber canopies genuinely cross into R > G
  // while chartreuse, meadow green, and forest emerald span the green spectrum.
  const v = 0.94 + r2 * 0.12;
  if (r1 < 0.1) {
    // Warm Autumn Amber-Gold accent (~10%, linear R:G ~ 1.83)
    return out.setRGB(2.35 * v, 0.82 * v, 0.38 * v);
  }
  if (r1 < 0.28) {
    // Radiant Golden-Yellow Birch / Ginkgo crown (~18%, linear R:G ~ 1.36)
    return out.setRGB(2.05 * v, 0.96 * v, 0.45 * v);
  }
  if (r1 < 0.52) {
    // Sunlit Spring Lime-Chartreuse crown (~24%, linear R:G ~ 0.77)
    return out.setRGB(1.38 * v, 1.14 * v, 0.68 * v);
  }
  if (r1 < 0.78) {
    // Fresh Mondstadt Meadow Green crown (~26%, linear R:G ~ 0.50)
    return out.setRGB(0.82 * v, 1.04 * v, 0.92 * v);
  }
  // Deep Forest Emerald-Jade crown (~22%, linear R:G ~ 0.34)
  return out.setRGB(0.46 * v, 0.86 * v, 1.05 * v);
}

/**
 * Entry point called by `extractParts(url)` in `src/render/foliage.ts` before
 * `foliageMaterial` is constructed, so `color` attributes automatically enable
 * `vertexColors: true` across the live instanced meshes, shadow casters,
 * impostor atlas bakes, and shader prewarm twins.
 */
export function sculptFoliageTreeGeometry(
  url: string,
  materialName: string,
  bakedGeo: THREE.BufferGeometry,
  lean = false,
): THREE.BufferGeometry {
  const oakIdx = oakVariantIndexFromUrl(url);
  if (oakIdx !== null) {
    if (materialName === 'Bark_NormalTree') {
      if (lean && (bakedGeo.index?.count ?? 0) > 600) {
        return buildLeanBroadleafBarkInPlace(bakedGeo, oakIdx);
      }
      return sculptBroadleafBark(bakedGeo, oakIdx);
    }
    if (materialName === 'Leaves_NormalTree') {
      bakedGeo.dispose();
      return buildGenshinBroadleafCanopy(oakIdx, lean);
    }
  }
  if (isPineUrl(url)) {
    if (materialName === 'Bark_NormalTree' && lean && (bakedGeo.index?.count ?? 0) > 600) {
      return buildLeanPineBarkInPlace(bakedGeo);
    }
    if (materialName === 'Leaves_Pine') {
      return sculptPineCanopy(bakedGeo);
    }
  }
  return bakedGeo;
}

const instancedMeshBounds = new WeakMap<
  THREE.InstancedMesh,
  { x: number; z: number; radius: number }
>();

export function foliageSpotsBounds(
  items: readonly { x: number; z: number }[],
  margin: number,
): { x: number; z: number; radius: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < items.length; i++) {
    const d = items[i];
    if (d.x < minX) minX = d.x;
    if (d.x > maxX) maxX = d.x;
    if (d.z < minZ) minZ = d.z;
    if (d.z > maxZ) maxZ = d.z;
  }
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    radius: Math.hypot(maxX - minX, maxZ - minZ) / 2 + margin,
  };
}

export function recordFoliageMeshBounds(
  mesh: THREE.InstancedMesh,
  items: readonly { x: number; z: number }[],
  margin: number,
): { x: number; z: number; radius: number } {
  const bounds = foliageSpotsBounds(items, margin);
  instancedMeshBounds.set(mesh, bounds);
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return bounds;
}

export function foliageMeshBoundsOr(
  mesh: THREE.InstancedMesh,
  bx: number,
  bz: number,
  bRadius: number,
): { x: number; z: number; radius: number } {
  return instancedMeshBounds.get(mesh) ?? { x: bx, z: bz, radius: bRadius };
}
