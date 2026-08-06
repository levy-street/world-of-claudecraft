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

/**
 * Range-fade weight under which a wave family is skipped outright instead of
 * evaluated at a vanishing amplitude. Spliced into the GLSL as WAVE_SKIP and
 * exported so a test can re-derive the shading error it admits: the largest
 * normal tilt a skipped family can cost is uSwellAmp * this * |k| * 5.5, and
 * the amplitude scale each family carries only shrinks it further.
 */
export const WAVE_SKIP_WEIGHT = 0.01;

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

  // The MID waves: 58, 44, and 70 yard wavelengths, the band between the chop
  // and the groundswell. SHADING ONLY, never displacement, and that is exactly
  // why they can exist at all: no grid ever has to sample them. They are what
  // puts travelling waves on the open sea at ranges where the chop has already
  // aliased away and the two long rollers alone read as a flat sheet. Three
  // members with well-spread directions, not two: two straight wave trains
  // interfere on a fixed diamond lattice, which is exactly the "grid of
  // swells" the open sea used to read as at range.
  // 62 / 72 / 79 whole cycles per wrap period.
  const vec2 MSWELL_K1 = vec2(0.1015, 0.0369);
  const vec2 MSWELL_K2 = vec2(-0.0248, 0.1406);
  const vec2 MSWELL_K3 = vec2(0.0735, -0.0515);
  const float MSWELL_W1 = 0.649262;
  const float MSWELL_W2 = 0.753982;
  const float MSWELL_W3 = 0.827286;

  // The GROUNDSWELL: three long rollers (about 150, 180, and 150 yard
  // wavelengths) that BOTH water grids sample cleanly. The apron cells are
  // ~29 x 38 yards (same segment count over width AND span, so NOT square):
  // a roller must clear ~4.5 z-samples per cycle or it goes faceted and
  // amplitude-starved out there; the second is the longest for that reason
  // and the third points 55 degrees off north so its z-projection still
  // clears the bar. Three members, not two, for the same anti-lattice
  // reason as the mid waves.
  // 44 / 38 / 50 whole cycles per wrap period.
  const vec2 GSWELL_K1 = vec2(0.0364, 0.0209);
  const vec2 GSWELL_K2 = vec2(-0.0119, 0.0328);
  const vec2 GSWELL_K3 = vec2(0.0240, 0.0343);
  const float GSWELL_W1 = 0.460767;
  const float GSWELL_W2 = 0.397935;
  const float GSWELL_W3 = 0.523599;

  // Wave GROUPS: a very slow envelope swells some stretches of sea and calms
  // others, so open water stops being one uniform corduroy sheet. A pure
  // two-sine product peaks on a fixed checkerboard, which reads as a lattice
  // of identical swell patches; blending the second axis between two
  // different wave vectors slides the peaks around instead.
  // Wavelengths 254, 238, and 207 yards; 14 / 11 / 17 whole cycles per period.
  const vec2 GROUP_K1 = vec2(0.021, 0.013);
  const vec2 GROUP_K2 = vec2(-0.011, 0.024);
  const vec2 GROUP_K3 = vec2(0.0152, -0.0262);
  const float GROUP_W1 = 0.146608;
  const float GROUP_W2 = 0.115192;
  const float GROUP_W3 = 0.178024;

  // The MEANDER warp: a slow, very long domain warp the mid waves, the
  // groundswell, and the group envelope all sample through. Straight-crested
  // sinusoids interfere on a fixed lattice no matter how many members a
  // family has; bending the sample position by two slower, far longer sines
  // makes every crest line wander and slides the interference pattern
  // around, so the open sea stops repeating. The chop stays UNWARPED on
  // purpose: its short crests are already broken up by the group envelope
  // and the detail maps, and it is the family the zone planes displace at
  // ~2 yard spacing, so skipping it keeps the vertex stage's added cost to
  // the families the apron carries anyway. Both stages share these
  // functions, so displaced crests and shaded crests bend identically.
  // Wavelengths 384 / 440 yards; 9 / 7 whole cycles per wrap period.
  const vec2 WARP_K1 = vec2(0.0141, -0.0083);
  const vec2 WARP_K2 = vec2(0.0067, 0.0126);
  const float WARP_W1 = 0.094248;
  const float WARP_W2 = 0.073304;
  // Yards of positional offset. Bounded by the coarsest DISPLACING grid: the
  // local wavenumber perturbation is at most WARP_AMP * (|WARP_K1| + 0.6 *
  // |WARP_K2|), about 15 percent, so a warped 180 yard roller never shortens
  // below what the apron's ~38 yard cells can sample (pinned in
  // tests/water_wave_field.test.ts).
  const float WARP_AMP = 6.0;

  // The axis-aligned surface WOBBLE the zone planes carry under the chop, and
  // the TWO shoreward LAPs that run through the foam band. The laps are
  // deliberately incommensurate (129 vs 88 cycles per period): their beat is
  // what makes the wash arrive in an irregular rhythm, a few strong waves and
  // then a near-still spell, instead of a single sine's metronome.
  // 105 / 67 / 129 / 88 whole cycles per wrap period.
  const float WOBBLE_W1 = 1.099557;
  const float WOBBLE_W2 = 0.701622;
  const float FOAM_LAP_W = 1.350885;
  const float FOAM_LAP_W2 = 0.921534;

  // Per family range fades for the FRAGMENT field (near, far), in yards of
  // camera distance. A per-pixel analytic wave has no mip chain, so a family
  // has to be gone before its wavelength falls under a couple of screen pixels
  // at a grazing angle. The longer the wave the further it survives, and the
  // three hand off, so there is moving water from the shore out to the haze
  // instead of the vertex chop's old hard stop at 300 yards.
  const vec2 CHOP_FADE = vec2(150.0, 480.0);
  const vec2 MSWELL_FADE = vec2(420.0, 1100.0);
  const vec2 GSWELL_FADE = vec2(1400.0, 3000.0);

  // Weight under which a family is skipped outright rather than evaluated at a
  // vanishing amplitude (WAVE_SKIP_WEIGHT). A family at this weight moves the
  // shading normal by uSwellAmp * weight * |k| * 5.5, under a thousandth of a
  // radian for every member: far below what a glint, a whitecap threshold or
  // the scatter term can resolve. It retires the last few percent of each
  // family's fade tail, which is exactly the band that covers the most SCREEN
  // area at a grazing sea angle and contributes the least to it.
  const float WAVE_SKIP = ${WAVE_SKIP_WEIGHT};

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

  // The meander warp itself: still a function of world position and time
  // alone, so everything sampled through it stays sheet-agnostic. The slope
  // addWave returns is taken with respect to the WARPED position; the warp's
  // own Jacobian (at most ~12 percent, see WARP_AMP) is deliberately ignored,
  // an error far below what the normal-tilt scale makes visible.
  vec2 waveWarp(vec2 p, float t) {
    float a = wavePhase(p, WARP_K1, WARP_W1, t);
    float b = wavePhase(p, WARP_K2, WARP_W2, t);
    return p + WARP_AMP * vec2(sin(a) + 0.6 * cos(b), sin(b) - 0.6 * cos(a));
  }

  // THE WARPED FORMS, and why they exist. The mid waves, the groundswell and
  // the group envelope all bend through the SAME warp of the SAME world
  // position, so a stage that wants more than one of them can evaluate
  // waveWarp ONCE and hand the warped point to these *At forms. Three separate
  // warps is four redundant wavePhase evaluations and eight redundant sin/cos
  // on every single water pixel, for a value that cannot differ between them.
  // The one-argument wrappers below are the definition; the *At forms are the
  // same arithmetic with the common subexpression lifted out, so a caller can
  // pick either and get identical output.

  // The slow envelope that gathers waves into SETS. Ranges 0.04 to 1.0: the
  // deep floor is deliberate, a real lull goes near-glassy, and the contrast
  // between a running set and the calm behind it is most of what reads as
  // "random" from the shore.
  float waveGroupAt(vec2 q, float t) {
    return 0.52 + 0.48
      * sin(wavePhase(q, GROUP_K1, GROUP_W1, t))
      * (0.62 * sin(wavePhase(q, GROUP_K2, GROUP_W2, t))
       + 0.38 * sin(wavePhase(q, GROUP_K3, GROUP_W3, t)));
  }

  float waveGroup(vec2 p, float t) {
    return waveGroupAt(waveWarp(p, t), t);
  }

  void chopField(vec2 p, float t, out float crest, out vec2 slope) {
    crest = 0.0;
    slope = vec2(0.0);
    addWave(p, t, SWELL_K1, SWELL_W1, 0.50, crest, slope);
    addWave(p, t, SWELL_K2, SWELL_W2, 0.32, crest, slope);
    addWave(p, t, SWELL_K3, SWELL_W3, 0.18, crest, slope);
  }

  void midFieldAt(vec2 q, float t, out float crest, out vec2 slope) {
    crest = 0.0;
    slope = vec2(0.0);
    addWave(q, t, MSWELL_K1, MSWELL_W1, 0.45, crest, slope);
    addWave(q, t, MSWELL_K2, MSWELL_W2, 0.33, crest, slope);
    addWave(q, t, MSWELL_K3, MSWELL_W3, 0.22, crest, slope);
  }

  void midField(vec2 p, float t, out float crest, out vec2 slope) {
    midFieldAt(waveWarp(p, t), t, crest, slope);
  }

  void groundswellFieldAt(vec2 q, float t, out float crest, out vec2 slope) {
    crest = 0.0;
    slope = vec2(0.0);
    addWave(q, t, GSWELL_K1, GSWELL_W1, 0.46, crest, slope);
    addWave(q, t, GSWELL_K2, GSWELL_W2, 0.33, crest, slope);
    addWave(q, t, GSWELL_K3, GSWELL_W3, 0.21, crest, slope);
  }

  void groundswellField(vec2 p, float t, out float crest, out vec2 slope) {
    groundswellFieldAt(waveWarp(p, t), t, crest, slope);
  }
`;
