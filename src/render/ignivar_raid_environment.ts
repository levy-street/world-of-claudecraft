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
  rimColor: number;
}

// One vibe across all three rooms: SUNSET IN A FORGE. A low amber key plus a
// warm dusk ambient carry the scene bright enough to read, the fog is lifted
// smoke instead of near-black, and the IBL stays low (0.13 to 0.16 after the
// 30% room-light lift) because the shared environment map is the DAYLIGHT
// sky: from 0.2 up it frosted every rig blue-white, which read as a milky
// sheen on the dark automata, and the intensity is scene-wide, so players in
// the room take it too (the ceiling pins live in
// tests/ignivar_raid_environment.test.ts). The rim is re-tinted ember here
// for the same reason; the rooms stay distinct by depth (the approach is
// golden smoke, the arena a deeper blaze, the crucible the reddest and
// hottest).
export const IGNIVAR_RAID_ENVIRONMENT: Readonly<
  Record<IgnivarRaidFogState, RaidEnvironmentProfile>
> = Object.freeze({
  ignivarApproach: Object.freeze({
    // Near-black smoke, but pushed well out: the readability lift lives in
    // the extended clear range plus the tile self-glow and the warmed
    // hemisphere, while the distance fades to black (a bright ember fog
    // here read as a red haze wall over the far end) and hands off to the
    // roof-darkness ramp above.
    fogColor: 0x2a1206,
    fogNear: 36,
    fogFar: 122,
    sunColor: 0xffa851,
    // Room-light lift: every ambient leg (key, hemisphere, IBL) runs 30%
    // over the first sunset-forge grade (1 / 0.66 / 0.12), rounded to two
    // decimals (the env leg lands at 0.16, a hair over the exact 0.156), so
    // the halls read brighter without touching the torch rig or the fog.
    sunIntensity: 1.3,
    // The hall's roof shadows swallow most of the amber key, so the warm
    // hemisphere IS the room's ambient: a brighter ember bounce with a
    // lifted floor leg keeps the whole hall readable between the torch
    // pools while the grade stays dark forge, not daylight.
    hemiSkyColor: 0xa8552c,
    hemiGroundColor: 0x361a0c,
    hemiIntensity: 0.86,
    envIntensity: 0.16,
    rimIntensity: 1.1,
    rimColor: 0xffb066,
  }),
  ignivar: IGNIVAR_ARENA_LIGHTING,
  varkhul: Object.freeze({
    fogColor: 0x3d1206,
    fogNear: 30,
    fogFar: 118,
    sunColor: 0xff8f3c,
    // The same 30% ambient lift as the approach hall (over 1.05 / 0.44 /
    // 0.12, rounded to two decimals; env lands at 0.16 over the exact
    // 0.156); the crucible keeps its reddest-and-hottest grade by color.
    sunIntensity: 1.37,
    hemiSkyColor: 0x9a3d24,
    hemiGroundColor: 0x2a0d06,
    hemiIntensity: 0.57,
    envIntensity: 0.16,
    rimIntensity: 1.1,
    rimColor: 0xff9a4e,
  }),
});

export function ignivarRaidFogStateForInterior(
  interior: string | null,
): IgnivarRaidFogState | null {
  if (interior === 'ignivar_approach') return 'ignivarApproach';
  // the lift car shares the approach's fog and light grade (one shaft)
  if (interior === 'ignivar_lift') return 'ignivarApproach';
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
    rimColor: { value: { setHex(value: number): unknown } };
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
  target.rimColor.value.setHex(profile.rimColor);
}
