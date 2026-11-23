// The per-frame fog scene resolution: one place owning WHICH fog scene state
// the player's position resolves to and WHAT each settled state means in fog,
// the twin of interior_light_rig.ts (which owns the same states' light).
// Extracted from renderer.ts behind the monolith ratchet's seam (a module the
// renderer calls); the values and the decision order are verbatim from the
// coordinator so behavior is unchanged.
//
// The renderer stays the owner of WHEN a preset applies (the fogState settle
// edge, the rift palette override, the lowGfx light-rig guard, and the whole
// outdoor residency clamp that grades fog.far per frame once 'outdoor' has
// settled); this module owns the resolution and the settled preset values.
import { dungeonAt, isArenaPos, isBgPos, isDelvePos, isYumiMazePos } from '../sim/data';
import { waterLevelAt } from '../sim/world';
import { SANCTUM_FOG_COLOR } from './gravewyrm_sanctum/sanctum_plan_core';
import { applyIgnivarRaidFog, ignivarRaidFogStateForInterior } from './ignivar_raid_environment';
import type { FogSceneState } from './interior_light_rig';
import { BASIN_FOG_COLOR } from './wildheart_basin/basin_plan_core';

/** The Hollow Crypt's night fog colour (its sky dome fades to it at the horizon). */
export const HOLLOW_CRYPT_FOG_COLOR = 0x1c2238;
/** The Sunken Bastion's storm-tide sea fog (its sky dome fades to it at the horizon). */
export const SUNKEN_BASTION_FOG_COLOR = 0x4d5a57;
/** The Drowned Temple's violet night haze (its sky dome fades to it at the horizon). */
export const DROWNED_TEMPLE_FOG_COLOR = 0x252a4c;
/** The Wildheart Basin's humid gold haze (its sky dome fades to it at the horizon). */
export const WILDHEART_BASIN_FOG_COLOR = BASIN_FOG_COLOR;
/** The Gravewyrm Sanctum's thin blue dusk (its sky's horizon too): clear air
 *  that only turns blue with distance, never a murk and never a sea mist. */
export const GRAVEWYRM_SANCTUM_FOG_COLOR = SANCTUM_FOG_COLOR;

export interface FogSceneResolution {
  /** The named dungeon interior the player stands in (null/undefined in the
   *  open world, a delve, the maze, a battleground, or the arena). */
  interior: string | null | undefined;
  desired: FogSceneState;
}

/** Mirrors THREE.Fog structurally so this module stays Three-free. */
export interface FogTarget {
  color: { setHex(value: number): unknown };
  near: number;
  far: number;
}

/** Resolve which fog scene state the player's position wants this frame. */
export function resolveFogScene(
  inside: boolean,
  px: number,
  camY: number,
  cam: { x: number; z: number },
  seed: number,
): FogSceneResolution {
  const inDelve = inside && isDelvePos(px);
  const inYumiMaze = inside && isYumiMazePos(px);
  const inBattleground = inside && isBgPos(px);
  const interior =
    inside && !inDelve && !inYumiMaze && !inBattleground && !isArenaPos(px)
      ? dungeonAt(px)?.interior
      : null;
  const inTemple = interior === 'temple';
  const inNythraxis = interior === 'nythraxis';
  const ignivarRaidFogState = ignivarRaidFogStateForInterior(interior ?? null);
  // The Wildheart Basin: an open-air jungle caldera on a humid gold
  // afternoon, under its OWN sky (the world dome hides inside it).
  const inWildheartBasin = interior === 'wildheart';
  // The Hollow Crypt is open-air too, but at night under its OWN sky: the
  // world dome hides and the interior group carries the moonlit sky.
  const inHollowCrypt = interior === 'hollow_crypt';
  // The Sunken Bastion: open-air at storm-tide dusk under its own sky.
  const inSunkenBastion = interior === 'sunken_bastion';
  // The Drowned Temple: open-air at night over its lagoon, under its own sky.
  const inDrownedTemple = interior === 'drowned_temple';
  // The Gravewyrm Sanctum: open-air at polar dusk under its own sky.
  const inGravewyrmSanctum = interior === 'gravewyrm_sanctum';
  const inLastKeep = interior === 'lastkeep';
  const inDawnhold = interior === 'dawnhold';
  const desired: FogSceneState = inDelve
    ? 'delve'
    : inYumiMaze
      ? 'yumiMaze'
      : inBattleground
        ? 'battleground'
        : inTemple
          ? 'temple'
          : inNythraxis
            ? 'nythraxis'
            : ignivarRaidFogState
              ? ignivarRaidFogState
              : inWildheartBasin
                ? 'wildheartBasin'
                : inHollowCrypt
                  ? 'hollowCrypt'
                  : inSunkenBastion
                    ? 'sunkenBastion'
                    : inDrownedTemple
                      ? 'drownedTemple'
                      : inGravewyrmSanctum
                        ? 'gravewyrmSanctum'
                        : inLastKeep
                          ? 'lastkeep'
                          : inDawnhold
                            ? 'dawnhold'
                            : inside
                              ? 'dungeon'
                              : camY < waterLevelAt(cam.x, cam.z, seed) - 0.05
                                ? 'underwater'
                                : 'outdoor';
  return { interior, desired };
}

/**
 * Apply the settled fog preset for a non-rift state (the rift palette stays
 * the renderer's: it re-applies per floor, not per settle). Branch order and
 * values are verbatim from the coordinator; the outdoor preset arrives as the
 * caller's thunk because the renderer grades it per frame.
 */
export function applyFogScenePreset(
  desired: FogSceneState,
  fog: FogTarget,
  outdoorPreset: () => { color: number; near: number; far: number },
): void {
  if (desired === 'dungeon') {
    fog.color.setHex(0x05060a);
    fog.near = 18;
    fog.far = 90;
  } else if (desired === 'temple') {
    // the Drowned Temple reads as submerged: a teal murk instead of the
    // crypt's near-black, so its flooded halls feel underwater, not just dark
    fog.color.setHex(0x0a3a44);
    fog.near = 12;
    fog.far = 78;
  } else if (desired === 'nythraxis') {
    // the raid arena is huge (±230), push the murk back so ~50yd reads
    // clear (linear-fog midpoint (near+far)/2 = 50), not the old ~30
    fog.color.setHex(0x020106);
    fog.near = 20;
    fog.far = 80;
  } else if (desired === 'ignivarApproach' || desired === 'ignivar' || desired === 'varkhul') {
    // a raid state only ever settles from ignivarRaidFogStateForInterior, so
    // matching the three state names here is the same condition the renderer
    // held as (ignivarRaidFogState && desired === ignivarRaidFogState)
    applyIgnivarRaidFog(desired, fog);
  } else if (desired === 'wildheartBasin') {
    // Humid gold haze over the jungle caldera: pushed far back so the falls,
    // the river and the stone jaguar read from the Idol Maw (480 yd), while
    // the caldera walls soften into the gold; the gorge's own thicker haze is
    // the interior's (render/wildheart_basin/basin_air.ts).
    fog.color.setHex(WILDHEART_BASIN_FOG_COLOR);
    fog.near = 150;
    fog.far = 1050;
  } else if (desired === 'hollowCrypt') {
    // Night air over the grave-mist: a deep blue-violet veil pushed far back
    // so the whole necropolis and the ritual column read from the landing,
    // while the far crag settles into silhouette against the sky.
    fog.color.setHex(HOLLOW_CRYPT_FOG_COLOR);
    fog.near = 70;
    fog.far = 460;
  } else if (desired === 'sunkenBastion') {
    // Storm-tide sea fog: grey-green and heavy low over the water, pushed back
    // far enough that the whole headland climbs out of it from the landing and
    // the Fogbeacon reads at the top, while the far coast drowns in it.
    fog.color.setHex(SUNKEN_BASTION_FOG_COLOR);
    fog.near = 70;
    fog.far = 640;
  } else if (desired === 'drownedTemple') {
    // A thin violet night haze over the lagoon, pushed far back so the Moon
    // Altar's column and the far rim's falls read from the Moongate Landing
    // (440 yd), while the crater wall fades into the night.
    fog.color.setHex(DROWNED_TEMPLE_FOG_COLOR);
    fog.near = 140;
    fog.far = 1050;
  } else if (desired === 'gravewyrmSanctum') {
    // Thin, clear polar dusk: the air only turns blue with distance, pushed
    // far back so the whole cirque, the lake far below and the dragon in the
    // Calving Face read from the Gate Landing (about 480 yd), while the ring
    // of Thornpeak's summits settles into the blue hour. The steam over the
    // Thaw Works and the vault is the interior's own (render/gravewyrm_sanctum).
    fog.color.setHex(GRAVEWYRM_SANCTUM_FOG_COLOR);
    fog.near = 90;
    fog.far = 980;
  } else if (desired === 'lastkeep') {
    // The Last Keep: a warm hearth-lit haze pushed well back, so its
    // grand three-story halls read golden and inhabited instead of
    // dissolving into the crypt's cold near-black murk.
    fog.color.setHex(0x241610);
    fog.near = 30;
    fog.far = 150;
  } else if (desired === 'dawnhold') {
    // Dawnhold Castle: brighter and greener-warm than the keep's hearth
    // murk: a pale sage-gold air pushed even further back, so the garden
    // palace reads sunlit end to end.
    fog.color.setHex(0x3d422a);
    fog.near = 40;
    fog.far = 190;
  } else if (desired === 'delve') {
    // the collapsed reliquary breathes a warm ember murk, dried-blood
    // charcoal, tighter than the overworld crypt's cold near-black, so the
    // delve reads as its own claustrophobic place under the red torches
    fog.color.setHex(0x0e0705);
    fog.near = 14;
    fog.far = 74;
  } else if (desired === 'yumiMaze') {
    // the Protect Yumi maze is a COMPETITIVE arena: a lighter night-blue
    // murk pushed well past the ~90yd footprint, so the torches + team
    // beacons read across the maze instead of dissolving mid-corridor
    fog.color.setHex(0x161d31);
    fog.near = 30;
    fog.far = 170;
  } else if (desired === 'battleground') {
    // Thornhollow Fields is OPEN-AIR at immersive scale (100x280): true
    // view-distance fog, the open world's own rule. The fight around you
    // (~a chamber) reads clearly; the far keep's detail still dissolves
    // before the 236yd flag-to-flag line, so the far chambers stay places
    // you travel to, not read from spawn. Pushed back from the original
    // 55/130 after the playtest: the tighter wall of haze swallowed the
    // sky and flattened the light; at 70/210 the dome and ramparts
    // breathe while the tactical veil holds. Symmetric for both teams:
    // distance, never information.
    fog.color.setHex(0xaecbe0);
    fog.near = 70;
    fog.far = 210;
  } else if (desired === 'underwater') {
    fog.color.setHex(0x17506e);
    fog.near = 2;
    fog.far = 48;
  } else {
    const preset = outdoorPreset();
    fog.color.setHex(preset.color);
    fog.near = preset.near;
    fog.far = preset.far;
  }
}
