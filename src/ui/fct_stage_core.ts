// Pure beat-STAGING decision for floating combat text: which authored contact beat a
// damage floater belongs to, and how long after the cast it should appear. The third
// pure half of the FCT split (fct_event shapes the spawn, fct_core describes it, this
// decides WHEN it lands); the FCT painter is the only consumer and owns the holding.
//
// WHY THIS EXISTS. Red Harvest resolves on the CAST TICK in src/sim (three weapon
// strikes, one tick, src/sim/combat/warrior_harvest.ts), so all three damage events
// reach the client in the same frame and all three numbers used to pop at once. The
// CLIENT owns the contact timing: the authored blade contacts play at
// FURY_AUDIO.red_harvest.times seconds after the cast. Staging the floaters on those
// same beats makes the numbers land with the blades instead of ahead of them.
//
// THE BEAT TABLE IS INJECTED, never imported here, for the same reason fct_core injects
// its jitter draw: the authored times live in src/game/fury_audio_core.ts, and a
// registered src/ui pure core may not import the game layer (tests/architecture.test.ts,
// forbiddenUiCoreImport). The painter reads FURY_AUDIO and hands the table down, so there
// is exactly ONE copy of 0.15 / 0.32 / 0.49 in the tree and this file stays host-agnostic,
// clock-free and dependency-free.
//
// The event's damage KIND is deliberately not part of the decision. Every strike of the
// cast advances the beat, landed or avoided: if the second blade whiffs, the third must
// still arrive on the third beat, so a miss consumes its ordinal exactly like a hit. The
// ability is matched on the stable content id (`abilityId`), never on the display label
// `ability`, which is a player-facing rename away from breaking the lookup (the lesson
// src/sim/types.ts records for IMPACT_ABILITY_CUES).

/**
 * The damage-event fields the staging decision reads. Structural on purpose so it is
 * satisfied identically by an offline `Sim` damage event and by the online wire mirror
 * of the same event (parity): both carry the source entity id and the stable ability id.
 */
export interface FctBeatStrike {
  readonly sourceId: number;
  /** The stable content id of the ability that dealt the hit (never the display label). */
  readonly abilityId?: string | null;
}

/** The one ability whose floaters are beat-staged today (its three weapon strikes). */
export const RED_HARVEST_ABILITY_ID = 'red_harvest';

/** Whether this ability's damage floaters ride the authored contact beats. */
export function isBeatStagedAbility(abilityId: string | null | undefined): boolean {
  return abilityId === RED_HARVEST_ABILITY_ID;
}

/**
 * The delay in seconds from the cast for one strike, or 0 when the floater spawns at
 * once. `ordinal` is which strike of the cast this is for that source in this frame
 * (0, 1, 2). Three rules, all deliberate:
 *  - an ability with no authored beats spawns immediately (0), which is every ability
 *    but Red Harvest and every auto-attack;
 *  - an ordinal PAST the table clamps to the LAST beat, so a fourth same-frame strike
 *    (a cleave or an echo) lands with the final blade rather than falling back to 0 and
 *    racing ahead of the numbers before it;
 *  - a NEGATIVE ordinal means the tracker had no slot for this source and declined to
 *    stage it, so the floater spawns immediately (the pre-staging behavior).
 */
export function fctBeatDelaySec(
  strike: FctBeatStrike,
  ordinal: number,
  beats: readonly number[],
): number {
  if (!isBeatStagedAbility(strike.abilityId)) return 0;
  if (ordinal < 0 || beats.length === 0) return 0;
  return ordinal >= beats.length ? beats[beats.length - 1] : beats[ordinal];
}

/**
 * How many distinct sources can be beat-staged within one frame. A bound, not a budget:
 * the tracker is a fixed pair of preallocated arrays, so nothing grows and nothing is
 * allocated per frame. Past it a source is simply not staged (its floaters pop at once),
 * which is the honest degradation rather than a growing map. Comfortably above the real
 * case, which is one local warrior plus a few visible others casting in the same frame.
 */
export const FCT_BEAT_SOURCE_SLOTS = 8;

/**
 * Per-frame strike ordinals, keyed by source entity id. ALLOCATION-FREE: the two arrays
 * are sized once in the constructor and the frame reset is a length counter, never a new
 * Map or a clear(). CLOCK-FREE: the frame is identified by the `now` the caller already
 * stamps its event batch with (hud.handleEvents takes one clock for the whole drain), so
 * a new `now` IS a new frame and the ordinals restart by themselves.
 */
export class FctBeatStager {
  private readonly sources: number[] = [];
  private readonly counts: number[] = [];
  /** How many slots of `sources` / `counts` the current frame has claimed. */
  private used = 0;
  /** The frame clock the claimed slots belong to; any other value starts a fresh frame. */
  private frame = Number.NaN;

  constructor(
    private readonly beats: readonly number[],
    slots: number = FCT_BEAT_SOURCE_SLOTS,
  ) {
    for (let i = 0; i < slots; i++) {
      this.sources.push(0);
      this.counts.push(0);
    }
  }

  /**
   * The delay in seconds this strike's floater should wait, consuming one ordinal for
   * its source when (and only when) the ability is beat-staged. Everything else returns
   * 0 without touching the tracker, so an auto-attack can never advance a warrior's beat.
   */
  delaySec(strike: FctBeatStrike, now: number): number {
    if (!isBeatStagedAbility(strike.abilityId)) return 0;
    return fctBeatDelaySec(strike, this.nextOrdinal(strike.sourceId, now), this.beats);
  }

  /** Forget the current frame's ordinals (teardown; the next frame resets by itself). */
  reset(): void {
    this.used = 0;
    this.frame = Number.NaN;
  }

  /**
   * The next strike ordinal for `sourceId` in the frame stamped `now`, or -1 when this
   * frame has already claimed every slot (the decline sentinel fctBeatDelaySec reads).
   */
  private nextOrdinal(sourceId: number, now: number): number {
    if (now !== this.frame) {
      this.frame = now;
      this.used = 0;
    }
    for (let i = 0; i < this.used; i++) {
      if (this.sources[i] !== sourceId) continue;
      const ordinal = this.counts[i];
      this.counts[i] = ordinal + 1;
      return ordinal;
    }
    if (this.used >= this.sources.length) return -1;
    this.sources[this.used] = sourceId;
    this.counts[this.used] = 1;
    this.used++;
    return 0;
  }
}
