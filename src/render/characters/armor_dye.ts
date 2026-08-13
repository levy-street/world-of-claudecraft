// The armour-dye shader layer, lifted out of characters/assets.ts so the two
// places that must attach it can share ONE implementation of the GLSL.
//
// It lives in its own leaf module rather than in assets.ts because
// material_clone_hooks.ts (a tiny util imported by dungeon/props/town/castle
// builders) has to re-attach the layer on every program-preserving clone, and
// importing the whole character-asset module from there would drag the boot
// preload registrations and ~500 transitive modules behind a leaf utility.
//
// Material.clone() copies userData but silently DROPS onBeforeCompile AND
// customProgramCacheKey, so the spec recorded in userData.armorDye is what
// every clone site re-attaches from.

import type * as THREE from 'three';
import type { DyeRule } from './modular';

/**
 * The outfit-colorway dye, as a shader layer on a clone of an armour material.
 *
 * The class atlases ship ktx2-compressed, so a colorway cannot be painted into
 * the pixels, instead the fragment stage remaps HSV zones of the atlas right
 * after the map sample. A spec is a list of up to MAX_DYE_RULES rules; each
 * selects a zone (hue band + sat/val smoothstep windows, measured off the
 * atlases, steel, gold trim, leather, the set's cloth band) and remaps
 * hue/sat/val inside it. The additive sat/val terms are what let near-gray
 * steel take real gold or bone colour, a legacy hue colorway is one rule
 * whose windows reproduce the old single-band dye exactly.
 *
 * Every rule is evaluated from the ORIGINAL texel and the results are blended
 * in sequence, so overlapping selector edges cross-fade instead of compounding.
 *
 * One uniform-driven program serves every set and every colorway: the hook is
 * byte-identical across clones and customProgramCacheKey pins the key, so
 * picking through the customizer's swatches never compiles a second program.
 */
export interface ArmorDyeSpec {
  rules: DyeRule[];
}

const MAX_DYE_RULES = 5;

/** Flatten a spec into the fixed-size uniform arrays the shader reads: per
 *  rule A=(ref, band, satLo0, satLo1), B=(satHi0, satHi1, valLo0, valLo1),
 *  C=(valHi0, valHi1, hueTarget, hueMode), D=(satMul, satAdd, valMul, valAdd).
 *  Unused slots get zero weight via an empty hue band. */
function dyeUniforms(dye: ArmorDyeSpec): {
  a: number[];
  b: number[];
  c: number[];
  d: number[];
  n: number;
} {
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  const d: number[] = [];
  const rules = dye.rules.slice(0, MAX_DYE_RULES);
  for (let i = 0; i < MAX_DYE_RULES; i++) {
    const r = rules[i];
    if (!r) {
      a.push(0, -1, 0, 0);
      b.push(0, 0, 0, 0);
      c.push(0, 0, 0, 0);
      d.push(1, 0, 1, 0);
      continue;
    }
    const mode = r.hueMode === 'keep' ? 0 : r.hueMode === 'abs' ? 1 : 2;
    a.push(r.ref, r.band, r.sat[0], r.sat[1]);
    b.push(r.sat[2], r.sat[3], r.val[0], r.val[1]);
    c.push(r.val[2], r.val[3], r.hue, mode);
    d.push(r.satMul, r.satAdd, r.valMul, r.valAdd);
  }
  return { a, b, c, d, n: rules.length };
}

/** Attach the dye hook to a material IN PLACE, recording a JSON-safe spec in
 *  userData: Material.clone() copies userData but silently DROPS
 *  onBeforeCompile (the worn_stone precedent), and tintedMaterial() clones
 *  again downstream of recolored(), so every clone site re-attaches from the
 *  spec it finds. */
export function attachArmorDye(mat: THREE.Material, dye: ArmorDyeSpec): void {
  mat.userData.armorDye = {
    rules: dye.rules.map((r) => ({ ...r, sat: [...r.sat], val: [...r.val] })),
  };
  // Compose with whatever hook the material may already carry (the
  // surface-detail layer composes the same way from its side), and fold the
  // previous program key in rather than clobbering it.
  const prev = mat.onBeforeCompile;
  const prevKey = typeof prev === 'function' ? prev.toString() : '';
  const u = dyeUniforms(dye);
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uDyeA = { value: u.a };
    shader.uniforms.uDyeB = { value: u.b };
    shader.uniforms.uDyeC = { value: u.c };
    shader.uniforms.uDyeD = { value: u.d };
    shader.uniforms.uDyeCount = { value: u.n };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec4 uDyeA[${MAX_DYE_RULES}];
uniform vec4 uDyeB[${MAX_DYE_RULES}];
uniform vec4 uDyeC[${MAX_DYE_RULES}];
uniform vec4 uDyeD[${MAX_DYE_RULES}];
uniform int uDyeCount;
vec3 wocRgb2Hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 wocHsv2Rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
// The dye works in sRGB: diffuseColor is LINEAR after map_fragment, and the
// zone selectors are calibrated against the atlases' sRGB values (a pale
// gold that measures s=0.31 in sRGB reads s=0.57 in linear, selectors
// written for one space silently miss in the other).
vec3 wocLin2Srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
vec3 wocSrgb2Lin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 dyeSrgb = wocLin2Srgb(diffuseColor.rgb);
  vec3 dyeHsv = wocRgb2Hsv(dyeSrgb);
  float dyeHueDeg = dyeHsv.x * 360.0;
  vec3 dyeOut = dyeSrgb;
  for (int i = 0; i < ${MAX_DYE_RULES}; i++) {
    if (i >= uDyeCount) break;
    float dHue = mod(dyeHueDeg - uDyeA[i].x + 540.0, 360.0) - 180.0;
    float w = 1.0 - smoothstep(uDyeA[i].y * 0.7, uDyeA[i].y, abs(dHue));
    w *= smoothstep(uDyeA[i].z, uDyeA[i].w, dyeHsv.y) * (1.0 - smoothstep(uDyeB[i].x, uDyeB[i].y, dyeHsv.y));
    w *= smoothstep(uDyeB[i].z, uDyeB[i].w, dyeHsv.z) * (1.0 - smoothstep(uDyeC[i].x, uDyeC[i].y, dyeHsv.z));
    if (w > 0.001) {
      float mode = uDyeC[i].w;
      float h = mode < 0.5 ? dyeHueDeg : mode < 1.5 ? uDyeC[i].z : uDyeC[i].z + dHue;
      vec3 dyed = wocHsv2Rgb(vec3(
        mod(h, 360.0) / 360.0,
        clamp(dyeHsv.y * uDyeD[i].x + uDyeD[i].y, 0.0, 1.0),
        clamp(dyeHsv.z * uDyeD[i].z + uDyeD[i].w, 0.0, 1.0)));
      dyeOut = mix(dyeOut, dyed, w);
    }
  }
  diffuseColor.rgb = wocSrgb2Lin(dyeOut);
}`,
      );
  };
  // One key for every colorway (the GLSL is identical; only uniforms differ),
  // with the PREVIOUS hook's source folded in so a dyed and an undyed armour
  // material can never share a program.
  mat.customProgramCacheKey = () => `woc_armor_dye|${prevKey}`;
}

/**
 * Put the dye layer back on a fresh `Material.clone()`, from the spec clone()
 * copied into userData. A no-op for a clone whose source never carried a dye,
 * so it can run unconditionally on the clone path.
 *
 * The isMeshStandardMaterial guard mirrors where the factories actually attach
 * the layer (recolored() dyes the standard GLB material, and the standard arm
 * of buildTintedClone re-attaches it): the low tier rebuilds rig materials as
 * Lambert from scratch and so never carries the spec at all.
 */
export function reapplyArmorDyeToClone(clone: THREE.Material): void {
  if (!(clone as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  const spec = (clone.userData as { armorDye?: ArmorDyeSpec }).armorDye;
  if (!spec) return;
  attachArmorDye(clone, spec);
}
