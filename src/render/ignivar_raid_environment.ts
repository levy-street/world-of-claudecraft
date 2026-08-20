import { IGNIVAR_ARENA_LIGHTING } from './ignivar_arena_atmosphere';

export type IgnivarRaidFogState = 'ignivarApproach' | 'ignivar' | 'varkhul';

interface RaidEnvironmentProfile {
  fogColor: number;
  fogNear: number;
  fogFar: number;
  sunColor: number;
  sunIntensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  envIntensity: number;
  rimIntensity: number;
}

export const IGNIVAR_RAID_ENVIRONMENT: Readonly<
  Record<IgnivarRaidFogState, RaidEnvironmentProfile>
> = Object.freeze({
  ignivarApproach: Object.freeze({
    fogColor: 0x0d0908,
    fogNear: 24,
    fogFar: 92,
    sunColor: 0xd9824d,
    sunIntensity: 0.34,
    hemiSkyColor: 0x3d302b,
    hemiGroundColor: 0x070606,
    hemiIntensity: 0.3,
    envIntensity: 0.2,
    rimIntensity: 1.58,
  }),
  ignivar: IGNIVAR_ARENA_LIGHTING,
  varkhul: Object.freeze({
    fogColor: 0x160604,
    fogNear: 30,
    fogFar: 118,
    sunColor: 0xff6a32,
    sunIntensity: 0.5,
    hemiSkyColor: 0x63291f,
    hemiGroundColor: 0x0b0303,
    hemiIntensity: 0.38,
    envIntensity: 0.34,
    rimIntensity: 1.55,
  }),
});

export function ignivarRaidFogStateForInterior(
  interior: string | null,
): IgnivarRaidFogState | null {
  if (interior === 'ignivar_approach') return 'ignivarApproach';
  if (interior === 'ignivar') return 'ignivar';
  if (interior === 'ignivar_depths') return 'varkhul';
  return null;
}

export function applyIgnivarRaidFog(
  state: IgnivarRaidFogState,
  fog: { color: { setHex(value: number): unknown }; near: number; far: number },
): void {
  const profile = IGNIVAR_RAID_ENVIRONMENT[state];
  fog.color.setHex(profile.fogColor);
  fog.near = profile.fogNear;
  fog.far = profile.fogFar;
}

export function applyIgnivarRaidLighting(
  state: IgnivarRaidFogState,
  target: {
    sun: { color: { setHex(value: number): unknown }; intensity: number };
    hemi: {
      color: { setHex(value: number): unknown };
      groundColor: { setHex(value: number): unknown };
      intensity: number;
    };
    scene: { environmentIntensity: number };
    rim: { value: number };
  },
): void {
  const profile = IGNIVAR_RAID_ENVIRONMENT[state];
  target.sun.color.setHex(profile.sunColor);
  target.sun.intensity = profile.sunIntensity;
  target.hemi.color.setHex(profile.hemiSkyColor);
  target.hemi.groundColor.setHex(profile.hemiGroundColor);
  target.hemi.intensity = profile.hemiIntensity;
  target.scene.environmentIntensity = profile.envIntensity;
  target.rim.value = profile.rimIntensity;
}
