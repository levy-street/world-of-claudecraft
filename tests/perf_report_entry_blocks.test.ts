import { describe, expect, it } from 'vitest';
import { sanitizeBootPhases, sanitizePostRevealLinks } from '../server/perf_report_entry_blocks';

describe('sanitizePostRevealLinks', () => {
  it('drops anything that is not a record, and an empty record too', () => {
    expect(sanitizePostRevealLinks(null)).toBeUndefined();
    expect(sanitizePostRevealLinks('x')).toBeUndefined();
    expect(sanitizePostRevealLinks([1])).toBeUndefined();
    // No windowMs, no window: an empty object must not become a zero row.
    expect(sanitizePostRevealLinks({})).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: '' })).toBeUndefined();
  });

  it('keeps a well-formed client block verbatim', () => {
    const block = {
      reveals: 1,
      revealsInWindow: 1,
      windowMs: 20_000,
      programsAtReveal: 1187,
      programsGained: 63,
      samples: 1180,
      unsampledMs: 0,
      closed: true,
      baselineLost: false,
    };
    expect(sanitizePostRevealLinks(block)).toEqual(block);
  });

  it('bounds every number, floors to ints, and reads the flags as strict booleans', () => {
    expect(
      sanitizePostRevealLinks({
        reveals: -3,
        revealsInWindow: 1e9,
        windowMs: 1e12,
        programsAtReveal: 'NaN',
        programsGained: 1e9,
        samples: 12.7,
        unsampledMs: -40,
        closed: 'true',
        baselineLost: 1,
        extra: ['not', 'kept'],
      }),
    ).toEqual({
      reveals: 0,
      revealsInWindow: 10_000,
      windowMs: 600_000,
      programsAtReveal: 0,
      programsGained: 100_000,
      samples: 12,
      unsampledMs: 0,
      closed: false,
      baselineLost: false,
    });
  });
});

describe('sanitizeBootPhases', () => {
  it('drops a block without a finite entry root', () => {
    expect(sanitizeBootPhases(null)).toBeUndefined();
    expect(sanitizeBootPhases({})).toBeUndefined();
    expect(sanitizeBootPhases({ rendererCtorMs: 5 })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: 'soon' })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: '' })).toBeUndefined();
  });

  it('keeps the phases, null per unstamped phase, and bounds a hostile span', () => {
    expect(
      sanitizeBootPhases({
        entryMs: 6120,
        rendererCtorMs: 813,
        prepareZoneMs: null,
        prepareNeighborsMs: 1e9,
        prewarmInitialMs: -1,
        list: [1, 2, 3],
      }),
    ).toEqual({
      entryMs: 6120,
      rendererCtorMs: 813,
      prepareZoneMs: null,
      prepareNeighborsMs: 1_800_000,
      prewarmInitialMs: 0,
    });
  });

  it('maps an empty string to null like the sibling nullable bound', () => {
    expect(sanitizeBootPhases({ entryMs: 10, prepareZoneMs: '' })?.prepareZoneMs).toBeNull();
  });
});
