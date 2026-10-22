// The indoor camera's rooms for a town view's walk-in painted buildings: one small registrar
// per town view. While the view builds, each walk-in building it stands registers its air
// (placed_town_interior_core.ts, at the record's own scale, turn and seat) with the
// indoor camera (interior_camera.ts); the next build first drops everything the last one
// registered, so a rebuilt view replaces its rooms and never doubles them, and a world without
// the town (or a document that owns its buildings as placements) keeps none. Every town that
// stands painted buildings owns one: Highwatch's through the shared placed-town view
// (placed_town_buildings.ts), Eastbrook's and Fenbridge's beside their own building loops
// (eastbrook_town.ts, fenbridge_town.ts). Built once per view, never per frame.

import { registerCameraInterior, unregisterCameraInterior } from './interior_camera';
import type { CameraInterior } from './interior_camera_core';
import {
  type PlacedTownInteriorBuilding,
  placedTownCameraInterior,
} from './placed_town_interior_core';

export interface PlacedTownInteriors {
  /** Drop every room this registered (the last view's): call it as a view starts to build. */
  clear(): void;
  /**
   * Register one placed building's rooms, its anchor standing on `groundAt` (the ground the
   * view stands the model on), at whatever turn it stands. A sealed record or a model with no
   * authored air registers nothing. Returns the air it registered (its doors, in its frame,
   * also feed the town's camera fade), or null when it registered nothing.
   */
  add(
    building: PlacedTownInteriorBuilding,
    groundAt: (x: number, z: number) => number,
  ): CameraInterior | null;
  /** The ids of the rooms registered now, in the order they were added. */
  ids(): readonly string[];
}

export function createPlacedTownInteriors(): PlacedTownInteriors {
  const registered: string[] = [];
  return {
    clear(): void {
      for (const id of registered) unregisterCameraInterior(id);
      registered.length = 0;
    },
    add(building, groundAt): CameraInterior | null {
      const p = building.placement;
      const interior = placedTownCameraInterior(building, p.groundY ?? groundAt(p.x, p.z));
      if (!interior) return null;
      // registering an id again replaces that room (interior_camera.ts), never doubles it
      registerCameraInterior(interior);
      if (!registered.includes(interior.id)) registered.push(interior.id);
      return interior;
    },
    ids: () => registered,
  };
}
