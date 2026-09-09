// Source-aware half of the unsettled gate. Material replay consumes exact
// provenance, so an equal quantity from a different gatherer is no substitute.
// Reuse the canonical replay reader and transfer planner, including legacy
// signature projection, zero-count reattribution and the automatic spend order.
import type { GuildBankOpDelta } from '../src/sim/guild_bank';
import { guildMaterialMoveFor } from '../src/sim/guild_bank_material';
import { materialItemIds } from '../src/sim/material_ids';
import { materialPayloadKey } from '../src/sim/material_payload_identity';
import {
  type MaterialSourceTransferSelection,
  resolveMaterialSourceTransferSelection,
} from '../src/sim/material_source_transfer_selection';
import { type MaterialComposition, materialSourceKey } from '../src/sim/material_sources';
import { normalizeMaterialStack, takeMaterialStack } from '../src/sim/material_stack';
import type { InvSlot } from '../src/sim/types';

function sourceUnitKey(itemId: string, payloadKey: string, sourceKey: string): string {
  return `${itemId}|${payloadKey.length}:${payloadKey}${sourceKey}`;
}

/** Positive net per source within ONE holder. Legacy removals do not identify
 *  their exact gatherer buckets, so they cannot cancel a known source deposit;
 *  current live journals always carry exact legs and net precisely. */
export function guildBankMaterialSourceContribution(
  log: readonly GuildBankOpDelta[],
): ReadonlyMap<string, number> {
  const own = new Map<string, number>();
  for (const delta of log) {
    const read = guildMaterialMoveFor(delta, materialItemIds());
    if (!read.ok || read.value === null) continue;
    const move = read.value;
    const legs = move.kind === 'exact' ? move.legs : move.signedCount > 0 ? move.composition : [];
    for (const leg of legs) {
      const key = sourceUnitKey(move.itemId, move.key, materialSourceKey(leg.source));
      own.set(key, (own.get(key) ?? 0) + leg.count);
    }
  }
  return new Map([...own].filter(([, net]) => net > 0));
}

/** Null means the sim will refuse the request itself. Otherwise the count is
 *  exactly what it would take, with a source dependency only if not durable. */
export function guildBankMaterialWithdrawal(
  request: {
    readonly slot?: number;
    readonly count?: number;
    readonly selection?: MaterialSourceTransferSelection;
  },
  slots: readonly InvSlot[],
  unsettled: ReadonlyMap<string, number>,
): { readonly count: number; readonly dependencyKey: string | null } | null {
  const slot = Number.isInteger(request.slot) ? slots[request.slot as number] : undefined;
  if (!slot) return null;
  let count = request.count ?? slot.count;
  let selected: MaterialComposition | undefined;
  if (request.selection !== undefined) {
    if (
      request.selection.target.slotIndex !== request.slot ||
      request.selection.itemId !== slot.itemId
    )
      return null;
    const resolved = resolveMaterialSourceTransferSelection(slots, request.selection);
    if (!resolved.ok || (request.count ?? resolved.value.count) !== resolved.value.count)
      return null;
    count = resolved.value.count;
    selected = resolved.value.sources;
  }
  const take = takeMaterialStack(slot, count, materialItemIds(), selected);
  if (!take.ok) return null;
  const incoming = take.value.taken;
  const payloadKey = materialPayloadKey(incoming);
  const held = new Map<string, number>();
  for (const row of slots) {
    if (row.itemId !== slot.itemId) continue;
    const normalized = normalizeMaterialStack(row, materialItemIds());
    if (!normalized.ok || materialPayloadKey(normalized.value) !== payloadKey) continue;
    for (const bucket of normalized.value.materialSources ?? []) {
      const key = sourceUnitKey(slot.itemId, payloadKey, materialSourceKey(bucket.source));
      held.set(key, (held.get(key) ?? 0) + bucket.count);
    }
  }
  for (const bucket of incoming.materialSources ?? []) {
    const key = sourceUnitKey(slot.itemId, payloadKey, materialSourceKey(bucket.source));
    const other = unsettled.get(key) ?? 0;
    if (other > 0 && bucket.count > (held.get(key) ?? 0) - other) {
      return { count, dependencyKey: key };
    }
  }
  return { count, dependencyKey: null };
}
