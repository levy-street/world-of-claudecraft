import type { CampDef, NpcDef } from '../sim/types';
import type { AssetPlacement } from './custom_map';

const MAX_NPC_ID_LENGTH = 64;

/** A placement clone with independent authored collision geometry. Collision
 * settings are part of the asset instance contract: duplicates must block in
 * exactly the same way as their source without sharing mutable box/deck data. */
export function cloneAssetPlacement(placement: AssetPlacement): AssetPlacement {
  return {
    ...placement,
    building: placement.building ? { ...placement.building } : undefined,
    wallFinishes: placement.wallFinishes ? structuredClone(placement.wallFinishes) : undefined,
    hitboxes: placement.hitboxes?.map((hitbox) => ({ ...hitbox })),
    ramps: placement.ramps?.map((ramp) => ({ ...ramp })),
  };
}

/** Resolve a placement marquee without mutating either selection. A normal
 * Ctrl/Cmd-drag replaces the pool; Ctrl/Cmd+Shift-drag only adds to it. */
export function marqueePlacementSelection(
  current: ReadonlySet<number>,
  incoming: readonly number[],
  additive: boolean,
): Set<number> {
  if (!additive) return new Set(incoming);
  const next = new Set(current);
  for (const index of incoming) next.add(index);
  return next;
}

function cloneNpc(npc: NpcDef): NpcDef {
  return {
    ...npc,
    pos: { ...npc.pos },
    questIds: [...npc.questIds],
    vendorItems: npc.vendorItems ? [...npc.vendorItems] : undefined,
  };
}

export function copyPlacementSelection(
  placements: readonly AssetPlacement[],
  indices: ReadonlySet<number>,
): AssetPlacement[] {
  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => placements[index])
    .filter((placement): placement is AssetPlacement => placement !== undefined)
    .map(cloneAssetPlacement);
}

export function pastePlacementSelection(
  placements: readonly AssetPlacement[],
  dx: number,
  dz: number,
): AssetPlacement[] {
  return placements.map((placement) => ({
    ...cloneAssetPlacement(placement),
    x: placement.x + dx,
    z: placement.z + dz,
  }));
}

export function copyCampSelection(camps: Iterable<CampDef>): CampDef[] {
  return [...camps].map((camp) => ({ ...camp, center: { ...camp.center } }));
}

export function pasteCampSelection(camps: readonly CampDef[], dx: number, dz: number): CampDef[] {
  return camps.map((camp) => ({
    ...camp,
    center: { x: camp.center.x + dx, z: camp.center.z + dz },
  }));
}

export interface CopiedNpc {
  sourceId: string;
  npc: NpcDef;
}

export function copyNpcSelection(
  npcs: Readonly<Record<string, NpcDef>>,
  keys: ReadonlySet<string>,
): CopiedNpc[] {
  return [...keys]
    .map((key) => key.replace(/^npc:/, ''))
    .sort()
    .map((sourceId) => ({ sourceId, npc: npcs[sourceId] }))
    .filter((entry): entry is { sourceId: string; npc: NpcDef } => entry.npc !== undefined)
    .map((entry) => ({ sourceId: entry.sourceId, npc: cloneNpc(entry.npc) }));
}

function uniqueNpcId(sourceId: string, used: Set<string>): string {
  const stem = `${sourceId}_copy`.slice(0, MAX_NPC_ID_LENGTH);
  if (!used.has(stem)) return stem;
  for (let suffix = 2; ; suffix++) {
    const tail = `_${suffix}`;
    const candidate = `${stem.slice(0, MAX_NPC_ID_LENGTH - tail.length)}${tail}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface PastedNpc {
  key: string;
  npc: NpcDef;
}

export function pasteNpcSelection(
  existing: Readonly<Record<string, NpcDef>>,
  copied: readonly CopiedNpc[],
  dx: number,
  dz: number,
): PastedNpc[] {
  const used = new Set(Object.keys(existing));
  return copied.map(({ sourceId, npc }) => {
    const key = uniqueNpcId(sourceId, used);
    used.add(key);
    const clone = cloneNpc(npc);
    clone.id = key;
    clone.pos.x += dx;
    clone.pos.z += dz;
    return { key, npc: clone };
  });
}

export function toggledKeySelection(
  current: ReadonlySet<string>,
  key: string,
  additive: boolean,
): Set<string> {
  if (!additive) return current.has(key) ? new Set(current) : new Set([key]);
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
