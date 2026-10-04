// Which ground objects wear the gold loot glint over their body. Pure: the
// renderer's object branch asks it once per built view. The forge targets are
// workstations, not loot, and the Graveyard Shift's grave is scenery with a
// secret (its own soft glow rides its material, quest_objects.ts), so neither
// advertises itself as something to pick up.
import { GRAVE_ITEM_ID } from '../sim/graveyard_shift/grave_entry';

export function lootGlint(objectItemId: string | null | undefined): boolean {
  if (objectItemId?.startsWith('forge_')) return false;
  return objectItemId !== GRAVE_ITEM_ID;
}
