// Exchange previews use the same collection, admission, and copy witnesses as
// the command. A selected target is never silently replaced after a bag edit.
import { crucibleCollectionForItem } from '../../../sim/content/crucible_collections';
import { isItemEnchantActive } from '../../../sim/item_instance_stats';
import { PERFECTING_RANKS, type PerfectItemRef } from '../../../sim/professions/perfecting';
import {
  capturePerfectItemRef,
  perfectingCopyMatches,
} from '../../../sim/professions/perfecting_copy';
import type {
  PerfectingSwapInfoView,
  PerfectingSwapRequest,
} from '../../../sim/professions/perfecting_swap';
import type { ItemInstancePayload } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import {
  type PerfectingCandidate,
  type PerfectingViewModel,
  samePerfectRef,
} from './perfecting_view';

export type PerfectingSwapReads = Pick<
  IWorld,
  'inventory' | 'equipment' | 'equipmentInstances' | 'craftingIdentity' | 'perfectingSwapInfo'
>;
export type PerfectingSwapUiReason =
  | NonNullable<PerfectingSwapInfoView['reason']>
  | 'choose_target'
  | 'changed'
  | 'syncing';
export interface PerfectingRankChange {
  itemId: string;
  name: string | null;
  from: number;
  to: number;
  enchantChange: 'inactive' | 'active' | null;
}
export interface PerfectingSwapView {
  rows: { candidate: PerfectingCandidate; ref: PerfectItemRef; selected: boolean }[];
  request: PerfectingSwapRequest | null;
  changes: PerfectingRankChange[];
  reason: PerfectingSwapUiReason | undefined;
  enabled: boolean;
}

function payloadAt(
  reads: PerfectingSwapReads,
  ref: PerfectItemRef,
): ItemInstancePayload | undefined {
  return 'slot' in ref ? reads.equipmentInstances[ref.slot] : reads.inventory[ref.bag]?.instance;
}

function rankChange(
  reads: PerfectingSwapReads,
  ref: PerfectItemRef,
  itemId: string,
  from: number,
  to: number,
): PerfectingRankChange {
  const instance = payloadAt(reads, ref);
  const activeBefore = isItemEnchantActive(instance);
  const activeAfter = isItemEnchantActive({
    ...instance,
    perfected: to === PERFECTING_RANKS ? true : undefined,
  });
  return {
    itemId,
    name: instance?.name ?? null,
    from,
    to,
    enchantChange: activeBefore === activeAfter ? null : activeAfter ? 'active' : 'inactive',
  };
}

export function buildPerfectingSwapView(
  reads: PerfectingSwapReads,
  view: PerfectingViewModel,
  requested: PerfectItemRef | null,
): PerfectingSwapView | null {
  const source = view.detail;
  const collection = source && crucibleCollectionForItem(source.itemId);
  if (!source || !collection) return null;
  const rows = view.candidates
    .filter(
      (candidate) =>
        !samePerfectRef(candidate.ref, source.ref) &&
        crucibleCollectionForItem(candidate.itemId)?.id === collection.id,
    )
    .map((candidate) => ({
      candidate,
      ref: capturePerfectItemRef(reads, candidate.ref),
      selected:
        samePerfectRef(candidate.ref, requested) &&
        requested !== null &&
        perfectingCopyMatches(reads, requested),
    }));
  const target = rows.find((row) => row.selected);
  if (!target || !requested)
    return {
      rows,
      request: null,
      changes: [],
      enabled: false,
      reason: requested ? 'changed' : 'choose_target',
    };
  const request = { source: source.commandRef, target: requested };
  const info = reads.perfectingSwapInfo(request);
  const current =
    perfectingCopyMatches(reads, request.source) && perfectingCopyMatches(reads, request.target);
  const reason = !current
    ? 'changed'
    : !reads.craftingIdentity.synced
      ? 'syncing'
      : (info?.reason ?? (!info ? 'no_item' : undefined));
  return {
    rows,
    request,
    reason,
    enabled: reason === undefined,
    changes: info
      ? [
          rankChange(reads, request.source, source.itemId, info.sourceRank, info.targetRank),
          rankChange(
            reads,
            request.target,
            target.candidate.itemId,
            info.targetRank,
            info.sourceRank,
          ),
        ]
      : [],
  };
}

export function perfectingSwapViewSignature(view: PerfectingSwapView | null): string {
  return JSON.stringify(view);
}

/** An answer must name the exact captured request, including both copy pins.
 * Property order on the wire is irrelevant; absent witnesses never match. */
export function samePerfectingSwapRequest(
  sent: PerfectingSwapRequest,
  answer: PerfectingSwapRequest | undefined,
): boolean {
  if (!answer) return false;
  return (['source', 'target'] as const).every((side) => {
    const a = sent[side];
    const b = answer[side];
    return (
      !!a?.copy &&
      !!b?.copy &&
      samePerfectRef(a, b) &&
      a.copy.pin === b.copy.pin &&
      a.copy.anchor?.ordinal === b.copy.anchor?.ordinal &&
      a.copy.anchor?.count === b.copy.anchor?.count
    );
  });
}
