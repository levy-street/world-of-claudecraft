// The per-interior light rig: one place owning the authored sun / hemisphere /
// IBL / rim numbers for every non-outdoor fog state, and the two appliers the
// renderer calls when a state settles. Extracted from renderer.ts behind the
// monolith ratchet's seam (a module the renderer calls); the values and the
// decision order are verbatim from the coordinator so behavior is unchanged.
//
// The renderer stays the owner of WHEN a rig applies (fog-state resolution,
// the lowGfx guard, and the per-frame outdoor grading whose current values
// arrive here as the outdoor fallbacks); this module owns WHAT each state
// means in light.
import type * as THREE from 'three';
import { sharedUniforms } from './gfx';
import { applyIgnivarRaidLighting, type IgnivarRaidFogState } from './ignivar_raid_environment';
import { RIM_GLOW_DEFAULT_COLOR } from './pbr_fragment_shader';

/** Every fog scene state the renderer resolves to (single source of truth). */
export type FogSceneState =
  | 'outdoor'
  | 'dungeon'
  | 'temple'
  | 'nythraxis'
  | 'ignivarApproach'
  | 'ignivar'
  | 'varkhul'
  | 'delve'
  | 'yumiMaze'
  | 'battleground'
  | 'underwater'
  | 'rift'
  | 'practice'
  | 'wildheartField'
  | 'lastkeep'
  | 'dawnhold';

/** The states whose scene is open to the sky: the overworld, Wildheart's field
 *  and the Thornhollow Fields hollow keep the sky dome (hiding it there left a
 *  black void above the ramparts); every interior, the maze, the rift and the
 *  water hide it. */
export function isOpenAirFogState(state: FogSceneState): boolean {
  return state === 'outdoor' || state === 'wildheartField' || state === 'battleground';
}

// dungeon interiors: kill the daylight so torchlight carries the scene
// (env at 0.15 still lit rigs sky-blue against the pitch-dark crypt)
const DUNGEON_SUN_INTENSITY = 0.34;
const DUNGEON_ENV_INTENSITY = 0.05;
const DUNGEON_HEMI_INTENSITY = 0.22; // floor of readability, bosses crushed to black at 0.14
// character rim glow scales up underground so silhouettes split from the murk
const DUNGEON_RIM_BOOST = 2.4;
// The authored Infernal Citadel is larger than a procedural floor and carries
// real budgeted brazier lights. A stronger ambient floor preserves the black-red
// infernal grade while keeping its loops, bosses, and doors readable between pools.
const INFERNAL_SUN_INTENSITY = 0.54;
const INFERNAL_HEMI_INTENSITY = 0.32;
const INFERNAL_ENV_INTENSITY = 0.1;
const INFERNAL_RIM_BOOST = 2.15;
// The Protect Yumi maze is a torch-lit NIGHT ARENA, not a crypt: a moon-key
// plus a healthy hemisphere keep the whole competitive space readable, with
// the braziers/torches adding warmth rather than carrying the scene alone.
const YUMI_MAZE_SUN_INTENSITY = 1.32;
const YUMI_MAZE_HEMI_INTENSITY = 0.38;
const YUMI_MAZE_ENV_INTENSITY = 0.25;
const YUMI_MAZE_RIM_BOOST = 1.7;
const WILDHEART_SUN_INTENSITY = 1.75;
const WILDHEART_HEMI_INTENSITY = 0.59;
const WILDHEART_ENV_INTENSITY = 0.28;
const WILDHEART_RIM_BOOST = 1.5;
const WILDHEART_SUN_COLOR = 0xffd48c;
const WILDHEART_HEMI_SKY_COLOR = 0xd8ebca;
const WILDHEART_HEMI_GROUND_COLOR = 0x5b4a2d;
// The Last Keep is a LIVED-IN castle interior, not a crypt: a higher, warmed
// ambient floor (over the candle-orange torch lights the interior itself
// carries) so its halls read golden and inhabited while staying indoors-dim.
// Scoped to interior 'lastkeep' only; every other underground interior keeps
// the DUNGEON_* rig.
const LASTKEEP_SUN_INTENSITY = 0.66;
const LASTKEEP_HEMI_INTENSITY = 0.46;
const LASTKEEP_ENV_INTENSITY = 0.14;
const LASTKEEP_RIM_BOOST = 1.9;
const LASTKEEP_SUN_COLOR = 0xffd9a8;
const LASTKEEP_HEMI_SKY_COLOR = 0xffe4c4;
const LASTKEEP_HEMI_GROUND_COLOR = 0x4a3826;
// Dawnhold Castle: the Evergarden garden palace. BRIGHTER and greener-warm
// than the Last Keep's rig: this is daylight through a garden palace, not
// torchlit stone, so the key and ambient sit well above the keep's and the
// bounce reads off sunlit lawn instead of dark timber. Scoped to interior
// 'dawnhold' only.
const DAWNHOLD_SUN_INTENSITY = 0.95;
const DAWNHOLD_HEMI_INTENSITY = 0.72;
const DAWNHOLD_ENV_INTENSITY = 0.26;
const DAWNHOLD_RIM_BOOST = 1.6;
const DAWNHOLD_SUN_COLOR = 0xffe4b0;
const DAWNHOLD_HEMI_SKY_COLOR = 0xf2fadc;
const DAWNHOLD_HEMI_GROUND_COLOR = 0x53603a;

export interface InteriorLightTargets {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  scene: THREE.Scene;
  /** the shared rim-boost uniform's live value slot */
  rim: { value: number };
  /** the shared rim-tint uniform's live color: cool by default, re-graded warm
   *  by the forge rooms and reset by every other state settling */
  rimColor: { value: { setHex(value: number): unknown } };
}

/** The outdoor rig legs, graded per frame by the renderer before the call. */
export interface OutdoorLightLegs {
  sunIntensity: number;
  hemiIntensity: number;
  envIntensity: number;
}

/**
 * Settle the light rig for a non-rift interior fog state. Every state not
 * carrying its own rig (underwater, battleground, practice) restores the
 * caller's graded outdoor legs, so stepping out of a cave at night stays
 * night; the maze runs its own night rig instead.
 */
export function applyInteriorLightRig(
  state: FogSceneState,
  targets: InteriorLightTargets,
  outdoor: OutdoorLightLegs,
): void {
  const mazeNight = state === 'yumiMaze';
  const wildheartSun = state === 'wildheartField';
  const keepHearth = state === 'lastkeep';
  const dawnholdDay = state === 'dawnhold';
  const ignivarForge = state === 'ignivarApproach' || state === 'ignivar' || state === 'varkhul';
  const underground =
    state === 'dungeon' ||
    state === 'temple' ||
    state === 'nythraxis' ||
    ignivarForge ||
    state === 'delve';
  targets.sun.intensity = mazeNight
    ? YUMI_MAZE_SUN_INTENSITY
    : wildheartSun
      ? WILDHEART_SUN_INTENSITY
      : keepHearth
        ? LASTKEEP_SUN_INTENSITY
        : dawnholdDay
          ? DAWNHOLD_SUN_INTENSITY
          : underground
            ? DUNGEON_SUN_INTENSITY
            : outdoor.sunIntensity;
  targets.hemi.intensity = mazeNight
    ? YUMI_MAZE_HEMI_INTENSITY
    : wildheartSun
      ? WILDHEART_HEMI_INTENSITY
      : keepHearth
        ? LASTKEEP_HEMI_INTENSITY
        : dawnholdDay
          ? DAWNHOLD_HEMI_INTENSITY
          : underground
            ? DUNGEON_HEMI_INTENSITY
            : outdoor.hemiIntensity;
  targets.scene.environmentIntensity = mazeNight
    ? YUMI_MAZE_ENV_INTENSITY
    : wildheartSun
      ? WILDHEART_ENV_INTENSITY
      : keepHearth
        ? LASTKEEP_ENV_INTENSITY
        : dawnholdDay
          ? DAWNHOLD_ENV_INTENSITY
          : underground
            ? DUNGEON_ENV_INTENSITY
            : outdoor.envIntensity;
  targets.rim.value = mazeNight
    ? YUMI_MAZE_RIM_BOOST
    : wildheartSun
      ? WILDHEART_RIM_BOOST
      : keepHearth
        ? LASTKEEP_RIM_BOOST
        : dawnholdDay
          ? DAWNHOLD_RIM_BOOST
          : underground
            ? DUNGEON_RIM_BOOST
            : 1;
  // The rim tint defaults cool everywhere; the forge applier below re-grades
  // it, and setting it first means leaving the raid restores it in the same
  // settle that restores the legs.
  targets.rimColor.value.setHex(RIM_GLOW_DEFAULT_COLOR);
  // The roof darkness ramp is scoped to the HALLS only (the arena and
  // crucible have other hands dressing them); zeroed by every other settle
  // (same restore pattern as the rim tint).
  sharedUniforms.uRoofDarkStrength.value = state === 'ignivarApproach' ? 1 : 0;
  if (wildheartSun) {
    targets.sun.color.setHex(WILDHEART_SUN_COLOR);
    targets.hemi.color.setHex(WILDHEART_HEMI_SKY_COLOR);
    targets.hemi.groundColor.setHex(WILDHEART_HEMI_GROUND_COLOR);
  } else if (keepHearth) {
    // hearth-gold key and bounce; the outdoor path re-grades these
    // colors every frame once the player steps back outside
    targets.sun.color.setHex(LASTKEEP_SUN_COLOR);
    targets.hemi.color.setHex(LASTKEEP_HEMI_SKY_COLOR);
    targets.hemi.groundColor.setHex(LASTKEEP_HEMI_GROUND_COLOR);
  } else if (dawnholdDay) {
    // garden daylight: gold key over a pale green sky bounce and a
    // lawn-green ground bounce; re-graded outdoors the same way
    targets.sun.color.setHex(DAWNHOLD_SUN_COLOR);
    targets.hemi.color.setHex(DAWNHOLD_HEMI_SKY_COLOR);
    targets.hemi.groundColor.setHex(DAWNHOLD_HEMI_GROUND_COLOR);
  } else if (ignivarForge) {
    applyIgnivarRaidLighting(state as IgnivarRaidFogState, targets);
  }
}

/**
 * The Rift's two-arm rig: authored floors (the Infernal Citadel) carry their
 * own brazier-budgeted grade, generated floors keep the crypt rig.
 */
export function applyRiftLightRig(authored: boolean, targets: InteriorLightTargets): void {
  targets.sun.intensity = authored ? INFERNAL_SUN_INTENSITY : DUNGEON_SUN_INTENSITY;
  targets.hemi.intensity = authored ? INFERNAL_HEMI_INTENSITY : DUNGEON_HEMI_INTENSITY;
  targets.scene.environmentIntensity = authored ? INFERNAL_ENV_INTENSITY : DUNGEON_ENV_INTENSITY;
  targets.rim.value = authored ? INFERNAL_RIM_BOOST : DUNGEON_RIM_BOOST;
  targets.rimColor.value.setHex(RIM_GLOW_DEFAULT_COLOR);
  sharedUniforms.uRoofDarkStrength.value = 0;
}
