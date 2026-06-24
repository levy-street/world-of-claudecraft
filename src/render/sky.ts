import * as THREE from 'three';
import { WORLD_MAX_Z, WORLD_MIN_Z, ZONES } from '../sim/data';
import type { BiomeId } from '../sim/types';
import { loadHdr, loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';
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
};

const BIOME_HDRI_2K: Record<BiomeId, string> = {
  vale: '/env/vale_day_2k.hdr',
  marsh: '/env/marsh_overcast_2k.hdr',
  peaks: '/env/peaks_dawn_2k.hdr',
};

const BIOME_HDRI_1K: Record<BiomeId, string> = {
  vale: '/env/vale_day_1k.hdr',
  marsh: '/env/marsh_overcast_1k.hdr',
  peaks: '/env/peaks_dawn_1k.hdr',
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
      if (matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 900px)').matches) return true;
    }
  }
  return false;
}

const BIOME_HDRI = shouldUseLiteHdri() ? BIOME_HDRI_1K : BIOME_HDRI_2K;

const BIOME_BACKDROP_8K: Record<BiomeId, string> = {
  vale: '/env/vale_backdrop.webp',
  marsh: '/env/marsh_backdrop.webp',
  peaks: '/env/peaks_backdrop.webp',
};

const BIOME_BACKDROP_4K: Record<BiomeId, string> = {
  vale: '/env/vale_backdrop_4k.webp',
  marsh: '/env/marsh_backdrop_4k.webp',
  peaks: '/env/peaks_backdrop_4k.webp',
};

const BACKDROP_Y_BIAS: Record<BiomeId, number> = {
  vale: 0,
  marsh: 0,
  peaks: 0,
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
    if (connection?.effectiveType && ['slow-2g', '2g', '3g'].includes(connection.effectiveType)) return true;
    if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) return true;
    if (nav.maxTouchPoints > 0 && typeof matchMedia !== 'undefined') {
      if (matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 900px)').matches) return true;
    }
  }
  return false;
}

const BIOME_BACKDROP = shouldUseLiteBackdrop() ? BIOME_BACKDROP_4K : BIOME_BACKDROP_8K;

// Measured brightest-texel u (sun azimuth in equirect space) per HDRI — see
// tmp/analyze_hdr.mjs. Used to rotate each map so its sun matches SUN_ANCHOR.
const HDRI_SUN_U: Record<BiomeId, number> = { vale: 0.595, marsh: 0.657, peaks: 0.631 };

const hdriStore: Partial<Record<BiomeId, THREE.DataTexture>> = {};
const backdropStore: Partial<Record<BiomeId, THREE.Texture>> = {};
// 2K HDRs are ~17MB on disk; 1K is ~4MB. Pick the lighter set for phone /
// low-memory browser sessions before preload starts, and skip entirely when
// the URL already forces the gradient-dome tier. An auto-detected software-GL
// low tier can only be known after WebGL context creation, which happens after
// preload, so this best-effort device gate keeps mobile out of the worst path.
if (GFX.standardMaterials) {
  for (const biome of Object.keys(BIOME_HDRI) as BiomeId[]) {
    registerPreload(loadHdr(BIOME_HDRI[biome]).then((tex) => {
      tex.wrapS = THREE.RepeatWrapping; // azimuth rotation needs u to wrap
      hdriStore[biome] = tex;
      return tex;
    }));
    registerPreload(loadTexture(BIOME_BACKDROP[biome], { srgb: true }).then((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      backdropStore[biome] = tex;
      return tex;
    }).catch(() => undefined));
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

  void main() {
    vec3 dir = normalize(vDir);
    vec3 c = mix(sampleSky(uSkyA, dir, uOffA, uTuneA), sampleSky(uSkyB, dir, uOffB, uTuneB), uMix);
    vec3 backA = sampleBackdrop(uBackdropA, dir, uBackdropBiasA);
    vec3 backB = sampleBackdrop(uBackdropB, dir, uBackdropBiasB);
    vec3 backdrop = mix(backA, backB, uMix);
    c = mix(c, backdrop, uBackdropStrength);
    float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 8.0);
    c += vec3(1.0, 0.85, 0.6) * sunAmt * 0.3;                        // warm glow around the anchor sun
    float sunCore = pow(max(dot(dir, uSunDir), 0.0), 90.0);
    c += vec3(1.0, 0.92, 0.75) * sunCore * 0.5;                      // tighter bright core
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

export function buildSky(lowGfx: boolean, sunDir: THREE.Vector3): SkyView {
  if (lowGfx || !hasSkyHdriAssets()) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    dome.renderOrder = -10;
    return {
      dome,
      setCameraZ: () => {},
      envTexture: () => null,
      envRotationY: () => 0,
      biomeAt: biomeBlendAt,
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
  const span = (WORLD_MAX_Z - WORLD_MIN_Z) + 240;

  const spawn = (count: number, yMin: number, yMax: number, baseOpacity: number, drift: number, scaleMin: number, scaleMax: number): void => {
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
      sprite.position.set(
        (Math.random() - 0.5) * 600,
        y,
        WORLD_MIN_Z - 120 + Math.random() * span,
      );
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
