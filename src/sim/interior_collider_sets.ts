// Per-dungeon interior collider set assembly, extracted from colliders.ts
// (the monolith ratchet). Dungeons sharing a room plan (Hollow Crypt and the
// Sunken Bastion are both 'crypt') dress their wall-side slots with
// different furniture, so the standable tops differ per dungeon even where
// the walls do not. Built lazily, cached by dungeon id. The Ignivar rooms
// append their authored dressing-prop colliders (ignivar_props.ts) so the
// hand-placed pillars, doors, and machines block movement exactly where
// they render.
import type { Collider } from './colliders';
import { DUNGEON_FLOOR_Y, DUNGEONS } from './data';
import { INTERIOR_LAYOUTS } from './dungeon_floor';
import { CRYPT_LAYOUT, DAWNHOLD_LAYOUT, LASTKEEP_LAYOUT, layoutColliders } from './dungeon_layout';
import { fireAndFlyColliders } from './fire_and_fly_field';
import { ignivarPropColliders } from './ignivar_props';
import { WILDHEART_COLLIDERS } from './wildheart_field';

// Interiors whose collision is NOT derived from an INTERIOR_LAYOUTS room plan:
// the open fields (Wildheart, the Fire and Fly arena: walls plus prop specs)
// and the authored room graphs (the Last Keep, Dawnhold Castle, whose walls
// minus doorways and decor footprints derive from one shared layout, exactly
// like the rift citadel floors). All static and seated on DUNGEON_FLOOR_Y, so
// their standable tops read in the same frame; they short-circuit the
// per-dungeon derivation below rather than falling back to the crypt plan.
const STATIC_INTERIOR_COLLIDERS: Record<string, Collider[]> = {
  wildheart: WILDHEART_COLLIDERS,
  lastkeep: layoutColliders(LASTKEEP_LAYOUT, undefined, DUNGEON_FLOOR_Y),
  dawnhold: layoutColliders(DAWNHOLD_LAYOUT, undefined, DUNGEON_FLOOR_Y),
  fire_and_fly: fireAndFlyColliders(DUNGEON_FLOOR_Y),
};

const interiorSetByDungeon = new Map<string, Collider[]>();

/** The interior collider set for a dungeon: a static set when the interior has
 *  one, otherwise the set derived from its INTERIOR_LAYOUTS room plan. */
export function derivedInteriorColliders(
  dungeonId: string | null,
  interior: string,
  staticSets: Record<string, Collider[]> = STATIC_INTERIOR_COLLIDERS,
): Collider[] {
  const staticSet = staticSets[interior];
  if (staticSet) return staticSet;
  const key = dungeonId ?? `interior:${interior}`;
  let set = interiorSetByDungeon.get(key);
  if (!set) {
    const layout = INTERIOR_LAYOUTS[interior] ?? CRYPT_LAYOUT;
    const dressing = dungeonId ? DUNGEONS[dungeonId]?.tombDressing : undefined;
    set = layoutColliders(layout, dressing, DUNGEON_FLOOR_Y).concat(
      ignivarPropColliders(interior, layout),
    );
    interiorSetByDungeon.set(key, set);
  }
  return set;
}
