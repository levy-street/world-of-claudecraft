// The analytic travelling-wave field the water surface runs on: one GLSL chunk
// that BOTH shader stages include, plus the pure helpers that pin its numbers.
// Three-free and DOM-free on purpose, so tests/water_wave_field.test.ts can
// re-derive every constant in it without standing up a renderer.
//
// Two rules govern every number in here.
//
// ONE SEAMLESS CLOCK. The water clock wraps at WATER_TIME_PERIOD (water.ts
// feeds it `time % WATER_TIME_PERIOD` as uTime) so shader phases never grow
// unbounded: fp32 sin() goes visibly steppy on long sessions and a mediump
// stage dies within minutes. Every angular speed below is therefore a whole
// number of cycles per that period, which makes the wrap seamless by
// construction, and the test re-derives each cycle count from the literal so a
// hand-typed frequency off the grid fails there instead of drifting live.
//
// ONE FIELD, NO GRID. The field is a function of WORLD position and time only.
// It carries no vertex attribute, no sheet identity, and no grid spacing, which
// is what lets the vertex stage DISPLACE with it on the zone planes (whose ~2
// yard spacing can sample a chop wavelength) while the fragment stage SHADES
// with it on the planes AND the horizon apron (whose ~29 x 38 yard cells cannot
// sample anything that short). Displacement has to respect what a grid can
// carry; shading does not. Tying shading to the grid is what cut a hard
// straight line through the sun-glint field along the zone planes' rect edge.

/**
 * The wrap period of the water clock, in seconds. Every angular speed in
 * WATER_WAVE_GLSL is a whole number of cycles per this period, and every
 * texture scroll in water.ts a whole number of tiles per it.
 */
export const WATER_TIME_PERIOD = 600;

const TWO_PI = Math.PI * 2;

/** Angular speed (radians per second) for a whole cycle count per wrap period. */
export function waveSpeed(cyclesPerPeriod: number): number {
  return (cyclesPerPeriod * TWO_PI) / WATER_TIME_PERIOD;
}

/** How many cycles per wrap period an angular speed completes. Whole = seamless. */
export function waveCycles(speed: number): number {
  return (speed * WATER_TIME_PERIOD) / TWO_PI;
}

/** Wavelength in yards of a wave vector given in radians per yard. */
export function waveLengthYards(kx: number, kz: number): number {
  return TWO_PI / Math.hypot(kx, kz);
}

export interface GlslFloatConst {
  name: string;
  value: number;
}

export interface GlslWaveVector {
  name: string;
  kx: number;
  kz: number;
}

const SPEED_DECL = /const\s+float\s+([A-Z][A-Z0-9_]*_W\d*)\s*=\s*(-?\d+(?:\.\d*)?)\s*;/g;
const VECTOR_DECL =
  /const\s+vec2\s+([A-Z][A-Z0-9_]*_K\d*)\s*=\s*vec2\(\s*(-?\d+(?:\.\d*)?)\s*,\s*(-?\d+(?:\.\d*)?)\s*\)\s*;/g;

/** Every `const float *_W<n>` angular speed declared in a GLSL source. */
export function waveSpeedsIn(source: string): GlslFloatConst[] {
  const out: GlslFloatConst[] = [];
  for (const match of source.matchAll(SPEED_DECL)) {
    out.push({ name: match[1], value: Number(match[2]) });
  }
  return out;
}

/** Every `const vec2 *_K<n>` wave vector declared in a GLSL source. */
export function waveVectorsIn(source: string): GlslWaveVector[] {
  const out: GlslWaveVector[] = [];
  for (const match of source.matchAll(VECTOR_DECL)) {
    out.push({ name: match[1], kx: Number(match[2]), kz: Number(match[3]) });
  }
  return out;
}

export const WATER_WAVE_GLSL = /* glsl */ `
  const float WAVE_TWO_PI = 6.283185307;
  const float WAVE_INV_TWO_PI = 0.159154943;

  // The three CHOP waves: wave vectors in radians per yard, speeds in radians
  // per second. Wavelengths 21 / 20 / 12 yards, long enough that the zone
  // planes' ~2 yard vertex spacing samples them cleanly for displacement and
  // short enough to read as running water.
  // 86 / 117 / 162 whole cycles per wrap period: seamless at the clock wrap.
  const vec2 SWELL_K1 = vec2(0.24, 0.18);
  const vec2 SWELL_K2 = vec2(-0.16, 0.27);
  const vec2 SWELL_K3 = vec2(0.44, -0.31);
  const float SWELL_W1 = 0.900590;
  const float SWELL_W2 = 1.225221;
  const float SWELL_W3 = 1.696460;

  // The MID waves: 58 and 44 yard wavelengths, the band between the chop and
  // the groundswell. SHADING ONLY, never displacement, and that is exactly why
  // they can exist at all: no grid ever has to sample them. They are what puts
  // travelling waves on the open sea at ranges where the chop has already
  // aliased away and the two long rollers alone read as a flat sheet.
  // 62 / 72 whole cycles per wrap period.
  const vec2 MSWELL_K1 = vec2(0.1015, 0.0369);
  const vec2 MSWELL_K2 = vec2(-0.0248, 0.1406);
  const float MSWELL_W1 = 0.649262;
  const float MSWELL_W2 = 0.753982;

  // The GROUNDSWELL: two long rollers (about 150 and 180 yard wavelengths)
  // that BOTH water grids sample cleanly. The apron cells are ~29 x 38 yards
  // (same segment count over width AND span, so NOT square): the second
  // wavelength must clear ~4.5 z-samples per cycle or it goes faceted and
  // amplitude-starved out there, which is why it is the longer of the two.
  // 44 / 38 whole cycles per wrap period.
  const vec2 GSWELL_K1 = vec2(0.0364, 0.0209);
  const vec2 GSWELL_K2 = vec2(-0.0119, 0.0328);
  const float GSWELL_W1 = 0.460767;
  const float GSWELL_W2 = 0.397935;

  // Wave GROUPS: a very slow two-sine envelope swells some stretches of sea
  // and calms others, so open water stops being one uniform corduroy sheet.
  // Wavelengths 254 and 238 yards; 14 / 11 whole cycles per wrap period.
  const vec2 GROUP_K1 = vec2(0.021, 0.013);
  const vec2 GROUP_K2 = vec2(-0.011, 0.024);
  const float GROUP_W1 = 0.146608;
  const float GROUP_W2 = 0.115192;

  // The axis-aligned surface WOBBLE the zone planes carry under the chop, and
  // the shoreward LAP that runs through the foam band. Both vertex-side and
  // fragment-side respectively, both on the same whole-cycle grid as the rest.
  // 105 / 67 / 129 whole cycles per wrap period.
  const float WOBBLE_W1 = 1.099557;
  const float WOBBLE_W2 = 0.701622;
  const float FOAM_LAP_W = 1.350885;

  // Per family range fades for the FRAGMENT field (near, far), in yards of
  // camera distance. A per-pixel analytic wave has no mip chain, so a family
  // has to be gone before its wavelength falls under a couple of screen pixels
  // at a grazing angle. The longer the wave the further it survives, and the
  // three hand off, so there is moving water from the shore out to the haze
  // instead of the vertex chop's old hard stop at 300 yards.
  const vec2 CHOP_FADE = vec2(150.0, 480.0);
  const vec2 MSWELL_FADE = vec2(420.0, 1100.0);
  const vec2 GSWELL_FADE = vec2(1400.0, 3000.0);

  // Half-amplitude of the mid waves as a multiple of uSwellAmp: about 0.9
  // yards, so a 50 yard wave carries a height-to-length ratio near 1/28, the
  // slope a moderate sea really has. It costs no geometry (shading only).
  const float MSWELL_AMP_SCALE = 4.0;
  // Pulls the three families' combined crest RMS back to what the old two
  // family vertex field carried, so whitecap density near shore is unchanged
  // and the only difference is that the crest field now reaches the horizon.
  const float CREST_NORM = 0.72;

  // Phase of one travelling wave at world xz, wrapped to [0, 6pi).
  //
  // fract() per axis and per clock term wraps that contribution by its OWN
  // period, which shifts the phase by a whole number of cycles: the wrap is
  // EXACT, not an approximation, and sin/cos of the result are unchanged. It
  // is needed because the widest apron reaches about 4100 yards and the clock
  // 600 seconds, so a raw dot(p, k) + t * w runs to roughly 1800 radians. That
  // is still accurate in the highp fragment stage three.js emits wherever the
  // device supports it; the wrap is what keeps everything downstream of the
  // phase small enough to survive a mediump fallback too.
  float wavePhase(vec2 p, vec2 k, float w, float t) {
    vec3 turns = vec3(p * k, t * w) * WAVE_INV_TWO_PI;
    return WAVE_TWO_PI * (fract(turns.x) + fract(turns.y) + fract(turns.z));
  }

  // Fold one travelling wave into a running crest height (normalized wave
  // units) and its analytic surface slope (d height / d xz, per unit crest).
  void addWave(vec2 p, float t, vec2 k, float w, float a, inout float crest, inout vec2 slope) {
    float phase = wavePhase(p, k, w, t);
    crest += sin(phase) * a;
    slope += cos(phase) * a * k;
  }

  // The slow envelope that gathers waves into SETS. Ranges 0.1 to 1.0.
  float waveGroup(vec2 p, float t) {
    return 0.55 + 0.45
      * sin(wavePhase(p, GROUP_K1, GROUP_W1, t))
      * sin(wavePhase(p, GROUP_K2, GROUP_W2, t));
  }

  void chopField(vec2 p, float t, out float crest, out vec2 slope) {
    crest = 0.0;
    slope = vec2(0.0);
    addWave(p, t, SWELL_K1, SWELL_W1, 0.50, crest, slope);
    addWave(p, t, SWELL_K2, SWELL_W2, 0.32, crest, slope);
    addWave(p, t, SWELL_K3, SWELL_W3, 0.18, crest, slope);
  }

  void midField(vec2 p, float t, out float crest, out vec2 slope) {
    crest = 0.0;
    slope = vec2(0.0);
    addWave(p, t, MSWELL_K1, MSWELL_W1, 0.60, crest, slope);
    addWave(p, t, MSWELL_K2, MSWELL_W2, 0.40, crest, slope);
  }

  void groundswellField(vec2 p, float t, out float crest, out vec2 slope) {
    crest = 0.0;
    slope = vec2(0.0);
    addWave(p, t, GSWELL_K1, GSWELL_W1, 0.62, crest, slope);
    addWave(p, t, GSWELL_K2, GSWELL_W2, 0.38, crest, slope);
  }
`;
