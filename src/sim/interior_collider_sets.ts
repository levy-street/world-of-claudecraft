// Per-dungeon interior collider set assembly, extracted from colliders.ts
// (the monolith ratchet). Dungeons sharing a room plan (the Sunken Bastion and
// the Abandoned Crypt are both 'crypt') dress their wall-side slots with
// different furniture, so the standable tops differ per dungeon even where
// the walls do not. Built lazily, cached by dungeon id. The Ignivar rooms
// append their authored dressing-prop colliders (ignivar_props.ts) so the
// hand-placed pillars, doors, and machines block movement exactly where
// they render.
//
// The static table of interiors whose collision is NOT derived from an
// INTERIOR_LAYOUTS room plan lives here too (moved out of colliders.ts), as
// does the per-slot view: a dungeon with in-instance gates appends its gate
// colliders, and each slot sees the list minus the gates open in THAT slot
// (instances/dungeon_gate_state.ts).
import type { Collider } from './colliders';
import { DUNGEON_FLOOR_Y, DUNGEONS } from './data';
import { INTERIOR_LAYOUTS } from './dungeon_floor';
import { CRYPT_LAYOUT, DAWNHOLD_LAYOUT, LASTKEEP_LAYOUT, layoutColliders } from './dungeon_layout';
import { ignivarPropColliders } from './ignivar_props';
import { authoredFieldColliders, authoredFieldFor } from './instances/authored_field';
import { slotWalledColliders } from './instances/combat_wall_state';
import { dungeonGateColliders } from './instances/dungeon_gate_colliders';
import { slotGatedColliders } from './instances/dungeon_gate_state';

// The Last Keep: an authored room-graph interior, so its walls (minus
// doorways) and decor footprints all derive from the one shared layout,
// exactly like the rift citadel floors (layoutColliders routes through
// authoredColliders). Seated on DUNGEON_FLOOR_Y like every derived interior
// set below, so its standable tops read in the same frame.
const LASTKEEP_COLLIDERS: Collider[] = layoutColliders(LASTKEEP_LAYOUT, undefined, DUNGEON_FLOOR_Y);
// Dawnhold Castle: the Evergarden garden palace, same authored room-graph
// derivation as The Last Keep (walls minus doorways plus decor footprints).
const DAWNHOLD_COLLIDERS: Collider[] = layoutColliders(DAWNHOLD_LAYOUT, undefined, DUNGEON_FLOOR_Y);

// Interiors whose collision is NOT derived from an INTERIOR_LAYOUTS room plan:
// the Last Keep and Dawnhold are authored room graphs. Both are static, so they
// short-circuit the per-dungeon derivation below rather than falling back to
// the crypt plan. Authored open fields (instances/authored_field, the Wildheart
// Basin among them) join through authoredFieldFor instead.
const STATIC_INTERIOR_COLLIDERS: Record<string, Collider[]> = {
  lastkeep: LASTKEEP_COLLIDERS,
  dawnhold: DAWNHOLD_COLLIDERS,
};

const interiorSetByDungeon = new Map<string, Collider[]>();

/** The derived interior collider set for a dungeon (statics short-circuit:
 *  interiors whose collision is not derived from an INTERIOR_LAYOUTS room
 *  plan, e.g. the Last Keep's authored graph). */
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
    const field = authoredFieldFor(interior);
    if (field) {
      // An authored open field: generated cliffs, walls and prop footprints,
      // plus the owning dungeon's gate colliders (tagged, filtered per slot).
      const gates = dungeonId ? (DUNGEONS[dungeonId]?.gates ?? []) : [];
      set = authoredFieldColliders(field, DUNGEON_FLOOR_Y).concat(
        dungeonGateColliders(gates, field, DUNGEON_FLOOR_Y),
      );
    } else {
      const layout = INTERIOR_LAYOUTS[interior] ?? CRYPT_LAYOUT;
      const dressing = dungeonId ? DUNGEONS[dungeonId]?.tombDressing : undefined;
      set = layoutColliders(layout, dressing, DUNGEON_FLOOR_Y).concat(
        ignivarPropColliders(interior, layout),
      );
    }
    interiorSetByDungeon.set(key, set);
  }
  return set;
}

/** The interior collider set a slot anchored at (ox, oz) collides with: the
 *  dungeon's shared set minus the gates open in that slot, plus the slot's
 *  live combat walls (instances/combat_wall_state.ts; none, at zero cost, in
 *  every slot with no wall standing). */
export function interiorCollidersFor(
  dungeonId: string | null,
  interior: string,
  ox: number,
  oz: number,
): Collider[] {
  return slotWalledColliders(
    slotGatedColliders(
      derivedInteriorColliders(dungeonId, interior, STATIC_INTERIOR_COLLIDERS),
      ox,
      oz,
    ),
    ox,
    oz,
  );
}
