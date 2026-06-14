import { describe, expect, it } from 'vitest';
import { forcedTierFromSearch, isConstrainedBrowser, tierFromHints, type GfxRuntimeHints } from '../src/render/gfx';

const desktop: GfxRuntimeHints = {
  search: '',
  maxTouchPoints: 0,
  coarsePointer: false,
  narrowViewport: false,
};

describe('graphics tier resolution', () => {
  it('honors explicit URL tier overrides', () => {
    expect(forcedTierFromSearch('?lowgfx')).toBe('low');
    expect(forcedTierFromSearch('?gfx=low')).toBe('low');
    expect(forcedTierFromSearch('?gfx=high')).toBe('high');
    expect(forcedTierFromSearch('?gfx=ultra')).toBe('ultra');
    expect(forcedTierFromSearch('?gfx=banana')).toBe(null);
  });

  it('treats phone-class and low-memory browsers as constrained', () => {
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1, coarsePointer: true })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1, narrowViewport: true })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, deviceMemory: 4 })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1 })).toBe(false);
    expect(isConstrainedBrowser(desktop)).toBe(false);
  });

  it('drops automatic constrained and software sessions to low while preserving forced high', () => {
    expect(tierFromHints(desktop, false)).toBe('high');
    expect(tierFromHints(desktop, true)).toBe('low');
    expect(tierFromHints({ ...desktop, maxTouchPoints: 1, coarsePointer: true }, false)).toBe('low');
    expect(tierFromHints({ ...desktop, search: '?gfx=high', maxTouchPoints: 1, coarsePointer: true }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, search: '?gfx=ultra' }, true)).toBe('ultra');
  });
});
