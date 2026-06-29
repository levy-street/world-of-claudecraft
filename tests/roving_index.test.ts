import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type RovingOrientation, rovingTarget } from '../src/ui/roving_index';

// rovingTarget is a PURE core: it reads NO IWorld, only primitives (key, current index,
// count, orientation), so the ClientWorld-vs-Sim parity row is N/A for it
// (exactly like dropdown_nav.ts). The contract that applies is same-input-same-output,
// asserted below, plus an equivalence check against the three inline talents handlers it
// folds, so the extraction is proven byte-faithful and not merely plausible.

const ORIENTATIONS: RovingOrientation[] = ['horizontal', 'both'];

describe('rovingTarget: same input -> same output', () => {
  it('returns null when there are no options (count <= 0)', () => {
    for (const o of ORIENTATIONS) {
      expect(rovingTarget('ArrowRight', 0, 0, o)).toBeNull();
      expect(rovingTarget('Home', 2, -1, o)).toBeNull();
    }
  });

  it('Home -> 0 and End -> count - 1 in both orientations', () => {
    for (const o of ORIENTATIONS) {
      expect(rovingTarget('Home', 2, 4, o)).toBe(0);
      expect(rovingTarget('End', 1, 4, o)).toBe(3);
    }
  });

  it('horizontal owns ArrowRight/ArrowLeft only, wrapping at the ends', () => {
    expect(rovingTarget('ArrowRight', 0, 3, 'horizontal')).toBe(1);
    expect(rovingTarget('ArrowRight', 2, 3, 'horizontal')).toBe(0); // wrap forward
    expect(rovingTarget('ArrowLeft', 1, 3, 'horizontal')).toBe(0);
    expect(rovingTarget('ArrowLeft', 0, 3, 'horizontal')).toBe(2); // wrap back
    // the vertical arrows are not a horizontal move
    expect(rovingTarget('ArrowDown', 0, 3, 'horizontal')).toBeNull();
    expect(rovingTarget('ArrowUp', 0, 3, 'horizontal')).toBeNull();
  });

  it('both owns the vertical arrows as well, wrapping at the ends', () => {
    expect(rovingTarget('ArrowDown', 0, 3, 'both')).toBe(1);
    expect(rovingTarget('ArrowDown', 2, 3, 'both')).toBe(0); // wrap forward
    expect(rovingTarget('ArrowRight', 2, 3, 'both')).toBe(0);
    expect(rovingTarget('ArrowUp', 0, 3, 'both')).toBe(2); // wrap back
    expect(rovingTarget('ArrowLeft', 0, 3, 'both')).toBe(2);
  });

  it('returns null for any non-roving key in either orientation', () => {
    for (const o of ORIENTATIONS) {
      for (const k of ['Tab', 'Enter', ' ', 'Escape', 'a', 'Backspace', 'Delete']) {
        expect(rovingTarget(k, 0, 3, o), `${o}/${k}`).toBeNull();
      }
    }
  });
});

describe('rovingTarget: equivalence with the three folded talents handlers', () => {
  // The exact inline arithmetic each handler computed before they were folded onto the
  // core, reproduced here so the fold is proven byte-faithful across a small index grid.

  // talents_window tablist (horizontal): ArrowRight/ArrowLeft/Home/End only.
  const oldTablist = (key: string, i: number, n: number): number | null => {
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return null;
    return key === 'Home'
      ? 0
      : key === 'End'
        ? n - 1
        : (i + (key === 'ArrowRight' ? 1 : n - 1)) % n;
  };

  // talents_window spec radiogroup (both): ArrowDown/ArrowRight/ArrowUp/ArrowLeft/Home/End.
  const oldRadiogroup = (key: string, i: number, n: number): number | null => {
    if (
      key !== 'ArrowDown' &&
      key !== 'ArrowRight' &&
      key !== 'ArrowUp' &&
      key !== 'ArrowLeft' &&
      key !== 'Home' &&
      key !== 'End'
    )
      return null;
    return key === 'Home'
      ? 0
      : key === 'End'
        ? n - 1
        : key === 'ArrowDown' || key === 'ArrowRight'
          ? (i + 1) % n
          : (i - 1 + n) % n;
  };

  // talents_window choice flyout (both): focusOpt normalizes ((idx % n) + n) % n for each
  // of i + 1 (Down/Right), i - 1 (Up/Left), 0 (Home), n - 1 (End).
  const oldFlyout = (key: string, i: number, n: number): number | null => {
    const norm = (idx: number) => ((idx % n) + n) % n;
    if (key === 'ArrowDown' || key === 'ArrowRight') return norm(i + 1);
    if (key === 'ArrowUp' || key === 'ArrowLeft') return norm(i - 1);
    if (key === 'Home') return norm(0);
    if (key === 'End') return norm(n - 1);
    return null;
  };

  const HKEYS = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
  const BKEYS = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
  const SIZES = [1, 2, 3, 5];

  it('reproduces the horizontal tablist index for every i and key', () => {
    for (const n of SIZES)
      for (let i = 0; i < n; i++)
        for (const k of HKEYS)
          expect(rovingTarget(k, i, n, 'horizontal'), `${k}@${i}/${n}`).toBe(oldTablist(k, i, n));
  });

  it('reproduces the both-orientation radiogroup index for every i and key', () => {
    for (const n of SIZES)
      for (let i = 0; i < n; i++)
        for (const k of BKEYS)
          expect(rovingTarget(k, i, n, 'both'), `${k}@${i}/${n}`).toBe(oldRadiogroup(k, i, n));
  });

  it('reproduces the choice-flyout (focusOpt-normalized) index for every i and key', () => {
    for (const n of SIZES)
      for (let i = 0; i < n; i++)
        for (const k of BKEYS)
          expect(rovingTarget(k, i, n, 'both'), `${k}@${i}/${n}`).toBe(oldFlyout(k, i, n));
  });
});

describe('roving_index: no magic values', () => {
  it('carries no hex color or px literal (named keys/orientation only)', () => {
    const src = readFileSync(new URL('../src/ui/roving_index.ts', import.meta.url), 'utf8');
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(src, 'no px literal').not.toMatch(/\b\d+px\b/);
  });
});
