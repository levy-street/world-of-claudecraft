import * as THREE from 'three';
import { WORLD_MAX_Z, WORLD_MIN_Z, ZONES } from '../sim/data';
import type { BiomeId } from '../sim/types';
import { loadHdr, loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, sharedUniforms } from './gfx';
import { cloudTexture, skyTexture } from './textures';

// HDRI sky dome + cloud sprites.
//
// High tier: the dome fragment shader samples real Poly Haven equirect HDRIs
// (one per biome) by view direction, cross-fading two maps across the same
// zone-boundary windows the terrain palette uses. Each HDRI's sample is
// rotated in azimuth so its real sun sits at SUN_ANCHOR's azimuth — the one
// canonical sun that shadows, god rays and water glints all share. Procedural
// warm sun-glow lobes stay layered on top so the anchor direction always
// carries the glow even where the HDRI sun's elevation differs.
//
// The dome rides with the camera (the renderer sets its position every
// frame) and exposes the raw equirects for PMREM IBL (see envTexture below
// and docs/design/lookdev-hookup.md).
//
// Low tier keeps the legacy 4x256 canvas-gradient dome.

const DOME_RADIUS = 560;

// The photographic HDRIs run hot next to the old procedural dome (sky bands
// 0.5-2.5 radiance, sun texels ~60000): unscaled they shove most of the sky
// past the 0.85 bloom threshold and the whole frame hazes out. Per-biome
// gain brings the open sky back under the bloom economy; the clamp leaves
// just enough headroom for the sun region to bloom like the old glow lobes
// did. The dawn HDRI carries a huge horizon-level sun glow, so the peaks get
// reined in harder or half the sky white-outs. The renderer's PMREM capture
// samples the same shader, so IBL stays in step.
const HDRI_TUNE: Record<BiomeId, { gain: number; clamp: number }> = {
  vale: { gain: 0.6, clamp: 2.6 },
  marsh: { gain: 0.6, clamp: 2.2 },
  peaks: { gain: 0.48, clamp: 1.7 },
  // Paint-only biomes reuse the closest shipped sky (no new HDRI downloads).
  beach: { gain: 0.6, clamp: 2.6 },
  desert: { gain: 0.55, clamp: 2.2 },
  volcano: { gain: 0.5, clamp: 2.0 },
  cave: { gain: 0.55, clamp: 2.0 },
  // zero gain: the night capture carries a warm glow the void must not show —
  // the Mirror World sky is pure black; mist and dome lights carry the scene
  mirror: { gain: 0, clamp: 0.1 },
};

// The Mirror World uses the real night capture: black-indigo sky with faint
// stars behind the mist; no daytime warmth can leak into the dome.
const BIOME_HDRI_2K: Record<BiomeId, string> = {
  vale: '/env/vale_day_2k.hdr',
  marsh: '/env/marsh_overcast_2k.hdr',
  peaks: '/env/peaks_dawn_2k.hdr',
  beach: '/env/vale_day_2k.hdr',
  desert: '/env/peaks_dawn_2k.hdr',
  volcano: '/env/marsh_overcast_2k.hdr',
  cave: '/env/marsh_overcast_2k.hdr',
  mirror: '/env/night_2k.hdr',
};

const BIOME_HDRI_1K: Record<BiomeId, string> = {
  vale: '/env/vale_day_1k.hdr',
  marsh: '/env/marsh_overcast_1k.hdr',
  peaks: '/env/peaks_dawn_1k.hdr',
  beach: '/env/vale_day_1k.hdr',
  desert: '/env/peaks_dawn_1k.hdr',
  volcano: '/env/marsh_overcast_1k.hdr',
  cave: '/env/marsh_overcast_1k.hdr',
  mirror: '/env/night_1k.hdr',
};

function shouldUseLiteHdri(): boolean {
  if (typeof location !== 'undefined') {
    const params = new URLSearchParams(location.search);
    const forced = params.get('gfx');
    if (params.has('lowgfx') || forced === 'low') return true;
    if (forced === 'high' || forced === 'ultra') return false;
  }
  if (typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & { deviceMemory?: number };
    if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) return true;
    if (nav.maxTouchPoints > 0 && typeof matchMedia !== 'undefined') {
      if (matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 900px)').matches)
        return true;
    }
  }
  return false;
}

const BIOME_HDRI = shouldUseLiteHdri() ? BIOME_HDRI_1K : BIOME_HDRI_2K;

// The Mirror World borrows the peaks backdrop: crushed near-black behind the
// mist, its ridgeline silhouettes read as far shapes in the dark.
const BIOME_BACKDROP_8K: Record<BiomeId, string> = {
  vale: '/env/vale_backdrop.webp',
  marsh: '/env/marsh_backdrop.webp',
  peaks: '/env/peaks_backdrop.webp',
  beach: '/env/vale_backdrop.webp',
  desert: '/env/peaks_backdrop.webp',
  volcano: '/env/peaks_backdrop.webp',
  cave: '/env/marsh_backdrop.webp',
  mirror: '/env/peaks_backdrop.webp',
};

const BIOME_BACKDROP_4K: Record<BiomeId, string> = {
  vale: '/env/vale_backdrop_4k.webp',
  marsh: '/env/marsh_backdrop_4k.webp',
  peaks: '/env/peaks_backdrop_4k.webp',
  beach: '/env/vale_backdrop_4k.webp',
  desert: '/env/peaks_backdrop_4k.webp',
  volcano: '/env/peaks_backdrop_4k.webp',
  cave: '/env/marsh_backdrop_4k.webp',
  mirror: '/env/peaks_backdrop_4k.webp',
};

const BACKDROP_Y_BIAS: Record<BiomeId, number> = {
  vale: 0,
  marsh: 0,
  peaks: 0,
  beach: 0,
  desert: 0,
  volcano: 0,
  cave: 0,
  mirror: 0,
};

// Photo-backdrop + anchor-sun brightness per biome. The Mirror World crushes
// both: outside its glass there is only darkness — no bright horizon photo
// and no sun glow; far shapes survive only as near-black silhouettes.
const BACKDROP_GAIN: Record<BiomeId, number> = {
  vale: 1,
  marsh: 1,
  peaks: 1,
  beach: 1,
  desert: 1,
  volcano: 1,
  cave: 1,
  mirror: 0,
};
const SUN_GLOW_GAIN: Record<BiomeId, number> = {
  vale: 1,
  marsh: 1,
  peaks: 1,
  beach: 1,
  desert: 1,
  volcano: 1,
  cave: 1,
  mirror: 0,
};

interface NetworkInformationLike {
  readonly effectiveType?: string;
  readonly saveData?: boolean;
}

type NavigatorWithBackdropHints = Navigator & {
  readonly connection?: NetworkInformationLike;
  readonly deviceMemory?: number;
  readonly mozConnection?: NetworkInformationLike;
  readonly webkitConnection?: NetworkInformationLike;
};

/** Typed read of the Save-Data client hint (the user asked to conserve data). */
export function navigatorSaveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavigatorWithBackdropHints;
  const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  return !!connection?.saveData;
}

function shouldUseLiteBackdrop(): boolean {
  if (typeof location !== 'undefined') {
    const params = new URLSearchParams(location.search);
    const forced = params.get('backdrop') ?? params.get('skybox');
    if (forced === '4k' || forced === 'lite') return true;
    if (forced === '8k' || forced === 'high') return false;
  }
  if (typeof navigator !== 'undefined') {
    const nav = navigator as NavigatorWithBackdropHints;
    const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
    if (connection?.saveData) return true;
    if (connection?.effectiveType && ['slow-2g', '2g', '3g'].includes(connection.effectiveType))
      return true;
    if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) return true;
    if (nav.maxTouchPoints > 0 && typeof matchMedia !== 'undefined') {
      if (matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 900px)').matches)
        return true;
    }
  }
  return false;
}

const BIOME_BACKDROP = shouldUseLiteBackdrop() ? BIOME_BACKDROP_4K : BIOME_BACKDROP_8K;

// Measured brightest-texel u (sun azimuth in equirect space) per HDRI — see
// tmp/analyze_hdr.mjs. Used to rotate each map so its sun matches SUN_ANCHOR.
const HDRI_SUN_U: Record<BiomeId, number> = {
  vale: 0.595,
  marsh: 0.657,
  peaks: 0.631,
  beach: 0.595,
  desert: 0.631,
  volcano: 0.657,
  cave: 0.657,
  mirror: 0.657,
};

const hdriStore: Partial<Record<BiomeId, THREE.DataTexture>> = {};
const backdropStore: Partial<Record<BiomeId, THREE.Texture>> = {};
// 2K HDRs are ~17MB on disk; 1K is ~4MB. Pick the lighter set for phone /
// low-memory browser sessions before preload starts, and skip entirely when
// the URL already forces the gradient-dome tier. An auto-detected software-GL
// low tier can only be known after WebGL context creation, which happens after
// preload, so this best-effort device gate keeps mobile out of the worst path.
if (GFX.standardMaterials) {
  for (const biome of Object.keys(BIOME_HDRI) as BiomeId[]) {
    registerPreload(
      loadHdr(BIOME_HDRI[biome]).then((tex) => {
        tex.wrapS = THREE.RepeatWrapping; // azimuth rotation needs u to wrap
        hdriStore[biome] = tex;
        return tex;
      }),
    );
    registerPreload(
      loadTexture(BIOME_BACKDROP[biome], { srgb: true })
        .then((tex) => {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          backdropStore[biome] = tex;
          return tex;
        })
        .catch(() => undefined),
    );
  }
}

export function hasSkyHdriAssets(): boolean {
  return Boolean(hdriStore.vale && hdriStore.marsh && hdriStore.peaks);
}

export function hasBackdropAssets(): boolean {
  return Boolean(backdropStore.vale && backdropStore.marsh && backdropStore.peaks);
}

export interface SkyView {
  dome: THREE.Mesh;
  /** cross-fades the HDRI pair toward the biome band the camera is over */
  setCameraZ(z: number, dt: number): void;
  /** Raw equirect HDR (unclamped) for PMREM IBL; null on the low tier. */
  envTexture(biome: BiomeId): THREE.DataTexture | null;
  /** scene.environmentRotation.y that aligns the IBL sun with the dome's */
  envRotationY(biome: BiomeId): number;
  /** biome cross-fade state at a given camera z (from -> to by t in [0,1]) */
  biomeAt(z: number): BiomeBlend;
  /** 0..1 alien-sky weight (mirror biome share), eased; drives moon/asteroid fade */
  mirrorFactor(): number;
}

export interface BiomeBlend {
  from: BiomeId;
  to: BiomeId;
  t: number;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position; // dome is camera-centred; object space = view direction
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform sampler2D uSkyA;
  uniform sampler2D uSkyB;
  uniform float uMix;
  uniform float uOffA; // equirect u offset aligning the HDRI sun azimuth
  uniform float uOffB;
  uniform vec2 uTuneA; // x: radiance gain, y: clamp (bloom economy)
  uniform vec2 uTuneB;
  uniform vec3 uSunDir;
  uniform sampler2D uBackdropA;
  uniform sampler2D uBackdropB;
  uniform float uBackdropStrength;
  uniform float uBackdropBiasA;
  uniform float uBackdropBiasB;
  uniform float uBackGainA;
  uniform float uBackGainB;
  uniform float uSunGainA;
  uniform float uSunGainB;
  uniform float uMirror; // 0..1 cross-fade into the Mirror World's alien sky
  uniform float uTime;   // shared seconds clock (star twinkle / nebula drift / meteors)
  varying vec3 vDir;

  vec3 sampleSky(sampler2D map, vec3 dir, float uOff, vec2 tune) {
    vec2 uv = vec2(
      atan(dir.z, dir.x) * 0.15915494 + 0.5 + uOff,
      asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);
    return min(texture2D(map, uv).rgb * tune.x, vec3(tune.y));
  }

  float hash12(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  vec3 sampleBackdrop(sampler2D map, vec3 dir, float yBias) {
    float flatLen = max(length(dir.xz), 0.08);
    vec2 flatDir = dir.xz / flatLen;
    float u = atan(flatDir.y, flatDir.x) * 0.15915494 + 0.5;
    float h = dir.y / flatLen;
    float v = clamp(0.36 + h * 0.32 + yBias, 0.0, 1.0);
    vec3 col = texture2D(map, vec2(u, v)).rgb;
    float skyMask = smoothstep(0.54, 0.9, v);
    float brush = noise2(vec2(u * 22.0, v * 9.0)) * 0.55
      + noise2(vec2(u * 47.0 + 11.0, v * 18.0 + 3.0)) * 0.45;
    float cloudLift = smoothstep(0.58, 0.92, brush) * skyMask * 0.08;
    col += (brush - 0.5) * skyMask * 0.045;
    col = mix(col, col + vec3(0.09, 0.085, 0.075), cloudLift);
    return col;
  }

  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise2(p); p *= 2.02; a *= 0.5; }
    return s;
  }

  // One hashed star layer: quantize the equirect cell coord, place one star per
  // populated cell at a sub-cell jitter. Returns coverage in [0,1]; writes the
  // cell id so the caller can hash per-star colour/twinkle. Rock-stable (no crawl).
  float starCell(vec2 cellUV, vec2 density, float fill, float radius, out vec2 cell) {
    cell = floor(cellUV * density);
    float present = step(hash12(cell + 0.5), fill);
    // keep the star centre in the middle half of the cell so its point never
    // clips against the cell boundary (which reads as a boxy artifact)
    vec2 sub = 0.25 + 0.5 * vec2(hash12(cell + 1.7), hash12(cell + 4.3));
    vec2 d = fract(cellUV * density) - sub;
    return present * smoothstep(radius, 0.0, length(d));
  }

  // ---- The Sundered Orrery: procedural alien night for the Mirror World ----
  // Drawn additively over the pure-black mirror HDRI. Intensity caps are pinned
  // to the bloom economy (nebula<=0.28, band<=0.12) so the frame never hazes.
  vec3 mirrorSky(vec3 dir) {
    const vec3 VOID   = vec3(0.0196, 0.0235, 0.0471); // #05060c zenith
    const vec3 ASH    = vec3(0.0784, 0.0706, 0.1451); // #141225 low sky
    const vec3 VIOLET = vec3(0.1255, 0.1137, 0.2196); // #201d38 = scene fog
    const vec3 AMETH  = vec3(0.4784, 0.3569, 0.6902); // #7a5bb0 nebula body
    const vec3 COBALT = vec3(0.3725, 0.4706, 0.7686); // #5f78c4 nebula edge
    const vec3 ROSE   = vec3(0.7216, 0.3294, 0.4941); // #b8547e warm knots
    const vec3 SILVER = vec3(0.7843, 0.8314, 0.9255); // #c8d4ec star/moon light
    const vec3 AMBER  = vec3(0.8471, 0.7059, 0.4784); // #d8b47a rare warm
    const vec3 TEAL   = vec3(0.2471, 0.6039, 0.5804); // #3f9a94 rare cool-green

    // (a) gradient: void at zenith -> ash at horizon + a violet mist-bleed that
    // welds the dome to the scene fog exactly at the horizon line
    float horizonT = pow(1.0 - max(dir.y, 0.0), 2.5);
    vec3 col = mix(VOID, ASH, horizonT);
    col += VIOLET * smoothstep(0.10, -0.05, dir.y) * 0.6;

    // (b) projections: stereographic for clouds/belt, equirect cells for stars
    vec2 p = dir.xz / (dir.y + 1.2);
    vec2 cellUV = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5,
                       asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);

    // a faint all-sky colour wash so the void reads as alien atmosphere, not
    // flat blue, even far from the river
    float wash = fbm(p * 0.5 + 11.0);
    col += mix(AMETH, TEAL, smoothstep(0.35, 0.75, wash)) * 0.045 * smoothstep(0.25, 0.8, wash);

    // (c) galactic band — the one reused mask (band glow + nebula veins + swell)
    vec3 nBand = normalize(vec3(0.35, 0.82, 0.45));
    float bd = abs(dot(dir, nBand));
    float band = 1.0 - smoothstep(0.0, 0.32, bd);
    band *= 0.5 + 0.5 * fbm(p * 2.2);                              // dust mottle
    band *= 1.0 - 0.5 * smoothstep(0.06, 0.0, abs(bd - 0.02));     // great-rift lane
    col += mix(SILVER, AMETH, 0.6) * band * 0.20;

    // (d) nebula — two fbm layers; a domain-mirrored echo breathes past the body,
    // warm knots ignite only along the river
    float fA = fbm(p * 1.4 + vec2(uTime * 0.006, 0.0));
    float dens = smoothstep(0.40, 0.78, fA);
    vec3 colA = mix(AMETH, COBALT, fbm(p * 0.7)) * dens;
    float fB = fbm(vec2(-p.x, p.y) * 3.1 - vec2(uTime * 0.005, 0.0));
    float veins = smoothstep(0.70, 0.96, fB) * dens * (0.3 + 0.7 * band);
    vec3 nebula = (colA + ROSE * veins * 0.7) * (0.45 + 0.55 * band);
    col += min(nebula, vec3(0.42)) * 0.9;

    // (e) stars — three quantized hashed layers. radius is a small fraction of a
    // cell so each star is a crisp point, not a cell-filling blob.
    vec2 cell;
    // L1: faint dense depth field (no twinkle), rare warm/cobalt tint
    float s1 = starCell(cellUV, vec2(760.0, 380.0), 0.55, 0.10, cell);
    float t1 = hash12(cell + 2.1);
    vec3 c1 = t1 > 0.975 ? AMBER : (t1 > 0.9 ? COBALT : SILVER);
    col += c1 * s1 * (0.12 + 0.24 * hash12(cell + 3.3));
    // L2: mid/bright, slow uncorrelated twinkle + diffraction cross on brightest
    vec2 dens2 = vec2(230.0, 115.0);
    vec2 cell2 = floor(cellUV * dens2);
    float present2 = step(hash12(cell2 + 0.5), 0.22);
    vec2 d2 = fract(cellUV * dens2) - (0.3 + 0.4 * vec2(hash12(cell2 + 1.7), hash12(cell2 + 4.3)));
    float bright = hash12(cell2 + 5.1);
    float tw = 0.74 + 0.26 * sin(uTime * (0.6 + 1.1 * hash12(cell2 + 6.2)) + hash12(cell2) * 6.2831);
    float star2 = smoothstep(0.16, 0.0, length(d2));
    if (bright > 0.86) {
      star2 += (smoothstep(0.28, 0.0, abs(d2.x)) * smoothstep(0.04, 0.0, abs(d2.y))
              + smoothstep(0.28, 0.0, abs(d2.y)) * smoothstep(0.04, 0.0, abs(d2.x))) * 0.5;
    }
    col += SILVER * present2 * star2 * (0.4 + 0.5 * bright) * tw;
    // L3: band stars — unresolved density swells inside the river so the
    // galactic band reads as made of stars, not just painted glow
    float s3 = starCell(cellUV, vec2(560.0, 280.0), 0.72, 0.12, cell) * band;
    col += mix(SILVER, COBALT, 0.3) * s3 * (0.32 + 0.5 * hash12(cell + 8.4));

    // (f) asteroid belt arc — its own great circle, a fine hashed stipple of
    // rock points (not full cells), lit toward the sun
    vec3 nBelt = normalize(vec3(-0.5, 0.6, 0.3));
    float belt = smoothstep(0.055, 0.0, abs(dot(dir, nBelt))) * step(0.0, dir.y);
    float stip = starCell(cellUV, vec2(620.0, 310.0), 0.45, 0.15, cell);
    float lit = 0.55 + 0.45 * max(dot(dir, uSunDir), 0.0);
    col += mix(SILVER, AMBER, 0.4) * belt * stip * 0.65 * lit;

    // (g) meteor — one deterministic shooting star per ~4.5s epoch
    float epoch = floor(uTime / 4.5);
    float life = fract(uTime / 4.5);
    if (life < 0.2) {
      vec2 mStart = vec2(hash12(vec2(epoch, 1.0)), hash12(vec2(epoch, 2.0)));
      vec2 mDir = normalize(vec2(hash12(vec2(epoch, 3.0)) - 0.5, hash12(vec2(epoch, 4.0)) - 0.5));
      vec2 head = mStart + mDir * (life / 0.2) * 0.6;
      vec2 rel = cellUV - head;
      float along = dot(rel, mDir);
      float perp = abs(dot(rel, vec2(-mDir.y, mDir.x)));
      float trail = smoothstep(0.0018, 0.0, perp) * smoothstep(0.14, 0.0, -along) * step(along, 0.0);
      float headGlow = smoothstep(0.01, 0.0, length(rel));
      col += SILVER * (trail * 0.6 + headGlow) * step(0.0, dir.y);
    }

    // (h) the galactic heart — a warm luminous core sitting LOW on the horizon
    // (the dream-world "sun" of the reference), placed on SUN_DIR's azimuth so it
    // blazes back off the Mirrormere. A blazing gold centre, a gold bloom, and a
    // broad rose aura that warms the surrounding galaxy toward it and cools away
    // — the reference's warm-heart / cool-edges spread.
    vec3 coreDir = normalize(vec3(uSunDir.x, 0.22, uSunDir.z));
    float cd = max(dot(dir, coreDir), 0.0);
    const vec3 CORE_HOT  = vec3(1.0, 0.96, 0.82); // gold-white heart
    const vec3 CORE_GOLD = vec3(1.0, 0.70, 0.36); // warm bloom
    const vec3 CORE_ROSE = vec3(0.98, 0.30, 0.52); // saturated rose-magenta aura
    float heart = pow(cd, 120.0);
    float bloom = pow(cd, 16.0);
    float aura = pow(cd, 5.0); // tight, so the rest of the galaxy stays dark
    // star-forming shimmer riding the aura so the heart reads as a galaxy core
    float shimmer = 0.65 + 0.35 * fbm(p * 3.0 + vec2(0.0, uTime * 0.01));
    col += CORE_HOT * heart * 1.25;
    col += CORE_GOLD * bloom * 0.6 * shimmer;
    col += CORE_ROSE * aura * 0.26 * shimmer;

    // die into the fog below the horizon (no seam)
    return col * smoothstep(-0.12, 0.02, dir.y);
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 c = mix(sampleSky(uSkyA, dir, uOffA, uTuneA), sampleSky(uSkyB, dir, uOffB, uTuneB), uMix);
    vec3 backA = sampleBackdrop(uBackdropA, dir, uBackdropBiasA) * uBackGainA;
    vec3 backB = sampleBackdrop(uBackdropB, dir, uBackdropBiasB) * uBackGainB;
    vec3 backdrop = mix(backA, backB, uMix);
    c = mix(c, backdrop, uBackdropStrength);
    float sunGain = mix(uSunGainA, uSunGainB, uMix);
    float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 8.0);
    c += vec3(1.0, 0.85, 0.6) * sunAmt * 0.3 * sunGain;              // warm glow around the anchor sun
    float sunCore = pow(max(dot(dir, uSunDir), 0.0), 90.0);
    c += vec3(1.0, 0.92, 0.75) * sunCore * 0.5 * sunGain;            // tighter bright core
    // The Mirror World: the black HDRI is replaced by the procedural alien sky,
    // cross-faded in by uMirror. Other biomes have uMirror=0 and skip it entirely.
    if (uMirror > 0.001) c += mirrorSky(dir) * uMirror;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Cross-fade state across the same ±30/35u zone windows the terrain palette
// uses, keyed by camera z. Boundaries are sequential, so two maps suffice.
function biomeBlendAt(z: number): BiomeBlend {
  let from: BiomeId = ZONES[0].biome;
  let to: BiomeId = ZONES[0].biome;
  let t = 0;
  for (let i = 0; i + 1 < ZONES.length; i++) {
    const b = ZONES[i].zMax;
    const raw = Math.max(0, Math.min(1, (z - (b - 30)) / 65));
    const tt = raw * raw * (3 - 2 * raw);
    if (tt <= 0) break;
    if (tt >= 1) {
      from = ZONES[i + 1].biome;
      to = from;
      t = 0;
    } else {
      to = ZONES[i + 1].biome;
      t = tt;
    }
  }
  return { from, to, t };
}

// u offset that moves a given HDRI's sun azimuth onto SUN_ANCHOR's azimuth
function sunOffsetU(biome: BiomeId, sunDir: THREE.Vector3): number {
  const sunU = Math.atan2(sunDir.z, sunDir.x) / (2 * Math.PI) + 0.5;
  return HDRI_SUN_U[biome] - sunU;
}

// How much of the current biome blend is the Mirror World (0..1). Drives the
// alien-sky uMirror uniform so it eases in on the same window the palette uses.
function mirrorWeight(blend: BiomeBlend): number {
  return (blend.from === 'mirror' ? 1 - blend.t : 0) + (blend.to === 'mirror' ? blend.t : 0);
}

export function buildSky(lowGfx: boolean, sunDir: THREE.Vector3): SkyView {
  if (lowGfx || !hasSkyHdriAssets()) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 24, 16),
      new THREE.MeshBasicMaterial({
        map: skyTexture(),
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    dome.renderOrder = -10;
    // The gradient-dome tier has no shader, so the procedural alien sky can't be
    // painted here (the low-tier sky is dominated by fog, not the dome material).
    // We still track the mirror cross-fade so the three moon + asteroid sprites
    // (which are tier-independent) fade in/out on low/mobile too. A baked starry
    // low-tier sky is a deferred follow-up (needs the low-tier fog/dome pipeline).
    let lowMirror = 0;
    return {
      dome,
      setCameraZ: (z: number, dt: number) => {
        lowMirror += (mirrorWeight(biomeBlendAt(z)) - lowMirror) * (1 - Math.exp(-dt * 3));
      },
      envTexture: () => null,
      envRotationY: () => 0,
      biomeAt: biomeBlendAt,
      mirrorFactor: () => lowMirror,
    };
  }

  const sun = sunDir.clone().normalize();
  const backdropsReady = hasBackdropAssets();
  const tuneVec = (b: BiomeId): THREE.Vector2 =>
    new THREE.Vector2(HDRI_TUNE[b].gain, HDRI_TUNE[b].clamp);
  const backdropTex = (b: BiomeId): THREE.Texture =>
    (backdropsReady ? backdropStore[b] : hdriStore[b]) as THREE.Texture;
  const start = biomeBlendAt(0);
  const uniforms = {
    uSkyA: { value: hdriStore[start.from] as THREE.Texture },
    uSkyB: { value: hdriStore[start.to] as THREE.Texture },
    uMix: { value: start.t },
    uOffA: { value: sunOffsetU(start.from, sun) },
    uOffB: { value: sunOffsetU(start.to, sun) },
    uTuneA: { value: tuneVec(start.from) },
    uTuneB: { value: tuneVec(start.to) },
    uSunDir: { value: sun },
    uBackdropA: { value: backdropTex(start.from) },
    uBackdropB: { value: backdropTex(start.to) },
    uBackdropStrength: { value: backdropsReady ? 1 : 0 },
    uBackdropBiasA: { value: BACKDROP_Y_BIAS[start.from] },
    uBackdropBiasB: { value: BACKDROP_Y_BIAS[start.to] },
    uBackGainA: { value: BACKDROP_GAIN[start.from] },
    uBackGainB: { value: BACKDROP_GAIN[start.to] },
    uSunGainA: { value: SUN_GLOW_GAIN[start.from] },
    uSunGainB: { value: SUN_GLOW_GAIN[start.to] },
    // Alien-sky cross-fade weight, driven each frame from the mirror biome blend.
    uMirror: { value: mirrorWeight(start) },
    // Shared seconds clock (ticked by the renderer) — twinkle / drift / meteors.
    uTime: sharedUniforms.uTime,
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 20), material);
  dome.renderOrder = -10;

  let cur = start;
  return {
    dome,
    setCameraZ(z: number, dt: number): void {
      const next = biomeBlendAt(z);
      // Ease the alien-sky weight toward the mirror share of the blend every
      // frame (same gentle chase as uMix so teleports don't pop the sky).
      uniforms.uMirror.value +=
        (mirrorWeight(next) - uniforms.uMirror.value) * (1 - Math.exp(-dt * 3));
      if (next.from !== cur.from || next.to !== cur.to) {
        uniforms.uSkyA.value = hdriStore[next.from] as THREE.Texture;
        uniforms.uSkyB.value = hdriStore[next.to] as THREE.Texture;
        uniforms.uOffA.value = sunOffsetU(next.from, sun);
        uniforms.uOffB.value = sunOffsetU(next.to, sun);
        uniforms.uTuneA.value.copy(tuneVec(next.from));
        uniforms.uTuneB.value.copy(tuneVec(next.to));
        uniforms.uBackdropA.value = backdropTex(next.from);
        uniforms.uBackdropB.value = backdropTex(next.to);
        uniforms.uBackdropBiasA.value = BACKDROP_Y_BIAS[next.from];
        uniforms.uBackdropBiasB.value = BACKDROP_Y_BIAS[next.to];
        uniforms.uBackGainA.value = BACKDROP_GAIN[next.from];
        uniforms.uBackGainB.value = BACKDROP_GAIN[next.to];
        uniforms.uSunGainA.value = SUN_GLOW_GAIN[next.from];
        uniforms.uSunGainB.value = SUN_GLOW_GAIN[next.to];
        uniforms.uMix.value = next.t;
        cur = next;
        return;
      }
      // same pair: chase the spatial mix gently so fast travel/teleports
      // still ease over ~a second instead of popping
      const k = 1 - Math.exp(-dt * 3);
      uniforms.uMix.value += (next.t - uniforms.uMix.value) * k;
      cur = next;
    },
    envTexture(biome: BiomeId): THREE.DataTexture | null {
      return hdriStore[biome] ?? null;
    },
    envRotationY(biome: BiomeId): number {
      // dome samples at u + off. three r165 negates environmentRotation
      // before building the PMREM lookup matrix ("accommodate left-handed
      // frame", WebGLMaterials.js), so the effective lookup azimuth is
      // alpha + theta — matching the dome needs theta = +off*2pi. (A negated
      // value lands the env sun 2x the offset away from the dome's.)
      return sunOffsetU(biome, sun) * 2 * Math.PI;
    },
    biomeAt: biomeBlendAt,
    mirrorFactor: () => uniforms.uMirror.value,
  };
}

export interface CloudLayer {
  sprites: THREE.Sprite[];
}

// Cloud sprites. Low tier keeps the full painted layer over its gradient
// dome. High tier: the HDRIs carry photographic cloud cover, so the cumulus
// sprite deck is retired — only a faint, slow cirrus layer remains for
// parallax/motion against the static sky.
export function buildClouds(lowGfx: boolean): CloudLayer {
  const variants = lowGfx
    ? [cloudTexture()]
    : [cloudTexture(14, 0.5), cloudTexture(8, 0.7), cloudTexture(20, 0.42)];
  const sprites: THREE.Sprite[] = [];
  const span = WORLD_MAX_Z - WORLD_MIN_Z + 240;

  const spawn = (
    count: number,
    yMin: number,
    yMax: number,
    baseOpacity: number,
    drift: number,
    scaleMin: number,
    scaleMax: number,
  ): void => {
    for (let i = 0; i < count; i++) {
      const y = yMin + Math.random() * (yMax - yMin);
      // higher clouds thin out
      const altFade = 1 - 0.35 * ((y - yMin) / Math.max(1, yMax - yMin));
      const mat = new THREE.SpriteMaterial({
        map: variants[i % variants.length],
        transparent: true,
        opacity: baseOpacity * altFade,
        fog: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const sc = scaleMin + Math.random() * (scaleMax - scaleMin);
      sprite.scale.set(sc, sc * 0.45, 1);
      sprite.position.set((Math.random() - 0.5) * 600, y, WORLD_MIN_Z - 120 + Math.random() * span);
      sprite.userData.drift = drift;
      sprites.push(sprite);
    }
  };

  if (lowGfx) {
    spawn(14, 95, 150, 0.85, 1.6, 60, 150);
  } else {
    spawn(5, 165, 195, 0.3, 0.55, 140, 240); // high slow cirrus layer only
  }
  return { sprites };
}
