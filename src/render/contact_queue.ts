/** Blade-contact timing for melee damage presentation (2026-09-28 review: "make sure we are timing
 *  the animations to the animations in game").
 *
 * The sim resolves a melee swing on its damage event and the attacker's one-shot starts on that
 * same frame, so every target-side effect used to fire the moment the clip STARTED: the number,
 * the flinch, the spark and the impact sound all landed 0.1 to 0.65 s before the blade did.
 * CharacterVisual.playAttack now reports how long its swing takes to land (ClipMap.contacts,
 * attack_swing_core.ts); the renderer records that per event here and holds the target-side
 * effects until then. The FCT painter asks the same table (FctPainterOptions.contactDelaySec),
 * so the number, the flinch, the spark and the sound all arrive with the blade.
 *
 * Presentation only: health, nameplates, cast bars and the combat log still update on the event
 * (nothing a player acts on is delayed), and a swing with no listed contact plays everything at
 * once exactly as before. No timers: due callbacks run from the renderer's frame (tick), off the
 * frame clock it already passes.
 *
 * A kill is held the same way (holdsDeath): the struck body keeps standing until the blade lands.
 * The renderer asks for that hold once per body per frame and three things read the one answer,
 * so they go on the same frame (collapsed, heldUntilCollapse below): the death pose, the mount
 * under a seated rider, and the wings on a paladin. Nothing else is held: whatever else the death
 * ended (a shapeshift form, a cast pose, the other aura-driven looks) still leaves on the event.
 */

/** The longest a presentation effect may be held: a clip listing a later contact is clamped. */
export const CONTACT_HOLD_MAX_SEC = 1.0;

/** Whether a dead body is PRESENTED dead this frame: dead, and its collapse not held for the
 *  blade that dealt the kill (`deathHeld`: ContactQueue.holdsDeath). */
export function collapsed(dead: boolean, deathHeld: boolean): boolean {
  return dead && !deathHeld;
}

/**
 * What a body whose death is held keeps showing of something that death ended. The sim clears
 * those on the tick the death resolves (a rider's mountKey: the mount bolts; a paladin's wing
 * auras: stripped with every buff), a frame before a held collapse shows any of it, so `live`
 * is already empty when the hold begins. While the death is held the body presents what it
 * presented on the frame before (`last`); from the collapse on, the live value again.
 */
export function heldUntilCollapse<T>(deathHeld: boolean, live: T, last: T): T {
  return deathHeld ? last : live;
}

interface Pending {
  dueAt: number;
  fn: () => void;
}

export class ContactQueue {
  /** event -> seconds its presentation is held (only events whose swing reported a contact) */
  private readonly delays = new WeakMap<object, number>();
  private readonly pending: Pending[] = [];
  /** target entity id -> frame time (ms) its last pending blade lands: a target killed by the
   *  swing keeps standing until then, so it collapses under the blade, not ahead of it */
  private readonly deathHold = new Map<number, number>();
  /** The frame clock (ms) of the last tick: what a hold is read against inside that frame. */
  private frameNow = 0;

  /** Record the contact delay of the swing this event started (<= 0 records nothing), and hold
   *  the target's collapse until that contact. */
  note(ev: object, delaySec: number, targetId?: number, now = 0): void {
    if (!(delaySec > 0)) return;
    const d = Math.min(delaySec, CONTACT_HOLD_MAX_SEC);
    this.delays.set(ev, d);
    if (targetId !== undefined) {
      const due = now + d * 1000;
      if (due > (this.deathHold.get(targetId) ?? 0)) this.deathHold.set(targetId, due);
    }
  }

  /** True while a blade swung at this entity has not landed yet (its death pose waits). `now`
   *  is the frame clock in ms: the last tick's unless one is given. */
  holdsDeath(id: number, now = this.frameNow): boolean {
    const until = this.deathHold.get(id);
    if (until === undefined) return false;
    if (now < until) return true;
    this.deathHold.delete(id);
    return false;
  }

  /** Seconds this event's presentation is held (0 = at once). */
  delayFor(ev: object): number {
    return this.delays.get(ev) ?? 0;
  }

  /** Run `fn(ev)` on `self` when this event's blade lands. An event with no contact (every
   *  event but a held melee hit) runs it at once and allocates nothing, so a caller on a
   *  per-event path hands its method and itself over instead of building a closure per event. */
  atContact<E extends object, S = undefined>(
    ev: E,
    now: number,
    fn: (this: S, ev: E) => void,
    self?: S,
  ): void {
    const delaySec = this.delayFor(ev);
    if (delaySec > 0) this.after(delaySec, now, () => fn.call(self as S, ev));
    else fn.call(self as S, ev);
  }

  /** Run `fn` after `delaySec` (at once for <= 0). `now` is the frame clock in ms. */
  after(delaySec: number, now: number, fn: () => void): void {
    if (!(delaySec > 0)) {
      fn();
      return;
    }
    const dueAt = now + Math.min(delaySec, CONTACT_HOLD_MAX_SEC) * 1000;
    // kept in due order (a later swing can carry a shorter contact)
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].dueAt > dueAt) i--;
    this.pending.splice(i, 0, { dueAt, fn });
  }

  /** Run every held effect whose contact has arrived (call once per frame), and forget the
   *  death holds that have passed (a target that never died would otherwise keep its entry). */
  tick(now: number): void {
    this.frameNow = now;
    for (const [id, until] of this.deathHold) if (now >= until) this.deathHold.delete(id);
    let n = 0;
    while (n < this.pending.length && this.pending[n].dueAt <= now) n++;
    if (n === 0) return;
    const due = this.pending.splice(0, n);
    for (const p of due) {
      // one throwing effect must not drop the rest of the batch or the frame it runs in
      try {
        p.fn();
      } catch (err) {
        console.warn('[contact] held effect failed:', err);
      }
    }
  }

  /** Death holds not yet passed (tests). */
  get heldDeaths(): number {
    return this.deathHold.size;
  }

  /** Held effects not yet run (tests). */
  get size(): number {
    return this.pending.length;
  }

  /** Drop everything held (renderer teardown). */
  clear(): void {
    this.pending.length = 0;
    this.deathHold.clear();
  }
}
