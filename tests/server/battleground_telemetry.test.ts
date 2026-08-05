// The Thornhollow Fields match-outcome vocabulary + its fan-out
// (server/battleground_telemetry.ts). Pure: no registry, no socket, no running
// world, which is the reason the module exists apart from the exporter.
import { describe, expect, it } from 'vitest';
import {
  BG_COMPOSITIONS,
  BG_END_CAUSES,
  BG_SCORE_SIDES,
  type BgCompositionLabel,
  type BgEndCauseLabel,
  bgCompositionLabel,
  bgScoreSides,
  isBgEndCause,
  reportBgOutcomes,
} from '../../server/battleground_telemetry';

describe('the bounded label vocabularies', () => {
  it('the ending causes are exactly the values the sim ships on bgEnd', () => {
    // Not a second vocabulary: an operator comparing a metric against what a
    // player saw on their finish banner must not have to translate.
    expect([...BG_END_CAUSES]).toEqual(['caps', 'timer', 'forfeit']);
  });

  it('the composition labels avoid the matchmaker\'s own "premade" word', () => {
    // BG_PREMADE_SIZE (4, facing solos) drives the fairness hold and is a
    // DIFFERENT population; sharing the word would silently conflate them.
    expect([...BG_COMPOSITIONS]).toEqual(['grouped', 'solo']);
    expect(BG_COMPOSITIONS).not.toContain('premade');
    expect(BG_COMPOSITIONS).not.toContain('pug');
  });

  it('the score sides are total over a draw, so they are high/low not winner/loser', () => {
    expect([...BG_SCORE_SIDES]).toEqual(['high', 'low']);
  });

  it('the cardinality stays small: six match series, six score series', () => {
    expect(BG_END_CAUSES.length * BG_COMPOSITIONS.length).toBe(6);
    expect(BG_END_CAUSES.length * BG_SCORE_SIDES.length).toBe(6);
  });
});

describe('bgCompositionLabel', () => {
  it('is total over its whole domain', () => {
    expect(bgCompositionLabel(true)).toBe('grouped');
    expect(bgCompositionLabel(false)).toBe('solo');
    for (const value of [true, false]) {
      expect(BG_COMPOSITIONS).toContain(bgCompositionLabel(value));
    }
  });
});

describe('bgScoreSides', () => {
  it('is order-independent, so which team was Crimson cannot tilt the series', () => {
    expect(bgScoreSides(3, 1)).toEqual({ high: 3, low: 1 });
    expect(bgScoreSides(1, 3)).toEqual({ high: 3, low: 1 });
  });

  it('a draw contributes the same value to both ends, which is the honest read', () => {
    expect(bgScoreSides(2, 2)).toEqual({ high: 2, low: 2 });
  });

  it('a 0:0 forfeit is booked as real zeros, not dropped', () => {
    expect(bgScoreSides(0, 0)).toEqual({ high: 0, low: 0 });
  });
});

describe('isBgEndCause', () => {
  it('accepts every member of the vocabulary', () => {
    for (const cause of BG_END_CAUSES) expect(isBgEndCause(cause)).toBe(true);
  });

  it('rejects anything else, which is the cardinality bound at the exporter', () => {
    // A newer sim could invent an ending; an unbounded label set is the failure
    // this guard exists to prevent.
    expect(isBgEndCause('surrendered')).toBe(false);
    expect(isBgEndCause('timeout')).toBe(false); // the SIM-internal token, not the wire one
    expect(isBgEndCause('')).toBe(false);
    expect(isBgEndCause('__proto__')).toBe(false);
  });
});

describe('reportBgOutcomes: one call per RESOLVED match', () => {
  function recordingSink() {
    const calls: Array<[BgEndCauseLabel, BgCompositionLabel, number, number, number]> = [];
    return {
      calls,
      battlegroundResolved(
        cause: BgEndCauseLabel,
        composition: BgCompositionLabel,
        durationSec: number,
        scoreCrimson: number,
        scoreAzure: number,
      ) {
        calls.push([cause, composition, durationSec, scoreCrimson, scoreAzure]);
      },
    };
  }

  it('books each drained record exactly once, in order, with its labels', () => {
    const sink = recordingSink();
    reportBgOutcomes(
      [
        { ended: 'timer', grouped: false, durationSec: 720, scoreCrimson: 2, scoreAzure: 1 },
        { ended: 'caps', grouped: true, durationSec: 415, scoreCrimson: 3, scoreAzure: 0 },
      ],
      sink,
    );
    expect(sink.calls).toEqual([
      ['timer', 'solo', 720, 2, 1],
      ['caps', 'grouped', 415, 3, 0],
    ]);
  });

  it('an empty drain books nothing at all', () => {
    const sink = recordingSink();
    reportBgOutcomes([], sink);
    expect(sink.calls).toEqual([]);
  });

  it('passes an off-vocabulary ending THROUGH, for the sink to drop', () => {
    // The membership guard belongs at the exporter (where the series is minted),
    // not here: re-labelling a malformed sample would corrupt the ratio silently.
    const sink = recordingSink();
    reportBgOutcomes(
      [{ ended: 'surrendered', grouped: false, durationSec: 10, scoreCrimson: 1, scoreAzure: 0 }],
      sink,
    );
    expect(sink.calls[0][0]).toBe('surrendered');
  });
});
