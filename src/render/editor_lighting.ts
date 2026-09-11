// Editor-only scene-lighting override profiles. Pure data (no Three imports):
// the map editor picks or edits a profile and hands it to
// Renderer.setEditorLighting(), which applies it over the boot light rig and
// restores the shipped values on null. The game/playtest path never calls it,
// so shared production lighting is untouched.

export interface EditorLightingProfile {
  /** Directional sun intensity (shipped outdoor value is 2.8). */
  sunIntensity: number;
  /** Sun light color (hex). */
  sunColor: number;
  /** Hemisphere (ambient) intensity (shipped outdoor value is 0.45). */
  hemiIntensity: number;
  /** Hemisphere sky color (hex); doubles as the ambient tint. */
  skyColor: number;
  /** Multiplier on the boot IBL environment intensity (1 = shipped). */
  envScale: number;
  /** Sun compass direction, degrees (the shipped anchor sits at ~29). */
  sunAzimuthDeg: number;
  /** Sun height above the horizon, degrees (shipped ~54). */
  sunElevationDeg: number;
}

/** The shipped outdoor rig expressed as a profile (the 'Day' preset). */
export const EDITOR_LIGHTING_DAY: EditorLightingProfile = {
  sunIntensity: 2.8,
  sunColor: 0xffedd0,
  hemiIntensity: 0.45,
  skyColor: 0xdcefff,
  envScale: 1,
  sunAzimuthDeg: 29,
  sunElevationDeg: 54,
};

export const EDITOR_LIGHTING_PRESETS: {
  key: 'day' | 'overcast' | 'dusk' | 'night';
  profile: EditorLightingProfile;
}[] = [
  { key: 'day', profile: EDITOR_LIGHTING_DAY },
  {
    key: 'overcast',
    profile: {
      sunIntensity: 1.0,
      sunColor: 0xd8dee6,
      hemiIntensity: 0.9,
      skyColor: 0xc2ccd6,
      envScale: 0.7,
      sunAzimuthDeg: 29,
      sunElevationDeg: 54,
    },
  },
  {
    key: 'dusk',
    profile: {
      sunIntensity: 1.7,
      sunColor: 0xff9a55,
      hemiIntensity: 0.32,
      skyColor: 0x9a80a8,
      envScale: 0.45,
      sunAzimuthDeg: 250,
      sunElevationDeg: 12,
    },
  },
  {
    key: 'night',
    profile: {
      sunIntensity: 0.3,
      sunColor: 0x9db8ff,
      hemiIntensity: 0.2,
      skyColor: 0x3a4a6e,
      envScale: 0.12,
      sunAzimuthDeg: 120,
      sunElevationDeg: 40,
    },
  },
];
