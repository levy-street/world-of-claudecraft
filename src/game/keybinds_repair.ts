// One-time, signature-keyed repair of stored keybind profiles left corrupted by
// two shipped-then-reverted layout changes. Pure (no DOM); it operates on the
// already-parsed bindings blob so Keybinds.load() stays a thin consumer and the
// repair is unit-tested directly.
//
// Why a signature repair instead of a general guard: a stored blob carries no
// version marker, so nothing distinguishes "the old convention" from "a
// deliberate remap that merely looks unusual". A heuristic that reverts any
// value resembling the old layout also reverts legitimate remaps and can drop
// the bindings they collide with. Each repair below therefore fires ONLY on the
// EXACT corrupted signature and simply DELETES the affected keys, so they fall
// back to their current defaults; every other stored value is left untouched.
//
// Signature A, the Q/E strafe overhaul (commit 1d2678f58, reverted by #1788):
// that overhaul shipped SLOT_DEFAULTS[10] = ['KeyQ','Minus'] and [11] =
// ['KeyE','Equal'] with Strafe Left/Right on empty defaults, so a profile SAVED
// during its window persisted slot10/slot11 holding Q/E and strafeLeft/
// strafeRight unbound. After the revert those explicit stored values stick (a
// stored binding always wins over the current default), so pressing Q/E drives
// action-bar slots and strafe is dead. Dropping the four keys re-seeds strafe to
// Q/E and slot10/slot11 to Minus/Equal, the current defaults.
//
// Signature B, the targetFriendly/meters KeyH collision: both used to default to
// KeyH, and the uniqueness sweep handed KeyH to Target Nearest Friendly
// (Targeting precedes Interface), so the next save() persisted Damage Meters as
// [null, null]. Damage Meters now defaults to Shift+KeyH, but a stored null wins
// over the default, so the collision victims stay unbound. clear() has no caller
// in src/ and the rebind-capture flow treats a null capture as CANCELLED, not as
// an unbind, so a stored null for meters can only be loader eviction, never
// player intent: dropping the key re-seeds meters to Shift+KeyH.

export type StoredBindingsBlob = Record<string, unknown>;

function entryPrimary(v: unknown): string | null {
  return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
}

// True when the stored entry exists but binds nothing (e.g. [null, null], the
// exact shape a uniqueness-sweep eviction persists). An ABSENT key is not empty:
// it keeps the current default rather than loading unbound.
function isEmptyEntry(v: unknown): boolean {
  return Array.isArray(v) && v.every((c) => c === null || c === undefined);
}

// True when Target Nearest Friendly resolves to KeyH: either it is absent (so it
// keeps its current KeyH default) or its stored primary is KeyH.
function targetFriendlyIsKeyH(obj: StoredBindingsBlob): boolean {
  if (!('targetFriendly' in obj)) return true;
  return entryPrimary(obj.targetFriendly) === 'KeyH';
}

/**
 * Mutate `obj` in place, deleting only the keys that match a known corrupted
 * signature so Keybinds.load() re-seeds them to their current defaults. Returns
 * the same object for convenience. Any blob that does not match a signature is
 * returned unchanged.
 */
export function repairStoredBindings(obj: StoredBindingsBlob): StoredBindingsBlob {
  // Signature A: the Q/E strafe overhaul fingerprint. Require the full four-key
  // shape (Q on slot10, E on slot11, both strafe actions empty) so a deliberate
  // remap that happens to touch only one of them never trips it.
  if (
    entryPrimary(obj.slot10) === 'KeyQ' &&
    entryPrimary(obj.slot11) === 'KeyE' &&
    isEmptyEntry(obj.strafeLeft) &&
    isEmptyEntry(obj.strafeRight)
  ) {
    delete obj.slot10;
    delete obj.slot11;
    delete obj.strafeLeft;
    delete obj.strafeRight;
  }
  // Signature B: meters evicted to empty while targetFriendly still holds KeyH.
  if (isEmptyEntry(obj.meters) && targetFriendlyIsKeyH(obj)) {
    delete obj.meters;
  }
  return obj;
}
