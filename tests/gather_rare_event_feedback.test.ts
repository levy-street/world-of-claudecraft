// The gatherRareEvent feedback decision core (src/ui/gather_rare_event_feedback.ts):
// the behavioral home of the finder-only rules the Phase 10 QA moved out of
// hud.ts source pins. Every flavor x recipient quadrant is driven directly,
// so a polarity flip, a hoisted cue, or a commented-out guard in the decision
// REDS here instead of sliding past an index-order source scan. The hud.ts
// glue (one case, one consumer, the cue calls inside their fb.* guards) stays
// pinned in tests/gather_event_i18n.test.ts over the comment-stripped source.
import { describe, expect, it } from 'vitest';
import type { GatherRareEventFlavor } from '../src/sim/types';
import {
  GATHER_RARE_EVENT_LINE_KEYS,
  gatherRareEventFeedback,
} from '../src/ui/gather_rare_event_feedback';

const FINDER = 7;
const OTHER = 8;

describe('the gatherRareEvent line keys', () => {
  it('pins each flavor to its literal key (the wire-name rule), all four distinct', () => {
    expect(GATHER_RARE_EVENT_LINE_KEYS).toEqual({
      pristine_vein: 'gatherEvent.pristineVein',
      ancient_heartwood: 'gatherEvent.ancientHeartwood',
      moonlit_bloom: 'gatherEvent.moonlitBloom',
      golden_harvest: 'gatherEvent.goldenHarvest',
    });
    expect(new Set(Object.values(GATHER_RARE_EVENT_LINE_KEYS)).size).toBe(4);
  });
});

describe('the finder-only cue rules, every quadrant', () => {
  const FLAVORS = Object.keys(GATHER_RARE_EVENT_LINE_KEYS) as GatherRareEventFlavor[];

  it.each(FLAVORS)('%s: every recipient renders the flavor line', (flavor) => {
    expect(gatherRareEventFeedback(flavor, FINDER, FINDER).lineKey).toBe(
      GATHER_RARE_EVENT_LINE_KEYS[flavor],
    );
    expect(gatherRareEventFeedback(flavor, FINDER, OTHER).lineKey).toBe(
      GATHER_RARE_EVENT_LINE_KEYS[flavor],
    );
  });

  it.each(FLAVORS)('%s: the shared achievement cue fires for the finder only', (flavor) => {
    expect(gatherRareEventFeedback(flavor, FINDER, FINDER).achievementCue).toBe(true);
    expect(gatherRareEventFeedback(flavor, FINDER, OTHER).achievementCue).toBe(false);
  });

  it('the golden sting fires ONLY for the finder of a golden harvest', () => {
    // The one true quadrant...
    expect(gatherRareEventFeedback('golden_harvest', FINDER, FINDER).farmGoldenSting).toBe(true);
    // ...and all three false ones, each stated on its own so a single
    // polarity flip cannot hide behind a passing sibling.
    expect(gatherRareEventFeedback('golden_harvest', FINDER, OTHER).farmGoldenSting).toBe(false);
    expect(gatherRareEventFeedback('pristine_vein', FINDER, FINDER).farmGoldenSting).toBe(false);
    expect(gatherRareEventFeedback('pristine_vein', FINDER, OTHER).farmGoldenSting).toBe(false);
    expect(gatherRareEventFeedback('ancient_heartwood', FINDER, FINDER).farmGoldenSting).toBe(
      false,
    );
    expect(gatherRareEventFeedback('moonlit_bloom', FINDER, FINDER).farmGoldenSting).toBe(false);
  });

  it('the sting LAYERS on the shared cue: a golden finder gets both, never sting-only', () => {
    const fb = gatherRareEventFeedback('golden_harvest', FINDER, FINDER);
    expect(fb.achievementCue).toBe(true);
    expect(fb.farmGoldenSting).toBe(true);
  });

  it('an OFF-UNION runtime flavor keeps the old catch-all line and gains no sting', () => {
    // A version-skewed server can emit a flavor this client does not know
    // (the event crosses the wire generically). The pre-extraction chain
    // rendered such a value as the golden line; the table lookup alone would
    // hand hud.ts an undefined key and t() THROWS on unknown keys in dev
    // builds, inside the event switch. The core carries the belt (the same
    // off-union defense the sim side took with != null), and the unknown
    // flavor must NOT inherit the golden sting through the fallback.
    const fb = gatherRareEventFeedback('mystery_bloom' as GatherRareEventFlavor, FINDER, FINDER);
    expect(fb.lineKey).toBe('gatherEvent.goldenHarvest');
    expect(fb.achievementCue).toBe(true);
    expect(fb.farmGoldenSting).toBe(false);
  });
});
