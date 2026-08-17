import { describe, expect, it } from 'vitest';
import {
  displayChangedPayload,
  displayWirePayload,
  shouldForwardDisplayChange,
} from '../electron/display_events.cjs';

describe('displayChangedPayload (renderer-facing display whitelist)', () => {
  it('passes only the two whitelisted fields, never the rest of the Display object', () => {
    expect(
      displayChangedPayload({
        id: 2528732444,
        scaleFactor: 1.5,
        bounds: { x: 0, y: 0, width: 3840, height: 2160 },
        workArea: { x: 0, y: 27, width: 3840, height: 2133 },
        label: 'Built-in Retina Display',
        rotation: 0,
      }),
    ).toEqual({ scaleFactor: 1.5, displayId: 2528732444 });
  });

  it('clamps the scale factor at both ends', () => {
    expect(displayChangedPayload({ id: 1, scaleFactor: 0.1 }).scaleFactor).toBe(0.25);
    expect(displayChangedPayload({ id: 1, scaleFactor: 0.25 }).scaleFactor).toBe(0.25);
    expect(displayChangedPayload({ id: 1, scaleFactor: 10 }).scaleFactor).toBe(10);
    expect(displayChangedPayload({ id: 1, scaleFactor: 64 }).scaleFactor).toBe(10);
  });

  it('falls back to a scale factor of 1 for anything not a finite positive number', () => {
    for (const scaleFactor of [undefined, null, 0, -2, Number.NaN, Number.POSITIVE_INFINITY, '2']) {
      expect(
        displayChangedPayload({ id: 1, scaleFactor }).scaleFactor,
        `fallback for ${String(scaleFactor)}`,
      ).toBe(1);
    }
    expect(displayChangedPayload(undefined)).toEqual({ scaleFactor: 1, displayId: 0 });
    expect(displayChangedPayload(null)).toEqual({ scaleFactor: 1, displayId: 0 });
  });

  it('truncates the display id and falls back to 0 for anything not a finite number', () => {
    expect(displayChangedPayload({ id: 7.9, scaleFactor: 1 }).displayId).toBe(7);
    expect(displayChangedPayload({ id: -7.9, scaleFactor: 1 }).displayId).toBe(-7);
    for (const id of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, '12', {}]) {
      expect(
        displayChangedPayload({ id, scaleFactor: 1 }).displayId,
        `fallback for ${String(id)}`,
      ).toBe(0);
    }
  });

  it('emits exactly the two whitelisted keys', () => {
    expect(Object.keys(displayChangedPayload({ id: 1, scaleFactor: 2 })).sort()).toEqual([
      'displayId',
      'scaleFactor',
    ]);
  });
});

describe('displayWirePayload (what actually crosses the bridge)', () => {
  it('narrows a reading to the scale factor alone, dropping the display id', () => {
    // The id is a stable OS-derived identifier that exists only for the
    // main-side dedup; the renderer re-resolves a pixel ratio and needs nothing
    // else. Pin the exact key set, so a pass-through rewrite cannot smuggle it.
    const wire = displayWirePayload({ scaleFactor: 1.5, displayId: 2528732444 });
    expect(wire).toEqual({ scaleFactor: 1.5 });
    expect(Object.keys(wire)).toEqual(['scaleFactor']);
  });

  it('re-applies the coercion, so a raw Display or a junk reading is still safe', () => {
    expect(displayWirePayload({ scaleFactor: 64, id: 1 })).toEqual({ scaleFactor: 10 });
    expect(displayWirePayload({ scaleFactor: 0.1 })).toEqual({ scaleFactor: 0.25 });
    expect(displayWirePayload({ scaleFactor: Number.NaN })).toEqual({ scaleFactor: 1 });
    expect(displayWirePayload(null)).toEqual({ scaleFactor: 1 });
    expect(displayWirePayload(undefined)).toEqual({ scaleFactor: 1 });
  });
});

describe('shouldForwardDisplayChange', () => {
  const base = { scaleFactor: 2, displayId: 10 };

  it('forwards the first reading of a session', () => {
    expect(shouldForwardDisplayChange(null, base)).toBe(true);
    expect(shouldForwardDisplayChange(undefined, base)).toBe(true);
  });

  it('drops an unchanged reading', () => {
    // This is the whole reason the dedup exists: a drag within one monitor and an
    // unrelated monitor's metrics changing both fire with an identical reading.
    expect(shouldForwardDisplayChange(base, { scaleFactor: 2, displayId: 10 })).toBe(false);
  });

  it('forwards a change in either field on its own', () => {
    expect(shouldForwardDisplayChange(base, { scaleFactor: 2, displayId: 11 })).toBe(true);
    expect(shouldForwardDisplayChange(base, { scaleFactor: 1.5, displayId: 10 })).toBe(true);
  });
});
