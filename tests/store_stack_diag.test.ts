import { describe, expect, it } from 'vitest';
import { StoreStackDiag } from '../src/ui/store_stack_diag';

describe('StoreStackDiag', () => {
  it('records visibility transitions with their timestamps', () => {
    // Arrange
    const diag = new StoreStackDiag();

    // Act
    diag.record(true, false, false, 1000);
    diag.record(true, true, true, 2000);
    diag.record(false, true, false, 3000);

    // Assert
    expect(diag.trail()).toEqual([
      { at: 1000, store: true, claudium: false, stacked: false },
      { at: 2000, store: true, claudium: true, stacked: true },
      { at: 3000, store: false, claudium: true, stacked: false },
    ]);
  });

  it('collapses repeated identical samples into one entry', () => {
    // Arrange
    const diag = new StoreStackDiag();

    // Act: the sync runs on every window mutation, so unchanged states repeat.
    diag.record(true, false, false, 1000);
    diag.record(true, false, false, 1500);
    diag.record(true, false, false, 2000);
    diag.record(false, false, false, 3000);

    // Assert
    expect(diag.trail().map((s) => s.at)).toEqual([1000, 3000]);
  });

  it('keeps only the most recent samples once the buffer is full', () => {
    // Arrange
    const diag = new StoreStackDiag();

    // Act: alternate states so nothing dedupes, far past the cap.
    for (let i = 0; i < 100; i++) diag.record(i % 2 === 0, false, false, i);

    // Assert
    const trail = diag.trail();
    expect(trail.length).toBe(40);
    expect(trail[0]?.at).toBe(60);
    expect(trail[trail.length - 1]?.at).toBe(99);
  });
});
