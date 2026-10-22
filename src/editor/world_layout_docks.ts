import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
  DOCK_SECTION_HALF_DEPTH,
  DOCK_SECTION_HALF_WIDTH,
  DOCK_SECTION_LOCAL_Z,
  dockSectionWorldCenter,
  dockSurfaceLine,
  dockSurfaceYAt,
} from '../sim/dock_layout';
import type { MapPlacement } from '../sim/map_doc';
import type { PlacedAsset, ZonePropsDef } from '../sim/types';
import { terrainHeight } from '../sim/world';
import type { LayoutDeck } from '../sim/world_layout/decks';
import { WORLD_SEED } from '../sim/world_seed';

/** Bind the original analytic plank surface to the exact model frame before editing. */
export function layoutDockDecks(
  dock: ZonePropsDef['docks'][number],
  children: readonly MapPlacement[],
  targets: readonly PlacedAsset[],
): LayoutDeck[] {
  const ground = (x: number, z: number) => terrainHeight(x, z, WORLD_SEED);
  const line = dockSurfaceLine(dock, ground);
  const ds = dock.scale ?? 1;
  return DOCK_SECTION_LOCAL_Z.map((localZ, index) => {
    const source = children[index],
      target = targets[index];
    if (
      source?.assetId !== 'props/dock_platform' ||
      target?.path !== '/models/props/dock_platform.glb'
    )
      throw new Error('Dock deck replacement needs the original plank model.');
    const base =
      (source.detached ? (source.groundY ?? 0) : ground(source.x, source.z)) + (source.y ?? 0);
    const inverse = new Matrix4()
      .compose(
        new Vector3(source.x, base, source.z),
        new Quaternion().setFromEuler(new Euler(source.rotX ?? 0, source.rotY, source.rotZ ?? 0)),
        new Vector3(
          source.scale * (source.scaleX ?? 1),
          source.scale * (source.scaleY ?? 1),
          source.scale * (source.scaleZ ?? 1),
        ),
      )
      .invert();
    const center = dockSectionWorldCenter(dock, index);
    const worldOrigin = new Vector3(center.x, dockSurfaceYAt(line, localZ), center.z);
    const origin = worldOrigin.clone().applyMatrix4(inverse);
    // Bake rotation/scale during export, avoiding matrices/allocations on every
    // character ground query. Terrain seating remains live at the model anchor.
    const targetFrame = new Matrix4().compose(
      new Vector3(),
      new Quaternion().setFromEuler(new Euler(target.rotX ?? 0, target.rotY, target.rotZ ?? 0)),
      new Vector3(
        target.scale * (target.scaleX ?? 1),
        target.scale * (target.scaleY ?? 1),
        target.scale * (target.scaleZ ?? 1),
      ),
    );
    const targetOrigin = origin.clone().applyMatrix4(targetFrame);
    const worldAcross = new Vector3(
      2 * DOCK_SECTION_HALF_WIDTH * ds * Math.cos(dock.rot),
      0,
      -2 * DOCK_SECTION_HALF_WIDTH * ds * Math.sin(dock.rot),
    );
    const worldAlong = new Vector3(
      2 * DOCK_SECTION_HALF_DEPTH * ds * Math.sin(dock.rot),
      2 * DOCK_SECTION_HALF_DEPTH * line.slope,
      2 * DOCK_SECTION_HALF_DEPTH * ds * Math.cos(dock.rot),
    );
    const vector = (v: Vector3) => {
      const local = worldOrigin
        .clone()
        .add(v)
        .applyMatrix4(inverse)
        .sub(origin)
        .applyMatrix4(targetFrame);
      return { x: local.x, y: local.y, z: local.z };
    };
    return {
      placement: target,
      origin: { x: targetOrigin.x, y: targetOrigin.y, z: targetOrigin.z },
      across: vector(worldAcross),
      along: vector(worldAlong),
    };
  });
}
