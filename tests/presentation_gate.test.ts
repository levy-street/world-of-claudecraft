import { describe, expect, it } from 'vitest';
import { presentationGate } from '../src/game/presentation_gate';

// The gate is three booleans in, three booleans out, so the whole contract is an
// eight-row truth table. Each row is written out literally (no loop over cases)
// so a polarity flip on any single arm fails on its own row and names itself.

describe('presentationGate', () => {
  it('stops everything while the graphics rebuild is paused, hidden or not', () => {
    expect(
      presentationGate({ hidden: false, desktopApp: false, graphicsRebuildPaused: true }),
    ).toEqual({ render: false, paint: false, tick: false });
    expect(
      presentationGate({ hidden: true, desktopApp: false, graphicsRebuildPaused: true }),
    ).toEqual({ render: false, paint: false, tick: false });
    expect(
      presentationGate({ hidden: false, desktopApp: true, graphicsRebuildPaused: true }),
    ).toEqual({ render: false, paint: false, tick: false });
    expect(
      presentationGate({ hidden: true, desktopApp: true, graphicsRebuildPaused: true }),
    ).toEqual({ render: false, paint: false, tick: false });
  });

  it('keeps the tick alive but drops render and paint in a hidden desktop window', () => {
    expect(
      presentationGate({ hidden: true, desktopApp: true, graphicsRebuildPaused: false }),
    ).toEqual({ render: false, paint: false, tick: true });
  });

  it('runs a whole frame in a visible desktop window', () => {
    expect(
      presentationGate({ hidden: false, desktopApp: true, graphicsRebuildPaused: false }),
    ).toEqual({ render: true, paint: true, tick: true });
  });

  it('leaves the web build untouched, including a hidden tab', () => {
    expect(
      presentationGate({ hidden: false, desktopApp: false, graphicsRebuildPaused: false }),
    ).toEqual({ render: true, paint: true, tick: true });
    expect(
      presentationGate({ hidden: true, desktopApp: false, graphicsRebuildPaused: false }),
    ).toEqual({ render: true, paint: true, tick: true });
  });

  it('returns the same frozen decision object per arm on every call (phase 4 QA F8)', () => {
    // The gate runs on the rAF hot path and its allocation-free contract is
    // the shared frozen singletons; toEqual alone would keep passing if a
    // rewrite returned fresh literals per frame. Identity plus frozen-ness is
    // the actual contract, so pin both, one case per arm.
    const paused = { hidden: false, desktopApp: false, graphicsRebuildPaused: true };
    const hiddenDesktop = { hidden: true, desktopApp: true, graphicsRebuildPaused: false };
    const allOn = { hidden: false, desktopApp: true, graphicsRebuildPaused: false };
    for (const input of [paused, hiddenDesktop, allOn]) {
      const first = presentationGate(input);
      expect(presentationGate({ ...input })).toBe(first);
      expect(Object.isFrozen(first)).toBe(true);
    }
    // The web arm shares the ALL_ON singleton with the visible desktop arm:
    // one decision, not two equal copies.
    expect(
      presentationGate({ hidden: true, desktopApp: false, graphicsRebuildPaused: false }),
    ).toBe(presentationGate(allOn));
  });
});
