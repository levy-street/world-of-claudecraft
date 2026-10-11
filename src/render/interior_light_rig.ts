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
import * as THREE from 'three';
import { sharedUniforms } from './gfx';
import { SANCTUM_KEY_DIRECTION } from './gravewyrm_sanctum/sanctum_plan_core';
import { applyIgnivarRaidLighting, type IgnivarRaidFogState } from './ignivar_raid_environment';
import { RIM_GLOW_DEFAULT_COLOR } from './pbr_fragment_shader';
import { BASIN_SUN_DIRECTION } from './wildheart_basin/basin_plan_core';

/** Every fog scene state the renderer resolves to (single source of truth). */
export type FogSceneState =
  | 'outdoor'
  | 'hoardValley'
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
  | 'wildheartBasin'
  | 'hollowCrypt'
  | 'sunkenBastion'
  | 'drownedTemple'
  | 'gravewyrmSanctum'
  | 'lastkeep'
  | 'dawnhold';

/** The states whose scene is open to the sky: the overworld and the
 *  Thornhollow Fields hollow keep the sky dome (hiding it there left a black
 *  void above the ramparts); every interior, the maze, the rift and the water
 *  hide it, and the open-air dungeon fields carry their own sky. */
export function isOpenAirFogState(state: FogSceneState): boolean {
  return state === 'outdoor' || state === 'hoardValley' || state === 'battleground';
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
// The Wildheart Basin: an OPEN-AIR jungle caldera on a humid gold-green
// afternoon, under its own sky (render/wildheart_basin). The one sun is the
// key light, warm gold and low in the south-west behind the Idol Maw (so the
// falls' rainbows read from the maw), with a pale green-gold sky bounce off
// the humid air and a mossy ground bounce off the canopy. The braziers and
// the jaguar's eyes ride the light sink; nothing else lights the basin.
// Golden hour: a strong warm key against a cool, low sky fill, so the light
// has a side and a shadow side (the flat, front-lit noon it replaced read as
// paper).
const WILDHEART_SUN_INTENSITY = 3.2;
const WILDHEART_HEMI_INTENSITY = 0.82;
/** Where the afternoon sun hangs (from the ground toward it). The renderer's
 *  per-frame key-light aim takes it in place of the world sun while the basin
 *  is the fog state. */
export const WILDHEART_KEY_LIGHT_DIRECTION = new THREE.Vector3(...BASIN_SUN_DIRECTION);
const WILDHEART_ENV_INTENSITY = 0.32;
const WILDHEART_RIM_BOOST = 1.6;
const WILDHEART_SUN_COLOR = 0xffc075;
const WILDHEART_HEMI_SKY_COLOR = 0x9fc3cf;
const WILDHEART_HEMI_GROUND_COLOR = 0x3b4a23;
// The Hollow Crypt: an OPEN-AIR necropolis under a vast moon. It hides the
// world's day-night dome (its own moonlit sky rides the interior group, so the
// look never depends on the realm's clock) and grades the one sun into a cold
// moon key from behind the crag, with a violet sky bounce and an umber floor
// bounce so the tallow lanterns carry the only warm tones.
const HOLLOW_CRYPT_SUN_INTENSITY = 2.5;
const HOLLOW_CRYPT_HEMI_INTENSITY = 0.95;
const HOLLOW_CRYPT_ENV_INTENSITY = 0.42;
const HOLLOW_CRYPT_RIM_BOOST = 2.1;
const HOLLOW_CRYPT_SUN_COLOR = 0xbfd0ff;
const HOLLOW_CRYPT_HEMI_SKY_COLOR = 0x5a64a0;
const HOLLOW_CRYPT_HEMI_GROUND_COLOR = 0x4a3d45;
/** Where the moon hangs (from the ground toward it): north-north-west over
 *  the crag, low enough to throw long shadows toward the entrance. */
export const HOLLOW_CRYPT_MOON_DIRECTION = new THREE.Vector3(-0.3, 0.3, 0.9).normalize();
// The Sunken Bastion: an OPEN-AIR sea fortress at storm tide, at dusk. Its own
// sky rides the interior group (the realm clock never changes the look); the
// one sun is a low, pale disc sinking behind the fog banks in the south-west,
// raking the fortress from the side as the party looks up the headland, with
// a grey-green sea-fog bounce and a cold slate floor bounce. The beacon's beam
// and the lanterns carry the only warm light.
const SUNKEN_BASTION_SUN_INTENSITY = 2.25;
const SUNKEN_BASTION_HEMI_INTENSITY = 0.74;
const SUNKEN_BASTION_ENV_INTENSITY = 0.32;
const SUNKEN_BASTION_RIM_BOOST = 1.9;
const SUNKEN_BASTION_SUN_COLOR = 0xffd9a8;
const SUNKEN_BASTION_HEMI_SKY_COLOR = 0x86968c;
const SUNKEN_BASTION_HEMI_GROUND_COLOR = 0x3b362c;
/** Where the storm sun hangs (from the ground toward it): low in the west,
 *  a little north, behind the fog banks over the fen-sea, so it rakes the
 *  headland from the side as the party climbs it (long shadows, lit edges). */
export const SUNKEN_BASTION_SUN_DIRECTION = new THREE.Vector3(-0.86, 0.3, 0.3).normalize();
// The Drowned Temple: an OPEN-AIR lagoon at the night the temple drowned, under
// a moon impossibly large and close, hanging low over the crater's north rim.
// The moon is the key light (cool silver, strong, long soft shadows toward the
// entrance), a violet night sky bounce overhead, a deep teal bounce off the
// lagoon. Braziers of pale fire and the altar's column are the only other light.
const DROWNED_TEMPLE_MOON_INTENSITY = 2.35;
const DROWNED_TEMPLE_HEMI_INTENSITY = 0.82;
const DROWNED_TEMPLE_ENV_INTENSITY = 0.36;
const DROWNED_TEMPLE_RIM_BOOST = 2.2;
const DROWNED_TEMPLE_MOON_COLOR = 0xd6e2ff;
const DROWNED_TEMPLE_HEMI_SKY_COLOR = 0x6272a8;
const DROWNED_TEMPLE_HEMI_GROUND_COLOR = 0x173640;
/** Where the moon hangs (from the ground toward it): low over the north rim,
 *  a little west, straight down the route from the Moongate Landing, so the
 *  whole temple is seen against it and every column throws its shadow back
 *  toward the party. */
// The Gravewyrm Sanctum: an OPEN-AIR glacier cirque at the blue hour of a
// clear polar dusk, under its own sky (render/gravewyrm_sanctum). No sun: the
// key is the cold sky itself, strongest from the bright west where the
// afterglow lingers behind the peaks, a pale blue-white with long soft
// shadows; a deep blue sky bounce overhead and a bright snow bounce from
// below (the snow and the ice throw the dusk back up). The only warm light is
// the shard's: the rim tint goes rose-gold, so every silhouette is edged by
// the heart in the ice. The pyres and braziers ride the light sink.
const GRAVEWYRM_SANCTUM_KEY_INTENSITY = 2.3;
const GRAVEWYRM_SANCTUM_HEMI_INTENSITY = 1.0;
const GRAVEWYRM_SANCTUM_ENV_INTENSITY = 0.42;
const GRAVEWYRM_SANCTUM_RIM_BOOST = 2.0;
const GRAVEWYRM_SANCTUM_KEY_COLOR = 0xc4d4ff;
const GRAVEWYRM_SANCTUM_HEMI_SKY_COLOR = 0x5f78b4;
const GRAVEWYRM_SANCTUM_HEMI_GROUND_COLOR = 0x8296b8;
/** The rim tint: the shard's rose-gold (design section 8, "a warm rim from
 *  the shard glow"). */
export const GRAVEWYRM_SANCTUM_RIM_COLOR = 0xf2b880;
/** Where the cold key comes from (from the ground toward it). */
export const GRAVEWYRM_SANCTUM_KEY_DIRECTION = new THREE.Vector3(...SANCTUM_KEY_DIRECTION);
export const DROWNED_TEMPLE_MOON_DIRECTION = new THREE.Vector3(-0.14, 0.27, 0.95).normalize();
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

/** Copy the state's own key-light direction into `out` when it has one; the
 *  outdoor sun and moon keep theirs otherwise. Returns whether it did. */
export function interiorKeyLightDirection(state: FogSceneState, out: THREE.Vector3): boolean {
  if (state === 'hollowCrypt') {
    out.copy(HOLLOW_CRYPT_MOON_DIRECTION);
    return true;
  }
  if (state === 'sunkenBastion') {
    out.copy(SUNKEN_BASTION_SUN_DIRECTION);
    return true;
  }
  if (state === 'drownedTemple') {
    out.copy(DROWNED_TEMPLE_MOON_DIRECTION);
    return true;
  }
  if (state === 'gravewyrmSanctum') {
    out.copy(GRAVEWYRM_SANCTUM_KEY_DIRECTION);
    return true;
  }
  if (state !== 'wildheartBasin') return false;
  out.copy(WILDHEART_KEY_LIGHT_DIRECTION);
  return true;
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
  const wildheartSun = state === 'wildheartBasin';
  const cryptMoon = state === 'hollowCrypt';
  const bastionDusk = state === 'sunkenBastion';
  const templeMoon = state === 'drownedTemple';
  const sanctumDusk = state === 'gravewyrmSanctum';
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
    : cryptMoon
      ? HOLLOW_CRYPT_SUN_INTENSITY
      : bastionDusk
        ? SUNKEN_BASTION_SUN_INTENSITY
        : templeMoon
          ? DROWNED_TEMPLE_MOON_INTENSITY
          : sanctumDusk
            ? GRAVEWYRM_SANCTUM_KEY_INTENSITY
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
    : cryptMoon
      ? HOLLOW_CRYPT_HEMI_INTENSITY
      : bastionDusk
        ? SUNKEN_BASTION_HEMI_INTENSITY
        : templeMoon
          ? DROWNED_TEMPLE_HEMI_INTENSITY
          : sanctumDusk
            ? GRAVEWYRM_SANCTUM_HEMI_INTENSITY
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
    : cryptMoon
      ? HOLLOW_CRYPT_ENV_INTENSITY
      : bastionDusk
        ? SUNKEN_BASTION_ENV_INTENSITY
        : templeMoon
          ? DROWNED_TEMPLE_ENV_INTENSITY
          : sanctumDusk
            ? GRAVEWYRM_SANCTUM_ENV_INTENSITY
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
    : cryptMoon
      ? HOLLOW_CRYPT_RIM_BOOST
      : bastionDusk
        ? SUNKEN_BASTION_RIM_BOOST
        : templeMoon
          ? DROWNED_TEMPLE_RIM_BOOST
          : sanctumDusk
            ? GRAVEWYRM_SANCTUM_RIM_BOOST
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
  if (cryptMoon) {
    targets.sun.color.setHex(HOLLOW_CRYPT_SUN_COLOR);
    targets.hemi.color.setHex(HOLLOW_CRYPT_HEMI_SKY_COLOR);
    targets.hemi.groundColor.setHex(HOLLOW_CRYPT_HEMI_GROUND_COLOR);
  } else if (bastionDusk) {
    targets.sun.color.setHex(SUNKEN_BASTION_SUN_COLOR);
    targets.hemi.color.setHex(SUNKEN_BASTION_HEMI_SKY_COLOR);
    targets.hemi.groundColor.setHex(SUNKEN_BASTION_HEMI_GROUND_COLOR);
  } else if (templeMoon) {
    targets.sun.color.setHex(DROWNED_TEMPLE_MOON_COLOR);
    targets.hemi.color.setHex(DROWNED_TEMPLE_HEMI_SKY_COLOR);
    targets.hemi.groundColor.setHex(DROWNED_TEMPLE_HEMI_GROUND_COLOR);
  } else if (sanctumDusk) {
    targets.sun.color.setHex(GRAVEWYRM_SANCTUM_KEY_COLOR);
    targets.hemi.color.setHex(GRAVEWYRM_SANCTUM_HEMI_SKY_COLOR);
    targets.hemi.groundColor.setHex(GRAVEWYRM_SANCTUM_HEMI_GROUND_COLOR);
    // The shard's warm rim (reset to the cool default by every other settle).
    targets.rimColor.value.setHex(GRAVEWYRM_SANCTUM_RIM_COLOR);
  } else if (wildheartSun) {
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
