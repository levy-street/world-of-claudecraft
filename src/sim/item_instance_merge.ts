// Identical-payload stacking (Professions 2.0): the one predicate
// deciding when two inventory slots of the same itemId may share a stack.
// Before this predicate every instanced slot (#1165) sat one-per-slot at count 1;
// now byte-equal payloads (same signer, same rolled quality/stats/masterwork,
// same enchant, same boundTo) merge up to the item's stack cap. bags.ts
// countFit/addStacked, Sim.addItemInstance, bank.ts moveBetweenContainers,
// and trade.ts fitsAfterSwap all consume canStackInstancePayloads below, so
// the merge rule cannot drift between bags, bank, and trade.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no rng, no clock
// (enforced by tests/architecture.test.ts). Pure bookkeeping, zero draws.

import type { ItemInstancePayload } from './types';

// Canonical structural equality over plain JSON-ish data: key-order
// independent, and a key that is absent equals a key set to undefined (a
// loaded payload and a freshly-built one must compare equal even when one
// spells an empty optional out). Compares EVERY present key, not just the
// declared payload fields, so a persisted payload carrying an unknown extra
// field never merges into (and silently loses it to) one without it.
function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keysA = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const keysB = Object.keys(rb).filter((k) => rb[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!structurallyEqual(ra[k], rb[k])) return false;
  }
  return true;
}

/** True when the two payloads are structurally identical over the full
 *  payload shape (signer, charges, rolled incl. quality/stats/masterwork,
 *  enchant, boundTo, and any persisted extra field). Two absent payloads are
 *  equal; a payload never equals no payload (a plain stack stays distinct
 *  from every instanced one, in both directions). */
export function itemInstancePayloadsEqual(
  a: ItemInstancePayload | undefined,
  b: ItemInstancePayload | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return structurallyEqual(a, b);
}

/** False when the payload carries `charges`: charges is the one payload field
 *  with mutate-in-place per-unit semantics, and a counted stack shares ONE
 *  payload object, so charge-bearing payloads stay one-per-slot as a
 *  structural safety (no shipped stackable item carries charges today; this
 *  is a forward guard). An absent payload is trivially mergeable. */
export function isMergeableInstancePayload(p: ItemInstancePayload | undefined): boolean {
  return p?.charges === undefined;
}

/** The single merge predicate every stacking site consumes: both payloads
 *  mergeable AND structurally equal. Two absent payloads stack (the plain
 *  fungible arm), so callers can gate plain and instanced adds uniformly. */
export function canStackInstancePayloads(
  a: ItemInstancePayload | undefined,
  b: ItemInstancePayload | undefined,
): boolean {
  return (
    isMergeableInstancePayload(a) &&
    isMergeableInstancePayload(b) &&
    itemInstancePayloadsEqual(a, b)
  );
}
