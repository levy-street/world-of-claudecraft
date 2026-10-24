// The ocean's wave statistics, as plain numbers: the cascade plan per tier, the
// directional wind-sea and swell spectra, the seeded initial amplitudes the GPU
// simulation evolves, and the slope variance a pixel cannot resolve. Three-free
// and DOM-free, so tests/ocean_spectrum_core.test.ts can check every number in
// it (and the FFT index arithmetic the GPU passes mirror) in plain Node.
//
// The model is the standard one for real-time oceans (Tessendorf, "Simulating
// Ocean Water", 2001; the JONSWAP fetch-limited spectrum; Donelan-Banner
// directional spreading), written fresh for this engine.
//
// UNITS ARE WORLD UNITS. A character is about 2.6 units tall, so one unit is
// about 0.7 m, and gravity is scaled to match: a wave of a given length then
// travels at the speed its real counterpart would next to a real person.
//
// ONE SEAMLESS CLOCK. The water clock wraps at OCEAN_LOOP_SECONDS (the same
// period as every other water term), so each wave's angular frequency is
// rounded to a whole number of cycles per loop. The rounding moves a frequency
// by at most half of 2 pi / 600 rad/s, far below anything visible, and it is what
// makes the wrap seamless and keeps the phase exact in float32.

/** Metres per world unit (a 2.6 unit character is about 1.8 m tall). */
export const OCEAN_METRES_PER_UNIT = 0.7;
/** Gravity in world units per second squared. */
export const OCEAN_GRAVITY = 9.81 / OCEAN_METRES_PER_UNIT;
/** The water clock's wrap period in seconds (water.ts wraps uTime at this). */
export const OCEAN_LOOP_SECONDS = 600;

const TWO_PI = Math.PI * 2;

export type OceanTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';

/** One FFT cascade: a square patch of `size` world units, band-limited. */
export interface OceanCascadeSpec {
  /** Patch side in world units; the field tiles with this period. */
  size: number;
  /** Lowest wavenumber (rad/unit) this cascade carries, inclusive. */
  kLow: number;
  /** Highest wavenumber this cascade carries, exclusive. */
  kHigh: number;
}

export interface OceanPlan {
  /** Grid side shared by every cascade (power of two). */
  resolution: number;
  cascades: OceanCascadeSpec[];
  /**
   * Screen-space reflection march steps where the opaque-scene capture runs
   * (high and up); 0 leaves reflections to the sky probe alone.
   */
  ssrSteps: number;
  /** Simulated steps per second at most (the waves move far slower than a frame). */
  stepHz: number;
}

/**
 * Patch sizes per tier. Each cascade hands over to the next a few of the next
 * cascade's own wavelengths in (CASCADE_HANDOVER), so a wave is carried by
 * exactly one cascade and never counted twice. The largest patch is the
 * longest swell anyone sees tile; the smallest carries the ripples that make
 * the sun road sparkle up close.
 */
const TIER_PATCHES: Record<
  OceanTier,
  { resolution: number; sizes: number[]; ssrSteps: number; stepHz: number }
> = {
  // The lowest Water Quality on a shader preset (the Advanced mix): still a
  // moving sea, on the smallest grids, stepped at half rate.
  low: { resolution: 64, sizes: [331, 61, 11.3], ssrSteps: 0, stepHz: 30 },
  medium: { resolution: 128, sizes: [331, 61, 11.3], ssrSteps: 0, stepHz: 30 },
  high: { resolution: 256, sizes: [331, 61, 11.3], ssrSteps: 16, stepHz: 45 },
  ultra: { resolution: 256, sizes: [331, 79, 19.1, 4.7], ssrSteps: 22, stepHz: 60 },
  insane: { resolution: 256, sizes: [331, 79, 19.1, 4.7], ssrSteps: 22, stepHz: 60 },
};

/**
 * A cascade covers wavelengths from its own patch down to the next patch over
 * this factor; below that the next cascade takes over. Four keeps every
 * handover wavelength well inside both grids' resolved band.
 */
export const CASCADE_HANDOVER = 4;

/**
 * The ocean simulation plan for a water tier (the Phong sheet of the low
 * GRAPHICS tier never asks); null only for a value that is no tier at all,
 * which draws the calm surface with no simulation behind it.
 */
export function oceanPlanForTier(tier: OceanTier): OceanPlan | null {
  const entry = TIER_PATCHES[tier];
  if (!entry) return null;
  const { resolution, sizes, ssrSteps, stepHz } = entry;
  const cascades = sizes.map((size, i) => {
    const kLow = i === 0 ? 0 : (TWO_PI / sizes[i]) * CASCADE_HANDOVER;
    const next = sizes[i + 1];
    // The finest cascade runs to its own Nyquist limit.
    const kHigh =
      next === undefined ? (Math.PI * resolution) / size : (TWO_PI / next) * CASCADE_HANDOVER;
    return { size, kLow, kHigh };
  });
  return { resolution, cascades, ssrSteps, stepHz };
}

/** The wind sea and swell the spectrum is built from. */
export interface OceanSeaState {
  /** Wind speed 10 m above the water, world units per second. */
  windSpeed: number;
  /** Direction the wind blows TOWARD, radians in the xz plane (0 = +x). */
  windAngle: number;
  /** Fetch, world units of open water upwind. */
  fetch: number;
  /** Significant height of the swell component (world units), 0 for none. */
  swellHeight: number;
  /** Direction the swell travels toward, radians. */
  swellAngle: number;
  /** Peak wavelength of the swell, world units. */
  swellWavelength: number;
  /** Horizontal displacement scale (Tessendorf's lambda); 0 is a pure heightfield. */
  choppiness: number;
}

/** A moderate open-sea state: a breeze over a long fetch plus a low swell. */
export const DEFAULT_SEA_STATE: OceanSeaState = {
  windSpeed: 6.6 / OCEAN_METRES_PER_UNIT,
  windAngle: 0.55,
  fetch: 42_000 / OCEAN_METRES_PER_UNIT,
  swellHeight: 0.45,
  swellAngle: 0.9,
  swellWavelength: 95,
  choppiness: 0.85,
};

/** Deep-water dispersion: angular frequency of wavenumber k. */
export function oceanOmega(k: number): number {
  return Math.sqrt(OCEAN_GRAVITY * k);
}

/**
 * The angular frequency rounded to a whole number of cycles per loop, as that
 * cycle count (the GPU multiplies it by the loop fraction). Never zero for a
 * travelling wave: a wave that rounded to zero cycles would freeze in place.
 */
export function oceanCyclesPerLoop(k: number): number {
  if (k <= 0) return 0;
  const cycles = Math.round((oceanOmega(k) * OCEAN_LOOP_SECONDS) / TWO_PI);
  return Math.max(1, cycles);
}

/** JONSWAP peak angular frequency for a wind speed and fetch. */
export function jonswapPeakOmega(windSpeed: number, fetch: number): number {
  return 22 * ((OCEAN_GRAVITY * OCEAN_GRAVITY) / (windSpeed * fetch)) ** (1 / 3);
}

/** JONSWAP frequency spectrum S(omega), units^2 s. */
export function jonswap(omega: number, windSpeed: number, fetch: number): number {
  if (omega <= 0) return 0;
  const g = OCEAN_GRAVITY;
  const alpha = 0.076 * ((windSpeed * windSpeed) / (fetch * g)) ** 0.22;
  const wp = jonswapPeakOmega(windSpeed, fetch);
  const sigma = omega <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((omega - wp) ** 2) / (2 * sigma * sigma * wp * wp));
  const gamma = 3.3;
  return ((alpha * g * g) / omega ** 5) * Math.exp(-1.25 * (wp / omega) ** 4) * gamma ** r;
}

/**
 * Donelan-Banner directional spreading, normalized over theta in [-pi, pi]:
 * narrow around the peak frequency, wider for the short waves riding on it.
 */
export function donelanBannerSpread(theta: number, omega: number, omegaPeak: number): number {
  const ratio = omega / omegaPeak;
  let beta: number;
  if (ratio < 0.95) beta = 2.61 * ratio ** 1.3;
  else if (ratio < 1.6) beta = 2.28 * ratio ** -1.3;
  else {
    const eps = -0.4 + 0.8393 * Math.exp(-0.567 * Math.log(ratio * ratio));
    beta = 10 ** eps;
  }
  const sech = 1 / Math.cosh(beta * theta);
  return (beta / (2 * Math.tanh(beta * Math.PI))) * sech * sech;
}

/** Share of the wind sea's energy given a broad, short-crested spread. */
export const BROAD_SPREAD_SHARE = 0.3;

/** Wrap an angle into (-pi, pi]. */
function wrapAngle(a: number): number {
  let v = a % TWO_PI;
  if (v > Math.PI) v -= TWO_PI;
  if (v <= -Math.PI) v += TWO_PI;
  return v;
}

/**
 * Directional wavenumber spectrum S(kx, kz): height variance per unit of
 * wavenumber area, wind sea plus swell. A tiny capillary roll-off keeps the
 * finest cascade from carrying energy no surface this size would hold.
 */
export function oceanSpectrumK(kx: number, kz: number, sea: OceanSeaState): number {
  const k = Math.hypot(kx, kz);
  if (k <= 1e-9) return 0;
  const omega = oceanOmega(k);
  const dOmegaDk = OCEAN_GRAVITY / (2 * omega);
  const theta = Math.atan2(kz, kx);
  const wp = jonswapPeakOmega(sea.windSpeed, sea.fetch);
  // Donelan-Banner alone crests the sea into long parallel ridges; real
  // seas carry a short-crested share from every gust and swell interaction,
  // so a broad cardioid takes part of the energy (both normalized over theta).
  const dTheta = wrapAngle(theta - sea.windAngle);
  const spread =
    (1 - BROAD_SPREAD_SHARE) * donelanBannerSpread(dTheta, omega, wp) +
    (BROAD_SPREAD_SHARE * (1 + Math.cos(dTheta))) / TWO_PI;
  const wind = jonswap(omega, sea.windSpeed, sea.fetch) * spread * (dOmegaDk / k);
  let swell = 0;
  if (sea.swellHeight > 0) {
    // A narrow, long-crested band around the swell peak: Gaussian in k and in
    // angle, normalized so its height variance is (Hs / 4)^2.
    const kp = TWO_PI / sea.swellWavelength;
    const kWidth = kp * 0.12;
    const thetaWidth = 0.16;
    const dSwell = wrapAngle(theta - sea.swellAngle);
    const variance = (sea.swellHeight / 4) ** 2;
    const radial =
      Math.exp(-((k - kp) ** 2) / (2 * kWidth * kWidth)) / (Math.sqrt(TWO_PI) * kWidth);
    const angular =
      Math.exp(-(dSwell * dSwell) / (2 * thetaWidth * thetaWidth)) /
      (Math.sqrt(TWO_PI) * thetaWidth);
    swell = (variance * radial * angular) / k;
  }
  const capillary = Math.exp(-((k * 0.012) ** 2));
  return (wind + swell) * capillary;
}

/** Small seeded PRNG (mulberry32), so a spectrum is the same on every load. */
export function oceanRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One standard normal pair (Box-Muller) from a uniform source. */
function gaussianPair(rand: () => number): [number, number] {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(TWO_PI * u2), r * Math.sin(TWO_PI * u2)];
}

/** The signed wave index a texel column or row stands for (standard FFT order). */
export function oceanWaveIndex(texel: number, resolution: number): number {
  return texel < resolution / 2 ? texel : texel - resolution;
}

export interface CascadeSpectrum {
  /**
   * RGBA per texel: h0(k) and conj(h0(-k)), real then imaginary, in standard
   * FFT order (row = z index, column = x index), so the GPU's time step reads
   * both halves of a mode from one texel.
   */
  h0: Float32Array;
  /** RGBA per texel: kx, kz, whole cycles per loop, 1/|k| (0 at k = 0). */
  waves: Float32Array;
  /** Height variance this cascade carries, world units squared. */
  heightVariance: number;
  /** Slope variance this cascade carries (both axes summed). */
  slopeVariance: number;
}

/**
 * The initial amplitudes of one cascade. Every mode outside the cascade's band
 * is zero, so the cascades sum to the whole spectrum with no overlap. Seeded
 * per cascade, so a tier with fewer cascades still draws the same big waves.
 */
export function buildCascadeSpectrum(
  plan: OceanPlan,
  index: number,
  sea: OceanSeaState,
  seed: number,
): CascadeSpectrum {
  const n = plan.resolution;
  const spec = plan.cascades[index];
  const dk = TWO_PI / spec.size;
  const rand = oceanRng(seed * 7919 + index * 104729 + 17);
  // Amplitude per mode first (one Gaussian draw each), then pair each mode
  // with its mirror: conj(h0(-k)) reads the amplitude drawn for -k.
  const re = new Float32Array(n * n);
  const im = new Float32Array(n * n);
  const waves = new Float32Array(n * n * 4);
  let heightVariance = 0;
  let slopeVariance = 0;
  for (let row = 0; row < n; row++) {
    const nz = oceanWaveIndex(row, n);
    for (let col = 0; col < n; col++) {
      const nx = oceanWaveIndex(col, n);
      const kx = nx * dk;
      const kz = nz * dk;
      const k = Math.hypot(kx, kz);
      const [gr, gi] = gaussianPair(rand);
      const t = row * n + col;
      waves[t * 4] = kx;
      waves[t * 4 + 1] = kz;
      waves[t * 4 + 2] = oceanCyclesPerLoop(k);
      waves[t * 4 + 3] = k > 0 ? 1 / k : 0;
      if (k < spec.kLow || k >= spec.kHigh || k === 0) continue;
      const density = oceanSpectrumK(kx, kz, sea) * dk * dk;
      const amp = Math.sqrt(density / 2);
      re[t] = (gr * amp) / Math.SQRT2;
      im[t] = (gi * amp) / Math.SQRT2;
      heightVariance += density;
      slopeVariance += density * k * k;
    }
  }
  const h0 = new Float32Array(n * n * 4);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const t = row * n + col;
      const mirror = ((n - row) % n) * n + ((n - col) % n);
      h0[t * 4] = re[t];
      h0[t * 4 + 1] = im[t];
      h0[t * 4 + 2] = re[mirror];
      h0[t * 4 + 3] = -im[mirror];
    }
  }
  return { h0, waves, heightVariance, slopeVariance };
}

/**
 * Horizontal displacement factor applied to the choppy terms. NEGATIVE on
 * purpose: with the transform's +i exponent, -i k/|k| h is the gradient
 * direction, and a surface point must move TOWARD the crest above it (the
 * Gerstner shape: sharp crests, broad troughs), so it moves against it.
 */
export const OCEAN_CHOP_SIGN = -1;

/**
 * One texel of the GPU time step (ocean_fft_glsl.ts OCEAN_EVOLVE_FRAG), line
 * for line: from h0 / conj(h0(-k)) and the wave texel to the two packed
 * outputs, A = (Dx + i Dy, Dz + i dDx/dz), B = (dDy/dx + i dDy/dz,
 * dDx/dx + i dDz/dz). The tests transform it on the CPU to pin the signs.
 */
export function oceanEvolveTexel(
  h0: readonly [number, number, number, number],
  wave: readonly [number, number, number, number],
  loopT: number,
  choppiness: number,
): { a: [number, number, number, number]; b: [number, number, number, number] } {
  const cycles = wave[2] * loopT;
  const phase = TWO_PI * (cycles - Math.floor(cycles)); // GLSL fract
  const ec = Math.cos(phase);
  const es = Math.sin(phase);
  const hr = h0[0] * ec - h0[1] * es + (h0[2] * ec + h0[3] * es);
  const hi = h0[0] * es + h0[1] * ec + (-h0[2] * es + h0[3] * ec);
  const [kx, kz, , invK] = wave;
  const chop = choppiness * OCEAN_CHOP_SIGN;
  // -i h and i h
  const mr = hi;
  const mi = -hr;
  const ir = -hi;
  const ii = hr;
  const dx: [number, number] = [mr * kx * invK * chop, mi * kx * invK * chop];
  const dz: [number, number] = [mr * kz * invK * chop, mi * kz * invK * chop];
  const dydx: [number, number] = [ir * kx, ii * kx];
  const dydz: [number, number] = [ir * kz, ii * kz];
  const dxdx: [number, number] = [hr * kx * kx * invK * chop, hi * kx * kx * invK * chop];
  const dzdz: [number, number] = [hr * kz * kz * invK * chop, hi * kz * kz * invK * chop];
  const dxdz: [number, number] = [hr * kx * kz * invK * chop, hi * kx * kz * invK * chop];
  const pack = (p: [number, number], q: [number, number]): [number, number] => [
    p[0] - q[1],
    p[1] + q[0],
  ];
  const c0 = pack(dx, [hr, hi]);
  const c1 = pack(dz, dxdz);
  const c2 = pack(dydx, dydz);
  const c3 = pack(dxdx, dzdz);
  return { a: [c0[0], c0[1], c1[0], c1[1]], b: [c2[0], c2[1], c3[0], c3[1]] };
}

/**
 * The Stockham radix-2 step the GPU's FFT passes run, as index arithmetic:
 * for output index `j` at stage half-size `p`, which two inputs it combines,
 * the twiddle numerator `k` (angle pi * k / p), and whether it takes the sum or
 * the difference. The GLSL mirrors this line for line.
 */
export function stockhamStage(
  j: number,
  p: number,
  n: number,
): { a: number; b: number; k: number; minus: boolean } {
  const k = j % p;
  const inPair = j % (2 * p);
  const i = (j - inPair) / 2 + k;
  return { a: i, b: i + n / 2, k, minus: inPair >= p };
}

/**
 * Inverse DFT of a complex sequence by the same stages (sign +1, no 1/N), the
 * CPU reference the tests hold the GPU arithmetic to.
 */
export function stockhamInverse(re: Float64Array, im: Float64Array): [Float64Array, Float64Array] {
  const n = re.length;
  let xr = Float64Array.from(re);
  let xi = Float64Array.from(im);
  for (let p = 1; p < n; p *= 2) {
    const yr = new Float64Array(n);
    const yi = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const { a, b, k, minus } = stockhamStage(j, p, n);
      const angle = (Math.PI * k) / p;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const br = xr[b] * c - xi[b] * s;
      const bi = xr[b] * s + xi[b] * c;
      yr[j] = minus ? xr[a] - br : xr[a] + br;
      yi[j] = minus ? xi[a] - bi : xi[a] + bi;
    }
    xr = yr;
    xi = yi;
  }
  return [xr, xi];
}

/** Log-spaced cutoff wavenumbers for the unresolved-slope table. */
export const OCEAN_VARIANCE_SAMPLES = 24;
export const OCEAN_VARIANCE_LOG2_K_MIN = -6;
export const OCEAN_VARIANCE_LOG2_K_MAX = 9;

/**
 * Slope variance carried by every simulated wave SHORTER than each cutoff, on
 * a log2 grid of cutoff wavenumbers. A pixel whose footprint is f world units
 * cannot resolve waves above k = pi / f; their slopes still tilt the micro
 * facets that reflect the sun, so this is the roughness the shader adds back
 * (the filtered normal maps already average those slopes away). Summed from
 * the same band-limited grids the GPU simulates, so it matches them exactly.
 */
export function unresolvedSlopeVariance(plan: OceanPlan, sea: OceanSeaState): Float32Array {
  const out = new Float32Array(OCEAN_VARIANCE_SAMPLES);
  const step =
    (OCEAN_VARIANCE_LOG2_K_MAX - OCEAN_VARIANCE_LOG2_K_MIN) / (OCEAN_VARIANCE_SAMPLES - 1);
  const cutoffs = Array.from(
    { length: OCEAN_VARIANCE_SAMPLES },
    (_, i) => 2 ** (OCEAN_VARIANCE_LOG2_K_MIN + i * step),
  );
  const n = plan.resolution;
  for (const spec of plan.cascades) {
    const dk = TWO_PI / spec.size;
    for (let row = 0; row < n; row++) {
      const kz = oceanWaveIndex(row, n) * dk;
      for (let col = 0; col < n; col++) {
        const kx = oceanWaveIndex(col, n) * dk;
        const k = Math.hypot(kx, kz);
        if (k < spec.kLow || k >= spec.kHigh || k === 0) continue;
        const slope = oceanSpectrumK(kx, kz, sea) * dk * dk * k * k;
        for (let i = 0; i < OCEAN_VARIANCE_SAMPLES; i++) if (k > cutoffs[i]) out[i] += slope;
      }
    }
  }
  return out;
}
