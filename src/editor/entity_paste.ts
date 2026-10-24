// Studio's Ctrl+V for copied mobs (camps) and NPCs. The copied group lands
// centred on the cursor, keeping its own layout, so Copy then Paste is how a
// maker places more of them; with no cursor over the map it lands two yards
// off the originals, as before.
//
// The editor stays live through a paste: the host updates its camps and NPCs
// in place (the viewport's own camp sync and NPC add/remove), never by
// rebuilding the whole 3D world, which on a world-size map took long enough
// to look like the editor reloading.

import type { CampDef, NpcDef } from '../sim/types';
import { capRoom } from './edit_caps_core';
import { type CopiedNpc, pasteCampSelection, pasteNpcSelection } from './selection_clipboard';
import { appendSpan, removeSpan } from './span_core';

/** What a paste needs from the editor: the live lists and in-place updates. */
export interface EntityPasteHost {
  camps(): CampDef[];
  npcs(): Record<string, NpcDef>;
  /** The camp list changed: rebuild only the authored camp mobs. */
  campsChanged(): void;
  /** One NPC joined the map: add just it to the live view. */
  npcAdded(npc: NpcDef): void;
  /** One NPC left the map: remove just it from the live view. */
  npcRemoved(id: string): void;
}

export interface PastedEntities {
  count: number;
  /** The map's cap trimmed the paste. */
  capped: boolean;
  undo(): void;
  redo(): void;
}

/** Yards a paste lands off its originals when no cursor is over the map. */
const FALLBACK_OFFSET = 2;

/** The offset that moves the copied group's centre to `target`, or the
 *  fixed fallback when there is no target. */
export function pasteOffset(
  points: readonly { x: number; z: number }[],
  target: { x: number; z: number } | null,
): { dx: number; dz: number } {
  if (!target || points.length === 0) return { dx: FALLBACK_OFFSET, dz: FALLBACK_OFFSET };
  let sx = 0;
  let sz = 0;
  for (const p of points) {
    sx += p.x;
    sz += p.z;
  }
  return { dx: target.x - sx / points.length, dz: target.z - sz / points.length };
}

export function pasteMobs(
  host: EntityPasteHost,
  copied: readonly CampDef[],
  target: { x: number; z: number } | null,
  maxCamps: number,
): PastedEntities | null {
  const room = capRoom(host.camps().length, maxCamps);
  const { dx, dz } = pasteOffset(
    copied.map((camp) => camp.center),
    target,
  );
  const accepted = pasteCampSelection(copied.slice(0, room), dx, dz);
  if (accepted.length === 0) return null;
  const start = appendSpan(host.camps(), accepted);
  host.campsChanged();
  return {
    count: accepted.length,
    capped: accepted.length < copied.length,
    undo: () => {
      removeSpan(host.camps(), start, accepted);
      host.campsChanged();
    },
    redo: () => {
      host.camps().push(...accepted);
      host.campsChanged();
    },
  };
}

export function pasteNpcs(
  host: EntityPasteHost,
  copied: readonly CopiedNpc[],
  target: { x: number; z: number } | null,
  maxNpcs: number,
): (PastedEntities & { keys: string[] }) | null {
  const npcs = host.npcs();
  const room = capRoom(Object.keys(npcs).length, maxNpcs);
  const { dx, dz } = pasteOffset(
    copied.map(({ npc }) => npc.pos),
    target,
  );
  const accepted = pasteNpcSelection(npcs, copied.slice(0, room), dx, dz);
  if (accepted.length === 0) return null;
  const insert = (): void => {
    for (const { key, npc } of accepted) {
      host.npcs()[key] = npc;
      host.npcAdded(npc);
    }
  };
  const remove = (): void => {
    for (const { key } of accepted) {
      delete host.npcs()[key];
      host.npcRemoved(key);
    }
  };
  insert();
  return {
    count: accepted.length,
    capped: accepted.length < copied.length,
    keys: accepted.map(({ key }) => key),
    undo: remove,
    redo: insert,
  };
}
