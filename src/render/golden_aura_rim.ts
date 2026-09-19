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
// Lambert tier has no per-fragment view vector worth paying for. On that
// tier the character keeps its normal colors and the surrounding glow halo
// (golden_aura.ts) is the only cue, which is fine: this is a rare account
// cosmetic, never a gameplay signal, so a lower-tier presentation gap is
// purely a fidelity tradeoff, not a fairness one.
import * as THREE from 'three';

const GOLDEN_AURA_RIM_MARKER = 'WOC_GOLDEN_AURA_RIM';
const COMMON_ANCHOR = '#include <common>';
const LIGHTS_BEGIN_ANCHOR = '#include <lights_fragment_begin>';

export const GOLDEN_AURA_RIM_COLOR = new THREE.Color(0xffc830);

/** Adds the character's OUTLINE, not a whole-body recolor. Deliberately a
 *  wider, stronger fresnel than the ambient character rim (power 1.6 instead
 *  of 3.0, roughly 5x the strength): the ambient rim is a subtle silhouette
 *  separator, while this is a deliberate cosmetic meant to read at a glance. */
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
      totalEmissiveRadiance += uGoldenAuraColor * 0.65 *
        pow(1.0 - saturate(dot(normal, geometryViewDir)), 1.6);`,
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
