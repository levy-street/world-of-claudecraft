import { freezeObjectMoves } from '../moved_objects';
import type { CampDef, GroundObjectDef, NpcDef, WorldContent } from '../types';
import { placeLayoutEnvironment } from './environment';
import { placeLayoutProps } from './props';
import { placeLayoutRoads } from './roads';
import { placeLayoutScenery } from './scenery';
import { placeLayoutServices, placeLayoutZoneGraveyards } from './services';
import type { WorldLayout } from './types';

export function campLayoutKey(camp: Pick<CampDef, 'mobId' | 'center'>): string {
  return JSON.stringify([camp.mobId, camp.center.x, camp.center.z]);
}

export function placeLayoutCamps(base: CampDef[], edits: WorldLayout['camps']): CampDef[] {
  if (!edits.length) return base;
  const entries = edits.flatMap((edit) =>
    edit.sources.map((source) => [campLayoutKey(source), edit] as const),
  );
  const campEdits = new Map(entries);
  if (campEdits.size !== entries.length) throw new Error('Duplicate camp layout identity');
  const baseCamps = new Set(base.map(campLayoutKey));
  for (const key of campEdits.keys()) {
    if (base.filter((camp) => campLayoutKey(camp) === key).length > 1)
      throw new Error(`Ambiguous canonical camp identity: ${key}`);
  }
  for (const key of campEdits.keys())
    if (!baseCamps.has(key)) throw new Error(`Unknown camp: ${key}`);
  const campByKey = new Map(base.map((camp) => [campLayoutKey(camp), camp]));
  for (const edit of edits) {
    if (!edit.sources.length) throw new Error('Camp edit needs a canonical source');
    const behavior = edit.sources.map((source) => {
      const camp = campByKey.get(campLayoutKey(source));
      if (!camp) throw new Error('Missing canonical camp');
      const { center: _center, radius: _radius, count: _count, ...rest } = camp;
      return JSON.stringify(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));
    });
    if (behavior.some((b) => b !== behavior[0]))
      throw new Error('Camp merge has differing gameplay behavior');
  }
  return base.flatMap((camp) => {
    const edit = campEdits.get(campLayoutKey(camp));
    if (!edit) return [camp];
    if (campLayoutKey(camp) !== campLayoutKey(edit.sources[0])) return [];
    return edit.placements.map((p) => ({
      ...camp,
      center: { ...p.center },
      radius: p.radius,
      count: p.count,
    }));
  });
}

export function placeLayoutNpcs(
  base: Record<string, NpcDef>,
  edits: WorldLayout['npcs'],
): Record<string, NpcDef> {
  if (!Object.keys(edits).length) return base;
  for (const id of Object.keys(edits))
    if (!Object.hasOwn(base, id)) throw new Error(`Unknown NPC: ${id}`);
  return Object.fromEntries(
    Object.entries(base).map(([id, npc]) => {
      const edit = edits[id];
      return [
        id,
        edit
          ? {
              ...npc,
              pos: { ...edit.pos },
              ...(edit.facing === undefined ? {} : { facing: edit.facing }),
            }
          : npc,
      ];
    }),
  );
}

export function placeLayoutObjects(
  base: GroundObjectDef[],
  edits: WorldLayout['groundObjects'],
): GroundObjectDef[] {
  if (!Object.keys(edits).length) return base;
  const objectIds = new Set(base.map((object) => object.itemId));
  for (const id of Object.keys(edits)) {
    if (base.filter((object) => object.itemId === id).length > 1)
      throw new Error(`Ambiguous ground object identity: ${id}`);
  }
  for (const id of Object.keys(edits))
    if (!objectIds.has(id)) throw new Error(`Unknown ground object: ${id}`);
  return base.map((object) => {
    const edit = edits[object.itemId];
    return edit ? { ...object, positions: edit.positions.map((p) => ({ ...p })) } : object;
  });
}

/** Spatial edits retain current capabilities, inventories, quests and camp behavior. */
export function composeWorldLayout(base: WorldContent, layout: WorldLayout): WorldContent {
  if (layout.version !== 1) throw new Error('Unsupported world layout version');
  return {
    ...placeLayoutScenery(placeLayoutEnvironment(base, layout.environment), layout.scenery),
    props: placeLayoutProps(
      base.props,
      layout.scenery?.propRemovals,
      layout.scenery?.retainedFences,
    ),
    // Iterate current content, preserving insertion order and newer definitions.
    npcs: placeLayoutNpcs(base.npcs, layout.npcs),
    zones: placeLayoutZoneGraveyards(base.zones, layout.zoneGraveyards),
    camps: placeLayoutCamps(base.camps, layout.camps),
    groundObjects: placeLayoutObjects(base.groundObjects, layout.groundObjects),
    roads: placeLayoutRoads(base.roads, layout.roads),
    ...(layout.stations || layout.graveyards
      ? { services: placeLayoutServices(base.services, layout.stations, layout.graveyards) }
      : {}),
    ...(Object.keys(layout.objectMoves).length
      ? { objectMoves: freezeObjectMoves({ ...base.objectMoves, ...layout.objectMoves }) }
      : {}),
  };
}
