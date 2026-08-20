import { describe, expect, it } from 'vitest';
import { newPresentationGateInput, presentationGate } from '../src/game/presentation_gate';

// The gate is four booleans in, four booleans out, so the whole contract is a
// small truth table. Each row is written out literally (no loop over cases)
// so a polarity flip on any single arm fails on its own row and names itself.

describe('presentationGate', () => {
  it('stops everything while the graphics rebuild is paused, hidden or not', () => {
    expect(
      presentationGate({
        hidden: false,
        desktopApp: false,
        graphicsRebuildPaused: true,
        worldDrawHeld: false,
      }),
    ).toEqual({ render: false, drawWorld: false, paint: false, tick: false });
    expect(
      presentationGate({
        hidden: true,
        desktopApp: false,
        graphicsRebuildPaused: true,
        worldDrawHeld: false,
      }),
    ).toEqual({ render: false, drawWorld: false, paint: false, tick: false });
    expect(
      presentationGate({
        hidden: false,
        desktopApp: true,
        graphicsRebuildPaused: true,
        worldDrawHeld: false,
      }),
    ).toEqual({ render: false, drawWorld: false, paint: false, tick: false });
    expect(
      presentationGate({
        hidden: true,
        desktopApp: true,
        graphicsRebuildPaused: true,
        worldDrawHeld: false,
      }),
    ).toEqual({ render: false, drawWorld: false, paint: false, tick: false });
  });

  it('keeps the tick alive but drops render and paint in a hidden desktop window', () => {
    expect(
      presentationGate({
        hidden: true,
        desktopApp: true,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      }),
    ).toEqual({ render: false, drawWorld: false, paint: false, tick: true });
  });

  it('runs a whole frame in a visible desktop window', () => {
    expect(
      presentationGate({
        hidden: false,
        desktopApp: true,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      }),
    ).toEqual({ render: true, drawWorld: true, paint: true, tick: true });
  });

  it('holds only the world draw during a blocking arrival: render, paint and tick go on', () => {
    const held = {
      hidden: false,
      desktopApp: false,
      graphicsRebuildPaused: false,
      worldDrawHeld: true,
    };
    expect(presentationGate(held)).toEqual({
      render: true,
      drawWorld: false,
      paint: true,
      tick: true,
    });
    expect(presentationGate({ ...held, desktopApp: true })).toEqual({
      render: true,
      drawWorld: false,
      paint: true,
      tick: true,
    });
    // The stronger arms still win over the hold.
    expect(presentationGate({ ...held, graphicsRebuildPaused: true }).tick).toBe(false);
    expect(presentationGate({ ...held, hidden: true, desktopApp: true }).render).toBe(false);
    // A hidden WEB tab is not the desktop hidden arm (rAF is already paused
    // there, so there is nothing to skip): it falls through to the hold, which
    // still applies. Hidden alone must not upgrade the decision to all-off.
    expect(presentationGate({ ...held, hidden: true })).toEqual({
      render: true,
      drawWorld: false,
      paint: true,
      tick: true,
    });
    // The hold is a frozen singleton like the others.
    expect(presentationGate({ ...held })).toBe(presentationGate(held));
    expect(Object.isFrozen(presentationGate(held))).toBe(true);
  });

  it('newPresentationGateInput starts all-on and its holdWorldDraw flips its own field', () => {
    const input = newPresentationGateInput(true);
    expect(presentationGate(input).drawWorld).toBe(true);
    input.holdWorldDraw(true);
    expect(input.worldDrawHeld).toBe(true);
    expect(presentationGate(input).drawWorld).toBe(false);
    expect(presentationGate(input).render).toBe(true);
    input.holdWorldDraw(false);
    expect(presentationGate(input).drawWorld).toBe(true);
  });

  it('leaves the web build untouched, including a hidden tab', () => {
    expect(
      presentationGate({
        hidden: false,
        desktopApp: false,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      }),
    ).toEqual({ render: true, drawWorld: true, paint: true, tick: true });
    expect(
      presentationGate({
        hidden: true,
        desktopApp: false,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      }),
    ).toEqual({ render: true, drawWorld: true, paint: true, tick: true });
  });

  it('returns the same frozen decision object per arm on every call (phase 4 QA F8)', () => {
    // The gate runs on the rAF hot path and its allocation-free contract is
    // the shared frozen singletons; toEqual alone would keep passing if a
    // rewrite returned fresh literals per frame. Identity plus frozen-ness is
    // the actual contract, so pin both, one case per arm.
    const paused = {
      hidden: false,
      desktopApp: false,
      graphicsRebuildPaused: true,
      worldDrawHeld: false,
    };
    const hiddenDesktop = {
      hidden: true,
      desktopApp: true,
      graphicsRebuildPaused: false,
      worldDrawHeld: false,
    };
    const allOn = {
      hidden: false,
      desktopApp: true,
      graphicsRebuildPaused: false,
      worldDrawHeld: false,
    };
    for (const input of [paused, hiddenDesktop, allOn]) {
      const first = presentationGate(input);
      expect(presentationGate({ ...input })).toBe(first);
      expect(Object.isFrozen(first)).toBe(true);
    }
    // The web arm shares the ALL_ON singleton with the visible desktop arm:
    // one decision, not two equal copies.
    expect(
      presentationGate({
        hidden: true,
        desktopApp: false,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      }),
    ).toBe(presentationGate(allOn));
  });
});
