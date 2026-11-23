// Edge-on fade for the kit foliage's cutout cards (the `Leaves_dg_*` planting
// the Tidehold kit buildings carry).
//
// A foliage card is a flat alpha-cutout quad. Seen within a few degrees of
// edge-on it collapses to a thin line of texture: a bright sliver across a
// canopy, a spike radiating from a pine seen from underneath. The review of
// the 2026-09-24 foliage rebuild flagged it on every kit ("pale edge-on
// slashes", "long thin edge-on spikes"). Geometry cannot hide it, some card
// is always edge-on to some camera, so the fragment shader does: alpha is
// scaled by how squarely the card faces the camera, from the card's own
// GEOMETRIC normal (screen-space derivatives of the view position; the
// shading normals are canopy-volume normals that say nothing about the
// card). Against the 0.5 alpha test, a card vanishes below ~9 degrees and is
// untouched above ~15, where its neighbours already cover the gap.
//
// The same hook carries the leaves' lighting lift (2026-09-24): a toe on the
// painted texel's darkest values and a sky wrap for leaves facing away from
// the sky (FOLIAGE_DARK_LIFT_GLSL, FOLIAGE_SKY_WRAP_GLSL below).
//
// Scoped by material NAME to the kit's leaf cards (`Leaves_dg_*`), so no
// other asset's look changes. Installed once per parsed
// GLB by the loader, as the material's base compile hook: the placed-asset
// sway (placed_assets.ts) chains it rather than replacing it, and its detach
// restores it.

import type * as THREE from 'three';

/** Materials that take the fade: the kit foliage's leaf cards. */
export function isEdgeFadeFoliage(name: string): boolean {
  return /^Leaves_dg_/.test(name);
}

/**
 * How far off edge-on a card starts and finishes fading, as |cos| of the
 * angle between the card and the view ray. Snow boughs fade earlier: seen from
 * below, a vertical snow card's white top rim reads as a bright sliver long
 * before the card itself is thin (round-3 review). The clump sheets (shrubs,
 * blossom) fade a little earlier too: their dark down-facing backs read as
 * black blades near edge-on. (Narrower bands were tried to stop half-faded
 * cards leaving specks, and brought the snow slivers straight back: keep
 * these.)
 */
export function edgeFadeRange(name: string): [number, number] {
  if (/^Leaves_dg_snow/.test(name)) return [0.15, 0.4];
  if (/^Leaves_dg_(under|bloom)/.test(name)) return [0.12, 0.34];
  return [0.08, 0.26];
}

/**
 * Every kit card: a near-VERTICAL card seen from steeply BELOW fades out.
 * From underneath, a hanging bough, a crown leader or a clump card standing
 * on edge reads as a spike or sliver radiating from the trunk; what a player
 * standing under a tree should see is the undersides, which the
 * near-horizontal cards still show. World-space terms from the view matrix:
 * the card's face normal and the fragment-to-camera direction.
 */
export const FROM_BELOW_GLSL = `
    vec3 wocWN = inverseTransformDirection(wocFaceN, viewMatrix);
    vec3 wocWV = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
    float wocBelow = smoothstep(0.6, 0.85, -wocWV.y) * (1.0 - smoothstep(0.35, 0.6, abs(wocWN.y)));
    diffuseColor.a *= 1.0 - wocBelow;
`;

/**
 * Snow boughs: the foliage painter tags snow pixels with alpha 0.66
 * (SNOW_TAG_ALPHA; needles are 1.0, both pass the 0.5 cutout). SNOW_TAG_GLSL
 * reads the tag before any fade touches alpha and restores full alpha;
 * SNOW_FROM_BELOW_GLSL then swaps tagged pixels for underside green whenever
 * the camera is below them. Snow lies on TOP of a branch; the white and
 * blue-grey rims seen from underneath were flagged for seven review rounds,
 * and a colour heuristic could not tell shaded snow from needles.
 */
export const SNOW_TAG_GLSL = `
    float wocSnowM = step(0.5, diffuseColor.a) * (1.0 - smoothstep(0.76, 0.86, diffuseColor.a));
    if (diffuseColor.a > 0.5) diffuseColor.a = 1.0;
`;

export const SNOW_FROM_BELOW_GLSL = `
    // only when the view ray CLIMBS steeply (30 degrees+) to the snow: the
    // boughs just above an eye-level player keep their snow (round-10 review)
    float wocUnder = smoothstep(0.5, 0.7, -wocWV.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.07, 0.06), wocSnowM * wocUnder);
`;

/**
 * Lifts the painted atlas's darkest values (SPACEY, 2026-09-24: "the darkest
 * lighting on the leaves are a bit dark make it less dark still keep the
 * variance but reduce the range from light to dark"). A tenth of every leaf
 * cell is painted at ~0.15 sRGB, ~0.02 linear, and rendered black whatever
 * the lighting; an emissive floor could not reach it (it scales that same
 * dark texel). A toe on the texel's LUMINANCE: +FOLIAGE_DARK_LIFT at black,
 * easing to nothing by FOLIAGE_DARK_KNEE, monotonic (every dark keeps its
 * order against its neighbours) and hue-preserving (RGB scales together).
 * Mids and highlights are untouched. Goes right after `map_fragment`, before
 * the vertex colour multiplies in.
 */
export const FOLIAGE_DARK_LIFT = 0.02;
export const FOLIAGE_DARK_KNEE = 0.12;
export const FOLIAGE_DARK_LIFT_GLSL = `
  {
    float wocY = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    float wocToe = 1.0 - min(wocY / ${FOLIAGE_DARK_KNEE.toFixed(3)}, 1.0);
    diffuseColor.rgb *= (wocY + ${FOLIAGE_DARK_LIFT.toFixed(3)} * wocToe * wocToe) / wocY;
  }
`;

/**
 * SKY WRAP: light reaching a leaf through the canopy. A leaf facing down or
 * away takes FOLIAGE_SKY_WRAP of the way from the ground-side hemisphere and
 * environment light it gets toward what it would get facing straight up. The
 * crowns' shaded undersides and self-shadowed middles crushed to black
 * clumps however bright the texel (SPACEY, 2026-09-24: "the darkest lighting on
 * the leaves are a bit dark"); a leaf facing up is unchanged, so the lit top
 * and every texture and vertex-colour variation keep their contrast, and it
 * follows the scene's own sky: dusk and night leaves stay dusk and night,
 * which an emissive floor would not. Goes after `lights_fragment_maps`, where
 * three's `irradiance` / `iblIrradiance` (view space) are still open.
 */
export const FOLIAGE_SKY_WRAP = 0.5;
export const FOLIAGE_SKY_WRAP_GLSL = `
#if defined( RE_IndirectDiffuse )
  {
    vec3 wocUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
    float wocAway = ${FOLIAGE_SKY_WRAP.toFixed(3)} * ( 1.0 - max( dot( geometryNormal, wocUp ), 0.0 ) );
    #if ( NUM_HEMI_LIGHTS > 0 )
      for ( int wocI = 0; wocI < NUM_HEMI_LIGHTS; wocI ++ ) {
        irradiance += wocAway * ( getHemisphereLightIrradiance( hemisphereLights[ wocI ], wocUp )
          - getHemisphereLightIrradiance( hemisphereLights[ wocI ], geometryNormal ) );
      }
    #endif
    #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && defined( STANDARD )
      iblIrradiance += wocAway * ( getIBLIrradiance( wocUp ) - getIBLIrradiance( geometryNormal ) );
    #endif
  }
#endif
`;

/** The fragment chunk, injected just before the alpha test. */
export function foliageEdgeFadeGlsl(
  [lo, hi]: [number, number],
  snow = false,
  fromBelow = true,
): string {
  return `
  {${snow ? SNOW_TAG_GLSL : ''}
    vec3 wocFaceN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    float wocFacing = abs(dot(wocFaceN, normalize(vViewPosition)));
    diffuseColor.a *= smoothstep(${lo.toFixed(3)}, ${hi.toFixed(3)}, wocFacing);${fromBelow || snow ? FROM_BELOW_GLSL : ''}${snow ? SNOW_FROM_BELOW_GLSL : ''}
  }
`;
}

export const FOLIAGE_EDGE_FADE_GLSL = foliageEdgeFadeGlsl([0.08, 0.26]);

type CompileHook = (
  shader: THREE.WebGLProgramParametersWithUniforms,
  renderer: THREE.WebGLRenderer,
) => void;

/** Patch a program's fragment shader with the fade (idempotent). */
export function injectFoliageEdgeFade(
  shader: { fragmentShader: string },
  range: [number, number] = [0.08, 0.26],
  snow = false,
  fromBelow = true,
): void {
  if (shader.fragmentShader.includes('wocFacing')) return;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>\n${FOLIAGE_DARK_LIFT_GLSL}`)
    .replace(
      '#include <lights_fragment_maps>',
      `#include <lights_fragment_maps>\n${FOLIAGE_SKY_WRAP_GLSL}`,
    )
    .replace(
      '#include <alphatest_fragment>',
      `${foliageEdgeFadeGlsl(range, snow, fromBelow)}\n#include <alphatest_fragment>`,
    );
}

/**
 * Install the fade on every kit foliage material of a parsed GLB as
 * its BASE compile hook (`userData.wocBaseCompile`), which the sway attach
 * chains and its detach restores. Returns how many materials took it.
 */
export function applyFoliageEdgeFade(root: {
  traverse?: (fn: (o: THREE.Object3D) => void) => void;
}): number {
  if (typeof root?.traverse !== 'function') return 0;
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || !isEdgeFadeFoliage(mat.name) || mat.userData.wocBaseCompile) continue;
      const range = edgeFadeRange(mat.name);
      const snow = /^Leaves_dg_snow/.test(mat.name);
      // the blossom sheet carries hanging wisteria: vertical by design, and
      // the from-below fade chopped the racemes into floating pieces
      const fromBelow = !/^Leaves_dg_bloom/.test(mat.name);
      const fadeHook: CompileHook = (shader) =>
        injectFoliageEdgeFade(shader, range, snow, fromBelow);
      const fadeKey = `woc-edge-fade:${range[0].toFixed(3)}:${range[1].toFixed(3)}:${snow ? 1 : 0}:${fromBelow ? 1 : 0}`;
      mat.userData.wocBaseCompile = fadeHook;
      mat.userData.wocBaseCacheKey = fadeKey;
      mat.onBeforeCompile = fadeHook;
      mat.customProgramCacheKey = () => fadeKey;
      n++;
    }
  });
  return n;
}
