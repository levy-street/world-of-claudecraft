import { BIOME_HAZE_DECLARATIONS, biomeHazeFragmentGlsl } from '../biome_haze_field';
import { SCENE_SAMPLE_GLSL } from '../scene_sampling';
import {
  WATER_FIELD_EDGE_FEATHER_UV,
  WATER_FOAM_WIDTH_YARDS,
  WATER_SEABED_CLAMP_YARDS,
} from '../water_core';
import {
  OCEAN_LOOP_SECONDS,
  OCEAN_VARIANCE_LOG2_K_MAX,
  OCEAN_VARIANCE_LOG2_K_MIN,
  OCEAN_VARIANCE_SAMPLES,
} from './ocean_spectrum_core';

// The water surface shader: the FFT ocean's displacement in the vertex stage,
// and in the fragment stage a physically based water surface built from the
// same simulation:
//
//   NORMALS from every cascade's filtered slope, plus the interactive wakes.
//   ROUGHNESS from the slope variance the pixel cannot resolve (the spectrum's
//     own number, not a tuned constant), so the sun's glitter path widens with
//     distance into a soft sheen exactly the way real water does, without
//     aliasing.
//   SUN GLITTER from a Gaussian micro-facet slope distribution centred on the
//     filtered slope.
//   SKY REFLECTION from a live cube capture of the dome (sky_probe.ts), read at
//     the mip that roughness asks for, under a Schlick fresnel.
//   THE WATER BODY: light scattered back up out of the depths, lit by the sky
//     and the sun; with the opaque-scene capture (high tier and up,
//     scene_sampling.ts) the real seabed shows through, refracted by the waves,
//     absorbed red-first over the true path length, and lit by caustics; without
//     it the surface blends over the seabed with a depth-driven opacity.
//   SUBSURFACE GLOW where the low sun shines through the backs of crests.
//   FOAM: whitecaps where the simulation's surface folds, surf breathing with
//     the swell along the shore, and contact foam wherever the scene meets the
//     surface (rocks, piers, wading legs).
//
// Every term that can take a power or a root is clamped first (see
// tests/shader_pow_domain.test.ts): a NaN here would poison bloom.

export interface OceanSurfaceShaderOptions {
  /** Number of FFT cascades bound (1 to 4). */
  cascades: number;
  /** The from-below ceiling (BackSide mesh). */
  underside: boolean;
  /** Fade to nothing where the baked depth reaches zero (interior pools). */
  shoreEdgeFade: boolean;
  /** Splice the per-zone haze (biome_haze_field.ts). */
  zoneHaze: boolean;
  /**
   * Screen-space reflection march steps (0 compiles it out). It traces the
   * opaque-scene capture, so it only ever runs where that capture is live.
   */
  ssrSteps: number;
  /** The horizon apron's variant: discard inside every built fine sheet. */
  apron: boolean;
}

/** How many fine-sheet rects the apron variant can test (zones plus gaps). */
export const OCEAN_MAX_SHEET_RECTS = 40;

/** GLSL needs a decimal point on every float literal. */
const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));

/** Whole cycles per loop as an angular speed, so the water clock wraps seamlessly. */
const loopSpeed = (cycles: number): string => f((cycles * 2 * Math.PI) / OCEAN_LOOP_SECONDS);
/** A texture scroll of whole tiles per loop. */
const loopScroll = (tiles: number): string => f(tiles / OCEAN_LOOP_SECONDS);

/** Depth over which the blended surface thins out onto the sand. */
const SHORE_FILM_DEPTH = 0.55;

const cascadeIndices = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Uniform names a material must bind for a cascade count. */
export function oceanSamplerNames(cascades: number): { disp: string[]; shade: string[] } {
  return {
    disp: cascadeIndices(Math.min(cascades, 2)).map((i) => `uOceanDisp${i}`),
    shade: cascadeIndices(cascades).map((i) => `uOceanShade${i}`),
  };
}

// The interactive wake window, shared by both stages (water_simulation.ts).
const WAKE_SAMPLE_GLSL = /* glsl */ `
float wakeSampleAt(vec2 worldXZ, out vec4 wave) {
  vec2 waveUv = (worldXZ - uWaveOrigin) / uWaveSize;
  if (any(lessThan(waveUv, vec2(0.0))) || any(greaterThan(waveUv, vec2(1.0)))) {
    wave = vec4(0.0);
    return 0.0;
  }
  wave = texture2D(uWaveState, waveUv);
  // Ramp to nothing at the border: the window is a camera-anchored square, and
  // a hard cut there would draw a straight seam.
  vec2 toEdge = min(waveUv, vec2(1.0) - waveUv);
  return smoothstep(0.0, ${f(WATER_FIELD_EDGE_FEATHER_UV)}, min(toEdge.x, toEdge.y));
}
`;

// The realm's water character (water_character_core.ts), by world position.
const CHARACTER_GLSL = /* glsl */ `
uniform sampler2DArray uWaterChar;
uniform vec4 uWaterCharRect;
vec4 waterCharacter(vec2 worldXZ, float layer) {
  return texture(uWaterChar, vec3((worldXZ - uWaterCharRect.xy) * uWaterCharRect.zw, layer));
}
`;

const WAKE_UNIFORMS = /* glsl */ `
uniform sampler2D uWaveState;
uniform float uWaveEnabled;
uniform vec2 uWaveOrigin;
uniform float uWaveSize;
`;

/**
 * Screen-space reflection over the opaque-scene capture: march the reflected
 * ray in view space with geometrically growing steps, test it against the
 * captured depth, refine the first crossing by bisection, and fade the hit by
 * how far it travelled, how close it lands to the screen edge, and whether
 * the ray was heading back toward the camera (where the capture holds nothing
 * behind what it shows). A miss returns confidence 0 and the sky probe stands.
 */
function ssrGlsl(steps: number): string {
  return /* glsl */ `
uniform mat4 projectionMatrix;
// Depth inside the march loop reads an explicit LOD: implicit-gradient reads in
// data-dependent loops are what some D3D11 translations unroll slowly.
float oceanSsrDepth(vec2 uv) {
  float d = textureLod(uOpaqueDepth, uv, 0.0).r;
  return uSceneClip.x * uSceneClip.y / (uSceneClip.y - d * (uSceneClip.y - uSceneClip.x));
}
vec2 oceanSsrUv(vec3 p, out bool inside) {
  vec4 clip = projectionMatrix * vec4(p, 1.0);
  vec2 ndc = clip.xy / max(clip.w, 1e-4);
  vec2 uv = ndc * 0.5 + 0.5;
  inside = clip.w > 0.0 && all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)));
  return uv;
}
vec3 oceanSsr(vec3 startV, vec3 dirV, float jitter, out float conf) {
  conf = 0.0;
  // Rays heading back toward the camera reflect what the capture cannot hold.
  float away = clamp(-dirV.z * 3.0 + 0.35, 0.0, 1.0);
  if (away <= 0.0) return vec3(0.0);
  float t = 0.35 + jitter * 0.3;
  float tPrev = 0.0;
  for (int i = 0; i < ${steps}; i++) {
    vec3 p = startV + dirV * t;
    bool inside;
    vec2 uv = oceanSsrUv(p, inside);
    if (!inside) return vec3(0.0);
    float sceneZ = oceanSsrDepth(uv * uSceneExtent.zw);
    float dz = -p.z - sceneZ;
    if (dz > 0.0 && dz < max(0.8, t * 0.14)) {
      // Bisect between the last miss and this hit.
      float lo = tPrev;
      float hi = t;
      for (int k = 0; k < 6; k++) {
        float mid = 0.5 * (lo + hi);
        vec3 q = startV + dirV * mid;
        bool qIn;
        vec2 quv = oceanSsrUv(q, qIn);
        if (-q.z - oceanSsrDepth(quv * uSceneExtent.zw) > 0.0) hi = mid;
        else lo = mid;
      }
      bool hitIn;
      vec2 huv = oceanSsrUv(startV + dirV * hi, hitIn);
      vec2 edge = min(huv, vec2(1.0) - huv);
      conf = away * smoothstep(0.0, 0.08, min(edge.x, edge.y)) * (1.0 - smoothstep(70.0, 130.0, hi));
      return textureLod(uOpaqueColor, clamp(huv * uSceneExtent.zw,
        uSceneExtent.xy * 0.5, uSceneExtent.zw - uSceneExtent.xy * 0.5), 0.0).rgb;
    }
    tPrev = t;
    t *= 1.32;
  }
  return vec3(0.0);
}
`;
}

export function oceanSurfaceVertex(opts: OceanSurfaceShaderOptions): string {
  const dispCascades = Math.min(opts.cascades, 2);
  return /* glsl */ `
attribute float aShoreDepth;
attribute float aShoreSlope;
attribute float aSwellW;
attribute float aSwellGate;
uniform float uOceanDispScale;
uniform vec4 uOceanCascade[${opts.cascades}];
${cascadeIndices(dispCascades)
  .map((i) => `uniform sampler2D uOceanDisp${i};`)
  .join('\n')}
${WAKE_UNIFORMS}
${CHARACTER_GLSL}
varying vec3 vWPos;
varying vec2 vOceanXZ;
varying float vShoreDepth;
varying float vShoreSlope;
varying float vOpenSea;
varying float vFetch;
varying float vViewZ;
#include <fog_pars_vertex>
${WAKE_SAMPLE_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 xz = wp.xz;
  vOceanXZ = xz;
  // Sea state by FETCH: the open sea swells, a sheltered pond only ripples.
  // Distance to the waterline is recovered as depth over seabed slope.
  float shoreDist = max(aShoreDepth, 0.0) / max(aShoreSlope, 0.001);
  float fetch = smoothstep(10.0, 80.0, shoreDist);
  vFetch = fetch;
  // aSwellW: 1 on the horizon apron (long waves only, its vertices are tens
  // of units apart), 2 inside a zone sheet (short waves too), feathering to 1
  // at a sheet edge so both sheets displace identically where they meet.
  float chopW = clamp(aSwellW - 1.0, 0.0, 1.0);
  float swellW = clamp(aSwellW, 0.0, 1.0);
  vOpenSea = swellW;
  float range = 1.0 - smoothstep(140.0, 340.0, distance(cameraPosition.xz, xz));
  // The apron reads the big cascade from a coarse mip (its grid cannot carry
  // anything shorter); a sheet reads it sharp, blending to the apron's mip at
  // its edge so the seam stays closed.
  vec3 d = textureLod(uOceanDisp0, xz * uOceanCascade[0].x, mix(3.0, 0.0, chopW)).xyz
    * swellW * mix(0.12, 1.0, fetch);
${
  dispCascades > 1
    ? `  d += textureLod(uOceanDisp1, xz * uOceanCascade[1].x, 0.0).xyz
    * chopW * range * mix(0.3, 1.0, fetch);`
    : ''
}
  // aSwellGate is the baked neighbourhood depth gate: zero over every cell
  // that touches dry ground, so the moving sheet can never rise over a beach.
  // A sheltered realm's water heaves less (its character's chop).
  float chop = waterCharacter(xz, 0.0).a;
  wp.xyz += d * uOceanDispScale * aSwellGate * mix(0.4, 1.0, clamp(chop, 0.0, 1.0));
  if (uWaveEnabled > 0.001) {
    vec4 wave;
    float waveW = uWaveEnabled * wakeSampleAt(xz, wave);
    wp.y += wave.r * waveW * aSwellGate;
  }
  vShoreDepth = aShoreDepth;
  vShoreSlope = aShoreSlope;
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
}

/**
 * The depth-only pass (ocean_material.ts createOceanDepthMaterial): the same
 * displaced surface, writing depth and no colour, drawn after every
 * transparent object. Floor marks a player reacts to have already drawn
 * through the water by then; what reads the depth afterwards (AO, the cel ink)
 * sees a solid sea instead of the seabed's contours under it. The apron's
 * variant discards inside the built sheets exactly as its colour pass does.
 */
export function oceanDepthFragment(opts: Pick<OceanSurfaceShaderOptions, 'apron'>): string {
  return /* glsl */ `
varying vec2 vOceanXZ;
${
  opts.apron
    ? `uniform vec4 uSheetRects[${OCEAN_MAX_SHEET_RECTS}];
uniform int uSheetRectCount;`
    : ''
}
void main() {
${
  opts.apron
    ? `  for (int i = 0; i < ${OCEAN_MAX_SHEET_RECTS}; i++) {
    if (i >= uSheetRectCount) break;
    vec4 r = uSheetRects[i];
    if (vOceanXZ.x >= r.x && vOceanXZ.x <= r.z && vOceanXZ.y >= r.y && vOceanXZ.y <= r.w) discard;
  }`
    : ''
}
  gl_FragColor = vec4(0.0);
}
`;
}

export function oceanSurfaceFragment(opts: OceanSurfaceShaderOptions): string {
  const n = opts.cascades;
  const idx = cascadeIndices(n);
  const varStep =
    (OCEAN_VARIANCE_LOG2_K_MAX - OCEAN_VARIANCE_LOG2_K_MIN) / (OCEAN_VARIANCE_SAMPLES - 1);
  // The ripple cascade the caustics read: the second finest.
  const causticCascade = Math.max(0, n - 2);
  const cascadeBlock = idx
    .map((i) => {
      // The long waves need fetch to grow; ripples ride any open water, a
      // little softer than the swell they ride on.
      const fetchW = i < 2 ? 'mix(0.12, 1.0, fetch)' : 'mix(0.6, 1.0, fetch) * 0.8';
      const gustW = i === 0 ? '1.0' : 'gust';
      return `  {
    // A cascade whose waves the pixel cannot hold even along its long axis
    // (grazing views squeeze the footprint one way only) hands its slope to
    // the roughness instead of drawing it as streaks.
    float size = 1.0 / uOceanCascade[${i}].x;
    float keep = 1.0 - smoothstep(size * 0.012, size * 0.05, footMax);
    vec4 s = texture2D(uOceanShade${i}, xz * uOceanCascade[${i}].x);
    float w = ${fetchW} * ${gustW};
    slope += s.xy * w * keep;
    fadedVar += uOceanCascade[${i}].y * w * w * (1.0 - keep * keep);
    foam = max(foam, s.w * min(w, 1.0) * uOceanCascade[${i}].z);
  }`;
    })
    .join('\n');
  return /* glsl */ `
${opts.zoneHaze ? BIOME_HAZE_DECLARATIONS : ''}
${SCENE_SAMPLE_GLSL}
${idx.map((i) => `uniform sampler2D uOceanShade${i};`).join('\n')}
uniform sampler2D uOceanDisp0;
uniform sampler2D uOceanDisp1;
uniform vec4 uOceanCascade[${n}];
uniform float uOceanVariance[${OCEAN_VARIANCE_SAMPLES}];
uniform samplerCube uSkyProbe;
uniform float uSkyProbeLod;
uniform float uSkyProbeReady;
uniform sampler2D uFoamTex;
uniform vec3 uSunDir;
uniform vec3 uDayNight;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uScatter;
uniform float uWaterPalette;
uniform vec4 uOceanLook;
#ifdef OCEAN_APRON
uniform vec4 uSheetRects[${OCEAN_MAX_SHEET_RECTS}];
uniform int uSheetRectCount;
#endif
#ifdef OCEAN_DEBUG_TERMS
uniform int uOceanDebug;
#endif
uniform float uTime;
${WAKE_UNIFORMS}
${CHARACTER_GLSL}
varying vec3 vWPos;
varying vec2 vOceanXZ;
varying float vShoreDepth;
varying float vShoreSlope;
varying float vOpenSea;
varying float vFetch;
varying float vViewZ;
#include <common>
#include <fog_pars_fragment>
${WAKE_SAMPLE_GLSL}

// Slope variance of every simulated wave shorter than a pixel can show.
float oceanUnresolvedVariance(float k) {
  float x = (log2(max(k, 1e-6)) - ${f(OCEAN_VARIANCE_LOG2_K_MIN)}) * ${f(1 / varStep)};
  float i = clamp(floor(x), 0.0, ${f(OCEAN_VARIANCE_SAMPLES - 2)});
  int ii = int(i);
  return mix(uOceanVariance[ii], uOceanVariance[ii + 1], clamp(x - i, 0.0, 1.0));
}

// Smith masking for a Gaussian (Beckmann) slope distribution: the share of
// facets a ray at this elevation is not shadowed from by the crests in front
// (Walter et al. 2007 rational fit of Lambda; exact enough, no erfc).
float oceanSmithLambda(float cosTheta, float sigma) {
  float c = clamp(cosTheta, 0.001, 0.9999);
  float a = c / (sqrt(1.0 - c * c) * sigma * 1.41421356);
  if (a >= 1.6) return 0.0;
  return (1.0 - 1.259 * a + 0.396 * a * a) / (3.535 * a + 2.181 * a * a);
}

// Schlick fresnel for water (F0 0.02), powers spelled as multiplies.
float oceanFresnel(float cosTheta) {
  float m = 1.0 - clamp(cosTheta, 0.0, 1.0);
  float m2 = m * m;
  return 0.02 + 0.98 * m2 * m2 * m;
}

${opts.ssrSteps > 0 ? ssrGlsl(opts.ssrSteps) : ''}
void main() {
  vec2 xz = vOceanXZ;
#ifdef OCEAN_APRON
  // A built fine sheet owns every pixel inside its rect; the apron draws only
  // the open sea and the coasts no sheet covers.
  for (int i = 0; i < ${OCEAN_MAX_SHEET_RECTS}; i++) {
    if (i >= uSheetRectCount) break;
    vec4 r = uSheetRects[i];
    if (xz.x >= r.x && xz.x <= r.z && xz.y >= r.y && xz.y <= r.w) discard;
  }
#endif
  vec3 toCam = cameraPosition - vWPos;
  float camDist = length(toCam);
  vec3 V = toCam / max(camDist, 1e-4);
  float fetch = vFetch;
  // Wind-gust lanes: a slow world-space field that varies the short waves, so
  // no two reaches of sea carry the same chop and no cascade reads as a tile.
  vec4 lanes = texture2D(uFoamTex, xz * 0.0011 + uTime * vec2(${loopScroll(1)}, ${loopScroll(-1)}));
  float gust = 0.55 + 0.9 * lanes.b;

  // ---- this place's water ----
  vec4 charA = waterCharacter(xz, 0.0);
  vec4 charB = waterCharacter(xz, 1.0);
  vec4 charC = waterCharacter(xz, 2.0);
  // The palette lab's water row, when one is applied, owns the colours.
  vec3 deepCol = mix(charA.rgb, uDeep, uWaterPalette);
  vec3 shallowCol = mix(charC.rgb, uShallow, uWaterPalette);
  vec3 scatterCol = mix(mix(charC.rgb, charA.rgb, 0.3), uScatter, uWaterPalette);
  vec3 absorb = charB.rgb;
  float chop = charA.a;
  float foamScale = charB.a;

  // ---- the simulated surface ----
  vec2 footDx = dFdx(xz);
  vec2 footDy = dFdy(xz);
  float footMax = max(length(footDx), length(footDy));
  vec2 slope = vec2(0.0);
  float foam = 0.0;
  float fadedVar = 0.0;
${cascadeBlock}
  float crest = texture2D(uOceanDisp0, xz * uOceanCascade[0].x).y
    + texture2D(uOceanDisp1, xz * uOceanCascade[${Math.min(1, n - 1)}].x).y * gust;
  float crestStd = uOceanCascade[0].w + uOceanCascade[${Math.min(1, n - 1)}].w;
  float crestN = clamp(crest * mix(0.12, 1.0, fetch) * chop / max(crestStd * 2.0, 1e-3), -1.0, 1.0);
  slope *= chop;
  foam *= foamScale;

  vec2 wakeSlope = vec2(0.0);
  float wakeEnergy = 0.0;
  if (uWaveEnabled > 0.001) {
    vec4 wave;
    float waveW = uWaveEnabled * wakeSampleAt(xz, wave);
    wakeSlope = wave.ba * waveW;
    wakeEnergy = (abs(wave.g) * 0.9 + length(wave.ba) * 0.4) * waveW;
  }
  // The wake field's slope at the weight the old surface gave it (9.5 over a
  // 3.1 normal), so a wade or a splash reads as strongly as it always did.
  slope += wakeSlope * 3.0;

  // What this pixel cannot resolve becomes roughness.
  float footprint = max(length(fwidth(xz)), 1e-4);
  float sigma2 = max(oceanUnresolvedVariance(3.14159265 / footprint) * mix(0.45, 1.0, fetch), fadedVar)
    * chop * chop + 0.00025;

  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 L = normalize(uSunDir);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float sunUp = clamp(L.y, 0.0, 1.0);

  // ---- light ----
  // The key light's colour, reddened as it sinks through a longer air path.
  vec3 airmass = exp(-vec3(0.04, 0.11, 0.26) / max(sunUp + 0.06, 0.06));
  vec3 sunRad = uSunColor * uDayNight * airmass * uOceanLook.x * smoothstep(-0.03, 0.05, L.y);
  // How bright the key light is against full day (the moon is a dim sun).
  float keyLight = clamp(dot(sunRad, vec3(0.2126, 0.7152, 0.0722)) / max(uOceanLook.x * 0.8, 1e-3), 0.0, 1.0);
  bool probe = uSkyProbeReady > 0.5;
  vec3 ambient = probe
    ? textureLod(uSkyProbe, vec3(0.0, 1.0, 0.0), uSkyProbeLod - 1.0).rgb
    : uSkyColor * uDayNight * 0.8;

#ifdef WATER_UNDERSIDE
  // ---- seen from below: Snell's window and total internal reflection ----
  vec3 Nd = -N;
  float upDot = clamp(dot(N, V) * -1.0, 0.0, 1.0);
  float snellW = smoothstep(0.655, 0.70, upDot);
  vec3 into = refract(-V, Nd, 1.333);
  vec3 skyT = probe && dot(into, into) > 0.0
    ? textureLod(uSkyProbe, normalize(into), 1.0).rgb
    : uSkyColor * uDayNight;
  vec3 body = deepCol * (ambient * 0.9 + sunRad * sunUp * 0.15);
  vec3 col = mix(body * 0.55, skyT * 0.85 + shallowCol * ambient * 0.12, snellW);
  float wellDot = clamp(dot(L, N), 0.0, 1.0);
  float well2 = wellDot * wellDot;
  col += shallowCol * sunRad * well2 * well2 * 0.18;
  float glint = clamp(dot(refract(-L, N, 1.0 / 1.333), -V), 0.0, 1.0);
  float glint2 = glint * glint;
  float glint8 = glint2 * glint2 * glint2 * glint2;
  col += sunRad * glint8 * glint8 * 0.35 * snellW;
  float alpha = mix(0.92, 0.85, snellW);
#else
  // ---- reflection ----
  // At a grazing angle the crests hide the facets turned away from the eye,
  // so the facets that ARE seen face it more squarely: their fresnel is a
  // little lower and they mirror sky from a little higher up. (Masking the
  // reflection outright instead is what painted the horizon water darker
  // than the sky above it.)
  float sigma = sqrt(sigma2);
  float lambdaV = oceanSmithLambda(V.y, sigma);
  float F = oceanFresnel(max(NdV, sigma * 0.45));
  float masking = 1.0;
  vec3 R = reflect(-V, N);
  R.y = max(abs(R.y), sigma * 0.35);
  R = normalize(R);
  float lod = clamp(log2(max(sigma * 220.0, 1.0)), 0.0, uSkyProbeLod);
  vec3 skyR = probe
    ? textureLod(uSkyProbe, R, lod).rgb
    : uSkyColor * uDayNight;
  // This world's dome is graded brighter than a physical sky (it is the
  // brightest thing in most frames), so an honest fresnel share of it washed
  // every steeply viewed pond out to the brightness of the sunlit ground. The
  // reflection keeps its full weight toward the horizon, where the far sea
  // must read as nearly sky-bright, and gives way to the water's own colour
  // as the view steepens.
  skyR *= mix(0.95, 0.6, smoothstep(0.04, 0.42, V.y));
  vec3 reflection = skyR;
${
  opts.ssrSteps > 0
    ? `  if (uSceneReady > 0.5) {
    // What the sky probe cannot know: the shore, the trees, the ships. Traced
    // along a CALMER normal than the one that shades, so the reflected world
    // breaks up with the waves instead of dissolving into noise.
    vec3 ssrN = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.45));
    vec3 ssrR = reflect(-V, ssrN);
    if (ssrR.y > 0.0) {
      float ssrConf;
      vec3 startV = (viewMatrix * vec4(vWPos, 1.0)).xyz;
      vec3 dirV = normalize(mat3(viewMatrix) * ssrR);
      // No per-pixel jitter: with no temporal accumulation to resolve it, a
      // jittered start prints as a stipple over everything reflected. The
      // bisection below finds the crossing exactly enough instead.
      vec3 hit = oceanSsr(startV, dirV, 0.5, ssrConf);
      // A rough patch smears what it mirrors; let the probe's blur take over.
      ssrConf *= 1.0 - smoothstep(0.02, 0.09, sigma2);
      reflection = mix(reflection, hit * 0.9, ssrConf);
    }
  }`
    : ''
}

  // Sun glitter: the micro-facet slope that mirrors the sun into the eye,
  // against the filtered slope, with the unresolved variance as its spread.
  vec3 H = normalize(L + V);
  float hy = max(H.y, 0.05);
  vec2 dz = -H.xz / hy - slope;
  float p = exp(-dot(dz, dz) / (2.0 * sigma2)) / (6.2831853 * sigma2);
  float Fh = oceanFresnel(dot(V, H));
  float hy2 = hy * hy;
  float shadowing = 1.0 / (1.0 + lambdaV + oceanSmithLambda(L.y, sigma));
  float glitter = min(Fh * p / (4.0 * hy2 * hy2 * max(V.y, 0.06)), 40.0) * shadowing;
  vec3 sunSpec = sunRad * glitter * smoothstep(0.0, 0.08, L.y + 0.02);

  // ---- the water body ----
  vec3 bodyLight = ambient * 0.95 + sunRad * sunUp * 0.16;
  // The water's own absorption sets the hue of light scattered back out of
  // it, so the body takes the light's BRIGHTNESS and only a little of its
  // colour: a sunset sea stays deep blue-green under its orange reflections.
  float bodyLum = dot(bodyLight, vec3(0.2126, 0.7152, 0.0722));
  vec3 body = deepCol * mix(vec3(bodyLum), bodyLight, 0.3) * 1.25;
  // Light through the backs of crests toward a low sun, and a faint glow on
  // every lifted face: the turquoise of a lit wave.
  vec3 sunH = normalize(vec3(L.x, 0.0, L.z) + vec3(1e-4, 0.0, 0.0));
  vec3 viewH = normalize(vec3(-V.x, 0.0, -V.z) + vec3(1e-4, 0.0, 0.0));
  float toward = clamp(dot(viewH, sunH), 0.0, 1.0);
  float toward2 = toward * toward;
  float churn = clamp(crestN + wakeEnergy * 2.0, 0.0, 1.3);
  float crestLift = max(crestN, 0.0);
  vec3 sss = scatterCol * (sunRad * toward2 * toward2 * (0.06 + 0.5 * crestLift * crestLift + 0.3 * churn * churn)
    * (1.0 - sunUp * 0.6) + ambient * 0.12 * crestLift) * (0.35 + 0.65 * fetch);

  vec3 under = body;
  // How much of what lies behind the surface still reaches the eye through
  // it, in the blended (no capture) arm; the capture arm composites the
  // scene into under itself and leaves this at zero.
  float behindT = 0.0;
  float edge = 1.0;
  float contact = 0.0;
  bool captured = uSceneReady > 0.5;
  if (captured) {
    // The real scene behind the surface, refracted by the waves.
    vec2 suv = sceneUv();
    float waterZ = vViewZ;
    float sceneZ = sceneDepth(suv);
    float thick = max(sceneZ - waterZ, 0.0);
    vec3 nView = mat3(viewMatrix) * N;
    vec2 offset = nView.xy * uOceanLook.y * min(thick, 3.5) / max(waterZ, 1.0);
    vec2 ruv = clamp(suv + offset * uSceneExtent.zw,
      uSceneExtent.xy * 0.5, uSceneExtent.zw - uSceneExtent.xy * 0.5);
    float rz = sceneDepth(ruv);
    // Never refract something in FRONT of the water into it.
    if (rz < waterZ + 0.05) {
      ruv = suv;
      rz = sceneZ;
    }
    vec3 behind = texture2D(uOpaqueColor, ruv).rgb;
    float rayScale = camDist / max(waterZ, 1e-3);
    // The seabed's own facets would print as hard colour steps through clear
    // water; a small cross of depth taps softens the depth the colour reads.
    vec2 tap = uSceneExtent.xy * 4.0;
    float rzSoft = (rz * 2.0 + sceneDepth(ruv + vec2(tap.x, 0.0)) + sceneDepth(ruv - vec2(tap.x, 0.0))
      + sceneDepth(ruv + vec2(0.0, tap.y)) + sceneDepth(ruv - vec2(0.0, tap.y))) / 6.0;
    float rayLen = max(mix(rz, max(rzSoft, waterZ), 0.75) - waterZ, 0.0) * rayScale;
    vec3 seabed = vWPos - V * rayLen;
    float below = max(vWPos.y - seabed.y, 0.0);
    // Caustics: the ripples focus sunlight into a moving net on the seabed
    // (where the ripple field compresses, its Jacobian drops under one).
    vec2 cxz = seabed.xz - L.xz / max(L.y, 0.25) * below * 0.75;
    float cj = texture2D(uOceanShade${causticCascade}, cxz * uOceanCascade[${causticCascade}].x * 0.85).z;
    float cj2 = texture2D(uOceanShade${causticCascade}, cxz * uOceanCascade[${causticCascade}].x * 1.37 + 0.31).z;
    float focus = clamp(1.0 - cj, 0.0, 1.0) + clamp(1.0 - cj2, 0.0, 1.0) * 0.7;
    float caustic = smoothstep(0.02, 0.32, focus) * uOceanLook.z * sunUp * keyLight
      * smoothstep(0.0, 0.25, below) * exp(-below * 0.22);
    behind *= 1.0 + caustic * (1.0 - foam);
    // Sand under the last film of water is wet and dark.
    behind *= mix(0.6, 1.0, smoothstep(0.0, 0.4, thick));
    // Red dies first, over the true path through the water.
    vec3 T = exp(-absorb * rayLen * 0.85);
    vec3 shallowTint = mix(vec3(1.0), shallowCol * 4.0, 0.35 * smoothstep(0.0, 1.2, below)
      * (1.0 - smoothstep(2.0, 7.0, below)));
    under = behind * T * shallowTint + body * (vec3(1.0) - T);
    edge = smoothstep(0.0, 0.12, thick);
    contact = 1.0 - smoothstep(0.0, 0.35, thick);
  } else {
    // No scene behind us: what the seabed contributes is left to the blend,
    // weighted by the light that survives the slanted path to it. A blend can
    // only dim the background GREY, so it keeps the share of the least
    // absorbed channel, and the colour the water steals beyond that (red
    // first) is put back against an estimate of a lit sandy bottom: shallows
    // over sand then turn turquoise instead of a washed-out grey.
    float pathLen = max(vShoreDepth, 0.0) / max(V.y, 0.15);
    vec3 T = exp(-absorb * pathLen);
    float keepT = min(T.r, min(T.g, T.b));
    behindT = keepT;
    float depthT = smoothstep(0.0, ${f(WATER_SEABED_CLAMP_YARDS)}, vShoreDepth);
    vec3 seabedGuess = vec3(0.52, 0.42, 0.28) * bodyLum;
    vec3 inscatter = mix(shallowCol * bodyLight * 0.9, body, 0.35 + 0.65 * depthT);
    under = (T - vec3(keepT)) * seabedGuess + inscatter * (vec3(1.0) - T);
    edge = smoothstep(0.0, ${f(SHORE_FILM_DEPTH)}, vShoreDepth);
  }

  vec3 col = under * (1.0 - F) + reflection * F * masking + sss * (1.0 - F) + sunSpec;
  float keep = behindT * (1.0 - F);

  // ---- foam ----
  vec4 foamA = texture2D(uFoamTex, xz * 0.23 + slope * 0.6);
  vec4 foamB = texture2D(uFoamTex, xz * 0.071 + uTime * vec2(${loopScroll(2)}, ${loopScroll(3)}));
  float lace = clamp(foamA.r * 0.65 + foamB.r * 0.55, 0.0, 1.0);
  float bubbles = foamA.g * (0.4 + 0.6 * foamB.b);
  // Whitecaps: dense where a crest has just broken, tearing into lace as the
  // foam ages and thins (the persisted foam decays toward its threads).
  float whitecap = uOceanLook.w * smoothstep(0.25, 0.85, foam * 0.75 + lace * 0.45 - 0.15)
    * mix(lace, 1.0, foam * foam) * 0.8;
  // Surf keyed on HORIZONTAL distance to the waterline (depth over slope),
  // breathing with the swell so a set runs the wash up the beach.
  float shoreDist = max(vShoreDepth, 0.0) / max(vShoreSlope, 0.001);
  float surge = 0.65 + 0.55 * clamp(crestN * 1.4 + 0.5, 0.0, 1.0);
  float band = 1.0 - smoothstep(0.0, ${f(WATER_FOAM_WIDTH_YARDS)} * surge, shoreDist + (foamB.b - 0.5) * 1.6);
  band *= band;
  float lap = 0.52
    + 0.30 * sin(uTime * ${loopSpeed(129)} - shoreDist * 1.9 + foamB.g * 3.0)
    + 0.26 * sin(uTime * ${loopSpeed(88)} - shoreDist * 1.1 + xz.x * 0.071 + xz.y * 0.053);
  // Surf needs waves to make it: a pond laps, an open coast breaks.
  float swellEnergy = mix(0.12, 1.0, fetch) * mix(0.5, 1.0, clamp(foamScale, 0.0, 1.0));
  // A wash is crisp-edged lace, not a fog: threshold the texture against how
  // much wash is here, so thin wash is torn threads and a fresh wave is solid.
  float wash = band * clamp(lap, 0.0, 1.0);
  float surf = smoothstep(0.42, 0.58, wash * 0.85 + (lace * 0.75 + bubbles * 0.35) * 0.6 - 0.12)
    * swellEnergy * exp(-camDist * 0.004);
  float contactFoam = contact * contact * smoothstep(0.25, 0.75, lace + bubbles * 0.5)
    * (0.5 + 0.5 * lap) * mix(0.25, 1.0, fetch) * exp(-camDist * 0.012);
  float wakeFoam = smoothstep(0.05, 0.25, wakeEnergy) * (0.4 + 0.8 * bubbles) * 0.8;
  float foamCov = clamp(whitecap + surf + contactFoam + wakeFoam, 0.0, 0.95);
  vec3 foamCol = (sunRad * (0.35 + 0.55 * clamp(dot(N, L), 0.0, 1.0)) * sunUp + ambient * 0.9) * 0.92;
  col = mix(col, foamCol, foamCov);
  keep *= 1.0 - foamCov;

  // The surface fades out where the water thins to nothing on the shore; the
  // wash line outlives it, the way surf is the last thing to dry.
#ifdef WATER_SHORE_EDGE_FADE
  float edgeWobble = 0.18 * sin(vWPos.x * 1.7 + vWPos.z * 2.3) + 0.12 * sin(vWPos.z * 4.1 - vWPos.x * 3.3);
  edge *= smoothstep(0.12, 0.85, vShoreDepth + edgeWobble);
#endif
  // Moonlight has no colour to give: the night sea greys toward its luminance
  // instead of glowing saturated blue.
  float night = 1.0 - clamp(dot(uDayNight, vec3(0.2126, 0.7152, 0.0722)) * 1.4, 0.0, 1.0);
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.85, 0.92, 1.1), night * 0.55);
  float cover = max(edge, foamCov * clamp(edge * 3.0, 0.0, 1.0));
  float alpha;
  if (captured) {
    // Composite against the captured scene ourselves (after fog and haze,
    // below: the capture is already fogged): the edge hands back the
    // untouched beach, and the frame blends nothing.
    alpha = 1.0;
  } else {
    // out = col + background * keep, spelled for straight alpha blending.
    alpha = (1.0 - keep) * cover;
    col = col / max(1.0 - keep, 0.02);
  }
#endif
  gl_FragColor = vec4(col, alpha);
#if defined(OCEAN_DEBUG_TERMS) && !defined(WATER_UNDERSIDE)
  if (uOceanDebug == 1) gl_FragColor = vec4(vec3(F), 1.0);
  if (uOceanDebug == 2) gl_FragColor = vec4(reflection, 1.0);
  if (uOceanDebug == 3) gl_FragColor = vec4(under, 1.0);
  if (uOceanDebug == 4) gl_FragColor = vec4(body, 1.0);
  if (uOceanDebug == 5) gl_FragColor = vec4(sunSpec, 1.0);
  if (uOceanDebug == 6) gl_FragColor = vec4(vec3(foamCov), 1.0);
  if (uOceanDebug == 7) gl_FragColor = vec4(sss, 1.0);
  if (uOceanDebug == 8) gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
${opts.zoneHaze ? biomeHazeFragmentGlsl('vWPos.xz') : ''}
  #include <fog_fragment>
#ifndef WATER_UNDERSIDE
  if (captured && cover < 1.0) {
    gl_FragColor.rgb = mix(texture2D(uOpaqueColor, sceneUv()).rgb, gl_FragColor.rgb, cover);
  }
#endif
}
`;
}
