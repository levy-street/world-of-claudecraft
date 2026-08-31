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
import { CRYPT_LAYOUT, layoutColliders } from './dungeon_layout';
import { ignivarPropColliders } from './ignivar_props';

const interiorSetByDungeon = new Map<string, Collider[]>();

/** The derived interior collider set for a dungeon (statics short-circuit:
 *  interiors whose collision is not derived from an INTERIOR_LAYOUTS room
 *  plan, e.g. Wildheart's open field or the Last Keep's authored graph). */
export function derivedInteriorColliders(
  dungeonId: string | null,
  interior: string,
  staticSets: Record<string, Collider[]>,
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
