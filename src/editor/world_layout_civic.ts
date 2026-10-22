import type { MapDoc, MapPlacement } from '../sim/map_doc';
import { CIVIC_ASSETS, type CivicId, type CivicPlacement } from '../sim/world_layout/civic';
import { compileLayoutAdditions } from './world_layout_additions';
import { matchLayoutScenery } from './world_layout_scenery';

export interface CivicLayoutBinding {
  id: CivicId;
  uid: string;
  source: MapPlacement;
  reason: string;
}

/** Civic assets keep their canonical dimensions, collision and gameplay identity. */
export function compileLayoutCivic(
  map: MapDoc,
  bindings: readonly CivicLayoutBinding[] | undefined,
  current: readonly MapPlacement[] | undefined,
  used: Set<string>,
  reserved: Set<number>,
  issue: (id: string, reason: string) => void,
): Partial<Record<CivicId, CivicPlacement>> {
  const out: Partial<Record<CivicId, CivicPlacement>> = {};
  for (const binding of bindings ?? []) {
    try {
      const assetId = CIVIC_ASSETS[binding.id];
      const expectedName = binding.id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const matches =
        current && matchLayoutScenery([binding.source, binding.source], current).matches;
      if (
        !assetId ||
        binding.source.assetId !== assetId ||
        binding.source.name !== expectedName ||
        !binding.reason.trim() ||
        out[binding.id] ||
        matches?.length !== 1 ||
        reserved.has(matches[0].currentIndex)
      )
        throw new Error(
          'Civic binding needs a unique unchanged canonical model and named identity.',
        );
      const errors: string[] = [],
        localUsed = new Set(used);
      const projected = compileLayoutAdditions(
        map,
        { [binding.uid]: binding.reason },
        localUsed,
        (_id, reason) => errors.push(reason),
      );
      const p = projected[0],
        target = map.placements.find((p) => p.uid === binding.uid);
      if (errors.length || projected.length !== 1 || !target)
        throw new Error('Invalid civic placement.');
      // The native vault owns a terrain pad at its seat. A terrain-relative
      // GLB offset would feed that pad back into its own model height.
      if (binding.id === 'eastbrook_weekly_vault' && !p.detached)
        throw new Error('The weekly vault requires a detached fixed ground seat.');
      // Normalize only supported spatial fields back to the source. Everything
      // else (size, model, collision, material, tilt) must preserve the native asset.
      const normalized = {
        ...target,
        x: binding.source.x,
        z: binding.source.z,
        y: binding.source.y,
        rotY: binding.source.rotY,
        detached: binding.source.detached,
        groundY: binding.source.groundY,
      };
      if (
        matchLayoutScenery([normalized], [binding.source], map.assetCollisionMesh).matches
          .length !== 1
      )
        throw new Error(
          'Civic import supports position, yaw and ground seat only; model, size and collision must remain canonical.',
        );
      out[binding.id] = {
        x: p.x,
        z: p.z,
        rotation: p.rotY,
        lift: p.y ?? 0,
        ...(p.detached ? { groundY: p.groundY ?? 0 } : {}),
      };
      used.add(binding.uid);
      reserved.add(matches[0].currentIndex);
    } catch (error) {
      issue(`civic:${binding.id}`, error instanceof Error ? error.message : String(error));
    }
  }
  return out;
}
