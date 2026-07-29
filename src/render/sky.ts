import * as THREE from 'three';
import { COLUMN_ZONES, columnBlendAt, STRIP_ZONES } from '../sim/data';
import type { BiomeId } from '../sim/types';
import { SOWFIELD_CENTER } from '../sim/vale_cup_layout';
import { loadHdr, loadTexture } from './assets/loader';
import { BIOME_HAZE_DECLARATIONS, biomeHazeUniforms, hasBiomeHazeField } from './biome_haze_field';
import { HAZE_SKY_SAMPLE_DIST, HAZE_SKY_TINT_MAX } from './biome_haze_field_core';
import {
  createEnvironmentBlend,
  SKY_ENVIRONMENT_RESPONSE,
  stepEnvironmentBlend,
} from './environment_transition_core';
import { GFX, type GfxSettings } from './gfx';
import { skyTexture } from './textures';

// HDRI sky dome. Cloud cover comes from the sky HDRIs themselves; there is
// no separate sprite cloud layer.
//
// High tier: the dome fragment shader samples real Poly Haven equirect HDRIs
// (one per biome) by view direction, cross-fading two maps across the same
// zone-boundary windows the terrain palette uses. Each HDRI's sample is
// rotated in azimuth so its real sun sits at SUN_ANCHOR's azimuth, the one
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
export const SKY_BACKGROUND_RENDER_ORDER = 1000;
const SKY_FAR_DEPTH = 'gl_Position.z = gl_Position.w;';

// The photographic HDRIs run hot next to the old procedural dome (sky bands
// 0.5-2.5 radiance, sun texels ~60000): unscaled they shove most of the sky
// past the 0.85 bloom threshold and the whole frame hazes out. Per-biome
// gain brings the open sky back under the bloom economy; the clamp leaves
// just enough headroom for the sun region to bloom like the old glow lobes
// did. The dawn HDRI carries a huge horizon-level sun glow, so the peaks get
// reined in harder or half the sky white-outs. The renderer's PMREM capture
// samples the same shader, so IBL stays in step.
//
// contrast (optional, default 1) is a pivot curve applied after the gain and
// before the clamp: values below the 0.8 pivot deepen and cloud shading above
// it spreads back out, recovering the texture detail the ACES highlight
// shoulder otherwise flattens to a white wash. Raise it per biome by eye.
// Two skies are keyed by PLACE rather than biome: the Farshore isle's own
// day sky over the vale band, and the Vale Cup stadium's practice sky over
// the Sowfield. They ride the same tables under widened keys.
export type SkyKey = BiomeId | 'farshore' | 'vale_cup';

const HDRI_TUNE: Record<SkyKey, { gain: number; clamp: number; contrast?: number }> = {
  // clamp reined in from 2.6 with the contrast pass, so the re-expanded cloud
  // tops do not just feed the bloom smear instead
  vale: { gain: 0.6, clamp: 2.0, contrast: 1.25 },
  marsh: { gain: 0.6, clamp: 2.2 },
  peaks: { gain: 0.48, clamp: 1.7, contrast: 1.15 },
  // Paint-only biomes reuse the closest shipped sky (no new HDRI downloads).
  beach: { gain: 0.6, clamp: 2.6, contrast: 1.15 },
  desert: { gain: 0.55, clamp: 2.2 },
  volcano: { gain: 0.5, clamp: 2.0 },
  cave: { gain: 0.55, clamp: 2.0 },
  // the five realm skies are project-generated with their moods baked in
  // (storm-dark ember, dim frost twilight), so their gains sit close to the
  // vale's day instead of re-dimming an already-graded image.
  // The day skies take the vale's contrast treatment (pivot 0.8 in the dome
  // shader): it deepens the zenith against the horizon so the sky reads as a
  // gradient with a sun in it rather than one flat blue; the mood-dark skies
  // (ember, haunt, frost) are left alone so their murk stays lifted.
  dusk: { gain: 0.55, clamp: 2.2 },
  ember: { gain: 0.5, clamp: 2.0 },
  frost: { gain: 0.5, clamp: 2.0 },
  amber: { gain: 0.55, clamp: 2.2, contrast: 1.1 },
  fen: { gain: 0.6, clamp: 2.6, contrast: 1.15 },
  // the Nightbloom's dream sky is project-generated like its siblings
  night: { gain: 0.55, clamp: 2.2 },
  // the Wraithwood's storm gloom is project-generated with the darkness
  // baked in; the clamp still reins in the dying sun's water lane
  haunt: { gain: 0.6, clamp: 1.8 },
  // the Palmreach's own tropical day sky (skies_in/palmreach.png), graded
  // like the fen's bright day
  jungle: { gain: 0.62, clamp: 2.6, contrast: 1.15 },
  // the Evergarden's own day sky (skies_in/evergarden.png)
  garden: { gain: 0.6, clamp: 2.6, contrast: 1.15 },
  // the Galecrest's own storm-light sky (skies_in/galecrest.png)
  gale: { gain: 0.6, clamp: 2.6, contrast: 1.1 },
  // the Farshore's own day sky and the Vale Cup practice sky, graded bright
  farshore: { gain: 0.6, clamp: 2.6, contrast: 1.15 },
  vale_cup: { gain: 0.6, clamp: 2.6 },
};

// Every zone biome carries its own project-generated sky (skies_in/ sources,
// converted by the local RGBE pipeline), one HDRI per zone; only the four
// paint-only biomes (beach/desert/volcano/cave) alias a shipped neighbour.
// The realm skies have clean ocean horizons: no baked land, so no lift and
// no tint hacks.
const BIOME_HDRI_2K: Record<SkyKey, string> = {
  vale: '/env/vale_day_2k.hdr',
  marsh: '/env/marsh_overcast_2k.hdr',
  peaks: '/env/peaks_dawn_2k.hdr',
  beach: '/env/vale_day_2k.hdr',
  desert: '/env/peaks_dawn_2k.hdr',
  volcano: '/env/marsh_overcast_2k.hdr',
  cave: '/env/marsh_overcast_2k.hdr',
  dusk: '/env/hollow_dusk_2k.hdr',
  ember: '/env/ember_storm_2k.hdr',
  frost: '/env/frost_twilight_2k.hdr',
  amber: '/env/amber_sunset_2k.hdr',
  fen: '/env/fen_day_2k.hdr',
  night: '/env/nightbloom_dream_2k.hdr',
  haunt: '/env/wraithwood_gloom_2k.hdr',
  jungle: '/env/palmreach_day_2k.hdr',
  garden: '/env/evergarden_day_2k.hdr',
  gale: '/env/galecrest_day_2k.hdr',
  farshore: '/env/farshore_day_2k.hdr',
  vale_cup: '/env/vale_cup_2k.hdr',
};

const BIOME_HDRI_1K: Record<SkyKey, string> = {
  vale: '/env/vale_day_1k.hdr',
  marsh: '/env/marsh_overcast_1k.hdr',
  peaks: '/env/peaks_dawn_1k.hdr',
  beach: '/env/vale_day_1k.hdr',
  desert: '/env/peaks_dawn_1k.hdr',
  volcano: '/env/marsh_overcast_1k.hdr',
  cave: '/env/marsh_overcast_1k.hdr',
  dusk: '/env/hollow_dusk_1k.hdr',
  ember: '/env/ember_storm_1k.hdr',
  frost: '/env/frost_twilight_1k.hdr',
  amber: '/env/amber_sunset_1k.hdr',
  fen: '/env/fen_day_1k.hdr',
  night: '/env/nightbloom_dream_1k.hdr',
  haunt: '/env/wraithwood_gloom_1k.hdr',
  jungle: '/env/palmreach_day_1k.hdr',
  garden: '/env/evergarden_day_1k.hdr',
  gale: '/env/galecrest_day_1k.hdr',
  farshore: '/env/farshore_day_1k.hdr',
  vale_cup: '/env/vale_cup_1k.hdr',
};

function shouldUseLiteHdri(): boolean {
  if (typeof location !== 'undefined') {
    const params = new URLSearchParams(location.search);
    const forced = params.get('gfx');
    if (params.has('lowgfx') || forced === 'low') return true;
    if (forced === 'high' || forced === 'ultra' || forced === 'insane') return false;
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

const BIOME_BACKDROP_8K: Record<SkyKey, string> = {
  vale: '/env/vale_backdrop.webp',
  marsh: '/env/marsh_backdrop.webp',
  peaks: '/env/peaks_backdrop.webp',
  beach: '/env/vale_backdrop.webp',
  desert: '/env/peaks_backdrop.webp',
  volcano: '/env/peaks_backdrop.webp',
  cave: '/env/marsh_backdrop.webp',
  dusk: '/env/peaks_backdrop.webp',
  ember: '/env/peaks_backdrop.webp',
  frost: '/env/vale_backdrop.webp',
  amber: '/env/peaks_backdrop.webp',
  fen: '/env/vale_backdrop.webp',
  night: '/env/vale_backdrop.webp', // never shown: backdrop strength 0
  haunt: '/env/marsh_backdrop.webp', // never shown: backdrop strength 0
  jungle: '/env/vale_backdrop.webp', // never shown: backdrop strength 0
  garden: '/env/vale_backdrop.webp', // never shown: backdrop strength 0
  gale: '/env/vale_backdrop.webp', // never shown: backdrop strength 0,
  farshore: '/env/vale_backdrop.webp',
  vale_cup: '/env/vale_backdrop.webp',
};

const BIOME_BACKDROP_4K: Record<SkyKey, string> = {
  vale: '/env/vale_backdrop_4k.webp',
  marsh: '/env/marsh_backdrop_4k.webp',
  peaks: '/env/peaks_backdrop_4k.webp',
  beach: '/env/vale_backdrop_4k.webp',
  desert: '/env/peaks_backdrop_4k.webp',
  volcano: '/env/peaks_backdrop_4k.webp',
  cave: '/env/marsh_backdrop_4k.webp',
  dusk: '/env/peaks_backdrop_4k.webp',
  ember: '/env/peaks_backdrop_4k.webp',
  frost: '/env/vale_backdrop_4k.webp',
  amber: '/env/peaks_backdrop_4k.webp',
  fen: '/env/vale_backdrop_4k.webp',
  night: '/env/vale_backdrop_4k.webp',
  haunt: '/env/marsh_backdrop_4k.webp',
  jungle: '/env/vale_backdrop_4k.webp',
  garden: '/env/vale_backdrop_4k.webp',
  gale: '/env/vale_backdrop_4k.webp',
  farshore: '/env/vale_backdrop_4k.webp',
  vale_cup: '/env/vale_backdrop_4k.webp',
};

const BACKDROP_Y_BIAS: Record<SkyKey, number> = {
  vale: 0,
  marsh: 0,
  peaks: 0,
  beach: 0,
  desert: 0,
  volcano: 0,
  cave: 0,
  dusk: 0,
  ember: 0,
  frost: 0,
  amber: 0,
  fen: 0,
  night: 0,
  haunt: 0,
  jungle: 0,
  garden: 0,
  gale: 0,
  farshore: 0,
  vale_cup: 0,
};

// How strongly the painted horizon backdrop shows per biome. At 1 the painted
// panorama REPLACES the HDRI across the whole dome, so every zone now drops it
// (0): the project HDRI skies are the one sky source everywhere, matching the
// realms, whose border mountains are real geometry and whose open sea must
// meet clear sky at the horizon, not a painted mountain ring.
const BIOME_BACKDROP_STRENGTH: Record<SkyKey, number> = {
  vale: 0,
  marsh: 0,
  peaks: 0,
  // paint-only biomes alias the southern zones and follow them
  beach: 0,
  desert: 0,
  volcano: 0,
  cave: 0,
  dusk: 0,
  ember: 0,
  frost: 0,
  amber: 0,
  // no backdrop: it hid the day sky's low cloud bank; the fen keeps the
  // whole cloudscape (the lift alone was the streak culprit, and it is off)
  fen: 0,
  night: 0,
  haunt: 0,
  jungle: 0,
  garden: 0,
  gale: 0,
  farshore: 0,
  vale_cup: 0,
};

// Lift masks a horizon band PHOTOGRAPHED into an HDRI (the dawn sky's red
// hills) by resampling low view angles from just above the ridge line. The
// realm skies are generated with clean ocean horizons, so nothing lifts:
// lift also smears bold clouds into vertical streaks near the ground.
const BIOME_HORIZON_LIFT: Record<SkyKey, number> = {
  vale: 0,
  marsh: 0,
  peaks: 0,
  beach: 0,
  desert: 0,
  volcano: 0,
  cave: 0,
  dusk: 0,
  ember: 0,
  frost: 0,
  amber: 0,
  fen: 0,
  night: 0,
  haunt: 0,
  jungle: 0,
  garden: 0,
  gale: 0,
  farshore: 0,
  vale_cup: 0,
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

// Measured brightest-texel u (sun azimuth in equirect space) per HDRI, used
// to rotate each map so its sun matches SUN_ANCHOR. Poly Haven values via
// tmp/analyze_hdr.mjs; realm-sky values printed by the conversion pipeline
// (the injected sun spot, identical at both tiers).
const HDRI_SUN_U: Record<SkyKey, number> = {
  vale: 0.595,
  marsh: 0.657,
  peaks: 0.631,
  beach: 0.595,
  desert: 0.631,
  volcano: 0.657,
  cave: 0.657,
  dusk: 0.745,
  ember: 0.385,
  frost: 0.5,
  amber: 0.501,
  fen: 0.497,
  night: 0.324, // the dream sky's low sun over its glowing sea
  haunt: 0.282, // the storm sky's dying sun on the horizon
  jungle: 0.497, // own sky (sunless source): rotation kept at the fen's value
  garden: 0.497, // own sky (sunless source): rotation kept at the fen's value
  gale: 0.497, // own sky (sunless source): rotation kept at the fen's value,
  farshore: 0.497, // own sky (sunless source): rotation kept at the fen's value
  vale_cup: 0.497,
};

// Per-biome dome grade multiplied into the sky + backdrop sample (HDR, pre
// tonemap, so channels above 1 are fine). White = untouched. Every realm sky
// now carries its own baked color (rose dusk, red storm, blue twilight,
// sunset gold, day blue), so the heavy grades that faked those moods over
// shared photographs are retired.
const BIOME_TINT: Record<SkyKey, [number, number, number]> = {
  vale: [1, 1, 1],
  marsh: [1, 1, 1],
  peaks: [1, 1, 1],
  beach: [1, 1, 1],
  desert: [1, 1, 1],
  volcano: [1, 1, 1],
  cave: [1, 1, 1],
  dusk: [1, 1, 1],
  ember: [1, 1, 1],
  frost: [1, 1, 1],
  amber: [1, 1, 1],
  fen: [1, 1, 1],
  night: [1, 1, 1],
  haunt: [1, 1, 1],
  jungle: [1, 1, 1],
  garden: [1, 1, 1],
  gale: [1, 1, 1],
  farshore: [1, 1, 1],
  vale_cup: [1, 1, 1],
};

const hdriStore: Partial<Record<SkyKey, THREE.DataTexture>> = {};
// PMREM (IBL) prefilter source, always the 1k variant even on tiers whose dome
// samples the 2k: the prefiltered env is blurred by the GGX chain anyway, and
// a 2k source quadruples the CubeUV working-target size and blur cost, which
// the zone streaming lane would otherwise pay inside live frames.
const envHdriStore: Partial<Record<SkyKey, THREE.DataTexture>> = {};
const backdropStore: Partial<Record<SkyKey, THREE.Texture>> = {};
const skyAssetTasks = new Map<string, Promise<void>>();

export function ensureSkyBiomeAssets(
  biomes: readonly SkyKey[],
  target: Readonly<GfxSettings> = GFX,
): Promise<void> {
  if (!target.standardMaterials) return Promise.resolve();
  const hdriUrls = BIOME_HDRI;
  const backdropUrls = BIOME_BACKDROP;
  const tasks = [...new Set(biomes)].map((biome) => {
    const taskKey = `${biome}|${hdriUrls[biome]}|${backdropUrls[biome]}`;
    const existing = skyAssetTasks.get(taskKey);
    if (existing) return existing;
    // Every shipped biome currently uses its HDRI as the sole sky source.
    // Loading an 8k painted backdrop at strength 0 still made Three upload it
    // on the first biome blend; marsh_backdrop.webp alone blocked the driver
    // for 386-479ms during the walked-crossing profile. Keep the dormant path
    // available for authored non-zero strengths without fetching dead assets.
    const backdropTask =
      BIOME_BACKDROP_STRENGTH[biome] > 0
        ? loadTexture(backdropUrls[biome], { srgb: true })
            .then((tex) => {
              tex.wrapS = THREE.RepeatWrapping;
              tex.wrapT = THREE.ClampToEdgeWrapping;
              const mips = !target.constrainedMemory;
              tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.generateMipmaps = mips;
              backdropStore[biome] = tex;
            })
            .catch(() => undefined)
        : Promise.resolve();
    const task = Promise.all([
      loadHdr(hdriUrls[biome]).then((tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        hdriStore[biome] = tex;
      }),
      // PMREM convolves this source immediately, so 512 equirect pixels retain
      // reflection quality while reducing its CubeUV working targets by 4x.
      // The visible dome remains 2k (1k on constrained tiers).
      loadHdr(BIOME_HDRI_1K[biome], { maxWidth: 512 }).then((tex) => {
        envHdriStore[biome] = tex;
      }),
      backdropTask,
    ])
      .then(() => undefined)
      .catch((err) => {
        skyAssetTasks.delete(taskKey);
        throw err;
      });
    skyAssetTasks.set(taskKey, task);
    return task;
  });
  return Promise.all(tasks).then(() => undefined);
}

export function hasSkyHdriAssets(biomes: readonly SkyKey[] = ['vale', 'marsh', 'peaks']): boolean {
  return biomes.every((biome) => Boolean(hdriStore[biome]));
}

export function hasBackdropAssets(biomes: readonly SkyKey[] = ['vale', 'marsh', 'peaks']): boolean {
  return biomes.every((biome) => Boolean(backdropStore[biome]));
}

export interface SkyView {
  dome: THREE.Mesh;
  /** cross-fades the HDRI pair toward the biome band the camera is over */
  setCameraPos(x: number, z: number, dt: number): void;
  /** per-channel day/night multiplier on the dome color (1,1,1 = full day) */
  setDayNight(mul: readonly [number, number, number]): void;
  /** the cycle's live sky grading: the sun/moon direction the dawn/dusk glow
   *  anchors to, how strongly that warm horizon lobe shows (0 = sun high or
   *  deep under), and how far the sky desaturates toward moonlit grey. */
  setCycle(sunDir: THREE.Vector3, duskWarm: number, nightDesat: number): void;
  /** current scene fog color: drives the dome's horizon fog band */
  setFog(color: THREE.Color): void;
  /** set the star-field strength (0 day, 1 deep night) and the current time in
   *  seconds (for star twinkle). The sun/moon discs are sprites, not dome-drawn. */
  setStars(starAmt: number, time: number): void;
  /** Raw equirect HDR (unclamped) for PMREM IBL; null on the low tier. */
  envTexture(biome: SkyKey): THREE.DataTexture | null;
  /** Dome-sampled equirect (the visible sky), for prepare-lane GPU upload. */
  domeTexture(biome: SkyKey): THREE.Texture | null;
  /** scene.environmentRotation.y that aligns the IBL sun with the dome's */
  envRotationY(biome: SkyKey): number;
  /** biome cross-fade state at a given camera z (from -> to by t in [0,1]) */
  biomeAt(x: number, z: number): BiomeBlend;
  /** temporally eased blend currently painted by the dome */
  currentBiomeBlend(): Readonly<BiomeBlend>;
}

export interface BiomeBlend {
  from: SkyKey;
  to: SkyKey;
  t: number;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position; // dome is camera-centred; object space = view direction
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${SKY_FAR_DEPTH}
  }
`;

// The dome fragment is composed per session: when the renderer built the
// biome haze field (vista tiers), the dome becomes one more consumer of the
// SAME field and shared uniform block the terrain layers splice, adding a
// directional horizon-band tint; without a field the string is byte-identical
// to the legacy shader. Decided once, before the material compiles, exactly
// like the geometry consumers gate on hasBiomeHazeField().
const skyFrag = (zoneHaze: boolean): string => /* glsl */ `${
  zoneHaze ? BIOME_HAZE_DECLARATIONS : ''
}
  uniform sampler2D uSkyA;
  uniform sampler2D uSkyB;
  uniform float uMix;
  uniform float uOffA; // equirect u offset aligning the HDRI sun azimuth
  uniform float uOffB;
  uniform vec3 uTuneA; // x: radiance gain, y: clamp (bloom economy), z: contrast
  uniform vec3 uTuneB;
  uniform float uStarAmt; // 0 day, 1 deep night: star-field strength
  uniform float uTime;    // seconds, for star twinkle
  uniform sampler2D uBackdropA;
  uniform sampler2D uBackdropB;
  uniform float uBackdropStrength;
  uniform float uBackdropBiasA;
  uniform float uBackdropBiasB;
  uniform float uBackdropAmtA; // per-biome backdrop visibility
  uniform float uBackdropAmtB;
  uniform vec3 uTintA; // per-biome dome grade (white = untouched)
  uniform vec3 uTintB;
  uniform vec3 uDayNight; // day/night grade (white = full day, dark blue = night)
  uniform vec3 uSunDirLive; // live sun/moon direction the dawn/dusk glow anchors to
  uniform float uDuskWarm;  // dawn/dusk horizon-glow strength (0 = none)
  uniform float uNightDesat; // how far the sky greys out toward night
  uniform vec3 uFog; // current scene fog color (biome + day/night graded)
  uniform float uLiftA; // 1 = mask the HDRI's photographed horizon hills
  uniform float uLiftB;
  varying vec3 vDir;

  vec3 sampleSky(sampler2D map, vec3 dir, float uOff, vec3 tune, float lift) {
    // lift resamples low view angles from just above the photographed ridge
    // line, dissolving the HDRI's baked-in horizon hills into clean sky. Every
    // shipped sky is generated with a clean ocean horizon and lifts nothing,
    // so the common path is a uniform 0 where the mix collapses to dir.y; the
    // branch is on a uniform, so the whole draw takes one path.
    float y = dir.y;
    if (lift > 0.0) y = mix(dir.y, 0.26, lift * smoothstep(0.24, -0.06, dir.y));
    vec2 uv = vec2(
      atan(dir.z, dir.x) * 0.15915494 + 0.5 + uOff,
      asin(clamp(y, -1.0, 1.0)) * 0.31830989 + 0.5);
    vec3 c = texture2D(map, uv).rgb * tune.x;
    // per-biome contrast around a fixed pivot just under the cloud whites:
    // deepens the open sky between clouds and spreads cloud shading back out
    // before the ACES highlight shoulder compresses it flat.
    //
    // Half the shipped skies (the mood-dark ones, and every biome the table
    // leaves at the default) run contrast 1, where this is arithmetically the
    // identity. A uniform is not a compile-time constant, so nothing folds it
    // away and those skies paid three pow() per sample, twice per pixel across
    // the biome blend. The branch is on a uniform, so a whole draw takes one
    // path, and skipping it is not merely equal but exact: pow(x, 1.0) is
    // exp2(log2(x)) on the hardware, which does not round-trip perfectly.
    if (tune.z != 1.0) c = 0.8 * pow(max(c, vec3(0.0)) / 0.8, vec3(tune.z));
    return min(c, vec3(tune.y));
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
    vec3 c = mix(sampleSky(uSkyA, dir, uOffA, uTuneA, uLiftA), sampleSky(uSkyB, dir, uOffB, uTuneB, uLiftB), uMix);
    // The shipped HDRI-only skies set this to zero. Guard the texture reads,
    // not just their final mix, so disabled 8k panoramas cost no fragment
    // bandwidth (and a future authored backdrop still uses the same path).
    if (uBackdropStrength > 0.001) {
      vec3 backA = sampleBackdrop(uBackdropA, dir, uBackdropBiasA);
      vec3 backB = sampleBackdrop(uBackdropB, dir, uBackdropBiasB);
      vec3 backdrop = mix(backA, backB, uMix);
      c = mix(c, backdrop, uBackdropStrength * mix(uBackdropAmtA, uBackdropAmtB, uMix));
    }
    c *= mix(uTintA, uTintB, uMix); // biome grade
    // Cycle sky grading, between the biome grade and the dark night multiply:
    // (1) desaturate toward night, so the day HDRI greys out to moonlight
    // instead of reading as a dimmed daytime photograph; (2) pour a warm
    // dawn/dusk glow into the horizon band around the live sun azimuth while
    // the sun crosses it, so the sky itself sets and rises with the sun.
    float cycleLum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(cycleLum), uNightDesat);
    c *= uDayNight;                 // world day/night grade
    // The dawn/dusk glow lands AFTER the dark multiply: the sunset sky is the
    // brightest thing in the frame at the horizon crossing, so the grade must
    // not dim it (uDuskWarm is zero through deep night, so nothing leaks).
    if (uDuskWarm > 0.001) {
      vec2 sunAz = normalize(uSunDirLive.xz);
      vec2 dirAz = normalize(dir.xz + vec2(1e-5, 0.0));
      float align = max(dot(dirAz, sunAz), 0.0);
      // The glow climbs to dir.y 0.55 rather than 0.45: a sunset that stops a
      // few degrees off the horizon reads as a stripe, and the camera looks
      // DOWN, so the band has to reach well up the dome to fill the frame.
      float band = (1.0 - smoothstep(0.04, 0.55, dir.y)) * smoothstep(-0.24, -0.02, dir.y);
      float warm = uDuskWarm * band * (0.2 + 0.8 * align * align);
      vec3 duskCol = vec3(1.0, 0.34, 0.09);
      // Two terms with very different costs. The MIX rewrites the sky toward
      // the dusk hue scaled by the sky's OWN luminance, so it re-colours what
      // is already there; it can be pushed. The ADD is real extra radiance into
      // the band around the sun, and it feeds the bloom threshold that hazes
      // distant sprite impostors out to white, so it goes the other way: 0.5,
      // under the 0.6 it replaces. Deeper orange, less light.
      //
      // The min() is the load-bearing part. Uncapped, this target reached red
      // 1.38 over the bright HDR sky, and after the ACES curve and the output
      // GAIN that pinned red at 255 across roughly 5 percent of the frame at the
      // horizon crossing: a wide detail-less wash, not a sun. Capping the target
      // under 1 means the re-colour can never itself be a clipping value, while
      // the 0.3 floor still lifts the DARK sky, which is where the glow reads
      // and where clipping is impossible anyway.
      float duskTarget = min(0.3 + 0.9 * cycleLum, 0.95);
      c = mix(c, duskCol * duskTarget, warm * 0.8);
      c += duskCol * warm * align * align * 0.5;
    }
    // The sun and moon discs are billboard sprites (see renderer.ts) so they stay
    // perfect circles on screen; the dome only carries the sky and the stars.
    // stars: a fine field of small twinkling points at hash-jittered spots, only
    // above the horizon, fading in as the sky darkens
    if (uStarAmt > 0.001) {
      // THREE NESTED EARLY-OUTS, and none of them changes a pixel. The field
      // is six hash12 (a sin each) plus a twinkle sine plus an atan/asin pair
      // on EVERY sky pixel of every night frame, and almost all of it lands on
      // zero: below the horizon there are no stars at all, only about one cell
      // in ten holds one, and a star's disc covers a few percent of the cell
      // that holds it. Each gate below is the exact condition under which the
      // term it guards was already multiplied out to zero, so the output is
      // identical and only the work is gone. The gates are coherent too: the
      // horizon test is a band, and a cell is ~0.8 degrees, which at a 1280
      // wide frame is roughly a ten pixel block taking one path.
      float upper = smoothstep(-0.02, 0.2, dir.y);                  // no stars below the horizon
      if (upper > 0.0) {
        vec2 suv = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0))) * 72.0;
        vec2 scell = floor(suv);
        if (hash12(scell) >= 0.9) {                                 // this cell holds a star
          vec2 sf = fract(suv) - vec2(hash12(scell + 7.0), hash12(scell + 13.0));
          float point = smoothstep(0.012, 0.0, dot(sf, sf));        // small points
          if (point > 0.0) {                                        // inside its disc
            float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + hash12(scell + 3.0) * 3.5) + hash12(scell + 19.0) * 6.2832);
            float star = point * (0.4 + 0.6 * hash12(scell + 41.0)) * twinkle;
            c += vec3(0.9, 0.93, 1.0) * star * upper * uStarAmt;
          }
        }
      }
    }
    // Horizon fog band: blend the dome into the scene's fog color at low view
    // angles, so fully fogged geometry (far trees, unloaded land, distant
    // mobs) melts into the sky instead of standing above the haze wall as
    // cutouts. Fogged geometry lands at EXACTLY the fog color, so the band
    // must hold the dome at 100% fog across the whole elevation range where
    // fogged skylines appear (treetops and hill crests reach ~6 degrees at
    // the shortest realm fog range), otherwise the sky share left in the mix
    // shows them as flat cutouts against a brighter horizon. Solid to ~6
    // degrees, then fade to clear sky by ~21 degrees for the taller stuff
    // (a neighbor realm's coast trees seen across a strait).
    c = mix(uFog, c, smoothstep(0.1, 0.36, dir.y));
${
  zoneHaze
    ? `    // Distant-zone air on the dome (biome_haze_field.ts): the sky just
    // above the horizon takes the colour of the realm the view ray lands in
    // (the field sampled ${HAZE_SKY_SAMPLE_DIST} yards out along the ray), so
    // the Nightbloom's twilight lavender and the Frostveil's snow-white air
    // read in the SKY from across a border, not only on the ground. Lands
    // AFTER the fog band above (inside it the band's own ramp multiplied the
    // tint to nothing), with a window that is ZERO at the true rim: on the
    // vista tiers fog saturates only at the extreme rim, and geometry there
    // lands at exactly the fog colour, so the dome must too.
    {
      vec2 wocSkyXZ = uHazeCam + normalize(dir.xz + vec2(1e-5, 0.0)) * ${HAZE_SKY_SAMPLE_DIST.toFixed(1)};
      vec4 wocSkyHaze = texture2D(uHazeField, (wocSkyXZ - uHazeRect.xy) * uHazeRect.zw);
      float wocSkyBand = smoothstep(0.02, 0.1, dir.y) * (1.0 - smoothstep(0.16, 0.38, dir.y));
      c = mix(c, wocSkyHaze.rgb * uHazeGrade, ${HAZE_SKY_TINT_MAX.toFixed(6)} * wocSkyHaze.a * wocSkyBand);
    }
`
    : ''
}    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Cross-fade state across the same ±30/35u zone windows the terrain palette
// uses, keyed by camera position. The strip's band boundaries cascade by z
// as they always did; a column zone blends in sideways with the same window
// shape, so its sky rises as you walk its border pass.
function biomeBlendAt(x: number, z: number): BiomeBlend {
  let from: SkyKey = STRIP_ZONES[0].biome;
  let to: SkyKey = STRIP_ZONES[0].biome;
  let t = 0;
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const raw = Math.max(0, Math.min(1, (z - (b - 30)) / 65));
    const tt = raw * raw * (3 - 2 * raw);
    if (tt <= 0) break;
    if (tt >= 1) {
      from = STRIP_ZONES[i + 1].biome;
      to = from;
      t = 0;
    } else {
      to = STRIP_ZONES[i + 1].biome;
      t = tt;
    }
  }
  for (const col of COLUMN_ZONES) {
    const ct = columnBlendAt(col, x, z);
    if (ct <= 0) continue;
    if (ct >= 1) {
      from = col.biome;
      to = from;
      t = 0;
    } else {
      from = t > 0 ? to : from;
      to = col.biome;
      t = ct;
    }
  }
  // the two place-keyed skies override the biome pick: the Farshore isle's
  // own day sky, and the Vale Cup practice sky over the Sowfield bowl
  const ss = (a: number, b: number, v: number): number => {
    const r = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return r * r * (3 - 2 * r);
  };
  const isleT = Math.min(
    ss(172, 200, x),
    1 - ss(532, 560, x),
    ss(-182, -152, z),
    1 - ss(152, 182, z),
  );
  if (isleT > 0) {
    from = t > 0 ? to : from;
    to = 'farshore';
    t = isleT;
  }
  const dCup = Math.hypot(x - SOWFIELD_CENTER.x, z - SOWFIELD_CENTER.z);
  const cupT = 1 - ss(70, 120, dCup);
  if (cupT > 0) {
    from = t > 0 ? to : from;
    to = 'vale_cup';
    t = cupT;
  }
  return { from, to, t };
}

export function skyBiomesAt(x: number, z: number): readonly SkyKey[] {
  const blend = biomeBlendAt(x, z);
  return blend.from === blend.to ? [blend.from] : [blend.from, blend.to];
}

export function ensureSkyAssetsAt(
  x: number,
  z: number,
  target: Readonly<GfxSettings> = GFX,
): Promise<void> {
  return ensureSkyBiomeAssets(skyBiomesAt(x, z), target);
}

// u offset that moves a given HDRI's sun azimuth onto SUN_ANCHOR's azimuth
function sunOffsetU(biome: SkyKey, sunDir: THREE.Vector3): number {
  const sunU = Math.atan2(sunDir.z, sunDir.x) / (2 * Math.PI) + 0.5;
  return HDRI_SUN_U[biome] - sunU;
}

function deferBasicSkyFragments(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    const anchor = '#include <logdepthbuf_vertex>';
    if (!shader.vertexShader.includes(anchor)) {
      throw new Error('sky shader is missing the pinned log-depth vertex anchor');
    }
    shader.vertexShader = shader.vertexShader.replace(anchor, `${anchor}\n${SKY_FAR_DEPTH}`);
  };
  material.customProgramCacheKey = () => 'woc-sky-far-depth-v1';
}

export function buildSky(
  lowGfx: boolean,
  sunDir: THREE.Vector3,
  initialX = 0,
  initialZ = 0,
): SkyView {
  const start = biomeBlendAt(initialX, initialZ);
  const startBiomes = start.from === start.to ? [start.from] : [start.from, start.to];
  if (lowGfx || !hasSkyHdriAssets(startBiomes)) {
    let current = start;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 24, 16),
      new THREE.MeshBasicMaterial({
        map: skyTexture(),
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    deferBasicSkyFragments(dome.material);
    // Draw after opaque geometry at far depth. Covered fragments fail depth
    // before the texture sample while untouched background pixels stay exact.
    dome.renderOrder = SKY_BACKGROUND_RENDER_ORDER;
    return {
      dome,
      setCameraPos: (x, z) => {
        current = biomeBlendAt(x, z);
      },
      setDayNight: () => {},
      setCycle: () => {},
      setFog: () => {},
      setStars: () => {},
      envTexture: () => null,
      domeTexture: () => null,
      envRotationY: () => 0,
      biomeAt: biomeBlendAt,
      currentBiomeBlend: () => current,
    };
  }

  const sun = sunDir.clone().normalize();
  const backdropsReady = hasBackdropAssets(startBiomes);
  const tuneVec = (b: SkyKey): THREE.Vector3 =>
    new THREE.Vector3(HDRI_TUNE[b].gain, HDRI_TUNE[b].clamp, HDRI_TUNE[b].contrast ?? 1);
  const tintVec = (b: SkyKey): THREE.Vector3 => new THREE.Vector3(...BIOME_TINT[b]);
  const backdropTex = (b: SkyKey): THREE.Texture =>
    (backdropsReady ? backdropStore[b] : hdriStore[b]) as THREE.Texture;
  const uniforms = {
    uSkyA: { value: hdriStore[start.from] as THREE.Texture },
    uSkyB: { value: hdriStore[start.to] as THREE.Texture },
    uMix: { value: start.t },
    uOffA: { value: sunOffsetU(start.from, sun) },
    uOffB: { value: sunOffsetU(start.to, sun) },
    uTuneA: { value: tuneVec(start.from) },
    uTuneB: { value: tuneVec(start.to) },
    uStarAmt: { value: 0 },
    uTime: { value: 0 },
    uBackdropA: { value: backdropTex(start.from) },
    uBackdropB: { value: backdropTex(start.to) },
    uBackdropStrength: { value: backdropsReady ? 1 : 0 },
    uBackdropBiasA: { value: BACKDROP_Y_BIAS[start.from] },
    uBackdropBiasB: { value: BACKDROP_Y_BIAS[start.to] },
    uBackdropAmtA: { value: BIOME_BACKDROP_STRENGTH[start.from] },
    uBackdropAmtB: { value: BIOME_BACKDROP_STRENGTH[start.to] },
    uTintA: { value: tintVec(start.from) },
    uTintB: { value: tintVec(start.to) },
    uDayNight: { value: new THREE.Vector3(1, 1, 1) },
    uSunDirLive: { value: sun.clone() },
    uDuskWarm: { value: 0 },
    uNightDesat: { value: 0 },
    uFog: { value: new THREE.Color(0x7095bd) },
    uLiftA: { value: BIOME_HORIZON_LIFT[start.from] },
    uLiftB: { value: BIOME_HORIZON_LIFT[start.to] },
  };
  // Distant-zone atmosphere on the horizon band: same compile-time gate and
  // SHARED uniform objects as the terrain layers (the renderer builds the
  // field before buildSky runs), so the dome's tint follows the same camera
  // and day/night grade with zero per-frame writes of its own.
  const zoneHaze = hasBiomeHazeField();
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, ...(zoneHaze ? biomeHazeUniforms() : {}) },
    vertexShader: SKY_VERT,
    fragmentShader: skyFrag(zoneHaze),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 20), material);
  dome.renderOrder = SKY_BACKGROUND_RENDER_ORDER;

  const current = createEnvironmentBlend(start);
  let boundFrom = start.from;
  let boundTo = start.to;
  return {
    dome,
    setCameraPos(x: number, z: number, dt: number): void {
      const target = biomeBlendAt(x, z);
      if (!hasSkyHdriAssets([target.from, target.to])) return;
      stepEnvironmentBlend(current, target, dt, SKY_ENVIRONMENT_RESPONSE);
      if (current.from !== boundFrom || current.to !== boundTo) {
        uniforms.uSkyA.value = hdriStore[current.from] as THREE.Texture;
        uniforms.uSkyB.value = hdriStore[current.to] as THREE.Texture;
        uniforms.uOffA.value = sunOffsetU(current.from, sun);
        uniforms.uOffB.value = sunOffsetU(current.to, sun);
        uniforms.uTuneA.value.copy(tuneVec(current.from));
        uniforms.uTuneB.value.copy(tuneVec(current.to));
        uniforms.uBackdropA.value = backdropTex(current.from);
        uniforms.uBackdropB.value = backdropTex(current.to);
        uniforms.uBackdropBiasA.value = BACKDROP_Y_BIAS[current.from];
        uniforms.uBackdropBiasB.value = BACKDROP_Y_BIAS[current.to];
        uniforms.uBackdropAmtA.value = BIOME_BACKDROP_STRENGTH[current.from];
        uniforms.uBackdropAmtB.value = BIOME_BACKDROP_STRENGTH[current.to];
        uniforms.uTintA.value.copy(tintVec(current.from));
        uniforms.uTintB.value.copy(tintVec(current.to));
        uniforms.uLiftA.value = BIOME_HORIZON_LIFT[current.from];
        uniforms.uLiftB.value = BIOME_HORIZON_LIFT[current.to];
        boundFrom = current.from;
        boundTo = current.to;
      }
      uniforms.uMix.value = current.t;
    },
    setDayNight(mul: readonly [number, number, number]): void {
      uniforms.uDayNight.value.set(mul[0], mul[1], mul[2]);
    },
    setCycle(liveSunDir: THREE.Vector3, duskWarm: number, nightDesat: number): void {
      uniforms.uSunDirLive.value.copy(liveSunDir);
      uniforms.uDuskWarm.value = duskWarm;
      uniforms.uNightDesat.value = nightDesat;
    },
    setFog(color: THREE.Color): void {
      uniforms.uFog.value.copy(color);
    },
    setStars(starAmt: number, time: number): void {
      uniforms.uStarAmt.value = starAmt;
      uniforms.uTime.value = time;
    },
    envTexture(biome: SkyKey): THREE.DataTexture | null {
      return envHdriStore[biome] ?? hdriStore[biome] ?? null;
    },
    domeTexture(biome: SkyKey): THREE.Texture | null {
      return hdriStore[biome] ?? null;
    },
    envRotationY(biome: SkyKey): number {
      // dome samples at u + off. three r165 negates environmentRotation
      // before building the PMREM lookup matrix ("accommodate left-handed
      // frame", WebGLMaterials.js), so the effective lookup azimuth is
      // alpha + theta, so matching the dome needs theta = +off*2pi. (A negated
      // value lands the env sun 2x the offset away from the dome's.)
      return sunOffsetU(biome, sun) * 2 * Math.PI;
    },
    biomeAt: biomeBlendAt,
    currentBiomeBlend: () => current,
  };
}

// The composed dome fragment for the shader-string tests
// (tests/sky_zone_haze.test.ts): both arms of the zone-haze gate without
// standing up the HDRI asset graph.
export const skyZoneHazeInternalsForTest = { skyFrag };
