// The outdoor fog request for authored (Studio) maps and the editor viewport,
// pure: no Three, no DOM. renderer.ts updateFog is the thin consumer. The
// built-in world asks with `gameplayBand: false` and no editor view, which
// reproduces the shipped request exactly (preset far times the grade's
// farScale, preset near, the fogless detail far under the vista).

/**
 * The gameplay fog band (SPACEY, 2026-09-20: "make that nice fog render at 700
 * to 800 yds"). Deliberately matched to LOD_RANGE_ASSETS (placed_assets.ts):
 * a placement must never be culled while it is still clearly visible, and it
 * must be fully fogged by the time it is. Floors only, a biome or a map author
 * may ask for MORE fog (a misty zone, a storm) and still gets it. Moved out
 * with the imposter range (imposters "visible at upto 1200yds"): the band is a
 * GATE, nothing but coarse far terrain survives behind it, so leaving it at
 * 700-800 while the sprites reached 1200 would have hidden every one of them in
 * fog. The 0.875 near:far ratio of the original 700/800 is kept, so the band
 * reads the same, just further out.
 */
export const GAMEPLAY_FOG_NEAR = 1050;
export const GAMEPLAY_FOG_FAR = 1200;

export interface FogPresetLike {
  near: number;
  far: number;
}

/** The editor's visibility sliders (distance in yards, haze 0..1). */
export interface EditorVisibility {
  distance: number;
  haze: number;
}

/**
 * This frame's requested outdoor fog envelope, written into `out`.
 * - `vista`: the far-vista path asks for `foglessFar` and the preset near.
 * - `editor` (non-null): the editor's visibility sliders drive the envelope
 *   directly. Haze 0 = a late, thin band (near at 82% of far); haze 1 = the
 *   shipped atmospheric near plane.
 * - `gameplayBand`: floor the far/near at the gameplay band (authored maps).
 */
export function requestOutdoorFog(
  preset: FogPresetLike,
  farScale: number,
  vista: boolean,
  foglessFar: number,
  editor: EditorVisibility | null,
  gameplayBand: boolean,
  out: FogPresetLike,
): FogPresetLike {
  const presetFar = preset.far * farScale;
  out.far = vista
    ? foglessFar
    : editor
      ? editor.distance
      : gameplayBand
        ? Math.max(presetFar, GAMEPLAY_FOG_FAR)
        : presetFar;
  out.near = editor
    ? out.far * 0.82 + (preset.near - out.far * 0.82) * editor.haze
    : vista || !gameplayBand
      ? preset.near
      : Math.max(preset.near, GAMEPLAY_FOG_NEAR);
  return out;
}

/**
 * The gameplay fog band, applied AFTER the vista/eased fog. The far-vista path
 * deliberately pushes fog out to the horizon haze so distant land melts into
 * the sky, which means nothing is ever fogged at the distance placements
 * actually cull; this puts the band back, so an asset is fully hidden by fog
 * before it is culled instead of winking out in clear air. Applies in the
 * EDITOR too: the editor slider still TIGHTENS it, it just cannot push past
 * the gate, so the maker sees what the player sees.
 */
export function clampToGameplayFogBand(fog: FogPresetLike): void {
  fog.far = Math.min(fog.far, GAMEPLAY_FOG_FAR);
  fog.near = Math.min(fog.near, GAMEPLAY_FOG_NEAR);
}
