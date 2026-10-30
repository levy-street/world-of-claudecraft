// The painted cloud layer of the vale's sky dome (src/render/sky.ts): hand-painted clouds that
// drift slowly round the sky over the painted day sky, so the clouds on screen are crisp where
// the panorama's own were soft (a 2048 texel panorama spreads one texel over two or three
// screen pixels at gameplay zoom). The pure half, Three- and DOM-free so a plain Vitest pins
// it (tests/sky_clouds_core.test.ts, RENDER_PURE_CORES): the atlas layout
// (scripts/assets/build_sky_clouds.mjs measures it), where every cloud sits and how fast it
// drifts, the uniform values at a moment in time, and the GLSL the dome splices into its one
// program.
//
// Cost. One program for the whole session: a fixed loop over SKY_CLOUD_COUNT clouds, each a
// handful of ALU (its offset from the view ray in true angles, two compares) and a texture tap
// only where the ray lands inside its rectangle, so open sky samples nothing. The block sits
// behind a uniform branch and an elevation band: a sky without clouds (every biome but the vale
// and the beach that aliases it, and the vale until its atlas is uploaded) skips it whole, and
// so does every pixel under the horizon fog or near the zenith. The atlas is one 1536 x 1024
// UASTC texture with no mips (the dome draws it near one texel a pixel), uploaded once on the
// idle lane (sky_residency_driver.ts) and kept for the session. The drift moves on the CPU once
// a frame (skyCloudPositions): a uniform array write, never a rebuild.
//
// Where it lands. Over the day sky colour BEFORE the cycle's grading, so the night
// desaturation and the dark multiply take the clouds with the sky they ride on; and the SAME
// clouds, graded moonlit (SKY_CLOUD_NIGHT: deep blue-violet bodies, silver tops), over the
// painted night's share, so they drift on unbroken through dusk, night and dawn while the
// night sky (a clear painting: stars, the milky band, low banks on the horizon) crossfades in
// under them. The stars are veiled where a cloud covers them, and the dusk glow and the horizon
// fog band land on the clouds exactly as on the sky. Cosmetic only: no tier hides anything a
// player acts on, so the layer needs no fairness gate.

/** Where the atlas ships (scripts/assets/build_sky_clouds.mjs writes it). */
export const SKY_CLOUD_ATLAS_URL = '/env/vale_painted_clouds.ktx2';

/** The atlas's size in texels (the sheet as painted: four clouds in a 2 x 2 grid). */
export const SKY_CLOUD_ATLAS_SIZE: readonly [number, number] = Object.freeze([1536, 1024]);

/** One painted cloud's rectangle in the atlas: texture space (u right, v UP from the
 *  atlas's bottom row: the build flips the rows), as build_sky_clouds.mjs measures it. */
export interface SkyCloudSprite {
  readonly u0: number;
  readonly v0: number;
  readonly du: number;
  readonly dv: number;
}

/** The four painted clouds: a tall cumulus, a long flat bank, a round puff and a broken wisp
 *  (scripts/assets/vale_painted_clouds.layout.json, which the test holds this to). */
export const SKY_CLOUD_SPRITES: readonly SkyCloudSprite[] = Object.freeze([
  { u0: 0.02734, v0: 0.50879, du: 0.47266, dv: 0.45215 },
  { u0: 0.5, v0: 0.6084, du: 0.47331, dv: 0.26855 },
  { u0: 0.05469, v0: 0.05762, du: 0.39779, dv: 0.39844 },
  { u0: 0.51563, v0: 0.08301, du: 0.45703, dv: 0.38281 },
]);

/** A sprite's height over its width on screen (its texel aspect). */
export function skyCloudAspect(sprite: SkyCloudSprite): number {
  return (sprite.dv * SKY_CLOUD_ATLAS_SIZE[1]) / (sprite.du * SKY_CLOUD_ATLAS_SIZE[0]);
}

/** One cloud in the sky: which sprite, mirrored or not, its azimuth at time 0 (degrees, the
 *  dome's atan(z, x) convention, increasing to the viewer's right), the elevation of its
 *  centre and its width (degrees), and its drift (degrees a second, all one way: one wind). */
export interface SkyCloudInstance {
  readonly sprite: number;
  readonly flip: boolean;
  readonly azDeg: number;
  readonly elDeg: number;
  readonly widthDeg: number;
  readonly speedDegPerSec: number;
}

/**
 * The clouds round the vale's sky: big cumulus and banks low over the horizon, puffs in the
 * middle, wisps and a small puff high up, spread round the whole circle so every view holds a
 * few. One wind, but parallax: a cloud high overhead is nearer than one on the horizon, so it
 * crosses more of the sky a second. Each drifts at its own pace, rising with its elevation
 * from 0.2 degrees a second on the horizon to 0.66 high up (a full turn in 9 to 30 minutes),
 * so the layers slide visibly past one another and the sky is never the same twice, slow
 * enough to read as weather and never as motion pulling at the eye. Listed low to high: the
 * shader draws later clouds in front, so the nearer, faster cloud passes in front.
 */
export const SKY_CLOUD_INSTANCES: readonly SkyCloudInstance[] = Object.freeze([
  { sprite: 1, flip: true, azDeg: 262, elDeg: 12, widthDeg: 46, speedDegPerSec: 0.2 },
  { sprite: 1, flip: false, azDeg: 95, elDeg: 13, widthDeg: 50, speedDegPerSec: 0.22 },
  { sprite: 0, flip: true, azDeg: 178, elDeg: 14, widthDeg: 30, speedDegPerSec: 0.24 },
  { sprite: 0, flip: false, azDeg: 10, elDeg: 15.5, widthDeg: 36, speedDegPerSec: 0.26 },
  { sprite: 2, flip: false, azDeg: 140, elDeg: 20, widthDeg: 24, speedDegPerSec: 0.33 },
  { sprite: 2, flip: true, azDeg: 300, elDeg: 22, widthDeg: 28, speedDegPerSec: 0.36 },
  { sprite: 3, flip: false, azDeg: 58, elDeg: 30, widthDeg: 40, speedDegPerSec: 0.47 },
  { sprite: 3, flip: true, azDeg: 222, elDeg: 34, widthDeg: 34, speedDegPerSec: 0.53 },
  { sprite: 2, flip: false, azDeg: 120, elDeg: 38, widthDeg: 16, speedDegPerSec: 0.6 },
  { sprite: 3, flip: false, azDeg: 336, elDeg: 42, widthDeg: 30, speedDegPerSec: 0.66 },
]);

/** The loop bound the dome's program is compiled with. */
export const SKY_CLOUD_COUNT = SKY_CLOUD_INSTANCES.length;

/** The sky keys whose dome carries the layer: the painted vale and the beach that aliases it. */
export const SKY_CLOUD_KEYS: readonly string[] = Object.freeze(['vale', 'beach']);

/** Whether a sky key's dome draws the painted clouds. */
export function hasSkyClouds(key: string): boolean {
  return SKY_CLOUD_KEYS.includes(key);
}

/** The painted clouds' radiance gain on the dome: the painting's own whites, like the
 *  painted day sky they sit in (PAINTED_DAY_TUNE gain 1). */
export const SKY_CLOUD_GAIN = 1.0;

/**
 * The moonlit grade the clouds take over the painted night (linear radiance): the day cloud's
 * own light, from its lavender undersides (`lumLo`) to its cream tops (`lumHi`), re-coloured
 * the way the first painted night (2026-10-29) painted its clouds, measured off its panorama:
 * the bulk deep blue, from bodies near (0.03, 0.10, 0.26) up to lit faces near
 * (0.11, 0.23, 0.37), which the whole sunlit top of a day cloud takes (`midTo`), and only its
 * brightest brush strokes (`topFrom` up) catching the silver of the brightest, near
 * (0.32, 0.44, 0.49). Graded flatter than that, a day cloud's big sunlit top turns silver
 * whole and reads as a white daytime cloud on the night sky.
 */
export const SKY_CLOUD_NIGHT = Object.freeze({
  body: Object.freeze([0.028, 0.085, 0.24] as const),
  mid: Object.freeze([0.105, 0.225, 0.37] as const),
  top: Object.freeze([0.3, 0.42, 0.5] as const),
  lumLo: 0.3,
  lumHi: 0.85,
  midTo: 0.85,
  topFrom: 0.88,
});

/** Seconds the layer takes to fade in once its atlas is uploaded (no cloud pops in). */
export const SKY_CLOUD_FADE_SEC = 2.5;

/** The band of view elevation (dir.y, the sine) the block runs in: under it the horizon fog
 *  band hides the sky anyway, over it no cloud reaches. */
export const SKY_CLOUD_MIN_Y = 0.02;
export const SKY_CLOUD_MAX_Y = 0.92;

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/** An angle wrapped to [-pi, pi). */
export function wrapAngle(rad: number): number {
  return rad - TAU * Math.floor(rad / TAU + 0.5);
}

/**
 * Every cloud's place at `timeSec`, written into `out` (4 floats a cloud: azimuth and
 * elevation of its centre, then its half width and half height, all radians), the values of
 * the uCloudPos uniform array. Deterministic in time: the same second draws the same sky.
 */
export function skyCloudPositions(
  timeSec: number,
  out: Float32Array = new Float32Array(SKY_CLOUD_COUNT * 4),
  instances: readonly SkyCloudInstance[] = SKY_CLOUD_INSTANCES,
): Float32Array {
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  for (let i = 0; i < instances.length; i++) {
    const c = instances[i];
    const halfW = (c.widthDeg * RAD) / 2;
    out[i * 4] = wrapAngle((c.azDeg + ((c.speedDegPerSec * t) % 360)) * RAD);
    out[i * 4 + 1] = c.elDeg * RAD;
    out[i * 4 + 2] = halfW;
    out[i * 4 + 3] = halfW * skyCloudAspect(SKY_CLOUD_SPRITES[c.sprite]);
  }
  return out;
}

/** Every cloud's atlas rectangle (4 floats a cloud: u0, v0, du, dv; a mirrored cloud starts
 *  at its sprite's right edge and runs back), the values of the uCloudRect uniform array. */
export function skyCloudRects(
  instances: readonly SkyCloudInstance[] = SKY_CLOUD_INSTANCES,
): Float32Array {
  const out = new Float32Array(instances.length * 4);
  for (let i = 0; i < instances.length; i++) {
    const c = instances[i];
    const s = SKY_CLOUD_SPRITES[c.sprite];
    out[i * 4] = c.flip ? s.u0 + s.du : s.u0;
    out[i * 4 + 1] = s.v0;
    out[i * 4 + 2] = c.flip ? -s.du : s.du;
    out[i * 4 + 3] = s.dv;
  }
  return out;
}

/** The layer's weight on one arm of the dome's biome blend: 0 for a sky without clouds, else
 *  the residency fade. */
export function skyCloudArmWeight(key: string, fade: number): number {
  return hasSkyClouds(key) ? Math.min(1, Math.max(0, fade)) : 0;
}

/** The residency fade one frame on: up toward 1 over SKY_CLOUD_FADE_SEC once the atlas is
 *  bound, straight back to 0 when it is not. */
export function stepSkyCloudFade(fade: number, bound: boolean, dt: number): number {
  if (!bound) return 0;
  const step = Number.isFinite(dt) && dt > 0 ? dt / SKY_CLOUD_FADE_SEC : 0;
  return Math.min(1, Math.max(0, fade) + step);
}

function glslFloat(value: number): string {
  const text = String(Number(value.toFixed(6)));
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
}

const vec3 = (rgb: readonly number[]): string => `vec3(${rgb.map(glslFloat).join(', ')})`;

/** The uniforms the layer adds to the dome. */
export const SKY_CLOUDS_DECLARATIONS = /* glsl */ `
  uniform sampler2D uClouds;   // the painted cloud atlas (sky_clouds_core.ts); a placeholder at weight 0
  uniform vec2 uCloudW;        // per-arm cloud weight: a sky with clouds x the residency fade
  uniform vec4 uCloudPos[${SKY_CLOUD_COUNT}]; // per cloud: centre azimuth, elevation, half width, half height (rad)
  uniform vec4 uCloudRect[${SKY_CLOUD_COUNT}]; // per cloud: atlas u0, v0, du, dv
`;

/** The layer's function: the clouds over a view direction, premultiplied (rgb, coverage),
 *  later clouds in front. Sampled at level 0 (the atlas has one), so a tap inside the loop's
 *  per-pixel branch never leans on derivatives. */
export const SKY_CLOUDS_FUNCTIONS = /* glsl */ `
  vec4 paintedSkyClouds(vec3 dir) {
    float az = atan(dir.z, dir.x);
    float el = asin(clamp(dir.y, -1.0, 1.0));
    float ce = cos(el);
    vec4 acc = vec4(0.0);
    for (int i = 0; i < ${SKY_CLOUD_COUNT}; i++) {
      vec4 p = uCloudPos[i];
      float dx = az - p.x;
      dx -= 6.2831853 * floor(dx * 0.15915494 + 0.5);
      vec2 q = vec2(dx * ce, el - p.y) / p.zw;
      if (abs(q.x) < 1.0 && abs(q.y) < 1.0) {
        vec4 r = uCloudRect[i];
        vec4 s = textureLod(uClouds, r.xy + (q * 0.5 + 0.5) * r.zw, 0.0);
        acc = vec4(s.rgb * s.a, s.a) + acc * (1.0 - s.a);
      }
    }
    return vec4(acc.rgb * ${glslFloat(SKY_CLOUD_GAIN)}, acc.a);
  }

  // The same clouds moonlit (premultiplied in, premultiplied out): their day light picks a
  // colour from deep blue bodies to blue lit faces, silver on the brightest strokes only
  // (SKY_CLOUD_NIGHT).
  vec3 paintedMoonClouds(vec4 cloud) {
    vec3 day = cloud.rgb / max(cloud.a, 0.0001);
    float t = smoothstep(${glslFloat(SKY_CLOUD_NIGHT.lumLo)}, ${glslFloat(SKY_CLOUD_NIGHT.lumHi)}, dot(day, vec3(0.2126, 0.7152, 0.0722)));
    vec3 col = mix(${vec3(SKY_CLOUD_NIGHT.body)}, ${vec3(SKY_CLOUD_NIGHT.mid)}, smoothstep(0.0, ${glslFloat(SKY_CLOUD_NIGHT.midTo)}, t));
    col = mix(col, ${vec3(SKY_CLOUD_NIGHT.top)}, smoothstep(${glslFloat(SKY_CLOUD_NIGHT.topFrom)}, 1.0, t));
    return col * cloud.a;
  }
`;

/** The layer laid over the dome colour `c` (in main, after the biome grade). Leaves the sample
 *  in `paintedCloud` (premultiplied, weighted) for the night share and the star veil below. */
export const SKY_CLOUDS_GLSL = /* glsl */ `    // The painted cloud layer (sky_clouds_core.ts): crisp painted clouds drifting over the
    // day sky, before the cycle grade so the dusk and the night grade take them with the sky.
    vec4 paintedCloud = vec4(0.0);
    {
      float cloudW = mix(uCloudW.x, uCloudW.y, uMix);
      if (cloudW > 0.001 && dir.y > ${glslFloat(SKY_CLOUD_MIN_Y)} && dir.y < ${glslFloat(SKY_CLOUD_MAX_Y)}) {
        paintedCloud = paintedSkyClouds(dir) * cloudW;
        c = c * (1.0 - paintedCloud.a) + paintedCloud.rgb;
      }
    }
`;

/** The same clouds over the painted night's share (inside the dome's night branch, on its
 *  arm-weighted `night` before it replaces its share of `c`): they drift on through the
 *  night, moonlit, instead of fading out with the day sky. */
export const SKY_CLOUDS_NIGHT_GLSL = /* glsl */ `      // the drifting clouds over the painted night, moonlit (sky_clouds_core.ts)
      if (paintedCloud.a > 0.0) night = night * (1.0 - paintedCloud.a) + paintedMoonClouds(paintedCloud) * nightShare;
`;

/** Around the dome's star fields: a cloud veils the stars behind it (every star the two
 *  fields add is taken back by the cloud's coverage). */
export const SKY_CLOUDS_STAR_VEIL_OPEN = /* glsl */ `    vec3 paintedPreStars = c;
`;
export const SKY_CLOUDS_STAR_VEIL_CLOSE = /* glsl */ `    if (paintedCloud.a > 0.0) c = paintedPreStars + (c - paintedPreStars) * (1.0 - paintedCloud.a);
`;
