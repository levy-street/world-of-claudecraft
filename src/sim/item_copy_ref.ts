// Per-copy item addressing: WHICH copy of an item id an action consumes.
//
// Two copies of one item id are no longer interchangeable. Since the instanced
// payload landed (#1165) a stack can carry an enchant, a masterwork seal, rolled
// stats, a signer, or a crafting provenance, so "salvage Furyforged Girdle" is an
// ambiguous instruction the moment a player holds two of them. Every item command
// still names only an item id on the wire, so each one guesses, and they do not
// even guess the same way:
//
//   consumeEquippedInventoryUnit (items.ts, equip)     newest match wins
//   removePreferFungible (discard / sell / trade)      plain copies first, then newest
//   removeItem (raw callers)                           newest match wins
//
// That guess has been patched three times without being fixed: the phase 12 trade
// copy-choice fix, the phase 18 widening onto the discard and vendor arms, and the
// #2398 buyback review, each adding a heuristic PREDICATE to bias the guess rather
// than letting the caller NAME the copy. Enchanting is the one family that took the
// other road, and it works: the client sends the bag index, the sim consumes exactly
// that slot, and a pin re-checked mid-cast catches a bag that shifted underneath.
//
// This module is that mechanism, lifted out so every surface can share it. Both
// halves are MOVES, byte-identical to the private originals they replace
// (`consumeSelectedInventorySlot` and `disenchantVictimPin` from
// professions/enchanting.ts, `consumeEquippedInventoryUnit` from items.ts), because
// the golden-trace parity gate drives equip / discard / sell / use and an id-only
// call must stay bit-for-bit what it was. The extraction is the rule of three:
// enchanting had it, items.ts had a near-copy of the fallback half, and the gear
// loadout is the third caller.
//
// A pure leaf on purpose: no SimContext, no rng, no clock. It takes an `InvSlot[]`
// and mutates it, so a Vitest drives it directly with a plain array.
//
// THE PATTERN A NEW SURFACE SHOULD COPY, since this is the part that took two
// review rounds to settle:
//
//   1. Resolve the selection WITHOUT consuming, before anything mutates, and refuse
//      there (`selectedInventorySlot(...) === null`). Refusing late is how equipItem
//      destroyed the displaced piece and how useItem granted its effect for free:
//      both had already written state by the time the consume could say no.
//   2. Consume at the point the surface actually takes the item
//      (`consumeSelectedInventorySlot`), falling back to
//      `consumeNewestInventoryUnit` only when no selection was given.
//   3. For a multi-tick action, pin the target with `itemCopyPin` at the start and
//      re-check it at completion (enchanting and salvage both do this inline).
//
// An earlier draft exported a composed `consumeItemCopy` plus an outcome union for
// step 2. Every converted surface ended up wanting the split above instead, because
// the refusal has to happen EARLIER than the consume, so the composed helper was
// removed rather than left as documented-but-unused advice.

import { cloneItemInstancePayload, type InventoryUnit, type InvSlot } from './types';

/** Stable, order-independent JSON, so a pin does not depend on key insertion
 *  order. Moved verbatim from professions/enchanting.ts. */
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // An explicit undefined fingerprints like an ABSENT key (JSON.stringify
    // drops both), so clearing a field by assignment can never flip the pin.
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedJson(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Identity of the COPY sitting in a bag slot, for re-checking a selection that
 *  may have moved. Deliberately not the bag index: an index is what shifts. The
 *  pin covers the item id, the instance payload, and the crafted provenance,
 *  which together are everything that distinguishes two copies of one id.
 *
 *  An empty string means "no slot", so a caller with no selection pins nothing
 *  and compares equal to nothing. Moved verbatim from `disenchantVictimPin`. */
export function itemCopyPin(slot: InvSlot | undefined): string {
  if (!slot) return '';
  return sortedJson({
    c: slot.craftedRecipeId ?? null,
    i: slot.itemId,
    p: slot.instance ?? null,
  });
}

/**
 * Consume one unit from the bag slot the caller NAMED. Three outcomes, and the
 * distinction between the last two is the whole point of the tri-state:
 *
 *   InventoryUnit  the named slot held the item and one unit was taken
 *   null           a selection was given and is NOT valid: refuse the action
 *   undefined      no selection was given: the caller may fall back
 *
 * Collapsing `null` into `undefined` would turn a bad selection into a silent
 * guess, which is the bug this module exists to remove. Callers must branch on
 * all three.
 *
 * Validates the index itself (integer, in range) rather than trusting it: the
 * index arrives from a client, and the server re-resolves against its own
 * inventory. Moved verbatim from `consumeSelectedInventorySlot`.
 */
export function consumeSelectedInventorySlot(
  inventory: InvSlot[],
  itemId: string,
  slotIndex: number | undefined,
): InventoryUnit | undefined | null {
  if (slotIndex === undefined) return undefined;
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= inventory.length) return null;
  const slot = inventory[slotIndex];
  if (slot.itemId !== itemId || slot.count < 1) return null;
  const instance =
    slot.instance && slot.count > 1 ? cloneItemInstancePayload(slot.instance) : slot.instance;
  const craftedRecipeId = slot.craftedRecipeId;
  slot.count -= 1;
  if (slot.count <= 0) inventory.splice(slotIndex, 1);
  return { instance, craftedRecipeId };
}

/**
 * The legacy fallback: consume the NEWEST matching copy (highest bag index down).
 *
 * This is the historical guess, kept exactly as it was and deliberately NOT
 * improved. Every id-only caller still reaches it, including callers no UI can
 * fix (`server/pbe_boost.ts` auto-gears by bare item id), and the parity goldens
 * drive equip / discard / sell / use through it, so any change here forks the
 * world. New surfaces should pass a selection instead of relying on this.
 *
 * Moved verbatim from `consumeEquippedInventoryUnit` (items.ts), parameterized on
 * the inventory array rather than PlayerMeta so it composes with the selected
 * walk above and needs no meta in a test.
 */
export function consumeNewestInventoryUnit(inventory: InvSlot[], itemId: string): InventoryUnit {
  for (let i = inventory.length - 1; i >= 0; i--) {
    const slot = inventory[i];
    if (slot.itemId !== itemId) continue;
    const instance =
      slot.instance && slot.count > 1 ? cloneItemInstancePayload(slot.instance) : slot.instance;
    const craftedRecipeId = slot.craftedRecipeId;
    slot.count -= 1;
    if (slot.count <= 0) inventory.splice(i, 1);
    return { instance, craftedRecipeId };
  }
  return { instance: undefined, craftedRecipeId: undefined };
}

/**
 * The non-consuming twin of `consumeNewestInventoryUnit` above: SAME walk (highest
 * bag index down), SAME match predicate, but returns the live slot rather than
 * taking a unit from it. For a caller that must inspect the copy an id-only
 * command would consume BEFORE committing to consume it (equipBag's bag-payload
 * refusal, bags.ts, #2837): peeking through this function rather than a
 * bespoke walk is what keeps it locked to the real selection `ctx.removeItem`
 * (`Sim.removeItem`) makes, instead of drifting into its own guess.
 *
 * THE ONE PRECONDITION, stated because a caller that misses it destroys items.
 * This agrees with `Sim.removeItem` only when the newest matching slot holds
 * `count >= 1`. `removeItem` takes `Math.min(s.count, count)` per slot, so a
 * non-positive count yields nothing, splices the slot and CONTINUES to the next
 * match, while this walk stops at it; a caller that peeks here and consumes
 * through `removeItem` would then inspect one copy and destroy another. The
 * consuming twin above has no such gap (it decrements the first match
 * unconditionally), and `selectedInventorySlot` below refuses `count < 1`
 * outright. A caller pairing this peek with `removeItem` must apply that same
 * `count >= 1` refusal itself; `bank_sockets.ts` bankSocketBag does.
 */
export function newestMatchingSlot(inventory: InvSlot[], itemId: string): InvSlot | undefined {
  for (let i = inventory.length - 1; i >= 0; i--) {
    if (inventory[i].itemId === itemId) return inventory[i];
  }
  return undefined;
}

/**
 * Resolve the bag slot the caller NAMED without consuming anything, for actions
 * that MUTATE a copy in place rather than destroying it (the rift forge upgrades,
 * enchants and sockets the slot's own payload).
 *
 * Same tri-state as the consuming walk, and the same reason for it: `null` is an
 * invalid selection the caller must refuse, `undefined` means none was given.
 * Kept separate from the consuming version rather than folded into it, because a
 * mutating caller that accidentally consumed its target would destroy the item it
 * was asked to improve.
 */
export function selectedInventorySlot(
  inventory: InvSlot[],
  itemId: string,
  slotIndex: number | undefined,
): InvSlot | undefined | null {
  if (slotIndex === undefined) return undefined;
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= inventory.length) return null;
  const slot = inventory[slotIndex];
  if (slot.itemId !== itemId || slot.count < 1) return null;
  return slot;
}

/**
 * Fold the shared entry points' overloaded trailing pair into (pid, named
 * slot). Sim's public item commands accept `pidOrTarget` as EITHER a host pid
 * (server/RL callers) OR the IWorld `{ slotIndex }` target (the UI naming the
 * exact copy, this module's whole subject), with a trailing `slotIndex` for
 * the pid arity. Extracted from the fifteen per-delegate copies in sim.ts
 * (rule of three, several times over), so the fold has ONE definition.
 *
 * Null-guarded (the bankSocketBag precedent): these delegates sit on the
 * shared entry point both hosts call, and `typeof null === 'object'` would
 * throw on `.slotIndex` if any caller ever passed a null target. No shipped
 * wire path can (dispatch parses `msg.slot` into the trailing arm), so the
 * guard is defense in depth, now uniform instead of per-site.
 */
export function foldNamedSlotTarget(
  pidOrTarget: number | { slotIndex: number } | undefined,
  slotIndex: number | undefined,
): { pid: number | undefined; named: number | undefined } {
  const pid = typeof pidOrTarget === 'number' ? pidOrTarget : undefined;
  const named =
    pidOrTarget !== null && typeof pidOrTarget === 'object' ? pidOrTarget.slotIndex : slotIndex;
  return { pid, named };
}
