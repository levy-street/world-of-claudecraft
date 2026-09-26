// The per-cast verdict of the cast gate: a cast draws its whole composition
// or nothing. It is decided at the cast's FIRST entry point the painter sees
// (the cast bar, else the release, the landing or the contact) against the
// cast's requirement mask, and a refusal is LATCHED for that caster and
// ability so the later entry points of the same cast (the release after its
// cast bar, the impact, the landing, channel ticks) stay refused even when
// the family latches mid-cast. An admitted cast needs no latch: readiness is
// monotone, so every later entry point admits it again. Per-frame holds (auras,
// orbits, shells, ground discs) are not casts: they draw the frame their
// families are ready.
//
// A refusal outlives the release by REFUSED_CAST_TAIL_SEC, the cap on an
// authored linger (the sequencer's longest dwell); a channel tick extends it,
// so a refused channel stays refused to its end. A new release of the same
// ability is a new cast and is decided afresh; only a release that follows a
// latched cast bar belongs to it, and a bar the sim interrupted hands its
// release to nobody. Follow-through is matched to the caster's latest cast of
// that ability, so two overlapping flights of one ability share one verdict,
// the newer cast's.
//
// Host-agnostic (RENDER_PURE_CORES): the gate and the clock are injected, and
// a latch is allocated only on a refusal.

/** Seconds a refused cast stays refused past its release: the sequencer's
 *  cap on an authored linger dwell. */
export const REFUSED_CAST_TAIL_SEC = 6;

const PRUNE_ABOVE = 64;

export interface CastAdmissionGate {
  /** Counted: one refusal per refused cast. */
  admit(mask: number): boolean;
  /** Uncounted: the per-frame answer. */
  ready(mask: number): boolean;
}

interface RefusedCast {
  until: number;
  /** Latched by the cast bar: the release that follows belongs to it. */
  windup: boolean;
}

export class CastAdmission {
  private readonly refused = new Map<number, Map<string, RefusedCast>>();

  constructor(private readonly gate: CastAdmissionGate) {}

  /** The cast bar, every frame it is on screen; `fresh` on the frame the
   *  painter first sees this cast. */
  windup(
    casterId: number,
    abilityId: string,
    mask: number,
    nowSec: number,
    remainingSec: number,
    fresh: boolean,
  ): boolean {
    if (fresh) this.drop(casterId, abilityId);
    const until = nowSec + Math.max(0, remainingSec) + REFUSED_CAST_TAIL_SEC;
    const latched = this.latched(casterId, abilityId, nowSec);
    if (latched) {
      latched.until = Math.max(latched.until, until);
      latched.windup = true;
      return false;
    }
    if (this.gate.ready(mask)) return true;
    this.gate.admit(mask);
    this.latch(casterId, abilityId, until, true, nowSec);
    return false;
  }

  /** A release cue: the cast bar's own, or a new cast. */
  release(casterId: number, abilityId: string, mask: number, nowSec: number): boolean {
    const latched = this.latched(casterId, abilityId, nowSec);
    if (latched?.windup) {
      latched.windup = false;
      latched.until = Math.max(latched.until, nowSec + REFUSED_CAST_TAIL_SEC);
      return false;
    }
    if (this.gate.admit(mask)) {
      if (latched) this.drop(casterId, abilityId);
      return true;
    }
    this.latch(casterId, abilityId, nowSec + REFUSED_CAST_TAIL_SEC, false, nowSec);
    return false;
  }

  /** Follow-through of a cast (an impact, a landing, a contact, a DoT tick):
   *  refused with its cast, else decided as the cast's first entry point. It
   *  never extends the latch, so a refused ability pressed again and again
   *  is decided afresh once the tail of its first refusal has passed. */
  follow(casterId: number, abilityId: string, mask: number, nowSec: number): boolean {
    return this.followThrough(casterId, abilityId, mask, nowSec, false);
  }

  /** A tick of a channel: follow-through that keeps a refused channel
   *  refused to its end, however long it runs. */
  channel(casterId: number, abilityId: string, mask: number, nowSec: number): boolean {
    return this.followThrough(casterId, abilityId, mask, nowSec, true);
  }

  /** A cue that names no caster: decided on its own, counted, never latched. */
  once(mask: number): boolean {
    return this.gate.admit(mask);
  }

  /** A per-frame hold: shown the frame its families are ready. */
  hold(mask: number): boolean {
    return this.gate.ready(mask);
  }

  /** The caster's cast bar stopped with no release to follow (an interrupt):
   *  the refusal it latched holds nothing any more, so a later cast of that
   *  ability is decided afresh instead of being taken for its release. */
  interrupted(casterId: number): void {
    const casts = this.refused.get(casterId);
    if (!casts) return;
    for (const [abilityId, cast] of casts) if (cast.windup) casts.delete(abilityId);
    if (casts.size === 0) this.refused.delete(casterId);
  }

  /** Whether a refusal is latched for this caster and ability right now. */
  isRefused(casterId: number, abilityId: string, nowSec: number): boolean {
    return this.latched(casterId, abilityId, nowSec) !== null;
  }

  clear(): void {
    this.refused.clear();
  }

  private followThrough(
    casterId: number,
    abilityId: string,
    mask: number,
    nowSec: number,
    extend: boolean,
  ): boolean {
    const latched = this.latched(casterId, abilityId, nowSec);
    if (latched) {
      if (extend) latched.until = Math.max(latched.until, nowSec + REFUSED_CAST_TAIL_SEC);
      return false;
    }
    if (this.gate.admit(mask)) return true;
    this.latch(casterId, abilityId, nowSec + REFUSED_CAST_TAIL_SEC, false, nowSec);
    return false;
  }

  private latched(casterId: number, abilityId: string, nowSec: number): RefusedCast | null {
    if (this.refused.size === 0) return null;
    const cast = this.refused.get(casterId)?.get(abilityId);
    if (!cast) return null;
    if (nowSec < cast.until) return cast;
    this.drop(casterId, abilityId);
    return null;
  }

  private latch(
    casterId: number,
    abilityId: string,
    until: number,
    windup: boolean,
    nowSec: number,
  ): void {
    if (this.refused.size > PRUNE_ABOVE) this.prune(nowSec);
    let casts = this.refused.get(casterId);
    if (!casts) {
      casts = new Map();
      this.refused.set(casterId, casts);
    }
    casts.set(abilityId, { until, windup });
  }

  private drop(casterId: number, abilityId: string): void {
    const casts = this.refused.get(casterId);
    if (!casts) return;
    casts.delete(abilityId);
    if (casts.size === 0) this.refused.delete(casterId);
  }

  private prune(nowSec: number): void {
    for (const [casterId, casts] of this.refused) {
      for (const [abilityId, cast] of casts) if (nowSec >= cast.until) casts.delete(abilityId);
      if (casts.size === 0) this.refused.delete(casterId);
    }
  }
}
