// Where the seasonal city dressing never goes: the event cities' chapels. A chapel is
// a quiet place, so no pumpkin, straw, lantern, garland or glow stands at it, round it
// or inside it (owner note 2026-10-18). Pure and deterministic, no Three.
//
// The chapel is found by its building record's own kind ('chapel' in the authored town
// registry), never by a coordinate, so a town rework that moves or rebuilds it moves the
// exclusion with it. The zone is the model's whole reach box (the hall, its bell tower,
// its notice board) grown by CHAPEL_DECOR_CLEARANCE on every side.
import { SEASONAL_EVENT_TOWNS } from './seasonal_towns';

/** How far past a chapel's reach box the dressing keeps away (yards). */
export const CHAPEL_DECOR_CLEARANCE = 8;

interface ChapelBox {
  id: string;
  cx: number;
  cz: number;
  cos: number;
  sin: number;
  halfWidth: number;
  halfDepth: number;
}

const CHAPELS: readonly ChapelBox[] = SEASONAL_EVENT_TOWNS.flatMap((town) => town.buildings)
  .filter((b) => b.kind === 'chapel')
  .map((b) => ({
    id: b.id,
    cx: b.reach.center.x,
    cz: b.reach.center.z,
    cos: Math.cos(b.reach.rotation),
    sin: Math.sin(b.reach.rotation),
    halfWidth: b.reach.halfWidth,
    halfDepth: b.reach.halfDepth,
  }));

/** The ids of the event cities' chapels (exported for the pin). */
export const SEASONAL_CHAPEL_IDS: readonly string[] = CHAPELS.map((c) => c.id);

/** The chapel whose keep-clear zone holds (x, z), or null. `margin` is the clearance
 *  past the reach box (the default for the dressing; the pin can probe it tighter). */
export function chapelAt(x: number, z: number, margin = CHAPEL_DECOR_CLEARANCE): string | null {
  for (const c of CHAPELS) {
    const dx = x - c.cx;
    const dz = z - c.cz;
    // the building yaw's inverse (the same frame the registry's boxes are authored in)
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    if (Math.abs(lx) <= c.halfWidth + margin && Math.abs(lz) <= c.halfDepth + margin) return c.id;
  }
  return null;
}
