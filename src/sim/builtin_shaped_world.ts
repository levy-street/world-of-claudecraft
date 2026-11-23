// Whether a world is the built-in world or a copy of it.
//
// Several harbor pieces drew (and collided) only for
// `getActiveWorldContent() === BUILTIN_WORLD`, an OBJECT IDENTITY check: the
// harbor planks (render/eastbrook_harbor.ts buildHarborWood: New Eastbrook's
// quay and piers, and the far ferry piers), the Wyrmwatch cliff harbor and
// Wickharbor's wharf and harbor, with their rails and props in
// harbor_structures.ts. Every Studio document and every published map is a
// COPY of the built-in world, never that object, so the docks vanished there
// while their decks stayed walkable (deck_surfaces.ts answers on every
// world): players stood on invisible planks over the water.
//
// Gate on the data instead, the same shape the editor's own built-in-world
// gates use (editor/feature_prop_placements.ts promoteFeatureDressing): the
// built-in world by identity (unchanged, so the shipped path cannot drift), or
// any world with the default presentation whose zones are the built-in zones,
// id for id. A blank or flat authoring world keeps the old behavior. The
// scheduled ferry itself stays built-in only (transport_ferry.ts), and so do
// its berth markers and gates.

import { BUILTIN_WORLD, getActiveWorldContent } from './data';
import type { WorldContent } from './types';

export function isBuiltinShapedWorld(content: WorldContent): boolean {
  if (content === BUILTIN_WORLD) return true;
  if (content.presentationMode !== undefined) return false;
  const builtin = BUILTIN_WORLD.zones;
  return (
    content.zones.length === builtin.length &&
    content.zones.every((zone, index) => zone.id === builtin[index].id)
  );
}

export function activeWorldIsBuiltinShaped(): boolean {
  return isBuiltinShapedWorld(getActiveWorldContent());
}
