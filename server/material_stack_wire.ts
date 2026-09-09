// Shape-only material grouping command decoding. Malformed optional sources
// refuse the entire command; they never become the default whole-stack action.
import { type MaterialComposition, mergeMaterialCompositions } from '../src/sim/material_sources';
import type { MaterialStackSelection } from '../src/sim/material_stack_selection';
import type { Sim } from '../src/sim/sim';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export interface MaterialGroupingIntent {
  readonly itemId: string;
  readonly target: MaterialStackSelection;
  readonly selectedSources?: MaterialComposition;
}

export function parseMaterialGroupingIntent(
  msg: Record<string, unknown>,
): MaterialGroupingIntent | null {
  if (typeof msg.item !== 'string' || !record(msg.target)) return null;
  const { slotIndex, pin, anchor } = msg.target;
  if (
    typeof slotIndex !== 'number' ||
    !Number.isSafeInteger(slotIndex) ||
    slotIndex < 0 ||
    typeof pin !== 'string' ||
    !/^[0-9a-f]{32}$/.test(pin) ||
    !record(anchor)
  )
    return null;
  const { ordinal, count } = anchor;
  if (
    typeof ordinal !== 'number' ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(ordinal) ||
    !Number.isSafeInteger(count) ||
    ordinal < 0 ||
    count <= ordinal
  )
    return null;
  const target = { slotIndex, pin, anchor: { ordinal, count } };
  if (!Object.hasOwn(msg, 'sources')) return { itemId: msg.item, target };
  const sources = mergeMaterialCompositions([], msg.sources as MaterialComposition);
  if (!sources.ok || sources.value.length === 0) return null;
  return { itemId: msg.item, target, selectedSources: sources.value };
}

/** Existing bag movement/sort and new grouping share this shape-only dispatch. */
export function dispatchInventoryGroupingCommand(
  sim: Pick<
    Sim,
    'moveInventoryItem' | 'sortInventory' | 'separateMaterialStack' | 'combineMaterialStacks'
  >,
  pid: number,
  msg: Record<string, unknown>,
): void {
  if (msg.cmd === 'inv_move') {
    if (typeof msg.from === 'number' && typeof msg.to === 'number')
      sim.moveInventoryItem(msg.from, msg.to, pid);
  } else if (msg.cmd === 'inv_sort') sim.sortInventory(pid);
  else {
    const intent = parseMaterialGroupingIntent(msg);
    if (!intent) return;
    if (msg.cmd === 'material_separate')
      sim.separateMaterialStack(intent.itemId, intent.target, intent.selectedSources, pid);
    else if (msg.cmd === 'material_combine')
      sim.combineMaterialStacks(intent.itemId, intent.target, pid);
  }
}
