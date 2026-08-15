// Blush and eyeshadow as a texture decal on the bare head.
//
// The third makeup layer, LIPSTICK, is deliberately not here: the mouth is its
// own part standing proud of the skin, so paint applied to the head at the lip
// band lands behind the lips and is never seen. It is a material tint on that
// part instead (assets.ts), which costs no mesh and no texture.
//
// Everything below rides the machinery stubble.ts already proved: the head's
// own surface, trimmed to a region, subdivided, lifted a fraction of a
// millimetre and unwrapped by the same azimuthal-equidistant projection. Only
// the MASK and the colour differ. In particular the decal is a plain `map` on a
// MeshStandardMaterial rather than a shader, because `tintedMaterial` rebuilds
// every character material as Lambert on the low graphics tier and an injected
// shader silently vanishes there.
//
// Where the shapes come from
// --------------------------
// Measured off the shipped head, not guessed (tmp/_head_feats.mjs dumps the
// morph targets, tmp/_head_map.mjs projects a part into the head's angles):
//
//   eye part      theta  90..100, |az| 20..40   (both heads)
//   brow morph    theta  63.. 90, |az| <= 42, peak theta 73 (M) / 79 (F)
//   cheeks morph  theta  77..126, peak theta 94 az 81 (M) / 93, 79 (F)
//   mouth part    theta 120..127, |az| <= 20
//
// So the lid is the gap between the eye and the brow, theta 80..92, and the
// cheek's apple sits below and inboard of the cheekbone's peak. Both shapes are
// stated in those angles, which is why one set of numbers fits both heads: the
// frame is each head's own bounding box mapped to the unit sphere, so the ~3%
// proportion difference is already divided out.
import * as THREE from 'three';
import {
  type BlushShade,
  blushColor,
  type Gender,
  MAT_MAKEUP,
  type MakeupSelection,
  type ShadowShade,
  shadowColor,
  wearsFaceDecal,
} from './modular';
import {
  buildRegionDecalGeometry,
  cachedHeadFrame,
  DECAL_TEX_SIZE,
  type DecalRegion,
  decalUv,
} from './stubble';

const DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

/**
 * A soft ellipse in (theta, azimuth), mirrored onto both sides of the face.
 *
 * `power` above 2 flattens the top so the patch reads as a swept shape rather
 * than a circular dot, the same superellipse trick the lip mask in stubble.ts
 * uses, and for the same reason: a plain ellipse sized to reach the corners
 * swallows everything between them.
 */
interface Patch {
  theta: number;
  az: number;
  halfTheta: number;
  halfAz: number;
  power: number;
  /** rotation of the patch in the (az, theta) plane, degrees; tilts a shape
   *  that should follow a feature running diagonally across the face */
  tilt: number;
}

function patchCoverage(p: Patch, theta: number, az: number): number {
  // mirror: the face is symmetric, so only one side is ever described
  const a = Math.abs(az);
  const t = Math.tan((p.tilt / DEG) as number);
  // rotate into the patch's own frame (small angles, so a shear is enough and
  // keeps the mask separable)
  const dAz = a - p.az;
  const dTh = theta - p.theta - t * dAz;
  const u = dAz / p.halfAz;
  const v = dTh / p.halfTheta;
  const r = (Math.abs(u) ** p.power + Math.abs(v) ** p.power) ** (1 / p.power);
  if (r >= 1) return 0;
  // smooth falloff to the rim: makeup has no hard edge
  const e = 1 - r;
  return e * e * (3 - 2 * e);
}

/**
 * Eyeshadow: the lid, between the top of the eye and the brow.
 *
 * Centred a little ABOVE the eye's own band (which runs theta 90..100) so the
 * colour reads as sitting on the lid rather than as a ring round the eye, and
 * tilted so the outer end lifts, which is what every swept eyeshadow does and
 * what stops it reading as a bruise.
 */
const SHADOW_PATCH: Patch = {
  theta: 88,
  az: 29,
  halfTheta: 6,
  halfAz: 12,
  power: 2.4,
  // A little lift at the outer end reads as swept. A lot of it reads as a
  // bruise at the temple, which is what -22 gave.
  tilt: -12,
};

/**
 * Blush: the apple of the cheek, below the eye and inboard of the cheekbone's
 * peak (theta 94, az 81), which is out at the ear and would read as war paint.
 */
const BLUSH_PATCH: Patch = {
  // Below the eye (which ends at theta 100) and well inboard of the ear (which
  // starts at |az| 85): centred at 104 the top of the patch reached eye level
  // and read as colour on the temple rather than on the cheek.
  theta: 110,
  az: 55,
  halfTheta: 10,
  halfAz: 17,
  power: 2.2,
  tilt: 10,
};

export function eyeshadowCoverage(theta: number, az: number): number {
  return patchCoverage(SHADOW_PATCH, theta, az);
}

export function blushCoverage(theta: number, az: number): number {
  return patchCoverage(BLUSH_PATCH, theta, az);
}

/** The head window both patches fit inside, with a margin so the falloff is
 *  never cut off by the trim. */
export const MAKEUP_REGION: DecalRegion = {
  minTheta: SHADOW_PATCH.theta - SHADOW_PATCH.halfTheta - 8,
  maxTheta: BLUSH_PATCH.theta + BLUSH_PATCH.halfTheta + 8,
  maxAz: BLUSH_PATCH.az + BLUSH_PATCH.halfAz + 10,
};

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------
//
// Unlike the stubble map, the COLOURS are baked in rather than left to the
// material tint: there are two layers here in two different colours, and one
// material cannot carry both. The material is left white and multiplies
// through. That makes the cache key the pair of shades, which is fine, there
// are 4x5 = 20 of them at most and the map is small.

/** Side of the generated map. A quarter of the stubble map's: these patches
 *  cover a few hundred square degrees between them rather than a whole head,
 *  and every texel outside them is wasted. */
export const MAKEUP_TEX_SIZE = 512;

export function makeupTextureData(
  sel: Pick<MakeupSelection, 'blush' | 'eyeshadow'>,
  size = MAKEUP_TEX_SIZE,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(size * size * 4));
  const shadow = shadowColor(sel.eyeshadow);
  const blush = blushColor(sel.blush);
  // RGB must be valid in EVERY texel, covered or not: three multiplies the
  // whole texel into the fragment, so a transparent texel left at black bleeds
  // through bilinear filtering and rings the patch with a dark halo. Filling
  // with the layer's own colour means the bleed is invisible instead.
  const fill = shadow ?? blush ?? 0xffffff;
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = (fill >> 16) & 0xff;
    out[i * 4 + 1] = (fill >> 8) & 0xff;
    out[i * 4 + 2] = fill & 0xff;
  }
  if (shadow === null && blush === null) return out;
  // Blush is the lighter of the two on purpose: it is colour in the skin, while
  // eyeshadow is colour ON it.
  const SHADOW_ALPHA = 0.5;
  const BLUSH_ALPHA = 0.34;
  for (let row = 0; row < size; row++) {
    const v = (row + 0.5) / size - 0.5;
    for (let colIdx = 0; colIdx < size; colIdx++) {
      const u = (colIdx + 0.5) / size - 0.5;
      const r = Math.sqrt(u * u + v * v);
      if (r > 0.5) continue; // outside the disc: no direction maps here
      const theta = r * 360;
      const az = Math.atan2(u, v) * DEG;
      let cover = 0;
      let color = 0;
      if (shadow !== null) {
        const c = eyeshadowCoverage(theta, az) * SHADOW_ALPHA;
        if (c > cover) {
          cover = c;
          color = shadow;
        }
      }
      if (blush !== null) {
        const c = blushCoverage(theta, az) * BLUSH_ALPHA;
        if (c > cover) {
          cover = c;
          color = blush;
        }
      }
      if (cover <= 0.002) continue;
      const i = (row * size + colIdx) * 4;
      out[i] = (color >> 16) & 0xff;
      out[i + 1] = (color >> 8) & 0xff;
      out[i + 2] = color & 0xff;
      out[i + 3] = Math.min(255, Math.round(cover * 255));
    }
  }
  return out;
}

export function makeupKeyOf(sel: Pick<MakeupSelection, 'blush' | 'eyeshadow'>): string {
  return `${sel.blush}|${sel.eyeshadow}`;
}

const textureCache = new Map<string, THREE.DataTexture>();

export function makeupTexture(
  sel: Pick<MakeupSelection, 'blush' | 'eyeshadow'>,
): THREE.DataTexture {
  const key = makeupKeyOf(sel);
  const hit = textureCache.get(key);
  if (hit) return hit;
  const tex = new THREE.DataTexture(
    makeupTextureData(sel),
    MAKEUP_TEX_SIZE,
    MAKEUP_TEX_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.name = `makeup_${key}`;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  textureCache.set(key, tex);
  return tex;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function makeupMaterial(
  sel: Pick<MakeupSelection, 'blush' | 'eyeshadow'>,
): THREE.MeshStandardMaterial {
  const key = makeupKeyOf(sel);
  const hit = materialCache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshStandardMaterial({
    name: MAT_MAKEUP,
    map: makeupTexture(sel),
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  // Same bias the stubble decal needs, for the same reason: it floats a
  // fraction of a millimetre off the face and would z-fight without one.
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -1;
  materialCache.set(key, mat);
  return mat;
}

// ---------------------------------------------------------------------------
// The mesh
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry | null>();

function makeupGeometry(head: THREE.BufferGeometry): THREE.BufferGeometry | null {
  // Cut ONCE per head geometry: unlike the stubble, the region does not depend
  // on which shades are worn, so every shade combination shares one cut.
  const key = head.uuid;
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  const frame = cachedHeadFrame(head);
  const geo = frame ? buildRegionDecalGeometry(head, frame, MAKEUP_REGION) : null;
  geoCache.set(key, geo);
  return geo;
}

/** The blush/eyeshadow mesh for a composed character, or null when neither is
 *  worn (in which case NOTHING is added and the face is exactly the head). */
export function buildMakeupDecal(
  head: THREE.SkinnedMesh,
  sel: MakeupSelection,
): THREE.SkinnedMesh | null {
  if (!wearsFaceDecal(sel)) return null;
  const geo = makeupGeometry(head.geometry);
  if (!geo) return null;
  const decal = new THREE.SkinnedMesh(geo, makeupMaterial(sel));
  decal.name = 'ModMakeupDecal';
  decal.position.copy(head.position);
  decal.quaternion.copy(head.quaternion);
  decal.scale.copy(head.scale);
  decal.frustumCulled = head.frustumCulled;
  // Over the stubble decal, which is scalp growth and belongs UNDER paint.
  decal.renderOrder = head.renderOrder + 1;
  decal.layers.mask = head.layers.mask;
  decal.castShadow = false;
  decal.receiveShadow = head.receiveShadow;
  decal.bindMode = head.bindMode;
  decal.bind(head.skeleton, head.bindMatrix);
  // Same targets, same names, applyMorphs drives both off the head's own
  // dictionary, so a face slider moves the skin and the paint on it together.
  if (head.morphTargetDictionary) {
    decal.morphTargetDictionary = head.morphTargetDictionary;
    decal.morphTargetInfluences = new Array(geo.morphAttributes.position?.length ?? 0).fill(0);
  }
  if (geo.boundingSphere) decal.boundingSphere = geo.boundingSphere.clone();
  return decal;
}

/** Re-exported so callers do not have to reach into two modules to find the
 *  head a decal rides. */
export { headNodeName } from './stubble';
export type { BlushShade, Gender, ShadowShade };
export { DECAL_TEX_SIZE, decalUv };
