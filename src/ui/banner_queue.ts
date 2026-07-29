// Banner scheduling (R38): the single HUD banner slot stops being
// last-write-wins for celebrations. The confirmed loss this closes: a fresh
// character's very first level-up banner was replaced mid-flight by the
// First Steps deed banner landing on the same tick.
//
// The policy, exactly (docs/design/banner-queue.md):
//   - Celebration banners ('levelup' / 'deed') QUEUE: while one banner is
//     live, they wait their turn, FIFO, except that a 'levelup' arrival
//     files ahead of every queued 'deed' (never preempting the live one):
//     the ruling's "level-up first, then deeds".
//   - Ambient banners (everything else: zone names, prompts, countdowns)
//     keep their real-time semantics: an ambient arrival REPLACES a live
//     ambient banner immediately (the pre-R38 behavior, which a race
//     countdown depends on), and while a celebration is live it waits in a
//     single latest-wins pending slot rather than a queue, because an
//     ambient banner is current-state, not history: showing three stale
//     zone names in sequence would be worse than showing the newest once.
//   - The celebration queue is BOUNDED; a full queue drops the incoming
//     entry. Every celebration's durable record is its chat-log line and
//     the polite announcer push, both emitted by the caller before the
//     banner, so a dropped banner loses only the ornament.
//
// Pure and host-agnostic: this core decides WHAT to do with an arrival and
// what shows next; the Hud owns the element, the timers, and the fade. Same
// input, same output; no DOM, no clock.

export type BannerClass = 'levelup' | 'deed' | 'ambient';

/** A full celebration queue drops the incoming banner (the log line already
 *  landed); deep celebration bursts only occur on retro catch-up paths that
 *  deliberately draw no banners at all. */
export const BANNER_QUEUE_LIMIT = 6;

export type BannerEnqueueOutcome = 'show' | 'queued' | 'dropped';

/**
 * Normalize a banner's secondary text into the LINES it will paint.
 *
 * A banner may carry one secondary line or several (the battleground verdict
 * stacks its score-and-rating line, why the match ended, and the first-win
 * bonus: independent sentences that each stay their own `t()` key rather than
 * being concatenated into one). Normalizing HERE, before the payload is built,
 * is what keeps the paint side's single `if (subtext)` gate honest: `!![]` is
 * true, so an empty list reaching the element would add the `has-subtext` class
 * to a banner with no subtext at all and lay out an empty second row. Empty
 * strings are dropped for the same reason.
 */
export function bannerSubtextLines(subtext: string | string[] | undefined): string[] {
  if (subtext === undefined) return [];
  const lines = Array.isArray(subtext) ? subtext : [subtext];
  return lines.filter((line) => line.length > 0);
}

export class BannerQueue<T> {
  private waitingCelebrations: { bannerClass: BannerClass; payload: T }[] = [];
  private pendingAmbient: T | null = null;
  private liveClass: BannerClass | null = null;

  /** Whether any banner is live right now (the caller drives the timer). */
  get isLive(): boolean {
    return this.liveClass !== null;
  }

  /** Queued entries, ambient pending slot included (test/diagnostic read). */
  get depth(): number {
    return this.waitingCelebrations.length + (this.pendingAmbient !== null ? 1 : 0);
  }

  /**
   * One banner arrived. 'show' means the caller paints it NOW (replacing
   * whatever is on the element); 'queued' means it waits for advance();
   * 'dropped' means it never shows (bounded queue; the log is the record).
   */
  enqueue(bannerClass: BannerClass, payload: T): BannerEnqueueOutcome {
    if (this.liveClass === null) {
      this.liveClass = bannerClass;
      return 'show';
    }
    if (bannerClass === 'ambient') {
      // Ambient over ambient keeps the pre-R38 immediate replace: the slot
      // is showing current state and the arrival is the newer current state.
      if (this.liveClass === 'ambient') {
        return 'show';
      }
      // Behind a live celebration: one latest-wins pending seat, never a
      // queue (a countdown must not replay stale numbers afterwards).
      this.pendingAmbient = payload;
      return 'queued';
    }
    if (this.waitingCelebrations.length >= BANNER_QUEUE_LIMIT) return 'dropped';
    if (bannerClass === 'levelup') {
      // Level-up files ahead of every queued deed (R38's ordering), but
      // never ahead of an earlier queued level-up: two dings stay in order.
      const firstDeed = this.waitingCelebrations.findIndex((e) => e.bannerClass === 'deed');
      if (firstDeed !== -1) {
        this.waitingCelebrations.splice(firstDeed, 0, { bannerClass, payload });
        return 'queued';
      }
    }
    this.waitingCelebrations.push({ bannerClass, payload });
    return 'queued';
  }

  /** The live banner's time ended: what shows next, or null (slot idle). */
  advance(): T | null {
    const next = this.waitingCelebrations.shift();
    if (next !== undefined) {
      this.liveClass = next.bannerClass;
      return next.payload;
    }
    if (this.pendingAmbient !== null) {
      const payload = this.pendingAmbient;
      this.pendingAmbient = null;
      this.liveClass = 'ambient';
      return payload;
    }
    this.liveClass = null;
    return null;
  }

  /** Hard reset (teleport-style banner wipes): nothing queued survives. */
  clear(): void {
    this.waitingCelebrations.length = 0;
    this.pendingAmbient = null;
    this.liveClass = null;
  }

  /** The LIVE banner was hidden early by an ambient takeover (the mount-race
   *  countdown claiming the slot): the pending ambient seat drops (it was
   *  current-state that is no longer current) but every QUEUED celebration
   *  survives to play after the takeover ends. clear() above stays the hard
   *  reset; using it for a takeover silently discarded queued level-up and
   *  deed banners (the phase 14 QA finding). */
  hideLive(): void {
    this.pendingAmbient = null;
    this.liveClass = null;
  }

  /** Purge queued entries failing `keep` (the unstuck-source purge). The
   *  LIVE banner is the caller's to clear; this touches only the waiters. */
  retainQueued(keep: (payload: T) => boolean): void {
    this.waitingCelebrations = this.waitingCelebrations.filter((e) => keep(e.payload));
    if (this.pendingAmbient !== null && !keep(this.pendingAmbient)) this.pendingAmbient = null;
  }
}
