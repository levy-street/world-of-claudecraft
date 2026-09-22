// The Golden Aura keepsake's silhouette rim (Founder's Pack Epic tier,
// src/sim/content/items.ts founder_golden_aura): a gold fresnel glow along
// the character's OUTLINE, not a whole-body recolor. Same shader-patch recipe
// as the character rim glow (gfx.ts addRimGlow / pbr_fragment_shader.ts), but
// with its own per-material uniform rather than the shared uRimBoost/
// uRimColor pair, so toggling it never touches the ambient dungeon rim every
// other rig wears. Reused per source material the same way addRimGlow is (a
// WeakSet marker plus a chained onBeforeCompile), so re-applying it to an
// already-patched clone is a no-op.
//
// PBR (MeshStandardMaterial) only, matching addRimGlow's own gate: the
// Lambert tier has no per-fragment view vector worth paying for, so that
// tier keeps the character's normal colors with no rim at all, which is
// fine: this is a rare account cosmetic, never a gameplay signal, so a
// lower-tier presentation gap is purely a fidelity tradeoff, not a fairness
// one.
import * as THREE from 'three';

const GOLDEN_AURA_RIM_MARKER = 'WOC_GOLDEN_AURA_RIM';
const COMMON_ANCHOR = '#include <common>';
const LIGHTS_BEGIN_ANCHOR = '#include <lights_fragment_begin>';

export const GOLDEN_AURA_RIM_COLOR = new THREE.Color(0xffc830);

/** Adds the character's OUTLINE, not a whole-body recolor. A thin silhouette
 *  line (power 2.6, still much tighter than the old 1.6 wide band) whose
 *  strength is picked to just clear the post pipeline's bloom threshold at
 *  the sharpest grazing angles (post.ts BLOOM_THRESHOLD, see EMISSIVE_GLOW in
 *  gfx.ts): that lets the brightest edge bleed a little OUTWARD past the
 *  actual mesh silhouette in screen space, rather than thickening inward
 *  across the surface, which a fresnel term alone cannot do (it only reads
 *  the existing geometry's normals, never displaces it). Front-facing
 *  surfaces stay untouched either way, since the fresnel term is already
 *  near zero there regardless of strength. */
function patchGoldenAuraFragmentShader(source: string): string {
  if (source.includes(GOLDEN_AURA_RIM_MARKER)) return source;
  if (!source.includes(COMMON_ANCHOR) || !source.includes(LIGHTS_BEGIN_ANCHOR)) {
    return source;
  }
  return source
    .replace(
      COMMON_ANCHOR,
      `${COMMON_ANCHOR}
      // ${GOLDEN_AURA_RIM_MARKER}
      uniform vec3 uGoldenAuraColor;`,
    )
    .replace(
      LIGHTS_BEGIN_ANCHOR,
      `${LIGHTS_BEGIN_ANCHOR}
      totalEmissiveRadiance += uGoldenAuraColor * 1.3 *
        pow(1.0 - saturate(dot(normal, geometryViewDir)), 2.6);`,
    );
}

const goldenAuraRimMaterials = new WeakSet<THREE.Material>();

/** Idempotent per material instance; chains onto whatever onBeforeCompile the
 *  material already carries (the ambient rim glow, the worn detail layer, the
 *  armor dye), exactly like addRimGlow does, so none of those are lost. */
export function attachGoldenAuraRim(mat: THREE.Material): void {
  if (
    !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
    goldenAuraRimMaterials.has(mat)
  ) {
    return;
  }
  goldenAuraRimMaterials.add(mat);
  const previousCompile = mat.onBeforeCompile;
  const previousCompileSource = previousCompile.toString();
  const previousProgramKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, renderer) => {
    previousCompile.call(mat, sh, renderer);
    const patched = patchGoldenAuraFragmentShader(sh.fragmentShader);
    if (patched === sh.fragmentShader) return;
    sh.uniforms.uGoldenAuraColor = { value: GOLDEN_AURA_RIM_COLOR };
    sh.fragmentShader = patched;
  };
  mat.customProgramCacheKey = () =>
    `golden-aura-rim|${previousCompileSource}|${previousProgramKey()}`;
  mat.needsUpdate = true;
}
