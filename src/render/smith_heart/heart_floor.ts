// The Anvil of the World's floor material (phase 2N, design doc section
// 5.21; the paint is heart_floor_glsl.ts): the kit's stone, lit like any
// floor (it takes the room's light and the shadows), with the slabs, their
// joints, the wear and the soot painted over the sheet's broad paint. One
// shared material per tier for the four quarters (each quarter's drift rides
// its vertex colour), opaque, so every telegraph and floor mark draws over it
// as over stone.
//
// Cosmetic only: the low tier drops the brush strokes, the hairlines and an
// octave of noise; the Lambert tier keeps the slabs and the joints unlit by
// the arris. No light, no texture (the stone's shared triplanar detail where
// the tier draws it). Built with the interior (the compile gate links it
// with the quarters).

import * as THREE from 'three';
import { GFX } from '../gfx';
import { markSharedMaterial } from '../shared_resource';
import { applySurfaceDetail } from '../worn_stone';
import {
  HEART_FLOOR_NORMAL,
  HEART_FLOOR_ROUGH,
  HEART_FLOOR_VERT_BODY,
  HEART_FLOOR_VERT_HEAD,
  heartFloorFragHead,
  heartFloorPaint,
} from './heart_floor_glsl';

const mats = new Map<string, THREE.Material>();

/** Each quarter's flood (`HEART_QUARTER_ORDER`) for the scars the floor paints:
 *  how awake (x to w) and how far its front has run (yards). One Smith's Heart
 *  field draws at a time, so one shared pair (heart_quarters.ts writes it). */
const SCAR_AWAKE = { value: new THREE.Vector4() };
const SCAR_FRONT = { value: new THREE.Vector4() };

/** Tell the floor quarter `i`'s flood (the frame). */
export function setHeartFloorQuarter(i: number, awake: number, front: number): void {
  SCAR_AWAKE.value.setComponent(i, awake);
  SCAR_FRONT.value.setComponent(i, front);
}

/** Patch a floor material's shaders with the paint (`lit`: the standard
 *  tier's arris and polish too). */
function paint(m: THREE.Material, lowGfx: boolean, lit: boolean): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHfAwake = SCAR_AWAKE;
    shader.uniforms.uHfFront = SCAR_FRONT;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HEART_FLOOR_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${HEART_FLOOR_VERT_BODY}`);
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${heartFloorFragHead(lowGfx)}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${heartFloorPaint(lowGfx)}`,
      );
    if (lit) {
      frag = frag
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>\n${HEART_FLOOR_NORMAL}`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>\n${HEART_FLOOR_ROUGH}`,
        );
    }
    shader.fragmentShader = frag;
  };
  m.customProgramCacheKey = () =>
    `smith-heart-floor|${lowGfx ? 'low' : 'full'}|${lit ? 'lit' : 'flat'}`;
}

/** The floor's material for the quarters' stone (shared per tier). */
export function heartFloorMaterial(lowGfx: boolean): THREE.Material {
  const key = `${GFX.standardMaterials ? 'std' : 'lambert'}|${lowGfx ? 'low' : 'full'}`;
  const cached = mats.get(key);
  if (cached) return cached;
  let m: THREE.Material;
  if (GFX.standardMaterials) {
    const std = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.03,
      roughness: 0.86,
      name: 'SmithHeartFloor',
    });
    paint(std, lowGfx, true);
    // The stone's grain close up (composes on the paint, runs it first).
    applySurfaceDetail(std, 'rock', { strength: 0.18 });
    m = std;
  } else {
    m = new THREE.MeshLambertMaterial({ vertexColors: true, name: 'SmithHeartFloor' });
    paint(m, lowGfx, false);
  }
  markSharedMaterial(m);
  mats.set(key, m);
  return m;
}
