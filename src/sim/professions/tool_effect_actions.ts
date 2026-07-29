// Tool-effect command bodies (the acquisition craft): the slot and recharge
// actions behind the SimContext seam, with `Sim` keeping thin same-named
// delegates for the IWorld facade and the server dispatch, plus a third
// export, the R35 admin slot restore, which has no delegate at all.
//
// The free-grant incident is this module's design constraint: the slot
// command was once its own acquisition path (no item, no copper, no
// cooldown), so the TWO player-reachable actions here (slot and recharge)
// resolve their whole decision through the pure resolvers in tools.ts before
// any mutation, consume their price with no partial arm (the charm copy, the
// arcane materials), and report every RESOLVER refusal through the one
// text-free personal `toolEffectResult` event. The one pre-resolver refusal,
// the dead gate, answers with the family's shared error line instead (a
// deliberate exception: no new wire reason, and the chat line is not
// silent), so the professions window's event-driven repaint does not fire
// for it and the sent-guard's one-shot re-arm timer covers the button.
// The third action, `restoreToolEffectSlotAction`, is the R35 GM
// restore: charm-free, delegate-free (no `Sim` method, no IWorld member, no
// wire command), reachable from the server ADMIN runtime alone, and the one
// arm that does NOT call `resolveSlotToolEffect`. It carries its OWN copy of
// the gate chain, which `tests/professions_admin_restore.test.ts` pins
// tuple-for-tuple against the resolver so a gate added to the one mint
// authority cannot silently skip the restore. Every arm is draw-free: nothing
// in this module can move the rng stream a harvest walks.
//
// Pacing: Craft Cast System Phase 5 made tool-effect recharge a fixed-duration
// non-spell cast (TOOL_RECHARGE_CAST_ID). The slot action stays instant: every
// successful slot burns a whole crafted charm (the mint IS the price) and a
// denied slot mutates nothing. Both are still under the wire command lane, and
// the deny events forcing a heavy self re-diff is the accepted amplification
// (neither command is a HEAVY_SELF_CMDS member; toolEffectResult's
// HEAVY_SELF_EVENTS membership is what drives the re-diff, and the dispatch
// comment in server/game.ts records that acceptance).

import {
  GATHERING_PROFESSION_IDS,
  type GatheringProfessionId,
  TOOL_EFFECTS,
  TOOL_RECHARGE_CAST_DURATION_SEC,
  type ToolEffectId,
} from '../content/professions';
import { ITEMS } from '../data';
import { refusedWhileDead } from '../dead_gate';
import { forceDismount } from '../mounts';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, isConsuming, TOOL_RECHARGE_CAST_ID } from '../types';
import { gatherNodeById, NODE_HARVEST_TABLE } from './gathering';
import {
  bestOwnedGatherToolFor,
  NO_TOOL_OWNED,
  resolveRechargeToolEffect,
  resolveSlotToolEffect,
  slotEffect,
  slotToolEffectRefused,
  type ToolEffectConfirmMode,
  type ToolEffectSlot,
} from './tools';

/**
 * Ceiling for a wire-supplied id echoed back inside a `toolEffectResult`
 * event. The longest shipped profession or effect id is 16 chars; the server
 * forwards `msg.profession` / `msg.effect` after only a typeof check, so the
 * deny arms (above all `invalid_request`) would otherwise serialize a
 * hostile id of up to the 16 KiB frame cap straight back to its sender.
 */
export const MAX_ECHOED_WIRE_ID_LENGTH = 64;

function boundEchoedWireId(id: string): string {
  return id.length > MAX_ECHOED_WIRE_ID_LENGTH ? id.slice(0, MAX_ECHOED_WIRE_ID_LENGTH) : id;
}

/**
 * Slot `effectId` onto `professionId`, consuming one charm copy from bags.
 * The resolver owns all seven refusals plus WHICH copy is consumed (self-signed
 * first, unsigned second, first signed third), and the consumed copy's
 * `signer` becomes the slot's `craftedBy` (the original-crafter recharge
 * discount's identity). Re-slotting consumes another charm and resets to full
 * charges, same as a fresh install.
 */
export function slotToolEffectAction(
  ctx: SimContext,
  professionIdWire: string,
  effectIdWire: string,
  confirmMode: ToolEffectConfirmMode = 'always',
  pid?: number,
): void {
  // Bound the raw wire ids before ANY use: every deny below echoes them back
  // to the sender inside the result event, and the server passes them through
  // after only a typeof check, so an unclamped id would ride a 16 KiB junk
  // string byte-for-byte back onto the wire. A legal id is 16 chars or less;
  // the clamp is invisible to every valid request.
  const professionId = boundEchoedWireId(professionIdWire);
  const effectId = boundEchoedWireId(effectIdWire);
  // Dead gate via the shared helper (dead_gate.ts): a dead or ghost-released
  // player spends nothing here. The refusal is the family's shared error
  // line, not a new toolEffectResult reason, so the wire enum is untouched.
  // Both player-reachable actions in this module carry it; the GM restore
  // does not (an operator restore may legitimately target a dead character).
  if (refusedWhileDead(ctx, pid)) return;
  const r = ctx.resolve(pid);
  if (!r) return;
  const resolved = resolveSlotToolEffect(
    r.meta.inventory,
    professionId,
    effectId,
    confirmMode,
    ITEMS,
    r.meta.name,
    // The live slot, so the resolver can refuse a re-slot that would change
    // nothing. Read through hasOwn-safe indexing: professionId is a wire
    // string and toolEffectSlots is a plain object literal.
    (GATHERING_PROFESSION_IDS as readonly string[]).includes(professionId)
      ? r.meta.toolEffectSlots?.[professionId as GatheringProfessionId]
      : undefined,
  );
  if (!resolved.ok) {
    ctx.emit({
      type: 'toolEffectResult',
      action: 'slot',
      ok: false,
      professionId,
      effectId,
      reason: resolved.reason,
      pid: r.meta.entityId,
    });
    return;
  }
  // Consume EXACTLY the copy the resolver chose: a targeted removal, never
  // removeItem's own preference walk, because the chosen copy's signer is
  // already baked into the minted slot's craftedBy and consuming a different
  // copy would record provenance the player still holds.
  const entry = r.meta.inventory[resolved.consumeIndex];
  if (entry.count > 1) entry.count -= 1;
  else r.meta.inventory.splice(resolved.consumeIndex, 1);
  // The hub's own post-removal duty, which a targeted splice would otherwise
  // skip: bump wireRev and re-derive collect-quest counts from live bags
  // (sim.ts removeItem and the enchanting targeted removals all do this). No
  // shipped quest collects a charm today; the seam contract is what matters,
  // so the first one that does cannot be quietly stale.
  ctx.onInventoryChangedForQuests(r.meta);
  applyMintedSlot(ctx, r, resolved.professionId, effectId, resolved.slot);
}

/**
 * The shared post-mint body of a slot install (the real charm mint above and
 * the R35 GM restore below): assign the slot, retire the touched profession's
 * live-cast captures, and emit the success event.
 */
function applyMintedSlot(
  ctx: SimContext,
  r: NonNullable<ReturnType<SimContext['resolve']>>,
  professionId: GatheringProfessionId,
  effectId: string,
  slot: ToolEffectSlot,
): void {
  // Created lazily HERE, never in makeMeta: the absent-by-default field is
  // what keeps a player who has never slotted an effect byte-identical in
  // the parity digest (every deny arm in BOTH callers returns before this
  // function is reached).
  r.meta.toolEffectSlots ??= {};
  r.meta.toolEffectSlots[professionId] = slot;
  // A fresh mint retires a live gather cast's R47 start-capture and R40
  // consent, but ONLY for the profession this mint touches: the re-slot
  // toll (this whole charm) is the sanctioned way DOWN off a price rung, so
  // a stale capture from the OLD slot's cast must not re-latch the new
  // slot's ceiling at completion. A cast on a DIFFERENT profession is
  // untouched by this mint (its slot, its consent, and its rarity capture
  // all belong to the other profession), so revoking its captures here
  // would silently strip a confirmed prompt use mid-cast (the phase 14 QA
  // finding). No live cast means the fields are already inert and the
  // clear is a no-op kept for the defensive arm (an unknown cast node id).
  // A live FISHING cast also reads as the empty id (fishing never writes
  // gatherCastNodeId or these captures today); if fishing ever adopts the
  // capture fields, key this scope off the profession instead.
  // Draw-free field writes; '' / false are the inert values.
  const castNode = r.e.gatherCastNodeId !== '' ? gatherNodeById(r.e.gatherCastNodeId) : undefined;
  const castProfession = castNode ? NODE_HARVEST_TABLE[castNode.type].professionId : undefined;
  if (castProfession === undefined || castProfession === professionId) {
    r.e.gatherCastToolRarity = '';
    r.e.gatherCastEffectConfirmed = false;
  }
  ctx.emit({
    type: 'toolEffectResult',
    action: 'slot',
    ok: true,
    professionId,
    effectId,
    pid: r.meta.entityId,
  });
}

/**
 * GM restore of a LOST tool-effect slot row (R35): mint `effectId` onto
 * `professionId` at full charges WITHOUT consuming a charm. This is exactly
 * the free acquisition the module header's incident bans from every
 * player-reachable path, so it is exported for the server ADMIN runtime
 * alone: no wire command routes here, no IWorld member exposes it, and the
 * admin surface audits every call with an operator identity and reason. The
 * mint mirrors a real slot everywhere else: the same profession/effect/pair
 * validation, the same no-tool refusal (R30 sizes charges by the best tool
 * OWNED, so a toolless character has no honest charge count; restore the
 * tool first), full charges sized by that tool's rarity, the same post-mint
 * capture hygiene, and the same success event so the player sees it land.
 * Beyond the charm cost, the restore drops exactly one more real-mint gate,
 * the no-gain refusal, and REPLACES it with a stricter one: a profession
 * that already HAS a slot refuses (`already_slotted`), because an overwrite
 * would silently destroy the live row's craftedBy provenance (the R48
 * recharge-discount identity), the player's R40 confirmMode choice, and an
 * R47-ratcheted ceiling; a restore is for a row that is GONE. `craftedBy`
 * stays unset (there is no consumed copy to take provenance from), so a
 * restored slot pays the generic recharge rate, the documented unsigned
 * arm. `confirmMode` mints 'always', the fresh-install default. `pid` is
 * REQUIRED and enforced at runtime, not just by the type: a non-finite pid
 * refuses as 'offline' rather than reaching `ctx.resolve`'s primary-entity
 * fallback (the one caller is the server, which always names the live
 * session, so an omitted pid could only ever mis-target the server sim's
 * primary entity). Draw-free, like everything here.
 */
export function restoreToolEffectSlotAction(
  ctx: SimContext,
  professionId: string,
  effectId: string,
  pid: number,
): 'ok' | 'invalid_request' | 'no_tool' | 'already_slotted' | 'offline' {
  // `pid` is required at the type level, but `ctx.resolve` falls back to the
  // sim's PRIMARY entity when it is undefined: an omitted or malformed pid
  // must never aim a charm-free mint at whoever that entity happens to be.
  if (!Number.isFinite(pid)) return 'offline';
  const r = ctx.resolve(pid);
  if (!r) return 'offline';
  if (!(GATHERING_PROFESSION_IDS as readonly string[]).includes(professionId)) {
    return 'invalid_request';
  }
  if (!Object.hasOwn(TOOL_EFFECTS, effectId)) return 'invalid_request';
  if (slotToolEffectRefused(professionId, effectId)) return 'invalid_request';
  const profession = professionId as GatheringProfessionId;
  if (r.meta.toolEffectSlots?.[profession] !== undefined) return 'already_slotted';
  const best = bestOwnedGatherToolFor(r.meta.inventory, profession, ITEMS);
  if (best.ownedTier === NO_TOOL_OWNED) return 'no_tool';
  const slot = slotEffect(effectId as ToolEffectId, { toolRarity: best.rarity });
  applyMintedSlot(ctx, r, profession, effectId, slot);
  return 'ok';
}

type RechargeDenyReason =
  | 'invalid_request'
  | 'no_slot'
  | 'no_tool'
  | 'already_full'
  | 'tool_capped'
  | 'busy'
  // Historical wire reason from the retired shared throttle. Never emitted
  // after Phase 5; kept in the union so older clients can still type-decode.
  | 'throttled';

function emitRechargeDeny(
  ctx: SimContext,
  pid: number,
  professionId: string,
  reason: RechargeDenyReason,
  effectId?: string,
  materials?: { materialItemId: string; count: number },
): void {
  ctx.emit({
    type: 'toolEffectResult',
    action: 'recharge',
    ok: false,
    professionId,
    ...(effectId === undefined ? {} : { effectId }),
    ...(materials === undefined
      ? {}
      : { materialItemId: materials.materialItemId, count: materials.count }),
    reason,
    pid,
  });
}

/**
 * Pre-consume admission for a tool-recharge cast: true when the cast may
 * start; on false the deny event was already emitted. No side effects. The
 * completion re-resolves slot and price from scratch (resolveRechargeBody),
 * so nothing resolved here is threaded forward.
 */
function evaluateRechargeAdmission(
  ctx: SimContext,
  r: NonNullable<ReturnType<SimContext['resolve']>>,
  professionId: string,
): boolean {
  if (!(GATHERING_PROFESSION_IDS as readonly string[]).includes(professionId)) {
    emitRechargeDeny(ctx, r.meta.entityId, professionId, 'invalid_request');
    return false;
  }
  const slot = r.meta.toolEffectSlots?.[professionId as GatheringProfessionId];
  if (!slot) {
    emitRechargeDeny(ctx, r.meta.entityId, professionId, 'no_slot');
    return false;
  }
  const resolved = resolveRechargeToolEffect(
    r.meta.inventory,
    professionId,
    slot,
    r.meta.name,
    r.meta.craftSkills,
    ITEMS,
  );
  if (!resolved.ok) {
    emitRechargeDeny(ctx, r.meta.entityId, professionId, resolved.reason, slot.effectId);
    return false;
  }
  if (ctx.countItem(resolved.materialItemId, r.meta.entityId) < resolved.count) {
    // insufficient_materials is the one surface that carries the price so the
    // player learns the cost from the refusal itself.
    ctx.emit({
      type: 'toolEffectResult',
      action: 'recharge',
      ok: false,
      professionId,
      effectId: slot.effectId,
      reason: 'insufficient_materials',
      materialItemId: resolved.materialItemId,
      count: resolved.count,
      pid: r.meta.entityId,
    });
    return false;
  }
  return true;
}

function beginToolRechargeCast(ctx: SimContext, p: Entity, professionId: string): void {
  if (p.sitting) ctx.standUp(p);
  if (p.mountKey !== '') forceDismount(ctx, p);
  if (p.mountCastKey !== '') {
    p.mountCastRemaining = 0;
    p.mountCastKey = '';
  }
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  const duration = TOOL_RECHARGE_CAST_DURATION_SEC;
  p.castingAbility = TOOL_RECHARGE_CAST_ID;
  p.castTotal = duration;
  p.castRemaining = duration;
  p.castTargetId = null;
  p.channeling = false;
  p.toolRechargeCastProfessionId = professionId;
  ctx.emit({
    type: 'castStart',
    entityId: p.id,
    ability: TOOL_RECHARGE_CAST_ID,
    time: duration,
  });
}

/**
 * Apply one admitted recharge: re-resolve price/fill, consume materials, fill
 * the slot. Emits toolEffectResult. Used by completeRechargeCast after a cast
 * finishes; materials never leave the bags until this runs successfully.
 */
function resolveRechargeBody(
  ctx: SimContext,
  r: NonNullable<ReturnType<SimContext['resolve']>>,
  professionId: string,
): void {
  if (!(GATHERING_PROFESSION_IDS as readonly string[]).includes(professionId)) {
    emitRechargeDeny(ctx, r.meta.entityId, professionId, 'invalid_request');
    return;
  }
  const slot = r.meta.toolEffectSlots?.[professionId as GatheringProfessionId];
  if (!slot) {
    emitRechargeDeny(ctx, r.meta.entityId, professionId, 'no_slot');
    return;
  }
  const resolved = resolveRechargeToolEffect(
    r.meta.inventory,
    professionId,
    slot,
    r.meta.name,
    r.meta.craftSkills,
    ITEMS,
  );
  if (!resolved.ok) {
    emitRechargeDeny(ctx, r.meta.entityId, professionId, resolved.reason, slot.effectId);
    return;
  }
  if (ctx.countItem(resolved.materialItemId, r.meta.entityId) < resolved.count) {
    ctx.emit({
      type: 'toolEffectResult',
      action: 'recharge',
      ok: false,
      professionId,
      effectId: slot.effectId,
      reason: 'insufficient_materials',
      materialItemId: resolved.materialItemId,
      count: resolved.count,
      pid: r.meta.entityId,
    });
    return;
  }
  ctx.removeItem(resolved.materialItemId, resolved.count, r.meta.entityId);
  // The fill is the R30 re-derive (the tool held right now); the ceiling is
  // the R47 high-water mark, raised by a better tool and never lowered by a
  // lesser one, which is what keeps the price rung from resetting on every
  // cheap fill.
  slot.durability = resolved.newMax;
  slot.maxDurability = resolved.ceiling;
  ctx.emit({
    type: 'toolEffectResult',
    action: 'recharge',
    ok: true,
    professionId,
    effectId: slot.effectId,
    materialItemId: resolved.materialItemId,
    count: resolved.count,
    pid: r.meta.entityId,
  });
}

/**
 * Recharge `professionId`'s slotted effect for its owner, at the R39 price
 * (the arcane material of the resolved rarity rung, count scaled to the
 * charges restored, the original-crafter and specialization discounts
 * composed into the count) and the R30 fill (sized by the best tool owned
 * NOW, so a borrowed epic pick's inflated mint buys one fill at most). The
 * price rung is floored at the slot's own ceiling per R47, so stashing a
 * good tool cannot buy a cheap fill; the resolver owns that whole decision.
 *
 * Craft Cast System Phase 5: validates and STARTS a TOOL_RECHARGE_CAST_ID
 * cast. Materials resolve only on completeRechargeCast. No shared action
 * throttle: cast duration paces the recharge.
 */
export function rechargeToolEffectAction(
  ctx: SimContext,
  professionIdWire: string,
  pid?: number,
): void {
  // Same wire-id clamp as slotToolEffectAction, for the same echo reason.
  const professionId = boundEchoedWireId(professionIdWire);
  // Same shared dead gate as slotToolEffectAction, for the same family-
  // consistency reason (materials must not leave a dead player's bags).
  if (refusedWhileDead(ctx, pid)) return;
  const r = ctx.resolve(pid);
  if (!r) return;
  const { e: p, meta } = r;
  if (p.castingAbility || isConsuming(p)) {
    emitRechargeDeny(ctx, meta.entityId, professionId, 'busy');
    return;
  }
  // Validate the profession id BEFORE indexing the slot record:
  // toolEffectSlots is a plain object literal, so a wire string like
  // 'constructor' would otherwise resolve a prototype member as a truthy
  // slot and carry it into the resolver (harmless only by the resolver's
  // internal check order). The repo's hasOwn doctrine for plain-object
  // tables, applied structurally.
  if (!evaluateRechargeAdmission(ctx, r, professionId)) return;
  beginToolRechargeCast(ctx, p, professionId);
}

/**
 * Completion of a running tool-recharge cast. Re-validates and applies the
 * resolve body; emits toolEffectResult. Materials never left the bags at start.
 */
export function completeRechargeCast(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  const professionId = p.toolRechargeCastProfessionId;
  p.toolRechargeCastProfessionId = '';
  if (professionId === '') return;
  const r = ctx.resolve(meta.entityId);
  if (!r) {
    emitRechargeDeny(ctx, meta.entityId, professionId, 'invalid_request');
    return;
  }
  resolveRechargeBody(ctx, r, professionId);
}
