// Deferral policy for applying a weapon-skin cosmetic (its model swap, its
// derived emissive materials and its VFX rig) to a live character view.
//
// The renderer's per-frame diff used to run that whole chain synchronously the
// moment `e.weaponSkinId` disagreed with the view's latch, so a burst of
// skinned players coming into interest applied every rig inside one frame: the
// reported connection freeze. This core owns the decisions instead, and the
// renderer stays a thin consumer that only does the Three work the core hands
// it.
//
// Rules, in one place:
//   - BUDGET: at most `WEAPON_SKIN_APPLIES_PER_FRAME` applications leave the
//     queue per drain, so a crowd spreads over frames instead of stalling one.
//   - PRIORITY: with a rank callback (the renderer ranks by squared distance to
//     the player), each budget slot goes to the nearest valid pending entry, so
//     the wearer standing next to you never waits behind thirty distant
//     arrivals. Without one, order is FIFO.
//   - COALESCING: one pending entry per view id. The diff re-enqueues every
//     frame while an entry waits (the view's latch is only written when the
//     application actually RUNS, so a queued-but-dropped skin always retries),
//     and a skin changed again while queued keeps its queue position but takes
//     the newest value.
//   - CANCELLATION: a removed or recycled view drops its pending entry, so an
//     application never lands on a dead view.
//   - STALE-GUARD: at drain time the caller re-reads the entity's live skin id.
//     An entry that no longer matches is dropped WITHOUT spending budget; if
//     the view still needs a skin, the next frame's diff re-enqueues it.
//
// Clearing a skin (back to null) deliberately does NOT queue: the teardown
// path re-attaches the base weapon model and builds no VFX rig, so it is cheap
// enough to stay synchronous and instant. The renderer cancels any pending
// entry for that view first, so a queued apply can never resurrect a skin the
// player just took off.

/** Applications drained per frame. One is enough to keep the rig latency
 *  imperceptible (a few frames for a crowd) while never stacking two derive +
 *  rig builds into the same frame. */
export const WEAPON_SKIN_APPLIES_PER_FRAME = 1;

export interface WeaponSkinApplyDecision {
  viewId: number;
  skinId: string;
}

/**
 * The entity's CURRENT weapon-skin id at drain time: `undefined` when the view
 * or its entity is gone (drop the entry), otherwise the live id, which the
 * stale-guard compares against the queued one.
 */
export type WeaponSkinLookup = (viewId: number) => string | null | undefined;

/**
 * Rank for one pending view; LOWER drains first. `undefined` ranks WORST, so a
 * view the caller cannot place (its entity vanished between the enqueue and the
 * drain) never wins a slot ahead of a real one.
 */
export type WeaponSkinRank = (viewId: number) => number | undefined;

/**
 * Resolve an entity into the value the stale-guard compares against.
 *
 * Both "entity is gone" and "entity carries no skin any more" INTENTIONALLY
 * collapse to `undefined`, which drops the queued entry: neither is something
 * to apply. Dropping a cleared skin loses nothing, because the renderer's diff
 * handles that direction synchronously (teardown is cheap) on the same frame it
 * sees it.
 */
export function resolveQueuedSkinLookup(
  entity: { weaponSkinId: string | null } | undefined,
): string | undefined {
  return entity?.weaponSkinId ?? undefined;
}

export class WeaponSkinApplyQueue {
  // Insertion-ordered, so an unranked drain is FIFO. Re-setting an existing key
  // updates the value and KEEPS its position, which is exactly the coalescing
  // rule.
  private readonly pending = new Map<number, string>();
  // Decision slots owned by the queue and handed out by reference: grown once,
  // then mutated in place, so a steady-state drain allocates nothing.
  private readonly slots: WeaponSkinApplyDecision[] = [];

  get size(): number {
    return this.pending.size;
  }

  has(viewId: number): boolean {
    return this.pending.has(viewId);
  }

  /** Queue (or re-coalesce) a skin application for one view. Idempotent: the
   *  per-frame diff calls this on every frame the view's latch still disagrees. */
  enqueue(viewId: number, skinId: string): void {
    this.pending.set(viewId, skinId);
  }

  /** Drop a view's pending entry (view removed, recycled, or skin cleared). */
  cancel(viewId: number): void {
    this.pending.delete(viewId);
  }

  clear(): void {
    this.pending.clear();
  }

  /**
   * Take up to `budget` applications that are still valid, filling and
   * returning the caller-owned `out` array. Entries the guard rejects (dead
   * view, skin moved on) leave the queue without spending a slot; everything
   * else keeps its place for a later drain.
   *
   * ALLOCATION: none in steady state. `out` is refilled with queue-owned slot
   * objects, so `out.length` carries the count and the entries are stable by
   * reference across drains, which also means they stay valid only until the
   * NEXT take (the renderer consumes them inside the same frame). The scan
   * costs O(pending) per slot and only runs while something is queued.
   */
  take(
    budget: number,
    current: WeaponSkinLookup,
    out: WeaponSkinApplyDecision[],
    rank?: WeaponSkinRank,
  ): WeaponSkinApplyDecision[] {
    out.length = 0;
    if (budget <= 0) return out;
    while (out.length < budget && this.pending.size > 0) {
      let bestId: number | null = null;
      let bestSkin = '';
      let bestRank = Number.POSITIVE_INFINITY;
      for (const [viewId, skinId] of this.pending) {
        const live = current(viewId);
        // Dead view, or the skin moved on while this entry waited: drop it and
        // keep scanning, so a stale entry never spends the frame's budget.
        if (live === undefined || live !== skinId) {
          this.pending.delete(viewId);
          continue;
        }
        // Without a rank callback every candidate scores the same, so the
        // strict comparison below keeps the FIRST valid entry: plain FIFO.
        const value = rank ? (rank(viewId) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
        if (bestId === null || value < bestRank) {
          bestId = viewId;
          bestSkin = skinId;
          bestRank = value;
        }
      }
      if (bestId === null) break;
      this.pending.delete(bestId);
      const slot = this.slot(out.length);
      slot.viewId = bestId;
      slot.skinId = bestSkin;
      out.push(slot);
    }
    return out;
  }

  private slot(index: number): WeaponSkinApplyDecision {
    let slot = this.slots[index];
    if (!slot) {
      slot = { viewId: 0, skinId: '' };
      this.slots[index] = slot;
    }
    return slot;
  }
}
