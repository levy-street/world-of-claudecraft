// The nameplate dot row's live size, the one piece of mutable state between the
// settings site and the plate painter.
//
// It exists because renderer.ts was carrying the value only to hand it straight
// to the painter, which its line ceiling does not have room for. Small as it is,
// the OFF encoding is load-bearing: 0 is how "draw no row" reaches the painter,
// so a fallback that produced some other number would turn the toggle into a
// resize.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { nameplateDotScale, setNameplateDotScale } from '../src/render/nameplate_dot_scale';
import { NAMEPLATE_DOT_SCALE_MIN } from '../src/render/nameplate_dots_core';

describe('nameplate dot scale', () => {
  beforeEach(() => setNameplateDotScale(NAMEPLATE_DOT_SCALE_MIN));

  it('reads back what the settings site applied', () => {
    setNameplateDotScale(1.5);
    expect(nameplateDotScale()).toBe(1.5);
    setNameplateDotScale(3);
    expect(nameplateDotScale()).toBe(3);
  });

  it('carries zero through as off, which is how the toggle reaches the painter', () => {
    setNameplateDotScale(0);
    expect(nameplateDotScale()).toBe(0);
  });

  it('reads a non-finite or negative value as OFF rather than as a size', () => {
    // The safe direction for a corrupt stored value is no row, never a row at
    // some arbitrary scale.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -2]) {
      setNameplateDotScale(1.5);
      setNameplateDotScale(bad);
      expect(nameplateDotScale(), String(bad)).toBe(0);
    }
  });

  it('starts at the minimum before any settings pass has run', async () => {
    // A genuinely fresh module, not the one this file already mutated: an
    // unreset dynamic import would just re-read the value beforeEach set and
    // assert nothing about module initialization.
    setNameplateDotScale(3);
    vi.resetModules();
    const fresh = await import('../src/render/nameplate_dot_scale');
    expect(fresh.nameplateDotScale()).toBe(NAMEPLATE_DOT_SCALE_MIN);
  });
});
