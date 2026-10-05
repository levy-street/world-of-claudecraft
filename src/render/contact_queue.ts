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
 */

/** The longest a presentation effect may be held: a clip listing a later contact is clamped. */
export const CONTACT_HOLD_MAX_SEC = 1.0;

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

  /** True while a blade swung at this entity has not landed yet (its death pose waits). */
  holdsDeath(id: number, now: number): boolean {
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

  /** Run `fn` when this event's blade lands (at once when it carries no contact). */
  atContact(ev: object, now: number, fn: () => void): void {
    this.after(this.delayFor(ev), now, fn);
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
