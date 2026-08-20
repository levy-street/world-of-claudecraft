import { describe, expect, it } from 'vitest';
import { type NavRect, nextFocusIndex } from '../src/ui/dpad_nav_core';

const box = (left: number, top: number, w = 40, h = 20): NavRect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

// A two-column, three-row form: the layout that exposes every interesting case.
//   0  1
//   2  3
//   4  5
const grid: NavRect[] = [
  box(0, 0),
  box(100, 0),
  box(0, 50),
  box(100, 50),
  box(0, 100),
  box(100, 100),
];

describe('nextFocusIndex', () => {
  it('moves to the control directly below, not the one diagonally nearer', () => {
    // Column discipline is the whole point: without the cross-axis penalty a
    // "down" press in a two-column form drifts into the other column.
    expect(nextFocusIndex(grid, 0, 'down')).toBe(2);
    expect(nextFocusIndex(grid, 2, 'down')).toBe(4);
  });

  it('moves up, left and right the same way', () => {
    expect(nextFocusIndex(grid, 4, 'up')).toBe(2);
    expect(nextFocusIndex(grid, 2, 'right')).toBe(3);
    expect(nextFocusIndex(grid, 3, 'left')).toBe(2);
  });

  it('holds at an edge rather than wrapping', () => {
    // Wrapping puts focus somewhere the player did not look.
    expect(nextFocusIndex(grid, 0, 'up')).toBe(0);
    expect(nextFocusIndex(grid, 0, 'left')).toBe(0);
    expect(nextFocusIndex(grid, 5, 'down')).toBe(5);
    expect(nextFocusIndex(grid, 5, 'right')).toBe(5);
  });

  it('lands on the first control when nothing is focused yet', () => {
    expect(nextFocusIndex(grid, -1, 'down')).toBe(0);
    expect(nextFocusIndex(grid, 99, 'up')).toBe(0);
  });

  it('answers -1 for an empty window rather than a bogus index', () => {
    expect(nextFocusIndex([], 0, 'down')).toBe(-1);
  });

  it('ignores a control merely level with the current one', () => {
    // A label and its input share a row; "down" must skip past the whole row
    // rather than hopping sideways within it.
    const row = [box(0, 0), box(100, 0), box(0, 50)];
    expect(nextFocusIndex(row, 0, 'down')).toBe(2);
  });

  it('prefers the nearer of two candidates in the same direction', () => {
    const stack = [box(0, 0), box(0, 40), box(0, 200)];
    expect(nextFocusIndex(stack, 0, 'down')).toBe(1);
  });

  it('will take a sideways candidate when nothing is straight ahead', () => {
    // Only a far-offset control lies below; a press should still reach it rather
    // than stranding focus.
    const offset = [box(0, 0), box(400, 60)];
    expect(nextFocusIndex(offset, 0, 'down')).toBe(1);
  });

  it('never returns an index outside the list', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      for (let i = 0; i < grid.length; i++) {
        const next = nextFocusIndex(grid, i, dir);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(grid.length);
      }
    }
  });
});
