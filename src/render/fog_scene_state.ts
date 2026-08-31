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
import { applyIgnivarRaidFog, ignivarRaidFogStateForInterior } from './ignivar_raid_environment';
import type { FogSceneState } from './interior_light_rig';

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
  // Wildheart is an OPEN-AIR jungle caldera, not a closed room: it keeps the
  // sky dome and the daylight rig and only swaps in its own field haze.
  const inWildheartField = interior === 'wildheart';
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
              : inWildheartField
                ? 'wildheartField'
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
  } else if (desired === 'wildheartField') {
    // Sunlit humid depth keeps the full caldera readable while the rear
    // shrine and limestone shell settle into a warm green atmospheric veil.
    fog.color.setHex(0x8ca786);
    fog.near = 105;
    fog.far = 430;
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
