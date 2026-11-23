// Placed copies of the authored towns' own models, drawn in the town's look.
//
// Eastbrook Vale and Fenbridge draw their square dressing from vertex-coloured
// GLBs that the town views recolour into semantic surfaces under a shared,
// textured town material (eastbrook_town.ts / fenbridge_town.ts). A plain
// placement of the same GLB renders the bare vertex colours instead, so a
// Studio document that promotes that dressing to placements
// (promotedScenery.authoredTownDressing) would visibly repaint the square.
//
// Every model listed here is used by ONE town and nothing else, so restyling
// by path is exact: any placement of it, promoted or hand-placed from the
// catalogue, now draws the way the town does. The one exception is the
// Eastbrook market stall's canopy colour, which the town takes from each
// stall's layout row; a placement names only the model, so it wears the
// default canopy. Models shared with the wider world (the plain fence, the
// dungeon bench) are deliberately absent.

import type * as THREE from 'three';
import { eastbrookStyledPlacedObject } from './eastbrook_town';
import { fenbridgeStyledPlacedObject } from './fenbridge_town';

type Styler = (source: THREE.Object3D, url: string) => THREE.Object3D | null;

const TOWN_STYLED_PATHS: Readonly<Record<string, Styler>> = {
  '/models/props/eastbrook_market_stall.glb': eastbrookStyledPlacedObject,
  '/models/props/fenbridge_mirelight_cistern.glb': fenbridgeStyledPlacedObject,
  '/models/props/fenbridge_provision_stall.glb': fenbridgeStyledPlacedObject,
  '/models/props/fenbridge_muster_board.glb': fenbridgeStyledPlacedObject,
  '/models/props/fenbridge_boardwalk.glb': fenbridgeStyledPlacedObject,
};

/** Whether placements of this model path draw in their town's look. */
export function isTownStyledPlacedPath(path: string): boolean {
  return Object.hasOwn(TOWN_STYLED_PATHS, path);
}

/** The town-styled template for a loaded GLB scene, or null for every other
 *  path (which keeps its own GLB materials) and while the town's textures
 *  have not loaded (the plain GLB draws instead of an atlas-less copy). */
export function townStyledPlacedTemplate(
  path: string,
  scene: THREE.Object3D,
): THREE.Object3D | null {
  const styler = Object.hasOwn(TOWN_STYLED_PATHS, path) ? TOWN_STYLED_PATHS[path] : undefined;
  return styler ? styler(scene, path) : null;
}
