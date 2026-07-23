// Commissions and the Maker's Bond (Professions 2.0, issue #2207).
//
// An opt-in commission craft arms its output with the bind-on-trade
// primitive (ItemInstancePayload.bindOnTrade; boundTo IS the lock, stamped by
// trade.ts grantOffer on first trade), so a piece made FOR someone binds to
// its recipient the moment it changes hands and the existing trade gate
// refuses to pass it on. This module owns the two facts that make a
// commission a commission, plus the master unbind service that clears the
// bond for gold:
//
// - Eligibility: the 2026-07-20 maintainer ruling scopes the opt-in to
//   EQUIPMENT ONLY (weapon, armor, held_offhand: the kinds that already carry
//   instances). The craft resolver consults isCommissionEligible and silently
//   ignores the flag for any other kind, so a tampered command can never arm
//   a potion (server authority: the flag is a boolean, the marker is minted
//   server-side).
// - The unbind fee: tier-scaled on the training-fee family by the item DEF's
//   quality (the same DEF-quality doctrine the masterwork discovery ruling
//   settled): uncommon 2500, rare 10000, epic 40000 copper, clamped to the
//   last entry above (legendary pays the epic fee) and to the first below
//   (a commissioned common piece pays the uncommon fee; the ruling's ladder
//   starts at uncommon, and a free unbind would leak the sink).
//
// Unbinding clears boundTo ONLY. The bindOnTrade arm stays on the payload,
// so an unbound commission piece re-binds to whoever receives it next (the
// bond is provenance, not a one-shot flag), and every other marker (signer,
// rolled.masterwork, enchant, charges) survives untouched. NPCs only sink
// gold: the fee buys a field clear, never a stat or item change.
//
// This module is `src/sim`-pure (src/sim/CLAUDE.md): no DOM/render/ui/game/
// net imports, no randomness at all (commissions draw nothing), no Sim
// import (PlayerMeta arrives type-only, the crafting.ts/training.ts idiom).

import { ITEMS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, type ItemDef } from '../types';
import { MASTERWORK_QUALITY_LADDER } from './masterwork';
import { isAtAnyStation } from './stations';

/** The opt-in item classes (2026-07-20 maintainer ruling: equipment only),
 *  as a kind-level predicate so presentation code holding only a kind (the
 *  tooltip module) shares the ONE rule. */
export function isCommissionEligibleKind(kind: ItemDef['kind'] | undefined): boolean {
  return kind === 'weapon' || kind === 'armor' || kind === 'held_offhand';
}

/** The def-level form of the opt-in rule. Everything ineligible ignores the
 *  commission flag at craft time. */
export function isCommissionEligible(def: ItemDef | undefined): boolean {
  return !!def && isCommissionEligibleKind(def.kind);
}

// The unbind fee ladder, in copper, indexed from the uncommon rung of
// MASTERWORK_QUALITY_LADDER (uncommon / rare / epic). Clamp-to-last above
// (the ruling's wording), clamp-to-first below (see the header rationale).
export const UNBIND_FEE_BY_QUALITY_TIER: readonly number[] = Object.freeze([2500, 10000, 40000]);

/** The unbind fee for one item def, in copper: DEF quality only ('poor' and
 *  absent normalize to 'common', the defOutputQuality convention; a legacy
 *  rolled.quality payload never moves the fee, matching the masterwork
 *  discovery-deed DEF-quality ruling). */
export function unbindFeeFor(def: ItemDef): number {
  const quality = def.quality === undefined || def.quality === 'poor' ? 'common' : def.quality;
  const ladderIdx = (MASTERWORK_QUALITY_LADDER as readonly string[]).indexOf(quality);
  const feeIdx = Math.min(Math.max(ladderIdx - 1, 0), UNBIND_FEE_BY_QUALITY_TIER.length - 1);
  return UNBIND_FEE_BY_QUALITY_TIER[feeIdx];
}

// Stable deny reasons, not player-facing prose (the client renders localized
// copy off the code; see the unbindResult SimEvent in ../types.ts).
export type UnbindDenyReason =
  | 'unbind_not_eligible'
  | 'unbind_not_bound'
  | 'unbind_out_of_range'
  | 'unbind_cannot_afford';

export interface UnbindResult {
  ok: boolean;
  itemId: string;
  // Present only when !ok, and absent entirely for a malformed/unknown item
  // id (a silent deny: nothing to render a reason against).
  reason?: UnbindDenyReason;
  // The fee this unbind costs (copper): charged exactly once, only on ok.
  // Carried on denials too (0 for an unknown id) so a UI probe can price an
  // unbind it cannot yet perform.
  fee: number;
}

/** The first (lowest bag index) inventory slot holding a bound copy of
 *  `itemId`, or -1. Deterministic selection: when several bound copies of the
 *  same item exist, the earliest slot is always the one unbound. */
function firstBoundSlotIndex(meta: PlayerMeta, itemId: string): number {
  const inventory = meta.inventory ?? [];
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];
    if (slot.itemId === itemId && slot.instance?.boundTo !== undefined) return i;
  }
  return -1;
}

/**
 * Pure validation of one unbind attempt: no side effect ever (the caller
 * charges/clears/emits on ok). The deny ORDER is load-bearing for replay
 * safety (a duplicate command must resolve unbind_not_bound before the
 * affordability arm can fire, so it never re-charges; the resolveTrain
 * deny-order doctrine):
 * 1. unknown itemId: ok:false with NO reason (silent malformed input);
 * 2. def not an opt-in equipment kind (isCommissionEligible; a bound
 *    disenchant reagent is deliberately NOT serviceable): unbind_not_eligible;
 * 3. no bound copy of itemId held (boundTo presence is the lock, its value
 *    is never compared: entity ids are not stable cross-session identities):
 *    unbind_not_bound;
 * 4. not within STATION_RADIUS of ANY static station (stations.ts
 *    isAtAnyStation; every station master offers the service, and a mobile
 *    station NEVER satisfies it, the training precedent): unbind_out_of_range;
 * 5. fee unaffordable (meta.copper below unbindFeeFor): unbind_cannot_afford;
 * 6. otherwise ok, with the fee to charge.
 */
export function resolveUnbind(
  meta: PlayerMeta | undefined,
  pos: { x: number; z: number } | undefined,
  itemId: string,
): UnbindResult {
  const def = ITEMS[itemId];
  if (!def) return { ok: false, itemId, fee: 0 };
  const fee = unbindFeeFor(def);
  if (!isCommissionEligible(def)) {
    return { ok: false, itemId, reason: 'unbind_not_eligible', fee };
  }
  if (!meta || firstBoundSlotIndex(meta, itemId) === -1) {
    return { ok: false, itemId, reason: 'unbind_not_bound', fee };
  }
  if (!pos || !isAtAnyStation(pos)) {
    return { ok: false, itemId, reason: 'unbind_out_of_range', fee };
  }
  if (meta.copper < fee) {
    return { ok: false, itemId, reason: 'unbind_cannot_afford', fee };
  }
  return { ok: true, itemId, fee };
}

/**
 * Command entry point (the crafting.ts craftItem shape): resolves the
 * caller's own player entity, validates via resolveUnbind, and on ok charges
 * the fee exactly once and clears boundTo on EXACTLY ONE copy (the earliest
 * bound slot). A bound stack holding several byte-equal copies (identical-
 * payload stacking) is split, never blanket-cleared: one copy is
 * peeled off and re-granted through ctx.addItemInstance with the bond
 * removed (so it merges with any existing unbound armed stack), and the
 * remaining copies stay bound at full price each. A single-copy slot is
 * cleared in place (the grantOffer in-place-stamp precedent: slot payloads
 * are never aliased across slots). No other payload field is touched.
 * Runs on the deterministic tick the wire command arrives on, never off-tick.
 */
export function unbindItem(ctx: SimContext, itemId: string, pid?: number): UnbindResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, fee: 0 };
  const meta = r.meta;
  const result = resolveUnbind(meta, r.e.pos, itemId);
  if (!result.ok) return result;
  const slotIdx = firstBoundSlotIndex(meta, itemId);
  const slot = meta.inventory[slotIdx];
  const instance = slot?.instance;
  // Unreachable: the resolver found a bound slot on this same meta within the
  // same synchronous call. Guarded BEFORE the charge below so that, were a
  // future refactor ever to let the resolver and the mutation diverge, the
  // failure mode is a no-op, never a fee charged with nothing cleared.
  if (instance === undefined) return result;
  meta.copper -= result.fee;
  if (slot.count === 1) {
    delete instance.boundTo;
  } else {
    slot.count -= 1;
    const freed = cloneItemInstancePayload(instance);
    delete freed.boundTo;
    ctx.addItemInstance(itemId, freed, meta.entityId);
  }
  return result;
}
