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

  it('drops a window whose gating field is not a number, coercible or not', () => {
    // Number(false) and Number([]) are both 0, so a coercing gate would plant a
    // zero-window row for a payload that carries no window at all.
    expect(sanitizePostRevealLinks({ windowMs: false })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: true })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: [] })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: [12] })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: '12' })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: null })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: Number.NaN })).toBeUndefined();
    // A real number still opens the block, whatever the rest of it says.
    expect(sanitizePostRevealLinks({ windowMs: 0 })?.windowMs).toBe(0);
    expect(sanitizePostRevealLinks({ windowMs: 20_000 })?.windowMs).toBe(20_000);
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

  it('drops a block whose entry root is not a number, coercible or not', () => {
    expect(sanitizeBootPhases({ entryMs: false })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: true })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: [] })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: [6120] })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: '6120' })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: null })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: Number.NaN })).toBeUndefined();
    // The non-gating phases keep their coercing bound: only the root gates.
    expect(sanitizeBootPhases({ entryMs: 6120, rendererCtorMs: '813' })?.rendererCtorMs).toBe(813);
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
