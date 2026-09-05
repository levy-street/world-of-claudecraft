// Atomic, draw-free rank exchange between two owned collection copies. Both
// selections are pinned and validated before either copy changes. No ledger,
// currency, cooldown, timer, or additional host call is needed.
import { crucibleCollectionForItem } from '../content/crucible_collections';
import { STATIONS } from '../content/professions';
import { recipeForResultItem } from '../content/recipes';
import { ITEMS } from '../data';
import { recalcPlayerStats } from '../entity';
import { isItemLocked } from '../item_lock_flag';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, type ItemInstancePayload, type StationDef } from '../types';
import { PERFECTING_RANKS, PERFECTING_SKILL_REQ } from './perfecting';
import { isValidPerfectingBonus, withPerfectingBonus } from './perfecting_bonus';
import {
  type PerfectItemRef,
  type PerfectingCopyReads,
  perfectingCopyMatches,
} from './perfecting_copy';
import { isAtStation, stationTypeForCraft } from './stations';
import type { CraftSkills } from './wheel';

export interface PerfectingSwapRequest {
  source: PerfectItemRef;
  target: PerfectItemRef;
}

export type PerfectingSwapDenyReason =
  | 'dead'
  | 'busy'
  | 'no_item'
  | 'same_item'
  | 'different_collection'
  | 'invalid_progress'
  | 'same_rank'
  | 'insufficient_skill'
  | 'out_of_range'
  | 'locked';

export interface PerfectingSwapInfoView {
  sourceItemId?: string;
  targetItemId?: string;
  sourceRank: number;
  targetRank: number;
  craftId: string | null;
  skillReq: number;
  reason?: PerfectingSwapDenyReason;
}

export interface PerfectingSwapInputs extends PerfectingCopyReads, PerfectingSwapRequest {
  craftSkills: Readonly<CraftSkills>;
  dead: boolean;
  inCombat: boolean;
  busy?: boolean;
  stationPlacements?: readonly StationDef[];
  pos: { x: number; z: number };
}

interface SwapCopy {
  itemId: string;
  payload: ItemInstancePayload | undefined;
  rank: number;
}

function copyAt(inputs: PerfectingCopyReads, ref: PerfectItemRef): SwapCopy | null {
  if (!ref || !ref.copy || !perfectingCopyMatches(inputs, ref)) return null;
  let itemId: string | undefined;
  let payload: ItemInstancePayload | undefined;
  if ('slot' in ref) {
    itemId = inputs.equipment[ref.slot];
    payload = inputs.equipmentInstances[ref.slot];
  } else {
    const bagged = inputs.inventory[ref.bag];
    if (!bagged || bagged.count !== 1 || bagged.itemId !== ref.itemId) return null;
    itemId = bagged.itemId;
    payload = bagged.instance;
  }
  if (!itemId) return null;
  return {
    itemId,
    payload,
    rank: payload?.perfected === true ? PERFECTING_RANKS : (payload?.perfecting ?? 0),
  };
}

function samePlace(a: PerfectItemRef, b: PerfectItemRef): boolean {
  return 'slot' in a ? 'slot' in b && a.slot === b.slot : 'bag' in b && a.bag === b.bag;
}

function validProgress(copy: SwapCopy): boolean {
  const { payload, rank } = copy;
  if (!Number.isInteger(rank) || rank < 0 || rank > PERFECTING_RANKS) return false;
  if (payload?.perfected !== true && rank >= PERFECTING_RANKS) return false;
  if (!ITEMS[copy.itemId] || !recipeForResultItem(copy.itemId)) return false;
  if (payload?.perfected && payload.perfecting !== undefined) return false;
  if (payload?.perfectingBonus !== undefined && !isValidPerfectingBonus(payload.perfectingBonus))
    return false;
  // A Perfected copy without its immutable contribution is ambiguous. Never
  // guess which part of its aggregate was Perfecting after a balance change.
  if (payload?.perfected && payload.perfectingBonus === undefined) return false;
  if (payload?.perfected) {
    for (const [key, value] of Object.entries(payload.perfectingBonus!)) {
      const stored = payload.rolled?.stats?.[key] ?? 0;
      if (!Number.isFinite(stored) || stored < value) return false;
    }
  }
  return true;
}

/** The same read-only admission is used by both world hosts and the command. */
export function perfectingSwapInfoFrom(inputs: PerfectingSwapInputs): PerfectingSwapInfoView {
  const source = copyAt(inputs, inputs.source);
  const target = copyAt(inputs, inputs.target);
  const collection = source ? crucibleCollectionForItem(source.itemId) : undefined;
  const view: PerfectingSwapInfoView = {
    sourceItemId: source?.itemId,
    targetItemId: target?.itemId,
    sourceRank: source?.rank ?? 0,
    targetRank: target?.rank ?? 0,
    craftId: collection?.craftId ?? null,
    skillReq: PERFECTING_SKILL_REQ,
  };
  let reason: PerfectingSwapDenyReason | undefined;
  if (inputs.dead) reason = 'dead';
  else if (inputs.inCombat || inputs.busy) reason = 'busy';
  else if (!source || !target) reason = 'no_item';
  else if (samePlace(inputs.source, inputs.target)) reason = 'same_item';
  else if (!collection || collection.id !== crucibleCollectionForItem(target.itemId)?.id)
    reason = 'different_collection';
  else if (isItemLocked(source.payload) || isItemLocked(target.payload)) reason = 'locked';
  else if (!validProgress(source) || !validProgress(target)) reason = 'invalid_progress';
  else if (source.rank === target.rank) reason = 'same_rank';
  else if ((inputs.craftSkills[collection.craftId] ?? 0) < PERFECTING_SKILL_REQ)
    reason = 'insufficient_skill';
  else {
    const station = stationTypeForCraft(collection.craftId);
    if (!station || !isAtStation(inputs.stationPlacements ?? STATIONS, inputs.pos, station))
      reason = 'out_of_range';
  }
  return reason ? { ...view, reason } : view;
}

function exchangedPayload(copy: SwapCopy, nextRank: number, pid: number): ItemInstancePayload {
  const recipe = recipeForResultItem(copy.itemId)!;
  const payload = cloneItemInstancePayload(
    withPerfectingBonus(ITEMS[copy.itemId], recipe, copy.payload ?? {}),
  );
  const stats = { ...payload.rolled?.stats };
  for (const [key, value] of Object.entries(payload.perfectingBonus!)) {
    const change =
      (nextRank === PERFECTING_RANKS ? value : 0) - (copy.rank === PERFECTING_RANKS ? value : 0);
    if (change === 0) continue;
    const next = (stats[key] ?? 0) + change;
    if (next !== 0) stats[key] = next;
    else delete stats[key];
  }
  if (payload.rolled || Object.keys(stats).length > 0)
    payload.rolled = { ...payload.rolled, stats };
  delete payload.perfecting;
  delete payload.perfected;
  if (nextRank === PERFECTING_RANKS) payload.perfected = true;
  else if (nextRank > 0) payload.perfecting = nextRank;
  payload.perfectingBound = true;
  payload.boundTo ??= pid;
  return payload;
}

export type PerfectingSwapResult = PerfectingSwapInfoView & {
  ok: boolean;
  request?: PerfectingSwapRequest;
};

function copiedRef(ref: PerfectItemRef): PerfectItemRef {
  return {
    ...('slot' in ref ? { slot: ref.slot } : { bag: ref.bag, itemId: ref.itemId }),
    ...(ref.copy
      ? {
          copy: {
            pin: ref.copy.pin,
            ...(ref.copy.anchor
              ? { anchor: { ordinal: ref.copy.anchor.ordinal, count: ref.copy.anchor.count } }
              : {}),
          },
        }
      : {}),
  };
}

export function swapPerfectingRanks(
  ctx: SimContext,
  pid: number | undefined,
  request: PerfectingSwapRequest,
): PerfectingSwapResult {
  const resolved = ctx.resolve(pid);
  if (!resolved)
    return {
      ok: false,
      reason: 'no_item',
      sourceRank: 0,
      targetRank: 0,
      craftId: null,
      skillReq: PERFECTING_SKILL_REQ,
    };
  const { e, meta } = resolved;
  const inputs: PerfectingSwapInputs = {
    ...request,
    inventory: meta.inventory,
    equipment: meta.equipment,
    equipmentInstances: meta.equipmentInstance,
    stationPlacements: ctx.stationPlacements,
    craftSkills: meta.craftSkills,
    dead: e.dead,
    inCombat: e.inCombat,
    busy: e.castingAbility !== null || e.channeling,
    pos: e.pos,
  };
  const view = perfectingSwapInfoFrom(inputs);
  const result: PerfectingSwapResult = {
    ...view,
    ok: view.reason === undefined,
    request: { source: copiedRef(request.source), target: copiedRef(request.target) },
  };
  if (result.ok) {
    const source = copyAt(inputs, request.source)!;
    const target = copyAt(inputs, request.target)!;
    // Build both complete payloads before touching either owned container.
    const sourcePayload = exchangedPayload(source, target.rank, meta.entityId);
    const targetPayload = exchangedPayload(target, source.rank, meta.entityId);
    const replacements = [
      { ref: request.source, payload: sourcePayload },
      { ref: request.target, payload: targetPayload },
    ];
    meta.inventory = meta.inventory.map((slot, index) => {
      const replacement = replacements.find(({ ref }) => 'bag' in ref && ref.bag === index);
      return replacement ? { ...slot, instance: replacement.payload } : slot;
    });
    const equipmentInstance = { ...meta.equipmentInstance };
    for (const { ref, payload } of replacements) {
      if ('slot' in ref) equipmentInstance[ref.slot] = payload;
    }
    meta.equipmentInstance = equipmentInstance;
    recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
    meta.wireRev++;
  }
  ctx.emit({ type: 'perfectingSwapResult', pid: meta.entityId, ...result });
  return result;
}
