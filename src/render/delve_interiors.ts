// Delve module interior placement: reuses the crypt KayKit kit but builds each
// module's OWN delve layout and a per-module ember-themed dressing variant.
import { DELVE_MODULES } from '../sim/data';
import { DELVE_MODULE_LAYOUTS, type DelveModuleId } from '../sim/delve_layout';
import type { DungeonInteriors, DungeonInteriorVariant } from './dungeon';

// Each reliquary module dresses the shared crypt kit differently (ossuary
// shelves, handbell alcoves, defaced saint colonnade, the boss bell-chamber).
const DELVE_MODULE_VARIANT: Record<DelveModuleId, DungeonInteriorVariant> = {
  reliquary_sunken_ossuary: 'delve_ossuary',
  reliquary_bell_niche: 'delve_bell',
  reliquary_saintless_hall: 'delve_hall',
  reliquary_finale: 'delve_finale',
};

/** Build one delve module at a world origin (crypt KayKit kit + that module's delve layout). */
export function buildDelveModule(
  dungeons: DungeonInteriors,
  moduleId: DelveModuleId,
  ox: number,
  oz: number,
): Promise<void> {
  const mod = DELVE_MODULES[moduleId];
  const interior = mod?.interior ?? 'crypt';
  // Pass the module's own layout so visible geometry matches the collision set
  // sim/colliders.ts derives from the SAME layout. Falling back to the interior
  // default (CRYPT_LAYOUT) was the source of the drifting walls/floor and the
  // out-of-map gaps between modules. The 'delve' variant gives ember-red torches
  // with per-module reliquary dressing.
  const layout = DELVE_MODULE_LAYOUTS[moduleId];
  const variant = DELVE_MODULE_VARIANT[moduleId] ?? 'delve_ossuary';
  return dungeons.buildInterior(interior, ox, oz, { layout, variant });
}
