// One-time client-side reset of the persisted unit-frame drag positions.
// v0.24.0 shipped the PR #1736 interface overhaul for about a day before
// v0.24.1 reverted it; frame positions dragged against the overhaul layout
// replay verbatim against the restored classic layout, leaving the player
// frame detached in a stale spot. The stored {left,top} carries no version or
// timestamp, so a targeted clear is impossible: v0.24.1 therefore clears BOTH
// unit-frame position keys once per client, keyed by an epoch marker. Bump
// LAYOUT_RESET_EPOCH if another forced layout reset is ever needed.

export const LAYOUT_RESET_EPOCH = 1;
export const LAYOUT_RESET_EPOCH_KEY = 'woc_layout_reset_epoch';
// The MovableFrame storage keys hud.ts wires up; hud.ts imports these so the
// reset and the movers can never drift apart.
export const PLAYER_FRAME_POS_KEY = 'woc_player_frame_pos';
export const TARGET_FRAME_POS_KEY = 'woc_target_frame_pos';
export const FRAME_POS_RESET_KEYS = [PLAYER_FRAME_POS_KEY, TARGET_FRAME_POS_KEY] as const;

// The subset of Storage the reset touches, so tests can pass a plain fake.
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Clear the saved unit-frame positions once per client (per epoch) and stamp
 *  the marker. Returns true when this call performed the reset. Must run
 *  BEFORE the MovableFrames construct, since they apply a saved position (and
 *  detach the player frame) in their constructors. Storage failures are
 *  swallowed like MovableFrame's own: a client without storage never had a
 *  saved position to clear. A corrupt marker counts as unseen (reset once,
 *  marker repaired); a future epoch never re-clears on a downgrade. */
export function resetFramePositionsOnce(storage: StorageLike): boolean {
  try {
    const seen = Number(storage.getItem(LAYOUT_RESET_EPOCH_KEY) ?? '0');
    if (Number.isFinite(seen) && seen >= LAYOUT_RESET_EPOCH) return false;
    for (const key of FRAME_POS_RESET_KEYS) storage.removeItem(key);
    storage.setItem(LAYOUT_RESET_EPOCH_KEY, String(LAYOUT_RESET_EPOCH));
    return true;
  } catch {
    return false;
  }
}
