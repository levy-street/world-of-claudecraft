// The Heart's room drawn in round the platform (phase 2N, design doc section
// 5.21): at 120 yd the Anvil of the World read as a disc in space, the crown
// far off. With the wall landmarks standing as each quarter's outer wall,
// this closes the rest of the frame:
//   - the abyss's glow under the platform's lip: the heart's light welling
//     up the chasm and catching the underside, a warm skirt of light hung
//     under the rim (brightest deep down, fading up to the lip) and a broad
//     pool of it far below, so the platform reads as hung over a lit depth;
//   - depth haze: a ring of warm dusk air between the room and the crown,
//     thick low in the chasm and thinning upward, so the crown steps back
//     behind the landmarks in layers instead of standing flat.
// The glow beats with the heart and rises with the ring in the final phase;
// it goes dark with the heart. Cosmetic only (no floor, nothing a player
// acts on), the same on every tier.
//
// GPU preparation: built with the interior with the quarters (the compile
// gate links its three materials); no light; no texture; the per-frame
// update writes uniforms only. Every point goes through `modelViewMatrix`
// on a mesh placed at the room's centre (room-local).

import * as THREE from 'three';
import { HEART_ROOM } from '../../sim/content/smith_heart_layout';
import { sharedUniforms } from '../gfx';

/** The frame's measures (yards, room-local; y from the walk). */
export const HEART_SURROUND = {
  /** The skirt of light under the lip: its radius and its depth. */
  skirt: { r: HEART_ROOM.r + 1.6, top: -1.2, bottom: -46 },
  /** The pool of light far down the chasm. */
  pool: { r: 150, y: -60 },
  /** The haze ring between the room and the crown. */
  haze: { r: 108, bottom: -70, top: 46 },
} as const;

const SKIRT_VERT = /* glsl */ `
varying float vV;
varying float vAng;
void main() {
  vV = uv.y;
  vAng = atan(position.x, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKIRT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uTime;
varying float vV;
varying float vAng;
void main() {
  // Brightest deep down (the abyss's light), fading up to the lip; slow
  // tongues of it licking up the keel.
  float up = vV;
  float tongue = 0.6 + 0.4 * sin(vAng * 11.0 + sin(vAng * 3.0 + uTime * 0.4) * 2.0 - uTime * 0.6);
  float a = uK * (1.0 - smoothstep(0.15, 1.0, up)) * (0.55 + 0.45 * tongue) * smoothstep(0.0, 0.08, up);
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

const POOL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const POOL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uR;
varying vec2 vP;
void main() {
  float r = length(vP) / uR;
  float a = uK * (1.0 - smoothstep(0.0, 1.0, r)) * (0.5 + 0.5 * (1.0 - r));
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

const HAZE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uTime;
varying float vV;
varying float vAng;
void main() {
  // Thick low in the chasm, thinning upward; drifting in slow folds.
  float fold = 0.75 + 0.25 * sin(vAng * 5.0 + uTime * 0.05 + sin(vAng * 2.0 - uTime * 0.03) * 1.5);
  float a = uK * (1.0 - smoothstep(0.1, 0.85, vV)) * fold;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

export interface HeartSurround {
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
  /** `ring`: the ring's light (0 to 1, the room awake); `blaze`: the final
   *  phase's; `dark`: the heart's fall. */
  set(ring: number, blaze: number, dark: number): void;
}

function band(r: number, y0: number, y1: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, y1 - y0, 96, 1, true).translate(0, (y0 + y1) / 2, 0);
}

/** The frame round the platform (instance-local, the room's centre
 *  `centre`). */
export function buildHeartSurround(centre: THREE.Vector3): HeartSurround {
  const group = new THREE.Group();
  group.name = 'smithHeartSurround';
  const S = HEART_SURROUND;
  const add = (geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, name: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(centre);
    m.name = name;
    group.add(m);
  };
  const glow = (name: string, color: number, vert: string, frag: string, extra = {}) =>
    new THREE.ShaderMaterial({
      name,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uColor: { value: new THREE.Color(color) },
        uK: { value: 0 },
        ...extra,
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
  const skirt = glow('smithHeartAbyssSkirt', 0xff9a3c, SKIRT_VERT, SKIRT_FRAG);
  // The skirt's uv.y runs 0 at its foot to 1 at the lip.
  add(band(S.skirt.r, S.skirt.bottom, S.skirt.top), skirt, 'heartAbyssSkirt');
  const pool = glow('smithHeartAbyssPool', 0xff8a30, POOL_VERT, POOL_FRAG, {
    uR: { value: S.pool.r },
  });
  const disc = new THREE.CircleGeometry(S.pool.r, 64)
    .rotateX(-Math.PI / 2)
    .translate(0, S.pool.y, 0);
  add(disc, pool, 'heartAbyssPool');
  const haze = new THREE.ShaderMaterial({
    name: 'smithHeartHaze',
    uniforms: {
      uTime: sharedUniforms.uTime,
      uColor: { value: new THREE.Color(0x4a3236) },
      uK: { value: 0 },
    },
    vertexShader: SKIRT_VERT,
    fragmentShader: HAZE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  add(band(S.haze.r, S.haze.bottom, S.haze.top), haze, 'heartHaze');
  const mats = [skirt, pool, haze];
  const set = (u: THREE.IUniform, v: number) => {
    const k = Math.round(v * 1000) / 1000;
    if (u.value !== k) u.value = k;
  };
  return {
    group,
    materials: mats,
    set(ring, blaze, dark) {
      const live = 1 - dark;
      set(skirt.uniforms.uK, (0.5 + 0.35 * ring + 0.8 * blaze) * live);
      set(pool.uniforms.uK, (0.18 + 0.12 * ring + 0.3 * blaze) * live);
      set(haze.uniforms.uK, 0.55 * (0.4 + 0.6 * live));
    },
  };
}
