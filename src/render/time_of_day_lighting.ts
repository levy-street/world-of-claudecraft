import * as THREE from 'three';
import { normalizeTimeOfDay } from '../sim/world_time';

const TAU = Math.PI * 2;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface DayNightLightingState {
  sunAnchor: THREE.Vector3;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  hemiSkyColor: THREE.Color;
  hemiGroundColor: THREE.Color;
  fogTint: THREE.Color;
  daylight: number;
  sunIntensityScale: number;
  hemiIntensityScale: number;
  envIntensityScale: number;
  fogTintMix: number;
  sunSpriteOpacityScale: number;
}

export function createDayNightLightingState(): DayNightLightingState {
  return {
    sunAnchor: new THREE.Vector3(),
    sunDirection: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    hemiSkyColor: new THREE.Color(),
    hemiGroundColor: new THREE.Color(),
    fogTint: new THREE.Color(),
    daylight: 1,
    sunIntensityScale: 1,
    hemiIntensityScale: 1,
    envIntensityScale: 1,
    fogTintMix: 0,
    sunSpriteOpacityScale: 1,
  };
}

const NIGHT_SUN = new THREE.Color(0xaec8ff);
const DAWN_SUN = new THREE.Color(0xffb46f);
const DAY_SUN = new THREE.Color(0xffedd0);
const NIGHT_HEMI_SKY = new THREE.Color(0x7896d8);
const DAY_HEMI_SKY = new THREE.Color(0xdcefff);
const NIGHT_HEMI_GROUND = new THREE.Color(0x243152);
const DAY_HEMI_GROUND = new THREE.Color(0x465f39);
const NIGHT_FOG = new THREE.Color(0x24365f);

export function computeDayNightLighting(
  timeOfDay: number,
  out = createDayNightLightingState(),
): DayNightLightingState {
  const t = normalizeTimeOfDay(timeOfDay);
  const sunAngle = (t - 0.25) * TAU;
  const altitude = Math.sin(sunAngle);
  const daylight = smoothstep(-0.16, 0.24, altitude);
  const twilight = 1 - Math.abs(daylight * 2 - 1);
  const azimuth = t * TAU + Math.PI * 0.12;
  const horizontal = 92;
  const y = 22 + Math.max(0.02, daylight) * 150;

  out.sunAnchor.set(Math.cos(azimuth) * horizontal, y, Math.sin(azimuth) * horizontal);
  out.sunDirection.copy(out.sunAnchor).normalize();
  out.daylight = daylight;
  out.sunIntensityScale = 0.24 + daylight * 0.76;
  out.hemiIntensityScale = 0.46 + daylight * 0.54;
  out.envIntensityScale = 0.34 + daylight * 0.66;
  out.fogTintMix = (1 - daylight) * 0.48;
  out.sunSpriteOpacityScale = smoothstep(-0.03, 0.2, altitude);
  out.sunColor
    .copy(NIGHT_SUN)
    .lerp(DAY_SUN, daylight)
    .lerp(DAWN_SUN, twilight * 0.35);
  out.hemiSkyColor.copy(NIGHT_HEMI_SKY).lerp(DAY_HEMI_SKY, daylight);
  out.hemiGroundColor.copy(NIGHT_HEMI_GROUND).lerp(DAY_HEMI_GROUND, daylight);
  out.fogTint.copy(NIGHT_FOG);
  return out;
}
