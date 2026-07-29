// The Three half of the night light field: the shared uniform block and GLSL
// snippet the terrain splat material splices, so every lamp, camp fire, and
// nearby body lights the ground as a REAL light (direction, distance falloff,
// surface normal), not as an additive decal draped over it.
//
// All the decisions (slot layout, nearest-K selection, falloff curve, the body
// collector) live in night_light_field_core.ts, which is Node-tested; this
// file only owns the registry, the uniforms, and the strings. The pattern is
// biome_haze_field.ts, the repo's cross-surface shader service reference.
//
// Cost: two flat uniform arrays written once per frame, and a bounded loop in
// the terrain fragment shader that the count uniform exits immediately by day
// (the count is 0 whenever the world is lit). This is how "every lamp lights
// the road" coexists with the pinned live THREE.PointLight budget: the point
// lights still light characters and props near the player; the field carries
// the ground everywhere else.
//
// After dark the loop is the most-run code the renderer owns (every terrain
// fragment on screen), so it carries TWO exact early exits the pack computes
// for it, both described in night_light_field_core.ts: `uNightLightBound`, the
// sphere around the anchor holding every packed light's reach, skips the whole
// block for ground out past all of them, and the ascending reach key in
// `uNightLightColor[i].w` stops the walk once the remaining slots are all too
// far out to touch this fragment. Neither changes a pixel; they only stop the
// shader paying for lights that were already contributing zero.
//
// `?nightlights=off` is the A/B switch back to the draped ground pools, which
// remain the fallback wherever the field is absent (the Lambert tier splats no
// standard material to splice).

import { GFX } from './gfx';
import {
  NIGHT_LIGHT_BOUND_FLOATS,
  NIGHT_LIGHT_SLOTS,
  type NightLightSite,
  packNightLights,
} from './night_light_field_core';
import { renderLayerDisabled } from './render_dev_flags';

const uNightLightPosR = { value: new Float32Array(NIGHT_LIGHT_SLOTS * 4) };
const uNightLightColor = { value: new Float32Array(NIGHT_LIGHT_SLOTS * 4) };
const uNightLightCount = { value: 0 };
/** (anchor.x, anchor.z, boundRadius^2): the packed set's whole reach. */
const uNightLightBound = { value: new Float32Array(NIGHT_LIGHT_BOUND_FLOATS) };

let active = false;
let decided = false;
/** Keyed by owner so a rebuilt scene (the editor viewport) REPLACES its own
 *  entries instead of stacking a second copy of every lamp's light. */
const staticByOwner = new Map<string, readonly NightLightSite[]>();
let staticSites: NightLightSite[] = [];

function rebuildStaticSites(): void {
  staticSites = [];
  for (const sites of staticByOwner.values()) pushAll(staticSites, sites);
}

/**
 * Decide once whether the field runs this session. Call BEFORE building the
 * terrain: the splat material gates its shader patch on hasNightLightField()
 * at compile time, so a field enabled later would never be read. The Lambert
 * tier compiles no standard splat material, so it keeps the draped pools.
 */
export function ensureNightLightField(): void {
  if (decided) return;
  decided = true;
  active = GFX.standardMaterials && !renderLayerDisabled('nightlights');
}

/** True when the terrain splices the field this session (compile-time gate). */
export function hasNightLightField(): boolean {
  return active;
}

/** World-static lights (lamps, braziers, camp fires) join the field at build.
 *  The set is read per frame, so builders may register in any order; a builder
 *  registering again under the same owner replaces its previous entries. */
export function registerStaticNightLights(owner: string, sites: readonly NightLightSite[]): void {
  staticByOwner.set(owner, sites.slice());
  rebuildStaticSites();
}

function pushAll(target: NightLightSite[], sites: readonly NightLightSite[]): void {
  // a loop, not push(...sites): a spread turns every site into a call
  // argument, which hits engine argument caps abruptly if the set grows
  for (const site of sites) target.push(site);
}

/**
 * Write this frame's light set. `anchorX`/`anchorZ` is the PLAYER position,
 * the same anchor the point-light budget and the disc layer rank by.
 * `dynamics` is the body collector's pooled array with its live
 * `dynamicsCount` (entries past it are stale); the glow drivers are the
 * shared night curves (night_lighting_core.ts), already zeroed indoors by the
 * caller.
 */
export function updateNightLightField(
  anchorX: number,
  anchorZ: number,
  staticGlow: number,
  dynamicGlow: number,
  time: number,
  dynamics: readonly NightLightSite[],
  dynamicsCount: number,
): void {
  if (!active) return;
  uNightLightCount.value = packNightLights(
    staticSites,
    dynamics,
    dynamicsCount,
    anchorX,
    anchorZ,
    staticGlow,
    dynamicGlow,
    time,
    uNightLightPosR.value,
    uNightLightColor.value,
    uNightLightBound.value,
  );
}

/** The uniforms a consumer material installs in its onBeforeCompile. Shared
 *  objects, never copies (the sharedUniforms.uTime idiom). */
export function nightLightUniforms(): Record<string, { value: unknown }> {
  return { uNightLightPosR, uNightLightColor, uNightLightCount, uNightLightBound };
}

/** Reset for tests: the field is deliberately session-static otherwise. */
export function resetNightLightFieldForTest(): void {
  active = false;
  decided = false;
  staticByOwner.clear();
  staticSites = [];
  uNightLightCount.value = 0;
  uNightLightPosR.value.fill(0);
  uNightLightColor.value.fill(0);
  uNightLightBound.value.fill(0);
}

/** How many static sites are registered (diagnostics and tests). */
export function nightLightStaticCount(): number {
  return staticSites.length;
}

/** Fragment-stage declarations. Splice into the fragment `<common>` patch. */
export const NIGHT_LIGHT_DECLARATIONS = `
uniform vec4 uNightLightPosR[${NIGHT_LIGHT_SLOTS}];
uniform vec4 uNightLightColor[${NIGHT_LIGHT_SLOTS}];
uniform int uNightLightCount;
uniform vec3 uNightLightBound;`;

/**
 * The lighting block. Splice immediately BEFORE `#include <lights_fragment_end>`,
 * with `worldPos` naming the fragment's world position vec3.
 *
 * This lands INSIDE the material's lighting resolve, not after tonemapping:
 * each light contributes irradiance to `reflectedLight.directDiffuse` through
 * `BRDF_Lambert(diffuseColor.rgb)`, the lambert diffuse path a real
 * THREE.PointLight takes (three feeds `material.diffuseColor`, which is the
 * same value times `1 - metalness`; the splat is metalness 0, so the two are
 * identical there). That is what makes it read as light rather than paint: it multiplies
 * with the ground's own albedo (dark peat soaks it up, pale cobbles catch it),
 * it follows the splat's detail normals, and the tonemapper rolls the bright
 * centre off softly instead of clipping it to a harsh disc.
 *
 * The falloff is three's own punctual attenuation (decay 2 with the pow4
 * cutoff window, nightLightFalloff in the core, mirrored term for term), so
 * field light and the budget's real point lights agree about reach.
 *
 * The loop works in SQUARED distance: `pow4(d / r)` is `pow2(d2 / r2)` and the
 * attenuation divides by d2 anyway, so the only root left is the one the
 * lambert term's direction needs, inside the branch a culled light never
 * enters. A light the fragment is out of range of therefore costs a subtract,
 * a dot and a compare, which is what lets the slot window be wide enough to
 * light a road ahead of the player instead of only the ground beneath them.
 * The cutoff arrives pre-squared in `.w`, so the loop does not re-square a
 * constant radius once per fragment per slot either.
 *
 * TWO EXACT EARLY EXITS carry the rest, both precomputed by the pack (the
 * layout comment in night_light_field_core.ts states the geometry):
 *   - the anchor bound. Every packed light reaches at most `uNightLightBound.z`
 *     (squared) from the anchor, so ground out past that is unlit by all of
 *     them and skips the block for the cost of one subtract, one dot and one
 *     compare. This is what makes the distant half of the ground free again,
 *     and in open country, where the nearest lamps may be hundreds of yards
 *     off, it is nearly the whole screen.
 *   - the reach key. Slots arrive ordered by how close to the anchor they can
 *     still reach, so the first slot that cannot reach this fragment ends the
 *     walk. Standing under a lamp in a lit town, that stops the loop after the
 *     handful of lamps around you instead of walking the whole window.
 * Both are conservative bounds on the same `wocNLDist2 < wocNLCutoff2` test the
 * loop already ran, so nothing they skip could have added light.
 */
export function nightLightFragmentGlsl(worldPos: string): string {
  return `
  vec2 wocNLAnchorTo = (${worldPos}).xz - uNightLightBound.xy;
  float wocNLAnchor2 = dot(wocNLAnchorTo, wocNLAnchorTo);
  if (uNightLightCount > 0 && wocNLAnchor2 < uNightLightBound.z) {
    float wocNLAnchorD = sqrt(wocNLAnchor2);
    vec3 wocNLIrradiance = vec3(0.0);
    vec3 wocNLNormal = inverseTransformDirection(normal, viewMatrix);
    for (int i = 0; i < ${NIGHT_LIGHT_SLOTS}; i++) {
      if (i >= uNightLightCount) break;
      vec4 wocNLTint = uNightLightColor[i];
      if (wocNLTint.w >= wocNLAnchorD) break;
      vec4 wocNLSite = uNightLightPosR[i];
      vec3 wocNLTo = wocNLSite.xyz - ${worldPos};
      float wocNLDist2 = dot(wocNLTo, wocNLTo);
      float wocNLCutoff2 = wocNLSite.w;
      if (wocNLDist2 < wocNLCutoff2) {
        float wocNLWin = pow2(saturate(1.0 - pow2(wocNLDist2 / wocNLCutoff2)));
        float wocNLAtt = wocNLWin / max(wocNLDist2, 0.01);
        float wocNLLambert = saturate(dot(wocNLNormal, wocNLTo * inversesqrt(max(wocNLDist2, 1e-8))));
        wocNLIrradiance += wocNLTint.rgb * (wocNLAtt * wocNLLambert);
      }
    }
    reflectedLight.directDiffuse += wocNLIrradiance * BRDF_Lambert(diffuseColor.rgb);
  }`;
}
