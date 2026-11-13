// The Ring's stone (heart_kit.ts's `ringStone` material, the owner's Ring concept of
// 2026-11-11): the Ring kit's paving, curbs, stairs, parapets, dais and standing stones
// in a cool pale grey-mauve, the warm dusk light catching it, where the kit was painted a
// sand tan. Graded from the kit's own vertex paint, so every slab's value, the joints and
// the wear survive: the paint keeps its luminance (lifted a touch, `lift`) and gives up
// `keep` of its own hue for the mauve (`tint`, a hue only: its luminance is divided out).
// One program for every Ring piece; the key keeps it apart from the stone's. No texture,
// no light.

import type * as THREE from 'three';

/** The grade (linear rgb): `tint` the hue the paint turns to, `keep` the share of the
 *  paint's own colour kept, `lift` on its value. */
export const RING_STONE_GRADE = {
  tint: [1.0, 0.84, 1.22],
  keep: 0.12,
  lift: 1.3,
} as const;

const LUMA = [0.2126, 0.7152, 0.0722] as const;

const luma = (c: readonly number[]): number => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

/** The graded colour of a painted rgb (linear), mirrored from the GLSL below for the
 *  tests. */
export function ringStoneGrade(rgb: readonly [number, number, number]): [number, number, number] {
  const G = RING_STONE_GRADE;
  const l = luma(rgb) * G.lift;
  const t = luma(G.tint);
  return [0, 1, 2].map((k) => {
    const hue = (G.tint[k] / t) * l;
    return hue + (rgb[k] * G.lift - hue) * G.keep;
  }) as [number, number, number];
}

const vec = (v: readonly number[]): string => v.map((x) => x.toFixed(4)).join(', ');

const KEY = `smith-heart-ring-stone|${RING_STONE_GRADE.tint.join(',')}|${RING_STONE_GRADE.keep}|${RING_STONE_GRADE.lift}`;

/** Wire the grade into a lit vertex-colour material (returns it). */
export function applyRingStoneLook<T extends THREE.Material>(mat: T): T {
  const G = RING_STONE_GRADE;
  const t = luma(G.tint);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
        {
          // The Ring's stone: the paint's value, the concept's grey-mauve hue.
          vec3 rsPaint = diffuseColor.rgb * ${G.lift.toFixed(3)};
          float rsL = dot( rsPaint, vec3( ${vec(LUMA)} ) );
          vec3 rsHue = vec3( ${vec(G.tint.map((v) => v / t))} ) * rsL;
          diffuseColor.rgb = mix( rsHue, rsPaint, ${G.keep.toFixed(3)} );
        }`,
    );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${KEY}|${prevKey()}`;
  return mat;
}
