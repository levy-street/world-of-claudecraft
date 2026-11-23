// The second ground sheet: cave tube floors, and the cuts that open the way in.
// Moved verbatim out of world.ts (the monolith ratchet); world.ts re-exports
// every public name here, so its importers stand unchanged.
//
// The rule lives in sim/ground_sheets.ts (pure); these bind it to the active
// content and the real heightfield (world.ts groundHeight / terrainHeight).
// Everything downstream of them, the renderer's dropped quads included,
// samples the SAME cut list through the SAME evaluator, which is what stops a
// cut becoming an invisible wall. Host-agnostic: no DOM, no RNG, no clock.

import { caveCameraMaxDist, caveFloorAt, caveSampleAt } from './caves';
import { supportHeightAt } from './colliders';
import { getActiveWorldContent } from './data';
import { cavitySheetAt, effectiveTerrainCuts, resolveGroundSheet } from './ground_sheets';
import { WALK_DECK_REACH } from './placement_ramps';
import { carveFieldAt, cutsVerticalRangeAt, inTerrainCut } from './terrain_cuts';
import type { CaveDef, TerrainCut } from './types';
import { groundHeight, groundHeightAtBody, terrainHeight } from './world';

/** The cuts that remove terrain on the active map: the maker's own, plus the
 *  mouth each self-carving cave bores for itself. */
function activeTerrainCuts(): readonly TerrainCut[] {
  const content = getActiveWorldContent();
  return effectiveTerrainCuts(content.caves, content.holes);
}

/** True when the active map carries any second-sheet geometry (a cave or a
 *  terrain cut). When false, every sheet query below early-outs to the plain
 *  surface answer, so a hot caller (the mob step fan) may skip them on this
 *  one constant-time check: the built-in world has neither. */
export function groundSheetsActive(): boolean {
  const content = getActiveWorldContent();
  return (content.caves?.length ?? 0) > 0 || activeTerrainCuts().length > 0;
}

// The carve-flagged subset (the solids with a real interior), memoized on the
// effective list's identity: the editor swaps whole arrays on every mutation,
// so a stale entry can never be read.
const carveCutCache = new WeakMap<readonly TerrainCut[], TerrainCut[]>();
function activeCarveCuts(): readonly TerrainCut[] {
  const cuts = activeTerrainCuts();
  if (cuts.length === 0) return cuts;
  let carves = carveCutCache.get(cuts);
  if (!carves) {
    carves = cuts.filter((c) => c.carve === true);
    carveCutCache.set(cuts, carves);
  }
  return carves;
}

/** True when the terrain sheet is cut away at (x, z), so there is no ground
 *  surface to stand on or draw there. */
export function terrainCutAt(x: number, z: number, seed: number): boolean {
  const cuts = activeTerrainCuts();
  if (cuts.length === 0) return false;
  return inTerrainCut(cuts, x, z, groundHeight(x, z, seed), getActiveWorldContent().holePatches);
}

/** terrainCutAt for a caller that already has the surface height in hand (the
 *  grass and dressing scatters, which sample terrainHeight anyway): same list,
 *  same evaluator, no second height computation. A map with no cuts pays one
 *  array-length check. */
export function terrainCutAtHeight(x: number, z: number, surfaceY: number): boolean {
  const cuts = activeTerrainCuts();
  if (cuts.length === 0) return false;
  return inTerrainCut(cuts, x, z, surfaceY, getActiveWorldContent().holePatches);
}

// How far above the feet a standable collider top still reads as walkable
// floor here. Matches the physics kernel's own step allowance
// (physics/character.ts MAX_STEP_HEIGHT) so the two never disagree about
// whether a low box is a step or a wall.
const SHEET_STEP_REACH = 0.9;

/** The ground height for a mover whose previous height was `prevY`: the
 *  terrain sheet (with any standable collider top within a step folded in,
 *  a baked box top or authored volume is walkable floor in this fork), a cave
 *  tube floor, a carve cavity floor, or the un-climbable rise that walls off
 *  a cut with nothing underneath. Equals groundHeight exactly on a map with
 *  no colliders standing proud and no caves or cuts. */
export function groundHeightNear(x: number, z: number, seed: number, prevY: number): number {
  let h = groundHeightAtBody(x, z, seed, prevY);
  // Radius 0: the top only holds you up where the box really is, matching the
  // fork's original colliderTopIn rule (no body-radius inflation).
  const support = supportHeightAt(seed, x, z, 0, prevY + SHEET_STEP_REACH);
  if (support > h) h = support;
  const content = getActiveWorldContent();
  const caves = content.caves;
  const cuts = activeTerrainCuts();
  if ((!caves || caves.length === 0) && cuts.length === 0) return h;
  return resolveGroundSheet(caves, cuts, content.holePatches, x, z, h, prevY).height;
}

/** groundHeightNear WITHOUT the standable-top fold: the terrain plus the
 *  cave/carve sheet resolution only. The physics kernel uses this, it has
 *  its own collider step machinery, and folding tops in here would let its
 *  landing query admit tops past the cap it was asked to respect. */
export function sheetGroundHeight(
  x: number,
  z: number,
  seed: number,
  prevY: number,
  deckReach = WALK_DECK_REACH,
): number {
  const h = groundHeightAtBody(x, z, seed, prevY, deckReach);
  const content = getActiveWorldContent();
  const caves = content.caves;
  const cuts = activeTerrainCuts();
  if ((!caves || caves.length === 0) && cuts.length === 0) return h;
  return resolveGroundSheet(caves, cuts, content.holePatches, x, z, h, prevY).height;
}

/** True when groundHeightNear would put that mover on a cave tube's floor
 *  rather than on the terrain surface. Movement reads it to let a mover deep
 *  in a tube pass under surface props. */
export function onCaveSheet(x: number, z: number, seed: number, prevY: number): boolean {
  const content = getActiveWorldContent();
  const caves = content.caves;
  if (!caves || caves.length === 0) return false;
  return resolveGroundSheet(
    caves,
    activeTerrainCuts(),
    content.holePatches,
    x,
    z,
    groundHeight(x, z, seed),
    prevY,
  ).cave;
}

/** True when the mover's sheet at (x, z) is a cave tube floor OR a carved
 *  cavity floor, any walkable ground UNDER the terrain surface. The steep-
 *  slope and climb gates read the SURFACE gradient, which is meaningless to a
 *  body walking a tunnel beneath it; they exempt themselves through this. */
export function onUnderSheet(x: number, z: number, seed: number, prevY: number): boolean {
  const content = getActiveWorldContent();
  const caves = content.caves;
  const cuts = activeTerrainCuts();
  if ((!caves || caves.length === 0) && cuts.length === 0) return false;
  const sheet = resolveGroundSheet(
    caves,
    cuts,
    content.holePatches,
    x,
    z,
    groundHeight(x, z, seed),
    prevY,
  );
  return sheet.cave || sheet.cavity;
}

/**
 * The ground a MOB rests on after a move. Mobs have always snapped to the
 * height-blind groundHeight, which is the mountain's SURFACE over a carve or a
 * tube: a camp spawned on a mine floor (carveSpawnFloor) jumped to the summit
 * on its first wander step and the tunnels played empty (SPACEY, 2026-09-18:
 * "the mobs in the tunnel were invis"). A mover standing on an under-sheet
 * keeps that sheet; everywhere else, and on any map without caves or cuts,
 * this is groundHeight to the bit, so shipped-world mob motion is unchanged.
 */
export function mobGroundHeight(x: number, z: number, seed: number, prevY: number): number {
  const content = getActiveWorldContent();
  if ((!content.caves || content.caves.length === 0) && activeTerrainCuts().length === 0) {
    return groundHeight(x, z, seed);
  }
  return onUnderSheet(x, z, seed, prevY)
    ? groundHeightNear(x, z, seed, prevY)
    : groundHeight(x, z, seed);
}

/** The rock/open ceiling over a mover's sheet at (x, z), or +Infinity when it
 *  stands on the open surface. The jump arc caps against this so a leap
 *  inside a tunnel bumps the roof instead of poking through it. */
export function sheetCeilingAt(x: number, z: number, seed: number, prevY: number): number {
  const content = getActiveWorldContent();
  const caves = content.caves;
  const cuts = activeTerrainCuts();
  if ((!caves || caves.length === 0) && cuts.length === 0) return Infinity;
  const surfaceY = groundHeight(x, z, seed);
  const sheet = resolveGroundSheet(caves, cuts, content.holePatches, x, z, surfaceY, prevY);
  if (sheet.cavity) {
    const tube = caves ? caveFloorAt(caves, x, z) : null;
    const cavity = cavitySheetAt(cuts, content.holePatches, x, z, surfaceY, prevY, tube);
    if (cavity && cavity.ceiling < surfaceY - 1e-3) return cavity.ceiling;
    return Infinity;
  }
  if (sheet.cave && caves) {
    const s = caveFloorAt(caves, x, z);
    if (s) return s.ceiling;
  }
  return Infinity;
}

/**
 * How far along the eye->camera segment the chase boom may pull before it
 * would sit inside solid rock: Infinity when the eye is on the open surface
 * (the overwhelmingly common case), else the last distance still inside the
 * cavity/tube air. Merges the cave clamp (sim/caves.ts caveCameraMaxDist)
 * with a march through the carve field.
 */
export function cameraSheetMaxDist(
  seed: number,
  ex: number,
  ey: number,
  ez: number,
  cx: number,
  cy: number,
  cz: number,
  pad: number,
): number {
  const content = getActiveWorldContent();
  const caves = content.caves;
  const carves = activeCarveCuts();
  let max = Infinity;
  if (caves && caves.length > 0) {
    max = caveCameraMaxDist(
      caves,
      (x, z) => terrainHeight(x, z, seed),
      ex,
      ey,
      ez,
      cx,
      cy,
      cz,
      pad,
    );
  }
  if (carves.length === 0) return max;
  // Only a camera whose EYE is inside a carve cavity below the surface is
  // confined; everywhere else the normal occlusion rules apply.
  if (ey >= terrainHeight(ex, ez, seed) - 0.1) return max;
  if (carveFieldAt(carves, content.holePatches, ex, ey, ez) >= 0) return max;
  const dx = cx - ex;
  const dy = cy - ey;
  const dz = cz - ez;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return max;
  const STEP = 0.5;
  for (let t = STEP; t <= len + STEP; t += STEP) {
    const tt = Math.min(t, len);
    const x = ex + (dx / len) * tt;
    const y = ey + (dy / len) * tt;
    const z = ez + (dz / len) * tt;
    // Risen above the local surface: out through a mouth or pit, open air,
    // the normal camera rules take over from here.
    if (y >= terrainHeight(x, z, seed) - 0.1) return max;
    if (carveFieldAt(carves, content.holePatches, x, y, z) >= -pad) {
      return Math.min(max, Math.max(0, tt - STEP));
    }
    if (tt >= len) break;
  }
  return max;
}

// The mid-body probe height for the rock test below: roughly a torso above
// the feet, low enough that ducking under a ceiling never false-positives,
// high enough that a per-tick uphill stride on walkable slopes stays clear.
const ROCK_PROBE_Y = 0.95;

/** True when a body standing at (x, y=feet, z) would have its torso inside
 *  SOLID GROUND: below the terrain surface, outside every carved cavity, and
 *  outside every cave tube's air. This is what makes a carve's walls rock. */
function solidRockAtBody(x: number, z: number, seed: number, feetY: number): boolean {
  const bodyY = feetY + ROCK_PROBE_Y;
  // BODY-AWARE, never the blind groundHeight: that answers with the highest
  // walkable surface in the column, which on any stacked structure is a deck
  // over the body's head. A player on a galleon's waist with the quarterdeck
  // 12 yd above them read as 12 yd UNDERGROUND and every step became a walk
  // into rock. The deck filter (WALK_DECK_REACH) drops only decks and plane
  // volumes out of reach above the feet - terrain and cave sheets still
  // count, so a body genuinely inside a hillside is still walled.
  if (bodyY >= groundHeightAtBody(x, z, seed, feetY) - 0.05) return false; // above ground
  const content = getActiveWorldContent();
  const carves = activeCarveCuts();
  if (carves.length > 0 && carveFieldAt(carves, content.holePatches, x, bodyY, z) < 0) {
    return false; // inside a carved cavity's air
  }
  const caves = content.caves;
  if (caves && caves.length > 0) {
    const s = caveFloorAt(caves, x, z);
    if (s && bodyY >= s.floor - 0.2 && bodyY <= s.ceiling + 0.2) return false; // tube air
  }
  return true;
}

// A tube's horseshoe wall band: inside the bore footprint where the arch
// pinches below standing height. Only bites a mover whose sheet IS that tube
// floor (or level with it, the flush-tube case, where the terrain outside
// sits at exactly the floor height and no climb gate can help). Mouth aprons
// are exempt: the opening must stay walkable.
function caveWallAtBody(caves: readonly CaveDef[], x: number, z: number, prevY: number): boolean {
  const s = caveSampleAt(caves, x, z);
  if (!s || s.mouth) return false;
  if (Math.abs(s.floor - prevY) > 1.6) return false; // not this mover's sheet
  const headroom = s.ceiling - s.floor;
  return headroom < Math.min(1.8, s.clearance * 0.55);
}

/**
 * Blocks a movement segment that would carry a body through solid rock: the
 * side wall of a carve, the horseshoe wall or exterior shell of a tube, the
 * face beside a mouth. Surface walkers away from every tube pay one bounds
 * scan and one comparison. The midpoint sample stops charge/knockback
 * substeps hopping a thin wall.
 */
export function sheetWallBlocksStep(
  seed: number,
  fromX: number,
  fromZ: number,
  prevY: number,
  toX: number,
  toZ: number,
): boolean {
  const content = getActiveWorldContent();
  const caves = content.caves;
  const cuts = activeTerrainCuts();
  if ((!caves || caves.length === 0) && cuts.length === 0) return false;
  if (fromX === toX && fromZ === toZ) return false;
  const midX = (fromX + toX) / 2;
  const midZ = (fromZ + toZ) / 2;
  // Tube walls exist at ANY height (a flush or above-ground shell included).
  if (caves && caves.length > 0) {
    if (caveWallAtBody(caves, toX, toZ, prevY) || caveWallAtBody(caves, midX, midZ, prevY)) {
      return true;
    }
  }
  // Underground rock: only a mover already below the surface can be walled by
  // it. The proxy for "under a sheet" must be the BODY-AWARE ground - the
  // blind one counts a deck over the mover's head as the ground they are
  // under, which turned every ship deck, gallery and upper storey on a map
  // that owns a carve into solid rock (the early-out above means a map with
  // no caves and no cuts never saw it).
  if (prevY >= groundHeightAtBody(fromX, fromZ, seed, prevY) - 0.5) return false;
  if (solidRockAtBody(toX, toZ, seed, prevY)) return true;
  return solidRockAtBody(midX, midZ, seed, prevY);
}

/**
 * True when a step lands where the nearest walkable sheet is a LAYER SWITCH
 * (more than a body-step from the mover's height) inside a cave or carve
 * footprint: the surface over the tunnel, or the tunnel under the field. The
 * mob fan skips such candidates, resolving them would teleport the mover
 * between layers. Points outside every footprint return false in a bounds
 * scan, so the open-world fan stays cheap.
 */
export function sheetStepMismatch(
  seed: number,
  fromX: number,
  fromZ: number,
  prevY: number,
  toX: number,
  toZ: number,
): boolean {
  const content = getActiveWorldContent();
  const caves = content.caves;
  const carves = activeCarveCuts();
  if ((!caves || caves.length === 0) && carves.length === 0) return false;
  const inFootprint =
    (caves &&
      caves.length > 0 &&
      (caveFloorAt(caves, toX, toZ) !== null || caveFloorAt(caves, fromX, fromZ) !== null)) ||
    (carves.length > 0 &&
      (cutsVerticalRangeAt(carves, toX, toZ) !== null ||
        cutsVerticalRangeAt(carves, fromX, fromZ) !== null));
  if (!inFootprint) return false;
  return Math.abs(groundHeightNear(toX, toZ, seed, prevY) - prevY) > 1.6;
}

// A small designed step between sheets: walking out of a cave mouth onto the
// bank, or over a carve's lip, is a doorway, not a cliff.
const SHEET_MOUTH_STEP_UP = 1.1;

/** Allow a small upward step only when the move TRANSFERS between the surface
 *  sheet and an under-sheet (tube or cavity), the mouth/lip crossing. Plain
 *  terrain cliffs see no transfer and keep the full climb gate. */
export function sheetMouthStepOk(
  seed: number,
  fromX: number,
  fromZ: number,
  prevY: number,
  toX: number,
  toZ: number,
  h0: number,
  h1: number,
): boolean {
  const rise = h1 - h0;
  if (rise <= 0 || rise > SHEET_MOUTH_STEP_UP) return false;
  const content = getActiveWorldContent();
  const caves = content.caves;
  const cuts = activeTerrainCuts();
  if ((!caves || caves.length === 0) && cuts.length === 0) return false;
  return onUnderSheet(fromX, fromZ, seed, prevY) !== onUnderSheet(toX, toZ, seed, prevY);
}
