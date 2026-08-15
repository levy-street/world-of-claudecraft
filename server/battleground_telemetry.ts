// Thornhollow Fields match-outcome vocabulary: the bounded label sets the
// /metrics exporter uses for resolved rated matches, plus the pure classifiers
// that produce them. Kept out of game.ts and out of the exporter, exactly like
// server/fishing_telemetry.ts and server/economy_telemetry.ts, so all of it
// unit-tests with no registry, no socket, and no running world.
//
// WHY THIS EXISTS: BG_CAPS_TO_WIN is the mode's number-one tuning knob, and it
// was just cut from 5 to 3 on a single playtest observation. The question it
// turns on ("does the match END on the winning capture, or does the clock end
// it?") is exactly one ratio between two label values here, and nothing else the
// server records can answer it. Duration and final scores ride along because
// they are the follow-up questions ("if the clock is ending them, by how much?"
// and "how many captures does a real match actually produce?") and cost one
// counter each.
//
// SUMS, NOT HISTOGRAMS. Duration and captures are published as counter SUMS
// beside the match COUNT, so an operator reads a mean with one division
// (`rate(sum) / rate(count)`) using the same primitives every other family here
// uses. A distribution would be better and a histogram is what to reach for if
// the mean ever stops answering the question; it is deliberately not the thing
// to build first for a knob that only needs to know which way to move.
//
// CARDINALITY IS BOUNDED BY CONSTRUCTION, the same contract as
// server/http/game_signals.ts: three ending causes times two compositions is
// six series, and the score family is three causes times two sides. Nothing
// per-player and nothing per-match (character id, name, match id) is ever a
// label; the match id lives only in the drained record, never on a series.

/**
 * Why a match ended. The SAME three values the sim puts on `bgEnd.ended` and on
 * its drained outcome record, deliberately not a second vocabulary: an operator
 * comparing a metric against what a player saw on their finish banner must not
 * have to translate. `timer` versus `caps` IS the cap-tuning question.
 */
export const BG_END_CAUSES = ['caps', 'timer', 'forfeit'] as const;

/** One of the three ending causes. */
export type BgEndCauseLabel = (typeof BG_END_CAUSES)[number];

/**
 * Whether the match was seated from at least one queued GROUP of 2 or more.
 * Two values, and deliberately coarse: the useful question is whether grouped
 * play skews the cap pace, not the exact group sizes, and a per-size label
 * would grow the series count for a distinction nobody would act on.
 *
 * Named `grouped`/`solo` rather than `premade`/`pug` ON PURPOSE. The battleground
 * matchmaker already owns a "premade" concept with a DIFFERENT threshold
 * (BG_PREMADE_SIZE, a block of four or more facing nothing but solos, which is
 * what drives the BG_PREMADE_HOLD fairness hold). An operator correlating this
 * series against that hold would otherwise be reading two different populations
 * under one word.
 */
export const BG_COMPOSITIONS = ['grouped', 'solo'] as const;

/** One of the two composition labels. */
export type BgCompositionLabel = (typeof BG_COMPOSITIONS)[number];

/**
 * Which end of the final score a sample belongs to. `high`/`low` rather than
 * `winner`/`loser` on purpose: it is total over a DRAW, where there is no
 * winner but the two scores are still the thing being measured.
 */
export const BG_SCORE_SIDES = ['high', 'low'] as const;

/** One of the two score-side labels. */
export type BgScoreSideLabel = (typeof BG_SCORE_SIDES)[number];

/** The composition label for a resolved match's grouped flag. Total over its
 *  whole domain, so it can never mint an off-vocabulary series. */
export function bgCompositionLabel(grouped: boolean): BgCompositionLabel {
  return grouped ? 'grouped' : 'solo';
}

/**
 * The two final scores sorted into their `high`/`low` sides. Order-independent
 * by construction, so which team happened to be Crimson cannot tilt the series;
 * a draw contributes the same value to both sides, which is correct (the mean
 * capture count of a drawn match really is that value on both ends).
 */
export function bgScoreSides(
  scoreCrimson: number,
  scoreAzure: number,
): Record<BgScoreSideLabel, number> {
  return {
    high: Math.max(scoreCrimson, scoreAzure),
    low: Math.min(scoreCrimson, scoreAzure),
  };
}

/** Membership guard for the cause label, applied at the exporter seam the same
 *  way the fishing and harvest vocabularies are: a value off the list drops the
 *  sample rather than minting a series for it. */
export function isBgEndCause(value: string): value is BgEndCauseLabel {
  return (BG_END_CAUSES as readonly string[]).includes(value);
}

/** One drained record, in the shape the counter sink is fed. Structural, so the
 *  server can pass a `BgOutcomeRecord` straight in without this module importing
 *  the sim (it stays a pure vocabulary leaf). */
export interface BgResolvedOutcome {
  durationSec: number;
  scoreCrimson: number;
  scoreAzure: number;
  ended: string;
  grouped: boolean;
}

/** What the counter sink needs from this module, structurally: the one method
 *  `reportBgOutcomes` drives. Keeps this leaf free of the http seam's imports. */
export interface BgOutcomeSink {
  battlegroundResolved(
    cause: BgEndCauseLabel,
    composition: BgCompositionLabel,
    durationSec: number,
    scoreCrimson: number,
    scoreAzure: number,
  ): void;
}

/**
 * Book one drained batch onto the counters: exactly one call per RESOLVED
 * match, never one per fighter. Extracted from the game loop so the fan-out is
 * unit-testable without a registry, a socket, or a running world, which is the
 * whole reason this module exists.
 *
 * The cause crosses untyped here (it is a plain string on the sim record); the
 * sink's own membership guard is what drops an off-vocabulary value.
 */
export function reportBgOutcomes(records: readonly BgResolvedOutcome[], sink: BgOutcomeSink): void {
  for (const record of records) {
    sink.battlegroundResolved(
      record.ended as BgEndCauseLabel,
      bgCompositionLabel(record.grouped),
      record.durationSec,
      record.scoreCrimson,
      record.scoreAzure,
    );
  }
}
