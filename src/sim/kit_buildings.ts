// The placed-kit ARCHITECTURE (the owner's Drakelands rebuild rows in the
// fortress table: the keep's halls and chapel, Wyrmwatch's tavern, stables,
// and church) as BuildingDef footprints, for the two consumers that read
// authored buildings BY FOOTPRINT: the zone map's building silhouettes
// (ui/map_window_view.ts) and the rested-XP inn test (progression/xp.ts).
// Never the renderer or the colliders: the kit pieces already draw through
// the env-prop pipeline and block through forgefatherFortressColliders, so
// feeding these into props.buildings would draw and block every piece twice.
// The footprint is the same OBB the kit's collider uses (native dims times
// scale, the placement's own yaw), so what the map strokes and what rests a
// body is exactly what blocks one. Pure leaf: deterministic, no rng.
import { FORGEFATHER_FORTRESS_PLACEMENTS } from './forgefather_fortress';
import {
  IGNIVAR_PROP_NATIVE,
  type IgnivarEnvPropKey,
  type IgnivarPropPlacement,
} from './ignivar_props';
import type { BuildingDef } from './types';

/** The kit pieces that read as a building: houses and halls, and the church
 *  as a chapel. Furniture, fences, signs, and graves are not buildings. */
export const KIT_BUILDING_KINDS: Partial<Record<IgnivarEnvPropKey, BuildingDef['kind']>> = {
  building_1: 'house',
  building_2: 'house',
  building_base: 'house',
  building_base_roof: 'house',
  barracks: 'house',
  stables: 'house',
  church: 'chapel',
};

/** A tavern_sign hung within this many yards of a house piece makes that
 *  piece the inn: the sign IS the owner's declaration of which building
 *  is the tavern, so the rest area follows the placed sign, never a
 *  hand-typed coordinate that would drift when the piece is re-seated. */
export const TAVERN_SIGN_REACH = 6;

/** Derive the building footprints from a placement table (the shipped
 *  fortress table by default; tests pass their own rows). */
export function kitBuildingFootprints(
  placements: readonly IgnivarPropPlacement[] = FORGEFATHER_FORTRESS_PLACEMENTS,
): BuildingDef[] {
  const signs = placements.filter((p) => p.key === 'tavern_sign');
  const out: BuildingDef[] = [];
  for (const p of placements) {
    const kind = KIT_BUILDING_KINDS[p.key];
    if (!kind) continue;
    const native = IGNIVAR_PROP_NATIVE[p.key];
    const isInn =
      kind === 'house' && signs.some((s) => Math.hypot(s.x - p.x, s.z - p.z) <= TAVERN_SIGN_REACH);
    out.push({
      kind: isInn ? 'inn' : kind,
      id: `kit:${p.key}@${p.x},${p.z}`,
      x: p.x,
      z: p.z,
      w: native.len * p.scale,
      d: native.dep * p.scale,
      rot: p.ry,
      height: native.hei * p.scale,
    });
  }
  return out;
}

/** The shipped kit's footprints, derived once at load. */
export const KIT_BUILDINGS: readonly BuildingDef[] = kitBuildingFootprints();
