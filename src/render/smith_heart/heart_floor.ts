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
  HEART_FLOOR_LOOK,
  HEART_FLOOR_NORMAL,
  HEART_FLOOR_ROUGH,
  HEART_FLOOR_VERT_BODY,
  HEART_FLOOR_VERT_COLOR,
  HEART_FLOOR_VERT_HEAD,
  HEART_FLOOR_VERT_NORMAL,
  heartFloorFragHead,
  heartFloorPaint,
} from './heart_floor_glsl';
import { HEART_FLOOR_SOCKETS, HEART_SOCKET_SAMPLE } from './heart_floor_rite_core';

const mats = new Map<string, THREE.Material>();

/** Each quarter's flood (`HEART_QUARTER_ORDER`) for the scars the floor paints:
 *  how awake (x to w) and how far its front has run (yards). One Smith's Heart
 *  field draws at a time, so one shared pair (heart_quarters.ts writes it). */
const SCAR_AWAKE = { value: new THREE.Vector4() };
const SCAR_FRONT = { value: new THREE.Vector4() };

/** How much of the rite marks show (heart_floor_rite_core.ts: the grooves
 *  and the arrival's sockets, 1 through the arrival or the death, else 0),
 *  and the sheet's paint round each socket for its mend. */
const RITE = { value: 0 };
const SOCKET_PAINT = {
  value: HEART_FLOOR_SOCKETS.map(() => new THREE.Color(0.42, 0.37, 0.31)),
};

/** Tell the floor how much of the rite shows (the frame). */
export function setHeartFloorRite(rite: number): void {
  const k = Math.round(Math.max(0, Math.min(1, rite)) * 1000) / 1000;
  if (RITE.value !== k) RITE.value = k;
}

/** The floor's rite share now (tests). */
export function heartFloorRiteNow(): number {
  return RITE.value;
}

/** Sample the sheet's own broad paint round each socket (the up-facing
 *  vertices at the sheet's height in a ring just past its mend) from the
 *  quarters' floor pieces, so a mended socket wears the paint round it. Once,
 *  at the build; a socket with no sample keeps the warm stone default. */
export function sampleHeartFloorSockets(
  pieces: readonly (THREE.BufferGeometry | undefined)[],
): void {
  const sums = HEART_FLOOR_SOCKETS.map(() => [0, 0, 0, 0]);
  for (const g of pieces) {
    const pos = g?.getAttribute('position');
    const nrm = g?.getAttribute('normal');
    const col = g?.getAttribute('color');
    if (!pos || !nrm || !col) continue;
    for (let v = 0; v < pos.count; v++) {
      if (nrm.getY(v) < 0.999 || Math.abs(pos.getY(v) - HEART_FLOOR_LOOK.sheetY) > 0.012) continue;
      const x = pos.getX(v);
      const z = pos.getZ(v);
      for (let i = 0; i < HEART_FLOOR_SOCKETS.length; i++) {
        const sk = HEART_FLOOR_SOCKETS[i];
        const d = Math.hypot(x - sk.x, z - sk.z);
        if (d < sk.r || d > sk.r + HEART_SOCKET_SAMPLE) continue;
        const s = sums[i];
        s[0] += col.getX(v);
        s[1] += col.getY(v);
        s[2] += col.getZ(v);
        s[3]++;
      }
    }
  }
  sums.forEach((s, i) => {
    if (s[3] > 0) SOCKET_PAINT.value[i].setRGB(s[0] / s[3], s[1] / s[3], s[2] / s[3]);
  });
}

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
    shader.uniforms.uHfRite = RITE;
    shader.uniforms.uHfSockCol = SOCKET_PAINT;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HEART_FLOOR_VERT_HEAD}`)
      .replace('#include <color_vertex>', `#include <color_vertex>\n${HEART_FLOOR_VERT_COLOR}`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>\n${HEART_FLOOR_VERT_NORMAL}`,
      )
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
