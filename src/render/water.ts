import * as THREE from 'three';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z, WORLD_SIZE, ZONES } from '../sim/data';
import type { ZoneDef } from '../sim/types';
import { waterLevel } from '../sim/world';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  BIOME_HAZE_DECLARATIONS,
  biomeHazeFragmentGlsl,
  biomeHazeUniforms,
  hasBiomeHazeField,
} from './biome_haze_field';
import { farVistaPlan } from './far_terrain_core';
import { GFX, SUN_DIR } from './gfx';
import { idleSlot, runIdleQueue } from './idle_queue';
import { waterNormalish, waterNormalMaps } from './textures';
import {
  bakeSwellGate,
  buildWaterSurfaceIndex,
  shoreDepthAt,
  shoreSlopeAt,
  WATER_FIELD_EDGE_FEATHER_UV,
  WATER_FOAM_WIDTH_YARDS,
  WATER_SEABED_CLAMP_YARDS,
} from './water_core';
import { WaterSimulation, type WaterWaveUniforms } from './water_simulation';
import { WATER_TIME_PERIOD, WATER_WAVE_GLSL } from './water_wave_core';

// Water for the whole zone strip.
//
// High tier: one ShaderMaterial plane per zone (so off-screen zones frustum
// cull away) with a CPU-precomputed per-vertex shore depth. Dual scrolling
// real normal maps (three.js r165 water set, MIT) + a broad ocean-swell map
// at range, fresnel sky tint, HDR sun glints (>1 so bloom catches them), a
// shoreline foam band and a subtle wave displacement.
//
// On top of that static surface sits the interactive height field
// (water_simulation.ts): ONE camera-anchored window, not one field per lake,
// because this world's water is continuous (zone strips plus the horizon
// apron) and has no lake list to key fields off. Every water mesh shares one
// material, so the field's uniforms drive all of them by reference. The broad
// swell maps stay: the field is camera-local and contributes nothing at range,
// where an open sea still has to read as moving water.
//
// Low tier keeps the legacy scrolling Phong plane, upgraded with the real
// swell normal map for textured speculars.
//
// DISPLACEMENT AND SHADING ARE SPLIT ON PURPOSE (water_wave_core.ts holds the
// one field both stages evaluate). Displacement is bound by what a grid can
// sample, so the short chop displaces on the zone planes only and feathers out
// at their rect edge; shading is not bound by anything, so it is computed per
// pixel from world position on every sheet. Tying the two together is what put
// a hard straight line through the sun-glint field along that rect edge and
// left the open sea (mostly apron) with no travelling waves at all.

const SEGMENTS_PER_ZONE = 180; // ~2u vertex spacing, enough for the foam band
// terrainHeight is deliberately rich and sampling all 32k water vertices in
// one timer was a measured 170-260ms live-play freeze. Background zone loads
// fill a handful of rows per idle callback instead; four rows stay around the
// 6ms cooperative-work budget on the profiling machine.
const WATER_ROWS_PER_IDLE_SLICE = 4;
const WATER_IDLE_TIMEOUT_MS = 200;
const WATER_VERTEX_ROWS = Array.from({ length: SEGMENTS_PER_ZONE + 1 }, (_, row) => row);
// The apron runs UNDER every zone plane and both ride one transparent material
// with depthWrite off, so the depth buffer cannot arbitrate between them: the
// surface that paints LAST wins the blend outright. Left to three.js's
// transparent sort that order comes from each object's bounding-sphere centre,
// and the apron's is a world-scale sheet near the origin, so merely orbiting
// the camera reorders them and swaps the sea between the apron's constant deep
// colour and the zone plane's shallow tint plus foam band. Pin the order so it
// can never depend on where the camera happens to be. The sky dome holds -10,
// so the apron sits between the sky and the default 0 band.
const WATER_APRON_RENDER_ORDER = -1;
const WATER_SURFACE_RENDER_ORDER = 0;

// Surface look, tuned against a 30 sample survey of the real coastline
// (tests/water_shore_shape.test.ts pins the geometry these assume).
/** Foam is an analytic sine with no mip chain, so fade it out with range. */
const WATER_FOAM_DISTANCE_FADE = 0.0055;
/**
 * Opacity rises far faster than colour does. Colour has to spread across the
 * whole 6 yard seabed range, but water stops showing its bottom within a couple
 * of yards, and the surface MUST reach full opacity by the seabed clamp: a zone
 * plane rect edge has the apron alone on one side and apron-under-zone-plane on
 * the other, and two stacked semi-transparent sheets do not composite to the
 * same colour as one. At full opacity both sides resolve identically and the
 * rect edge stops being visible.
 */
const WATER_OPACITY_EXTINCTION_PER_YARD = 0.9;
const WATER_SHALLOW_ALPHA = 0.84;
const WATER_DEEP_ALPHA = 1;
/**
 * Depth over which the surface thins to nothing as it runs out onto the sand.
 * Without it the sheet holds WATER_SHALLOW_ALPHA right up to its geometric
 * intersection with the terrain and then simply stops, which reads as a cut
 * line rather than as water. Deliberately far shallower than the seabed clamp,
 * so the "both sheets saturate by the clamp" rule the file header rests on is
 * untouched: this only ever acts in the last half yard.
 */
const WATER_SHORE_FILM_YARDS = 0.55;
/**
 * The surf outlives the water carrying it: a wash line is the last thing to
 * dry off a beach, and the foam band lives in exactly the depth range the film
 * acts on, so fading them together would erase the surf instead of softening
 * the waterline. Foam therefore rides its own shorter fade.
 */
const WATER_SHORE_FILM_FOAM_FRACTION = 0.4;
/**
 * How much of the palette the SEABED is allowed to drive. Bathymetry is not
 * smooth: the measured shelf off Eastbrook runs flat at ~1.5 yards for 40
 * yards, then breaks and drops to the 6 yard clamp within 30. Letting depth
 * drive the whole palette spends it across that break, and 30 yards of ground
 * at a grazing camera angle is a handful of pixels, so a real and correct piece
 * of terrain reads as a hard painted line out at sea. Handing most of the range
 * to VIEW DISTANCE instead is both softer and truer: open water gets its colour
 * from the depth of atmosphere in front of it, not from the rock underneath.
 */
const WATER_DEPTH_COLOR_AUTHORITY = 0.55;
/** View distance over which the sea grades to open-ocean colour. */
const WATER_DEEP_NEAR_YARDS = 25;
const WATER_DEEP_FAR_YARDS = 500;
// Carries what the seabed no longer does, so the far sea still reads as ocean.
const WATER_DEEP_DISTANCE_STRENGTH = 0.92;
/** GLSL needs a decimal point on every float literal. */
const glsl = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));
/**
 * The one shared, wrapped water clock every water material binds as uTime.
 * It wraps at WATER_TIME_PERIOD so shader phases never grow unbounded; every
 * wave frequency (water_wave_core.ts) is a whole number of cycles per that
 * period and every texture scroll below a whole number of tiles per it, so the
 * wrap is seamless by construction.
 */
const WATER_TIME: THREE.IUniform<number> = { value: 0 };
/**
 * Seabed slope the horizon apron falls back to once it is far enough out that
 * terrain sampling is no longer trustworthy. Foam is depth/slope, so a small
 * slope against a deep reading puts it far past the surf band: open water,
 * never foam.
 */
const APRON_SHORE_SLOPE = 1;
/**
 * The apron is NOT a featureless sheet. It begins exactly where the zone planes
 * stop (the world is only WORLD_SIZE yards across, so that edge is a few dozen
 * yards offshore and squarely in view), and a constant deep reading there steps
 * against whatever the zone plane actually has, which is usually still shelf.
 * Measured off Eastbrook: 1.51 yards on the plane's last vertex against the
 * apron's 6, drawn as a ruler-straight line because a rectangle edge IS
 * straight. So the apron samples the SAME terrain function the zone planes do
 * and the two agree at the seam by construction rather than by tuning.
 */
const APRON_SEGMENTS = 192;
/**
 * How far outside the world the apron keeps trusting terrainHeight. It stays
 * sensible well past the edge (6 yards, the clamp, by 70 yards out) but turns
 * into another landmass eventually (-38 yards at 720 out), which would paint
 * dry land across the horizon. Fade to the constant deep sea before that.
 */
const APRON_TERRAIN_FADE_YARDS = 240;

// Real water normal maps, fetched at module import and gated by the boot
// preload only for the shader tier. Low/mobile uses generated canvas water
// so it does not pay network/decode/upload cost for water detail.
const WATER_TEX: Record<string, THREE.Texture> = {};
function kickWaterTex(key: string, file: string): void {
  registerDeferredPreload(() =>
    loadTexture(`/textures/water/${file}`, { repeat: true }).then((tex) => {
      tex.anisotropy = 4;
      WATER_TEX[key] = tex;
      return tex;
    }),
  );
}
if (GFX.standardMaterials) {
  kickWaterTex('n1', 'water_1_normal.jpg');
  kickWaterTex('n2', 'water_2_normal.jpg');
  kickWaterTex('broad', 'waternormals.jpg');
}

export function hasWaterShaderAssets(): boolean {
  return Boolean(WATER_TEX.n1 && WATER_TEX.n2 && WATER_TEX.broad);
}

/**
 * Directional swell height (yards of half-amplitude), the amplitude BOTH
 * shader stages scale their wave field by. Purely cosmetic: the sim's
 * waterline and the swim surface stay flat, the amplitude is gated to zero
 * over every cell that touches the shore (a heaving sheet must never rise over
 * a beach, and the gate is a baked neighbourhood minimum precisely because the
 * naive per-vertex version is only correct AT the vertices; see the aSwellGate
 * attribute and water_core.ts bakeSwellGate), and the vertex
 * DISPLACEMENT additionally fades with camera range (the apron's ~29 yard
 * vertex spacing would alias the chop wavelengths into shimmer at the horizon;
 * the fragment stage has no such limit and fades on its own, wider schedule).
 */
const WATER_SWELL_AMP = 0.22;
/**
 * Feather over which the zone planes fade their chop DISPLACEMENT to zero
 * approaching their rect edge, where the chop-free apron takes over. Wider
 * than the chop wavelengths' half-heights so the handoff has no visible knee.
 * Displacement only: the shading field is per-pixel and identical on both
 * sheets, so this feather never reaches a normal, a whitecap, or a glint.
 */
const WATER_CHOP_EDGE_FEATHER_YARDS = 14;
/**
 * Depth margin the horizon apron subtracts before its displacement gate opens
 * (see bakeSwellGate). Its cells are ~29 x 38 yards, so an offshore sandbar can
 * sit entirely BETWEEN four wet vertices, invisible to a grid minimum; one yard
 * of margin covers every such bar in the world. It costs nothing visible: the
 * shallowest fully-heaving apron vertex moves from 1.3 to about 3.4 yards of
 * depth, and inside the world rect the apron is under a near-opaque zone plane
 * there anyway. The zone planes take 0 at their 2 yard spacing, where the grid
 * already sees everything.
 */
const WATER_APRON_SWELL_GATE_MARGIN_YARDS = 1;
const WATER_PLANE_SWELL_GATE_MARGIN_YARDS = 0;
/** Sun-through-swell scattering tint: the turquoise a lit wave face glows. */
const SCATTER_COLOR = new THREE.Color(0.09, 0.38, 0.33);

const DEEP_COLOR = new THREE.Color(0x0d3a52);
/** Canonical shallow-water tint, exported for surfaces that must match the
 *  sea palette without the full shader (the Wildheart waterfall ribbons). */
export const SHALLOW_COLOR = new THREE.Color(0x2d8077);
const SKY_TINT = new THREE.Color(0x7fb2e0); // matches the sky horizon band
const SUN_COLOR = new THREE.Color(0xfff0d4);

// Live day/night inputs, shared BY REFERENCE across every water surface
// material (the overworld field plus the Wildheart pools), the same idiom as
// sharedUniforms.uTime: the renderer writes them once per frame and every
// surface follows. uSunDir starts at the fixed anchor and tracks the moving
// sun/moon key light once the cycle drives it; uDayNight is the day/night
// color multiplier ((1,1,1) = authored day), needed because this shader is
// unlit (baked palette + fog) and would otherwise stay day-bright at night.
const WATER_SUN_UNIFORM = { value: SUN_DIR.clone() };
const WATER_DAYNIGHT_UNIFORM = { value: new THREE.Vector3(1, 1, 1) };

/** Point the water glints along the live key-light direction (sun by day,
 *  moon by night); the renderer calls this from its key-light update. */
export function setWaterSunDirection(dir: THREE.Vector3): void {
  WATER_SUN_UNIFORM.value.copy(dir);
}

/** Apply the day/night color multiplier to every water surface. */
export function setWaterDayNight(mul: readonly [number, number, number]): void {
  WATER_DAYNIGHT_UNIFORM.value.set(mul[0], mul[1], mul[2]);
}

export interface WaterView {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  ensureZone(zone: ZoneDef, opts?: { pace?: 'fast' | 'idle' }): Promise<THREE.Mesh[]>;
  isZoneLoaded(zoneId: string): boolean;
  /**
   * Advances the wrapped water clock, the legacy texture scroll (low tier),
   * the interactive height field, and the from-below ceiling visibility
   * (cameraY against the waterline). Returns the simulation passes drawn
   * this frame, which the renderer folds into its draw-call accounting.
   */
  update(
    time: number,
    cameraX: number,
    cameraZ: number,
    visibleRange: number,
    cameraY?: number,
  ): number;
  /** Adds a local entry, landing, fish, or bobber disturbance. */
  addSplash(x: number, z: number, radius: number, strength?: number): void;
  /** Presses a facing-aligned body footprint into the surface. */
  enterContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Moves submerged volume from the previous footprint to the current one. */
  moveContact(
    oldX: number,
    oldZ: number,
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Refills the final submerged footprint when a contact exits. */
  releaseContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /**
   * Editor-only: re-seat the surface at the ACTIVE waterLevel() and recompute
   * the per-vertex shore depth from the CURRENT terrainHeight (after a
   * water-level change or a sculpt near the shoreline). Updates the existing
   * geometry in place (no geometry is replaced, so nothing leaks); the low
   * Phong tier has no shore attribute and only repositions its one plane.
   */
  setLevel(): void;
  /** Releases view-owned geometry, materials, and simulation targets. */
  dispose(): void;
}

// Shared by the vertex and fragment stages: map a world xz onto the anchored
// height-field window, and report whether the sample actually lands inside it.
// Outside the window there is no state to read, and clamping to the rim would
// smear the border texel across the entire distant sea.
const WAVE_SAMPLE_GLSL = /* glsl */ `
  float waveSampleAt(vec2 worldXZ, out vec4 wave) {
    vec2 waveUv = (worldXZ - uWaveOrigin) / uWaveSize;
    if (any(lessThan(waveUv, vec2(0.0))) || any(greaterThan(waveUv, vec2(1.0)))) {
      wave = vec4(0.0);
      return 0.0;
    }
    wave = texture2D(uWaveState, waveUv);
    // Ramp to nothing at the border. A hard cut steps the surface normal, and
    // the window is a camera-anchored SQUARE, so that step is a straight seam.
    vec2 toEdge = min(waveUv, vec2(1.0) - waveUv);
    return smoothstep(0.0, ${glsl(WATER_FIELD_EDGE_FEATHER_UV)}, min(toEdge.x, toEdge.y));
  }
`;

const WATER_VERT = /* glsl */ `
  attribute float aShoreDepth;
  attribute float aShoreSlope;
  attribute float aSwellW;
  // Baked conservative displacement gate (water_core.ts bakeSwellGate): the
  // vertex's own depth ramp is only correct AT the vertex, and the GPU
  // interpolates lift across the whole cell between them. A geometry that omits
  // it reads 0 and stays flat, the same still-water default an interior pool
  // already gets from omitting aSwellW.
  attribute float aSwellGate;
  uniform float uTime;
  uniform float uSwellAmp;
  uniform sampler2D uWaveState;
  uniform float uWaveEnabled;
  uniform vec2 uWaveOrigin;
  uniform float uWaveSize;
  varying vec3 vWPos;
  varying float vShoreDepth;
  varying float vShoreSlope;
  // Open water, WITHOUT the rect-edge chop feather: 1 on the zone planes and
  // the apron alike, 0 on a still interior pool. The fragment stage keys its
  // whole wave field on this, so it must carry no per-sheet difference at all.
  varying float vOpenSea;
  #include <fog_pars_vertex>
  ${WATER_WAVE_GLSL}
  ${WAVE_SAMPLE_GLSL}
  void main() {
    vec3 pos = position;
    // Directional CHOP: three short travelling waves DISPLACE the surface.
    // Gated by aSwellW: zone planes only, feathered out at their rect edge
    // (the apron cannot sample these wavelengths, see the apron builder). The
    // matching SHADING is not computed here at all: the fragment stage
    // evaluates the same field per pixel on both sheets, so the feather (a
    // property of what a grid can carry) never reaches a normal.
    // The baked neighbourhood gate, NOT this vertex's own depth: every corner
    // of a cell touching dry ground reads 0, so the displaced sheet is exactly
    // flat over that cell and cannot tear up through a beach between vertices.
    float depthFade = aSwellGate;
    float rangeFade = 1.0 - smoothstep(120.0, 300.0, distance(cameraPosition.xz, pos.xz));
    // aSwellW packs both displacement gates: 0 = still water (interior pools,
    // whose geometry omits the attribute so GL supplies 0), 1 = groundswell
    // only (the apron), 2 = groundswell plus chop (zone plane interiors,
    // feathering back to 1 approaching the rect edge the apron shares).
    float chopW = clamp(aSwellW - 1.0, 0.0, 1.0);
    float gswW = clamp(aSwellW, 0.0, 1.0);
    float group = waveGroup(pos.xz, uTime);
    float chopCrest;
    vec2 chopSlope;
    chopField(pos.xz, uTime, chopCrest, chopSlope);
    pos.y += chopCrest * uSwellAmp * depthFade * rangeFade * chopW * (0.55 + 0.9 * group);
    // The GROUNDSWELL: long rollers both grids sample cleanly, so they carry
    // no aSwellW gate and no range fade: this is what keeps the open sea
    // visibly heaving at distance. Depth-faded like the chop (a heaving sheet
    // must never rise over a beach), and the group envelope rides along so
    // the rollers arrive in sets instead of a metronome.
    float gsCrest;
    vec2 gsSlope;
    groundswellField(pos.xz, uTime, gsCrest, gsSlope);
    pos.y += gsCrest * uSwellAmp * 2.0 * depthFade * gswW * (0.5 + 0.8 * group);
    vOpenSea = gswW;
    pos.y += (sin(uTime * WOBBLE_W1 + pos.x * 0.35) + sin(uTime * WOBBLE_W2 + pos.z * 0.28))
      * 0.05 * depthFade * chopW;
    if (uWaveEnabled > 0.001) {
      // waveSampleAt WRITES wave, so it has to complete before wave is read:
      // operand evaluation order is unspecified in GLSL.
      vec4 wave;
      float waveW = uWaveEnabled * waveSampleAt(pos.xz, wave);
      // Gated too: the height field clamps to +/- 0.65 yards, and this was the
      // one displacement term that took no depth gate at all, so a wake or a
      // splash next to a beach lifted the sheet over the sand at ANY vertex,
      // dry ones included. Only the geometry is gated: the wake's SHADING
      // (waveSlope, contactSheen) is a fragment effect and still runs ashore.
      pos.y += wave.r * waveW * depthFade;
    }
    vShoreDepth = aShoreDepth;
    vShoreSlope = aShoreSlope;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
#ifdef WOC_ZONE_HAZE
${BIOME_HAZE_DECLARATIONS}
#endif
  uniform sampler2D uNorm1;
  uniform sampler2D uNorm2;
  uniform sampler2D uNorm3;
  uniform vec3 uSunDir;
  uniform vec3 uDayNight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uTime;
  uniform sampler2D uWaveState;
  uniform float uWaveEnabled;
  uniform vec2 uWaveOrigin;
  uniform float uWaveSize;
  uniform float uShoreEdgeFade;
  uniform vec3 uScatter;
  uniform float uSwellAmp;
  varying vec3 vWPos;
  varying float vShoreDepth;
  varying float vShoreSlope;
  varying float vOpenSea;
  #include <common>
  #include <fog_pars_fragment>
  ${WATER_WAVE_GLSL}
  ${WAVE_SAMPLE_GLSL}
  void main() {
    float camDist = length(cameraPosition - vWPos);
    // dual-scroll detail ripples (real three.js water normal maps)
    vec3 n1 = texture2D(uNorm1, vWPos.xz * 0.055 + uTime * vec2(0.013333, 0.018333)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNorm2, vWPos.xz * 0.115 - uTime * vec2(0.021667, 0.011667)).xyz * 2.0 - 1.0;
    // broad slow ocean swell that survives at range, where the detail maps
    // average out to a mirror, keeps big water surfaces alive from above
    vec3 n3 = texture2D(uNorm3, vWPos.xz * 0.016 + uTime * vec2(0.005000, -0.003333)).xyz * 2.0 - 1.0;
    // Sea-state lanes: the broad map again at 1/4 the scale, drifting one
    // tile per clock period. Its slow field re-tints and brightens whole
    // stretches of water (wind lanes, glassy calms), the large-scale
    // variation a single-palette ocean is missing. (Named seaLane because
    // "patch" is a RESERVED WORD in GLSL ES 3.00, and three.js promotes this
    // shader to #version 300 es on WebGL2; the reserved name failed the
    // compile silently under parallel shader compilation.)
    float seaLane = texture2D(uNorm3, vWPos.xz * 0.0042 + uTime * vec2(0.001667, -0.001667)).x;
    float farW = smoothstep(40.0, 260.0, camDist);
    // THE WAVE FIELD, PER PIXEL, from world position: the same functions the
    // vertex stage displaces with, evaluated identically on BOTH sheets.
    //
    // Carrying the slope as a vertex varying instead is what cut a hard
    // straight line through the sun-glint field along the zone planes' rect
    // edge. The planes can displace the chop and the apron's ~29 x 38 yard
    // cells cannot, so the slope feeding glints, whitecaps and scatter stepped
    // exactly at that rectangle, and at a low sun the mismatch is glaring.
    // Nothing here reads a grid or a sheet, so the two cannot disagree. It is
    // also what puts travelling waves on the OPEN sea, which is mostly apron
    // and previously carried nothing but scrolling normal maps.
    float waveDepthFade = clamp(vShoreDepth * 0.8, 0.0, 1.0);
    float group = waveGroup(vWPos.xz, uTime);
    float openW = vOpenSea * waveDepthFade;
    float chopW = openW * (1.0 - smoothstep(CHOP_FADE.x, CHOP_FADE.y, camDist));
    float midW = openW * (1.0 - smoothstep(MSWELL_FADE.x, MSWELL_FADE.y, camDist));
    float gsW = openW * (1.0 - smoothstep(GSWELL_FADE.x, GSWELL_FADE.y, camDist));
    vec2 swellSlope = vec2(0.0);
    float crestSum = 0.0;
    // Each family is skipped once it has faded out. camDist varies smoothly
    // across the screen, so these branches are coherent: whole tiles of the
    // distant sea take the same path and pay for none of the trig.
    if (chopW > 0.002) {
      float crest;
      vec2 slope;
      chopField(vWPos.xz, uTime, crest, slope);
      swellSlope += slope * (uSwellAmp * chopW * (0.55 + 0.9 * group));
      crestSum += crest * chopW * (0.35 + 0.65 * group);
    }
    if (midW > 0.002) {
      float crest;
      vec2 slope;
      midField(vWPos.xz, uTime, crest, slope);
      swellSlope += slope * (uSwellAmp * MSWELL_AMP_SCALE * midW * (0.45 + 0.75 * group));
      crestSum += crest * midW * (0.32 + 0.58 * group);
    }
    if (gsW > 0.002) {
      float crest;
      vec2 slope;
      groundswellField(vWPos.xz, uTime, crest, slope);
      swellSlope += slope * (uSwellAmp * 2.0 * gsW * (0.5 + 0.8 * group));
      crestSum += crest * gsW * 0.45 * group;
    }
    // Normalized crest height, 0.5 = still water. Drives the whitecaps and the
    // sun-through-swell scatter, and is per-pixel for the same reason the
    // slope is: it keyed off the same feathered vertex weight, so it stepped
    // along the same rectangle and left a tonal boundary on the open water.
    float crestN = crestSum * CREST_NORM * 0.5 + 0.5;
    // rippled up close -> glassy at distance: detail fades out, swell stays.
    // The swell's analytic slope tilts the whole normal so the lit shading
    // agrees with the silhouette the vertex stage displaced.
    vec2 nm = mix(n1.xy * 0.85 + n2.xy * 0.6, n3.xy * 1.5, farW * 0.78) + swellSlope * 5.5;
    // interactive wakes ride on top of the static maps, near the camera only
    vec2 waveSlope = vec2(0.0);
    float waveEnergy = 0.0;
    if (uWaveEnabled > 0.001) {
      vec4 wave;
      float waveW = uWaveEnabled * waveSampleAt(vWPos.xz, wave);
      waveSlope = wave.ba * waveW;
      waveEnergy = (abs(wave.g) * 0.9 + length(wave.ba) * 0.4) * waveW;
    }
    vec3 N = normalize(vec3(nm + waveSlope * 9.5, 3.1).xzy);
    vec3 V = normalize(cameraPosition - vWPos);
  #ifdef WATER_UNDERSIDE
    // Seen from BELOW: the surface is a rippling ceiling lit from above.
    // (A dedicated BackSide mesh, never gl_FrontFacing: three.js renders a
    // transparent DoubleSide object as two passes with forced face culling,
    // which makes gl_FrontFacing unreliable.) Inside Snell's window (the
    // ~97 degree cone overhead, IOR 1.333) the ceiling opens to sky light;
    // outside it closes into the deep, the total-internal-reflection look.
    // Around the sun's column light wells down and refracted glints dance.
    float upDot = abs(dot(N, V));
    float tir = pow(1.0 - upDot, 2.0);
    float snellW = smoothstep(0.655, 0.70, upDot);
    float sunWell = pow(max(dot(uSunDir, N), 0.0), 4.0);
    vec3 ceiling = mix(uDeep * 0.5, mix(uShallow * 0.75, uSkyColor * 0.9, 0.45), snellW);
    ceiling += uShallow * sunWell * 0.25;
    ceiling += uSunColor * pow(max(dot(reflect(-uSunDir, N), -V), 0.0), 60.0) * 0.6;
    vec3 col = mix(ceiling, uDeep * 0.35, tir * (1.0 - snellW) * 0.8);
    float alpha = clamp(0.88 + tir * 0.12, 0.0, 1.0);
  #else
    float fresnel = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
    // The seabed is hard clamped at ${WATER_SEABED_CLAMP_YARDS} yards. A linear ramp spends the
    // whole palette in the shallows, and an exponential is still climbing when
    // it reaches the clamp, which creases the colour field along the clamp
    // contour. smoothstep spans the full range AND arrives with zero slope, so
    // the gradient is already flat where the geometry goes flat. The apron
    // carries exactly WATER_SEABED_CLAMP_YARDS and runs the same ramp, so the
    // two land on the same colour and rect boundaries stay invisible.
    float depth = smoothstep(0.0, ${glsl(WATER_SEABED_CLAMP_YARDS)}, vShoreDepth);
    vec3 col = mix(uShallow, uDeep, depth * ${glsl(WATER_DEPTH_COLOR_AUTHORITY)});
    // Red dies first (Beer-Lambert): the per-channel absorption signature
    // that makes shallow-to-mid water read as water instead of paint. Both
    // sheets saturate by the seabed clamp, so the apron seam stays closed.
    col *= mix(vec3(1.0), vec3(0.78, 0.99, 1.04), 1.0 - exp(-vShoreDepth * 0.55));
    // A 6 yard seabed cannot supply open-ocean depth, so grade toward deep with
    // VIEW DISTANCE the way real water does. This is what makes the far sea read
    // as ocean rather than as an endless shallow, and it hides the apron seam.
    col = mix(col, uDeep, smoothstep(${glsl(WATER_DEEP_NEAR_YARDS)}, ${glsl(WATER_DEEP_FAR_YARDS)}, camDist) * ${glsl(WATER_DEEP_DISTANCE_STRENGTH)});
    // dappled shimmer that fades with distance so it never reads as speckle
    float shimmer = max(n1.x * 0.7 + n2.y * 0.55, 0.0) * exp(-camDist * 0.022);
    col *= 0.92 + 0.4 * shimmer;
    // wind lanes: hue and brightness drift with the lane field
    col = mix(col, col * vec3(0.86, 1.04, 1.07), (seaLane - 0.5) * 0.9);
    col *= 0.93 + seaLane * 0.14;
    // reflection tracks the live fog/horizon color so each biome's water
    // belongs to its sky instead of a constant pasted-on tint
    vec3 skyRef = mix(uSkyColor, fogColor, 0.5);
    col = mix(col, skyRef, min(fresnel * 0.65, 0.42));
    float sunAlign = max(dot(reflect(-uSunDir, N), V), 0.0);
    // sparkle glints (>1 -> bloom), jittered by the detail maps so they
    // twinkle in patches instead of lighting one uniform stripe
    col += uSunColor * pow(sunAlign, 130.0) * (1.4 + 2.4 * clamp(n1.x * 3.0 + 0.5, 0.0, 1.0));
    col += uSunColor * pow(sunAlign, 28.0) * 0.30;                   // wider lobe: survives steep cameras
    col += uSunColor * pow(sunAlign, 6.0) * 0.05;                    // faint warm sheen sunward
    // Sun-through-swell scattering: looking INTO the sun across running water,
    // light enters the back of a crest and scatters out of its face as a
    // turquoise glow. Gated on the crest height and a grazing view, so calm
    // water seen from above is untouched; the interactive wake energy feeds it
    // too, so a churned wake glows the same way.
    float intoSun = pow(max(dot(-V, uSunDir), 0.0), 3.0);
    float grazing = 1.0 - max(dot(N, V), 0.0);
    float churn = clamp(crestN + waveEnergy * 2.0, 0.0, 1.3);
    col += uScatter * (intoSun * grazing * (0.25 + 0.75 * churn));
    // Whitecap mottling where grouped crests peak. The thresholds roll out
    // with range instead of the mask being faded away: near, individual crests
    // break and only the tallest go white, while far the only crests still
    // resolvable are the long rollers under the group envelope, so the
    // thresholds have to meet the field where it is or the horizon goes flat.
    float capMask = smoothstep(
      mix(0.68, 0.53, farW),
      mix(0.96, 0.74, farW),
      crestN * (0.5 + 0.5 * seaLane)
    );
    // The detail map breaks the caps up close; at range it mips toward a flat
    // 0.5 and would erase them, so hand over to the lane field, which is low
    // frequency enough to keep both its structure and its mips all the way out.
    float capTex = smoothstep(0.52, 0.82, n2.x * 0.5 + 0.5);
    float capBreak = mix(capTex, smoothstep(0.30, 0.78, seaLane), farW);
    col = mix(col, vec3(0.99), capMask * capBreak * 0.45);
    // Shoreline foam keyed on HORIZONTAL distance to the waterline, recovered
    // as depth / seabed slope, NOT on depth. Measured shelves range from 3.2
    // yards of depth in 4 yards of run to 0.2 yards of depth sustained over 40,
    // so any depth threshold either floods a flat bay or vanishes on a steep
    // one. Distance to shore is the same signal on both.
    float shoreDist = vShoreDepth / vShoreSlope;
    float foamBand = smoothstep(${glsl(WATER_FOAM_WIDTH_YARDS)}, 0.0, shoreDist + n1.x * 0.6);
    foamBand *= foamBand;
    // Two decorrelated sines so the band stops reading as one set of wallpaper
    // stripes, faded with range because it is an analytic function with no mip
    // chain and aliases hard at grazing angles.
    float foamWave = 0.55
      + 0.25 * sin(uTime * SWELL_W3 + vWPos.x * 1.2 + vWPos.z * 0.95 + n2.y * 6.0)
      + 0.20 * sin(uTime * SWELL_W1 - vWPos.x * 0.41 + vWPos.z * 0.63 + n1.y * 4.0);
    // A lapping wave travels SHOREWARD through the band (phase runs along the
    // recovered shore distance), so the surf advances and retreats instead of
    // pulsing in place. Reuses the already-sampled normal maps for its break.
    float lap = 0.6 + 0.4 * sin(uTime * FOAM_LAP_W - shoreDist * 1.9 + n1.y * 3.0);
    float foam = foamBand * foamWave * lap * exp(-camDist * ${glsl(WATER_FOAM_DISTANCE_FADE)});
    // disturbed water reads brighter and skyward, the way a real wake does
    float contactSheen = smoothstep(0.025, 0.13, waveEnergy) * exp(-camDist * 0.022);
    col = mix(col, mix(uShallow, uSkyColor, 0.52), contactSheen * 0.24);
    col = mix(col, vec3(1.05), clamp(foam, 0.0, 0.9));
    float surfaceAccent = clamp(foam + contactSheen * 0.12, 0.0, 0.92);
    float opacityDepth = 1.0 - exp(-vShoreDepth * ${glsl(WATER_OPACITY_EXTINCTION_PER_YARD)});
    // The last half yard of shallows THINS to nothing over the sand instead of
    // ending at the geometric intersection with it. Foam holds on longer (see
    // WATER_SHORE_FILM_FOAM_FRACTION): the wash line is the last thing to dry.
    float shoreFilm = smoothstep(0.0, ${glsl(WATER_SHORE_FILM_YARDS)}, vShoreDepth);
    float foamFilm = smoothstep(
      0.0,
      ${glsl(WATER_SHORE_FILM_YARDS * WATER_SHORE_FILM_FOAM_FRACTION)},
      vShoreDepth
    );
    float alpha = max(
      mix(${glsl(WATER_SHALLOW_ALPHA)}, ${glsl(WATER_DEEP_ALPHA)}, opacityDepth) * shoreFilm,
      surfaceAccent * 0.95 * foamFilm
    );
    // Contour waterline (uShoreEdgeFade, interior strips/pools only): the
    // surface dissolves where the baked depth reaches zero, so the visible
    // bank is the terrain's own wet line, never the mesh rectangle. The noise
    // term wobbles the line so it reads as a shore, not a clip path. Off (0)
    // collapses the mix to 1.0: the overworld shader is byte-identical.
    float edgeWobble = 0.18 * sin(vWPos.x * 1.7 + vWPos.z * 2.3) + 0.12 * sin(vWPos.z * 4.1 - vWPos.x * 3.3);
    alpha *= mix(1.0, smoothstep(0.12, 0.85, vShoreDepth + edgeWobble * uShoreEdgeFade), uShoreEdgeFade);
  #endif
    // World day/night grade: this shader is unlit (baked palette), so the same
    // multiplier the fog takes dims the whole surface, glints and foam
    // included, toward the moonlit night. (1,1,1) by day = byte-identical.
    // Applies on both sides of WATER_UNDERSIDE: the ceiling is baked too.
    col *= uDayNight;
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
#ifdef WOC_ZONE_HAZE
    // Per-zone aerial perspective (biome_haze_field.ts): the identical snippet
    // on the identical uniforms both terrain layers splice, so a far bay or
    // lake takes the air of the zone it lies in and stops being the one
    // surface in the vista with no realm character. Compiled out entirely
    // when no field exists, so the fogged tiers are byte-identical.
${biomeHazeFragmentGlsl('vWPos.xz')}
#endif
    #include <fog_fragment>
  }
`;

function disposeOwned(meshes: THREE.Mesh[]): void {
  const materials = new Set<THREE.Material>();
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) materials.add(entry);
    else materials.add(material);
  }
  for (const material of materials) material.dispose();
}

/** Inert wave uniforms for surfaces with no interactive height field (no
 *  renderer to run the simulation, or an interior pool outside its window). */
export function zeroWaveUniforms(): WaterWaveUniforms {
  return {
    uWaveState: { value: WATER_TEX.n1 },
    uWaveEnabled: { value: 0 },
    uWaveOrigin: { value: new THREE.Vector2() },
    uWaveSize: { value: 1 },
  };
}

/**
 * The one overworld water surface material (dual-scroll + swell normal maps,
 * fresnel sky tint, HDR sun glints, shore foam, fog). Exported so interior
 * builders (the Wildheart Basin) draw the exact same surface; geometry fed to
 * it must carry aShoreDepth/aShoreSlope attributes (aSwellW is optional: a
 * geometry that omits it reads 0 and stays displacement-still, which is what
 * interior pools want). Callers gate on
 * GFX.standardMaterials && hasWaterShaderAssets() exactly like buildWater.
 *
 * `shoreEdgeFade` fades the surface to nothing where the baked depth reaches
 * zero, so the WATERLINE follows the terrain contour instead of the geometry
 * boundary. The overworld planes leave it off (their rect edges hide under
 * carved bathymetry and the apron); an interior strip or pool laid over its
 * own heightfield turns it on so a rectangular mesh cannot read as a
 * hard-edged sheet. Off is the exact pre-option shader (the mix collapses to
 * 1.0), so overworld output is unchanged.
 */
export function createWaterSurfaceMaterial(
  wave: WaterWaveUniforms,
  opts?: { shoreEdgeFade?: boolean; underside?: boolean },
): THREE.ShaderMaterial {
  // Distant-zone atmosphere: present only when the renderer built the field
  // (vista tiers). The define compiles the block away otherwise, and the
  // uniforms are the shared objects, never clones, so the water follows the
  // same camera and day/night grade the terrain layers do.
  const zoneHaze = hasBiomeHazeField();
  return new THREE.ShaderMaterial({
    defines: {
      ...(opts?.underside ? { WATER_UNDERSIDE: '' } : {}),
      ...(zoneHaze ? { WOC_ZONE_HAZE: '' } : {}),
    },
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...(zoneHaze ? biomeHazeUniforms() : {}),
      uNorm1: { value: WATER_TEX.n1 },
      uNorm2: { value: WATER_TEX.n2 },
      uNorm3: { value: WATER_TEX.broad },
      uSunDir: WATER_SUN_UNIFORM, // live key-light direction (shared by reference)
      uDayNight: WATER_DAYNIGHT_UNIFORM, // day/night multiplier (shared by reference)
      uSunColor: { value: SUN_COLOR },
      uSkyColor: { value: SKY_TINT },
      uDeep: { value: DEEP_COLOR },
      uShallow: { value: SHALLOW_COLOR },
      uTime: WATER_TIME,
      uWaveState: wave.uWaveState,
      uWaveEnabled: wave.uWaveEnabled,
      uWaveOrigin: wave.uWaveOrigin,
      uWaveSize: wave.uWaveSize,
      uShoreEdgeFade: { value: opts?.shoreEdgeFade ? 1 : 0 },
      uSwellAmp: { value: WATER_SWELL_AMP },
      uScatter: { value: SCATTER_COLOR },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    // The from-below ceiling is a separate BackSide mesh (see addUnderside in
    // buildShaderWater), never DoubleSide: three.js splits a transparent
    // DoubleSide object into two passes, which breaks gl_FrontFacing.
    side: opts?.underside ? THREE.BackSide : THREE.FrontSide,
    fog: true,
  });
}

function buildShaderWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  // legacy procedural maps still get generated (unused) to preserve the
  // shared-LCG call order in textures.ts for everything generated after
  waterNormalMaps();
  const simulation = renderer ? new WaterSimulation(renderer) : null;
  const wave = simulation ? simulation.uniforms : zeroWaveUniforms();
  // ONE material for every zone plane and the apron, so the field's uniform
  // objects (shared by reference, like uTime) drive the whole surface.
  const material = createWaterSurfaceMaterial(wave);
  const undersideMaterial = createWaterSurfaceMaterial(wave, { underside: true });

  const meshes: THREE.Mesh[] = [];
  const group = new THREE.Group();
  group.name = 'water';
  // The from-below ceiling: a BackSide twin per sheet SHARING its geometry
  // (attributes, culled index and all), visible only while the camera is
  // under the waterline, so above water it costs nothing at all.
  const underPairs: { front: THREE.Mesh; under: THREE.Mesh }[] = [];
  const addUnderside = (front: THREE.Mesh): void => {
    const under = new THREE.Mesh(front.geometry, undersideMaterial);
    under.renderOrder = front.renderOrder;
    under.position.copy(front.position);
    under.visible = false;
    group.add(under);
    meshes.push(under);
    underPairs.push({ front, under });
  };
  const loadedZones = new Set<string>();
  const pendingZones = new Map<string, Promise<THREE.Mesh[]>>();
  // Per-mesh in-place refit closures: re-seat y and recompute the shore-depth
  // attribute from the CURRENT terrain (build and setLevel share them). The
  // vertices never move (only the attribute + the mesh transform change), so
  // the baked bounding volumes stay valid.
  const refits: (() => void)[] = [];
  // The apron: one huge deep-sea sheet running far past every map edge, so
  // looking off the world's side reads as open ocean to the horizon, never
  // a water plane ending in mid-air. It sits a hair below the zone planes
  // (no z-fight) and carries a constant deep shore attribute. Its reach must
  // beat the view envelope from ANY camera position or its rim shows as a
  // line against the sky; the vista tiers (whose outdoor fog is gone) open
  // that envelope well past the classic view, so the apron grows with the
  // tier plan, with extra segments so coastal cells stay fade-band sized.
  {
    const vista = farVistaPlan(GFX.tier, GFX.constrainedMemory);
    const reach = vista.enabled ? WORLD_MAX_X + vista.envelopeFar + 400 : 0;
    const width = vista.enabled ? reach * 2 : 3000;
    const span = WORLD_MAX_Z - WORLD_MIN_Z + (vista.enabled ? reach * 2 : 2400);
    const apronSegments = vista.enabled ? 288 : APRON_SEGMENTS;
    const geo = new THREE.PlaneGeometry(width, span, apronSegments, apronSegments).rotateX(
      -Math.PI / 2,
    );
    geo.translate(0, 0, (WORLD_MIN_Z + WORLD_MAX_Z) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const deep = new Float32Array(pos.count);
    const apronSlope = new Float32Array(pos.count);
    // The FULL world rect, side columns included: WORLD_MAX_X, never
    // WORLD_SIZE / 2 (that is one column's half-width, 180, and clamping the
    // terrain sample there treated the whole east and west columns as open
    // ocean: their real 0.8 to 2.2 yard shelves met a constant 6 yard apron
    // at a ruler-straight 23 to 30 percent luma step along the outer coasts).
    const half = WORLD_MAX_X;
    const edgeDepthCache = new Map<string, number>();
    const fillApron = (): void => {
      edgeDepthCache.clear();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        // Distance OUTSIDE the world rect: 0 anywhere the zone planes cover.
        const outside = Math.max(0, Math.abs(x) - half, z - WORLD_MAX_Z, WORLD_MIN_Z - z);
        // The apron is thousands of yards across and the world is 360, so the
        // vast majority of vertices are far outside and need no sampling at
        // all. Skipping them is what keeps this bake cheap enough to run
        // inline: terrainHeight is deliberately rich and shoreSlopeAt costs
        // four samples of it.
        if (outside >= APRON_TERRAIN_FADE_YARDS) {
          deep[i] = WATER_SEABED_CLAMP_YARDS;
          apronSlope[i] = APRON_SHORE_SLOPE;
          continue;
        }
        const t = outside / APRON_TERRAIN_FADE_YARDS;
        const toConstant = t * t * (3 - 2 * t); // smoothstep, flat at both ends
        // Sample the nearest point INSIDE the world, never past it. Inside, that
        // is the vertex itself, so the apron reads the exact function the zone
        // planes read and the seam closes by construction. Outside, it extends
        // the coast's own depth and fades to open sea. Sampling the real
        // terrain out there instead looks tempting and is wrong: it is another
        // landmass (measured -518 yards, i.e. dry ground), so it would paint
        // land and surf across the open horizon.
        // Every vertex on a ray heading straight out of one edge clamps to the
        // SAME boundary point, so the samples collapse heavily. Memoize them.
        const cx = Math.min(half, Math.max(-half, x));
        const cz = Math.min(WORLD_MAX_Z, Math.max(WORLD_MIN_Z, z));
        const key = `${cx},${cz}`;
        let edgeDepth = edgeDepthCache.get(key);
        if (edgeDepth === undefined) {
          edgeDepth = shoreDepthAt(cx, cz, seed);
          edgeDepthCache.set(key, edgeDepth);
        }
        const carried = outside > 0 ? Math.max(edgeDepth, 0) : edgeDepth;
        deep[i] = carried * (1 - toConstant) + WATER_SEABED_CLAMP_YARDS * toConstant;
      }
      // Slope is the GRADIENT of the depth just filled, so take it by finite
      // difference on the grid instead of calling shoreSlopeAt: that costs four
      // more terrainHeight samples per vertex and terrainHeight is the
      // expensive part. It cannot be dropped for a constant either: the shader
      // reads foam as depth/slope, and a constant slope of 1 against the real
      // shelf depths out here (~1.5 yards) lands inside the surf band and would
      // paint foam across open water.
      const columns = apronSegments + 1;
      const dx = (2 * width) / apronSegments;
      const dz = (2 * span) / apronSegments;
      for (let i = 0; i < pos.count; i++) {
        const row = Math.floor(i / columns);
        const col = i % columns;
        const west = col > 0 ? deep[i - 1] : deep[i];
        const east = col < columns - 1 ? deep[i + 1] : deep[i];
        const north = row > 0 ? deep[i - columns] : deep[i];
        const south = row < columns - 1 ? deep[i + columns] : deep[i];
        // Never zero: the shader divides by this.
        apronSlope[i] = Math.max(Math.hypot((east - west) / dx, (south - north) / dz), 1e-4);
      }
    };
    fillApron();
    geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(deep, 1));
    geo.setAttribute('aShoreSlope', new THREE.BufferAttribute(apronSlope, 1));
    // aSwellW 1 everywhere: the apron takes the long groundswell (its grid
    // samples those wavelengths cleanly) but NEVER the short chop: its ~27
    // yard vertex spacing cannot sample chop wavelengths (pure aliasing).
    // It is a DISPLACEMENT gate only. The fragment stage reads the clamped
    // weight, which is 1 here and 1 on every zone plane, so the two sheets
    // shade from the identical wave field and their shared rect edge carries
    // no step in normals, whitecaps, or glints.
    geo.setAttribute('aSwellW', new THREE.BufferAttribute(new Float32Array(pos.count).fill(1), 1));
    // The LIVE segment count, never APRON_SEGMENTS: the vista tiers build a
    // denser apron, and a gate computed over the wrong grid dimensions reads
    // the wrong neighbours (the same class of bug commit 032ee377d fixed in
    // cullApron).
    const apronColumns = apronSegments + 1;
    const apronGate = bakeSwellGate(
      deep,
      apronColumns,
      apronColumns,
      WATER_APRON_SWELL_GATE_MARGIN_YARDS,
    );
    geo.setAttribute('aSwellGate', new THREE.BufferAttribute(apronGate, 1));
    const refitApronGate = (): void => {
      apronGate.set(
        bakeSwellGate(deep, apronColumns, apronColumns, WATER_APRON_SWELL_GATE_MARGIN_YARDS),
      );
      (geo.attributes.aSwellGate as THREE.BufferAttribute).needsUpdate = true;
    };
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    // Dry-tile culling: the apron spans the whole world rect too, and its
    // interior is mostly LAND under the zone planes. Bounding volumes stay
    // the full-rect ones baked above (conservative, still correct).
    const fullIndex = geo.getIndex();
    const cullApron = (): void => {
      // The LIVE segment count, never the APRON_SEGMENTS constant: the vista
      // tiers build a denser apron (288), and a cull index computed over the
      // wrong grid dimensions keeps and drops the wrong triangles (seen live
      // as hard dark wedges and stray slivers along the coast).
      const culled = buildWaterSurfaceIndex(deep, apronSegments + 1, apronSegments + 1);
      geo.setIndex(culled ? new THREE.BufferAttribute(culled, 1) : fullIndex);
    };
    cullApron();
    const apron = new THREE.Mesh(geo, material);
    apron.position.y = waterLevel() - 0.02;
    apron.renderOrder = WATER_APRON_RENDER_ORDER;
    meshes.push(apron);
    group.add(apron);
    addUnderside(apron);
    refits.push(() => {
      fillApron();
      (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.aShoreSlope as THREE.BufferAttribute).needsUpdate = true;
      refitApronGate();
      cullApron();
      apron.position.y = waterLevel() - 0.02;
    });
  }
  // Coarse wetness scan: samples the zone rect on a 3-vertex stride (about 6
  // yards) and reports whether ANY sample is submerged. A fully dry zone then
  // skips the whole 181-row fill, the single biggest term in a background
  // zone prepare. The stride is safely below the smallest authored water body
  // (the border meres); a body would have to be under two strides across in
  // BOTH axes to slip through.
  const WETNESS_SCAN_STRIDE = 3;
  const zoneHasWater = async (
    zone: ZoneDef,
    x0: number,
    x1: number,
    idlePace: boolean,
  ): Promise<boolean> => {
    const step = ((x1 - x0) / SEGMENTS_PER_ZONE) * WETNESS_SCAN_STRIDE;
    const zStep = ((zone.zMax - zone.zMin) / SEGMENTS_PER_ZONE) * WETNESS_SCAN_STRIDE;
    let sincePause = 0;
    for (let z = zone.zMin; z <= zone.zMax; z += zStep) {
      for (let x = x0; x <= x1; x += step) {
        if (shoreDepthAt(x, z, seed) > 0) return true;
      }
      if (idlePace && ++sincePause >= WATER_ROWS_PER_IDLE_SLICE) {
        sincePause = 0;
        await idleSlot(WATER_IDLE_TIMEOUT_MS);
      }
    }
    return false;
  };
  const buildZone = async (zone: ZoneDef, idlePace: boolean): Promise<THREE.Mesh | null> => {
    const depth = zone.zMax - zone.zMin;
    // each plane covers its zone's own rect: the side columns live at
    // x beyond the strip, and a strip-centered plane would leave their
    // shores (and the border meres straddling the column line) on the
    // featureless apron with no foam or shallow grading
    const x0 = zone.xMin ?? -WORLD_SIZE / 2;
    const x1 = zone.xMax ?? WORLD_SIZE / 2;
    if (!(await zoneHasWater(zone, x0, x1, idlePace))) return null;
    const geo = new THREE.PlaneGeometry(
      x1 - x0,
      depth,
      SEGMENTS_PER_ZONE,
      SEGMENTS_PER_ZONE,
    ).rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (zone.zMin + zone.zMax) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const shoreDepth = new Float32Array(pos.count);
    const shoreSlope = new Float32Array(pos.count);
    // Swell DISPLACEMENT weight, packed (see WATER_VERT): 2 = groundswell +
    // chop inside the plane, feathering the chop share back to 1 (groundswell
    // only, the apron's constant) at the rect edge, so the two displaced
    // sheets agree exactly where they meet. The feather fires ONLY where the
    // neighbour across the edge really is the apron: an edge abutted by another zone
    // plane carries identical chop on both sides, and feathering there cut a
    // visible calm stripe down every internal border water (the column
    // straits, the row meres). Abutment is per COORDINATE, not per edge:
    // the zone grid has coverage gaps, so one edge can be plane on part of
    // its run and apron on the rest. Static per-vertex geometry: bakes once.
    const otherZoneCovers = (px: number, pz: number): boolean =>
      ZONES.some(
        (zz) =>
          zz.id !== zone.id &&
          px >= (zz.xMin ?? -WORLD_SIZE / 2) &&
          px <= (zz.xMax ?? WORLD_SIZE / 2) &&
          pz >= zz.zMin &&
          pz <= zz.zMax,
      );
    const swellW = new Float32Array(pos.count);
    const probe = 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let edge = Number.POSITIVE_INFINITY;
      if (!otherZoneCovers(x0 - probe, z)) edge = Math.min(edge, x - x0);
      if (!otherZoneCovers(x1 + probe, z)) edge = Math.min(edge, x1 - x);
      if (!otherZoneCovers(x, zone.zMin - probe)) edge = Math.min(edge, z - zone.zMin);
      if (!otherZoneCovers(x, zone.zMax + probe)) edge = Math.min(edge, zone.zMax - z);
      swellW[i] =
        1 +
        (edge === Number.POSITIVE_INFINITY
          ? 1
          : Math.min(1, Math.max(0, edge / WATER_CHOP_EDGE_FEATHER_YARDS)));
    }
    const columns = SEGMENTS_PER_ZONE + 1;
    const fillRow = (row: number): void => {
      const start = row * columns;
      const end = Math.min(pos.count, start + columns);
      for (let i = start; i < end; i++) {
        shoreDepth[i] = shoreDepthAt(pos.getX(i), pos.getZ(i), seed);
        shoreSlope[i] = shoreSlopeAt(pos.getX(i), pos.getZ(i), seed);
      }
    };
    const fill = (): void => {
      for (const row of WATER_VERTEX_ROWS) fillRow(row);
    };
    if (idlePace) {
      await runIdleQueue(WATER_VERTEX_ROWS, fillRow, {
        batchSize: WATER_ROWS_PER_IDLE_SLICE,
        timeoutMs: WATER_IDLE_TIMEOUT_MS,
      });
    } else {
      fill();
    }
    geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(shoreDepth, 1));
    geo.setAttribute('aShoreSlope', new THREE.BufferAttribute(shoreSlope, 1));
    geo.setAttribute('aSwellW', new THREE.BufferAttribute(swellW, 1));
    const planeGate = bakeSwellGate(
      shoreDepth,
      columns,
      SEGMENTS_PER_ZONE + 1,
      WATER_PLANE_SWELL_GATE_MARGIN_YARDS,
    );
    geo.setAttribute('aSwellGate', new THREE.BufferAttribute(planeGate, 1));
    const refitPlaneGate = (): void => {
      planeGate.set(
        bakeSwellGate(
          shoreDepth,
          columns,
          SEGMENTS_PER_ZONE + 1,
          WATER_PLANE_SWELL_GATE_MARGIN_YARDS,
        ),
      );
      (geo.attributes.aSwellGate as THREE.BufferAttribute).needsUpdate = true;
    };
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    // Dry-tile culling: most of a zone rect is land, and every quad buried
    // under it still cost full vertex shading. Keeping only waterline-adjacent
    // tiles is the single biggest water frame-cost win in this module.
    const fullIndex = geo.getIndex();
    const cullZone = (): void => {
      const culled = buildWaterSurfaceIndex(shoreDepth, columns, SEGMENTS_PER_ZONE + 1);
      geo.setIndex(culled ? new THREE.BufferAttribute(culled, 1) : fullIndex);
    };
    cullZone();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = waterLevel();
    mesh.renderOrder = WATER_SURFACE_RENDER_ORDER;
    // The renderer compiles a background zone's material while this mesh is
    // hidden, then reveals it. Adding it visible here lets the next rAF draw
    // (and synchronously upload/link) it before prepareZoneAt can prewarm it.
    mesh.visible = !idlePace;
    meshes.push(mesh);
    group.add(mesh);
    addUnderside(mesh);
    refits.push(() => {
      fill();
      (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.aShoreSlope as THREE.BufferAttribute).needsUpdate = true;
      refitPlaneGate();
      cullZone();
      mesh.position.y = waterLevel();
    });
    return mesh;
  };
  return {
    group,
    meshes,
    ensureZone(zone: ZoneDef, opts?: { pace?: 'fast' | 'idle' }): Promise<THREE.Mesh[]> {
      if (loadedZones.has(zone.id)) return Promise.resolve([]);
      const pending = pendingZones.get(zone.id);
      if (pending) return pending;
      const idlePace = opts?.pace === 'idle';
      const scheduled = idlePace
        ? idleSlot(WATER_IDLE_TIMEOUT_MS)
        : new Promise<void>((resolve) => setTimeout(resolve, 0));
      const task = scheduled
        .then(async () => {
          const mesh = await buildZone(zone, idlePace);
          loadedZones.add(zone.id);
          return mesh ? [mesh] : [];
        })
        .finally(() => pendingZones.delete(zone.id));
      pendingZones.set(zone.id, task);
      return task;
    },
    isZoneLoaded: (zoneId: string) => loadedZones.has(zoneId),
    update(
      _time: number,
      cameraX: number,
      cameraZ: number,
      _visibleRange?: number,
      cameraY = Number.POSITIVE_INFINITY,
    ): number {
      WATER_TIME.value = _time % WATER_TIME_PERIOD;
      // Slack over the waterline so the swell never strands the camera
      // between a displaced front face and a hidden ceiling: must exceed the
      // worst-case combined chop + groundswell + wobble displacement.
      const under = cameraY < waterLevel() + 1.1;
      for (const pair of underPairs) {
        pair.under.position.y = pair.front.position.y;
        pair.under.visible = under && pair.front.visible;
      }
      return simulation?.update(_time, cameraX, cameraZ) ?? 0;
    },
    addSplash(x: number, z: number, radius: number, strength = 1): void {
      simulation?.addSplash(x, z, radius, strength);
    },
    enterContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.enterContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    moveContact(
      oldX: number,
      oldZ: number,
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.moveContact(oldX, oldZ, x, z, radius, halfLength, axisX, axisZ, strength);
    },
    releaseContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.releaseContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    setLevel(): void {
      simulation?.reset();
      for (const refit of refits) refit();
    },
    dispose(): void {
      simulation?.dispose();
      disposeOwned(meshes);
    },
  };
}

function buildPhongWater(): WaterView {
  const tex = waterNormalish();
  const [norm] = waterNormalMaps();
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2a6a96,
    transparent: true,
    opacity: 0.8,
    shininess: 140,
    specular: 0xd8ecff,
    map: tex,
    normalMap: norm,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  // low tier gets the same to-the-horizon apron by simply oversizing the
  // one plane (the tiled texture keeps its density via the repeat bump)
  const worldDepth = WORLD_MAX_Z - WORLD_MIN_Z + 2400;
  tex.repeat.set(240, 240);
  norm.repeat.set(210, 620);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3000, worldDepth).rotateX(-Math.PI / 2), mat);
  mesh.position.set(0, waterLevel(), (WORLD_MIN_Z + WORLD_MAX_Z) / 2);
  const meshes = [mesh];
  const group = new THREE.Group();
  group.name = 'water';
  group.add(mesh);
  return {
    group,
    meshes,
    ensureZone: async () => [],
    isZoneLoaded: () => true,
    // The low tier has no height field at all: a Phong plane cannot sample one,
    // and the tier exists precisely to skip that GPU work.
    update(time: number): number {
      tex.offset.x = time * 0.008;
      tex.offset.y = time * 0.011;
      norm.offset.x = time * 0.006;
      norm.offset.y = time * 0.009;
      return 0;
    },
    addSplash: () => {},
    enterContact: () => {},
    moveContact: () => {},
    releaseContact: () => {},
    setLevel(): void {
      for (const m of meshes) m.position.y = waterLevel();
    },
    dispose(): void {
      disposeOwned(meshes);
    },
  };
}

export function buildWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  return GFX.standardMaterials && hasWaterShaderAssets()
    ? buildShaderWater(seed, renderer)
    : buildPhongWater();
}
