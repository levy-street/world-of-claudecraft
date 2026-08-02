// Canopy clump detail: internal texture for the foliage kit's leaf materials
// (pine tiers, oak/twisted broadleaf lobes, bush and fern dressing), which
// otherwise render as flat solid-colour surfaces that merge into one smooth
// silhouette. The canopy/leaf names are deliberately SKIPPED by the shared
// surface-detail family router (worn_stone.ts foliageWornFamilyFor): masonry
// or bark grain on a canopy reads absurd, so leaves get this dedicated layer
// instead:
// - a WORLD-SPACE triplanar clump normal (ambientCG Moss002 NormalGL, CC0)
//   bends the shading normal at moderate strength, so tier surfaces pick up
//   lit and shadowed needle/leaf clumps while the low-poly silhouette stays
//   untouched (fragment shading only, no displacement);
// - the matching AmbientOcclusion map multiplies diffuse AND the leaf
//   emissive ambient floor through a measured-centered remap (clump tops
//   lighten, the seams between clumps darken), so the break-up survives on
//   the shadowed side of a canopy where the emissive floor dominates;
// - a crevice term darkens down-facing geometry (the underside ring where one
//   pine tier meets the next, the shaded belly of an oak lobe), so stacked
//   tiers and overlapping trees stop merging into one mass.
// Moss002 was picked over the finer grass/moss candidates because its clump
// cells (~7% of the tile) survive mipping at gameplay distance: at the coarse
// tiles below they read as 0.3-0.7yd foliage clumps, not noise. Measured over
// the shipped 1K maps: AO mean 0.474, sd 0.117, row/col isotropy 0.73;
// NormalGL x/y sd 0.104/0.103 (isotropy 1.00).
// Cost: alpha-rejected fragments pay zero canopy taps; surviving fragments
// inside CANOPY_FADE_END pay 6, and fragments past it pay zero (distance fade
// below). There is no per-frame CPU work. Gated to HIGH AND UP
// (GFX.detailLayers, the round-10 medium regate: medium keeps its
// pre-overhaul canopy look and cost); there is intentionally no parallax
// here, a cutout canopy has no coherent view-ray height field to walk.
import type * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { patchCanopyDetailShaderSource } from './foliage_shader_core';
import { GFX } from './gfx';
import { renderLayerDisabled } from './render_dev_flags';

const CANOPY_TEXTURE_DIR = '/textures/foliage/';
const CANOPY_TEXTURE_PREFIX = 'Moss002';
/** MEASURED mean of the shipped Moss002 AmbientOcclusion map: the AO remap
 *  centers on it so the layer never shifts a canopy's overall brightness. */
const MOSS002_AO_MEAN = 0.474;
/** Full-depth diffuse span across the AO range (a spec's aoDepth scales it):
 *  at 1.0 the seams between clumps sit ~15% under the clump tops. */
const CANOPY_AO_SPAN = 0.62;
/** Down-facing crevice ramp: shading starts once the raw geometric normal
 *  points below the horizon by START and saturates at FULL. */
const CANOPY_CREVICE_DOWN_START = 0.15;
const CANOPY_CREVICE_DOWN_FULL = 0.7;
/** Distance fade (perf): the 6 taps per leaf fragment exist to break up NEAR
 *  canopies; past ~50yd a 0.3-0.7yd clump projects a handful of pixels and
 *  the break-up is carried by the canopy geometry itself. Across the band
 *  the AO term eases back to 1.0, which IS its value at the measured map
 *  mean (the remap is mean-centered, see MOSS002_AO_MEAN), and the normal
 *  blend eases to identity, so a distant canopy's brightness and silhouette
 *  cannot shift; past the end all 6 taps are branch-skipped. The geometric
 *  crevice term (no taps) keeps running at every distance so stacked tiers
 *  never re-merge. Verified by screenshot A/B via the shared ?wornfade dev
 *  override (scripts/round9_fade_shots.mjs). */
const CANOPY_FADE_START = 34;
const CANOPY_FADE_END = 55;
const CANOPY_FADE_SCALE = ((): number => {
  if (typeof location === 'undefined') return 1;
  const v = new URLSearchParams(location.search).get('wornfade');
  if (!v) return 1;
  if (v === 'off') return 1e5;
  const m = /^x([\d.]+)$/.exec(v);
  const k = m ? Number(m[1]) : 1;
  return Number.isFinite(k) && k > 0 ? k : 1;
})();

export interface CanopyDetailSpec {
  /** shading-normal blend toward the triplanar clump normal (0 = off) */
  strength: number;
  /** projection tiles per world unit; smaller = larger clumps */
  tileScale: number;
  /** scales CANOPY_AO_SPAN: how deep the clump-seam light/dark break-up runs */
  aoDepth: number;
  /** extra darkening on down-facing geometry (tier undersides, lobe bellies) */
  creviceShade: number;
  /**
   * Luma mix pulling the leaf albedo toward neutral (0 = off). The kit's
   * bush sheet is (0, 0.139, 0.025) linear, pure green with NO red, so
   * the foliage.ts albedo-lift multiplier can brighten it but can never
   * desaturate it; only a mix toward luminance can.
   */
  desat: number;
}

/**
 * Per-source-material tuning, keyed by the foliage kit's material names
 * (foliage.ts MAT_POLICY). Flowers are deliberately absent: blossom cards
 * stay clean colour. Pines take the strongest treatment (stacked tiers are
 * the "one smooth cone" repro); broadleafs are gentler; dressing bushes and
 * ferns tile finer because they are small and viewed close.
 */
export const CANOPY_DETAIL_SPECS: Record<string, CanopyDetailSpec> = {
  Leaves_Pine: { strength: 0.6, tileScale: 1 / 10, aoDepth: 1.2, creviceShade: 0.4, desat: 0.06 },
  Leaves_NormalTree: {
    strength: 0.5,
    tileScale: 1 / 10,
    aoDepth: 1,
    creviceShade: 0.26,
    desat: 0.08,
  },
  Leaves_TwistedTree: {
    strength: 0.5,
    tileScale: 1 / 10,
    aoDepth: 1,
    creviceShade: 0.26,
    desat: 0.08,
  },
  // dressing bushes read closest and greenest: the strongest desat lives here
  Leaves: { strength: 0.4, tileScale: 1 / 5, aoDepth: 0.7, creviceShade: 0.15, desat: 0.18 },
};

interface CanopyTextures {
  normal: THREE.Texture | null;
  ao: THREE.Texture | null;
}
const TEX: CanopyTextures = { normal: null, ao: null };

// Tiers below high never compile the layer (GFX.canopyDetail, the round-10
// medium regate), so skip the fetches there. The import-time tier is only a
// guess; a lower live tier leaves the textures idle, and a higher live tier
// fails soft to the plain leaf materials (the detail_normals null contract).
// The loader cache is immutable: clone before the anisotropy tweak (the
// worn_stone.ts pattern). Both maps are non-color data in linear space.
if (GFX.canopyDetail) {
  const prep = (name: string): Promise<THREE.Texture> =>
    loadTexture(`${CANOPY_TEXTURE_DIR}${CANOPY_TEXTURE_PREFIX}_${name}.jpg`, {
      repeat: true,
    }).then((tex) => {
      const t = tex.clone();
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    });
  registerDeferredPreload(() =>
    Promise.all([prep('NormalGL'), prep('AmbientOcclusion')]).then(([n, a]) => {
      TEX.normal = n;
      TEX.ao = a;
    }),
  );
}

/**
 * The resolved clump textures for the renderer's boot-prewarm window: like the
 * worn_stone family maps these are onBeforeCompile UNIFORMS, invisible to the
 * scene texture sweep, so without an explicit prewarm they upload on the first
 * live canopy draw. Empty before the preload gate resolves.
 */
export function canopyDetailPrewarmTextures(): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  if (TEX.normal) out.push(TEX.normal);
  if (TEX.ao) out.push(TEX.ao);
  return out;
}

// Identity-based once-per-instance guard (clone() copies userData, so a
// userData marker alone would falsely mark clones as applied).
const applied = new WeakSet<THREE.Material>();

/**
 * Attach the canopy clump-detail layer to a foliage leaf material, keyed by
 * the SOURCE material name (unknown names no-op, so the caller can pass every
 * leaf material through). Composes with any existing onBeforeCompile hook by
 * running it first (wind sway + instance collapse in foliage.ts), and chains
 * the previous customProgramCacheKey so program sharing keeps the collapse
 * semantics. No-op on the Lambert and lean-foliage tiers.
 */
export function applyCanopyDetail(mat: THREE.Material, sourceName: string): void {
  const spec = CANOPY_DETAIL_SPECS[sourceName];
  if (!spec) return;
  // High and up only (GFX.canopyDetail, the round-10 medium regate; the
  // Advanced Foliage Density dial maps onto the same knob); ?canopy=off is
  // the dev-only perf-attribution kill switch (render_dev_flags.ts).
  if (!GFX.canopyDetail || renderLayerDisabled('canopy')) return;
  const std = mat as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;
  if (applied.has(mat)) return;
  applied.add(mat);
  mat.userData.canopyDetail = sourceName;
  const aoSpan = CANOPY_AO_SPAN * spec.aoDepth;
  // centered on the measured map mean so overall canopy brightness holds
  const aoLo = 1 - aoSpan * MOSS002_AO_MEAN;
  const prev = mat.onBeforeCompile;
  const prevKey =
    typeof mat.customProgramCacheKey === 'function' ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    // Fail soft before the preload gate resolves: the material simply ships
    // without the layer (the detail_normals null contract).
    if (!TEX.normal || !TEX.ao) return;
    shader.uniforms.uCanopyNormalTex = { value: TEX.normal };
    shader.uniforms.uCanopyAoTex = { value: TEX.ao };
    shader.uniforms.uCanopyStrength = { value: spec.strength };
    shader.uniforms.uCanopyTile = { value: spec.tileScale };
    shader.uniforms.uCanopyAoLo = { value: aoLo };
    shader.uniforms.uCanopyAoSpan = { value: aoSpan };
    shader.uniforms.uCanopyCrevice = { value: spec.creviceShade };
    shader.uniforms.uCanopyDesat = { value: spec.desat };
    // The pure patch keeps the RGB-only AO work after the stock alpha test,
    // while leaving the original visible-fragment operation order intact.
    const patched = patchCanopyDetailShaderSource(shader.vertexShader, shader.fragmentShader, {
      fadeStart: CANOPY_FADE_START * CANOPY_FADE_SCALE,
      fadeEnd: CANOPY_FADE_END * CANOPY_FADE_SCALE,
      creviceDownStart: CANOPY_CREVICE_DOWN_START,
      creviceDownFull: CANOPY_CREVICE_DOWN_FULL,
    });
    shader.vertexShader = patched.vertexShader;
    shader.fragmentShader = patched.fragmentShader;
  };
  // The default program cache key stringifies onBeforeCompile, and every
  // chained wrapper here stringifies identically even when the PREVIOUS hook
  // differs, so chain the previous key (the foliage_collapse precedent). The
  // texture-ready state keys too: before the preload resolves the hook
  // compiles to a plain pass-through.
  mat.customProgramCacheKey = () =>
    `canopy-detail|${TEX.normal && TEX.ao ? 'on' : 'off'}|f${(CANOPY_FADE_START * CANOPY_FADE_SCALE).toFixed(1)},${(CANOPY_FADE_END * CANOPY_FADE_SCALE).toFixed(1)}|${prevKey ? prevKey() : ''}`;
}
