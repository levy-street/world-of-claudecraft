import type { GraveyardDef, StationDef, WorldServicesDef, ZoneDef } from '../types';
import type { WorldLayout } from './types';

export function placeLayoutStations(
  base: readonly StationDef[],
  edits: WorldLayout['stations'],
): readonly StationDef[] {
  if (!edits || !Object.keys(edits).length) return base;
  for (const [id, edit] of Object.entries(edits)) {
    if (base.filter((station) => station.id === id).length !== 1)
      throw new Error(`Missing or ambiguous station identity: ${id}`);
    if (!Number.isFinite(edit.pos.x) || !Number.isFinite(edit.pos.z) || !edit.zoneId)
      throw new Error(`Invalid station placement: ${id}`);
  }
  return base.map((station) => {
    const edit = edits[station.id];
    return edit ? { ...station, pos: { ...edit.pos }, zoneId: edit.zoneId } : station;
  });
}

export function placeLayoutServices(
  base: WorldServicesDef | undefined,
  edits: WorldLayout['stations'],
  graveyards?: WorldLayout['graveyards'],
): WorldServicesDef | undefined {
  if ((!edits || !Object.keys(edits).length) && (!graveyards || !Object.keys(graveyards).length))
    return base;
  return {
    ...base,
    ...(edits && Object.keys(edits).length
      ? { stations: placeLayoutStations(base?.stations ?? [], edits) }
      : {}),
    ...(graveyards && Object.keys(graveyards).length
      ? { graveyards: placeLayoutGraveyards(base?.graveyards ?? [], graveyards) }
      : {}),
  };
}

function validatePoints(
  base: readonly { id: string }[],
  edits: Record<string, { x: number; z: number }>,
) {
  for (const [id, p] of Object.entries(edits)) {
    if (base.filter((entry) => entry.id === id).length !== 1)
      throw new Error(`Missing or ambiguous graveyard identity: ${id}`);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z))
      throw new Error(`Invalid graveyard placement: ${id}`);
  }
}

export function placeLayoutGraveyards(
  base: readonly GraveyardDef[],
  edits: WorldLayout['graveyards'],
): readonly GraveyardDef[] {
  if (!edits || !Object.keys(edits).length) return base;
  validatePoints(base, edits);
  return base.map((gy) => (edits[gy.id] ? { ...gy, x: edits[gy.id].x, z: edits[gy.id].z } : gy));
}

export function placeLayoutZoneGraveyards(
  base: ZoneDef[],
  edits: WorldLayout['zoneGraveyards'],
): ZoneDef[] {
  if (!edits || !Object.keys(edits).length) return base;
  validatePoints(base, edits);
  return base.map((zone) =>
    edits[zone.id] ? { ...zone, graveyard: { ...edits[zone.id] } } : zone,
  );
}
