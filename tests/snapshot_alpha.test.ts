import { describe, expect, it } from 'vitest';
import { snapshotAlpha } from '../src/net/snapshot_alpha';

// The one interpolation alpha both the render loop (src/main.ts) and
// ClientWorld's snapshot re-anchor (src/net/online.ts) read.

describe('snapshotAlpha', () => {
  it('is a full 1 before the first snapshot has landed', () => {
    expect(snapshotAlpha(1000, 0, 50)).toBe(1);
    expect(snapshotAlpha(0, 0, 50)).toBe(1);
    // A negative timestamp is "no snapshot yet" too, not a huge alpha.
    expect(snapshotAlpha(1000, -1, 50)).toBe(1);
  });

  it('is the elapsed fraction of the measured snapshot interval', () => {
    expect(snapshotAlpha(1025, 1000, 50)).toBe(0.5);
    expect(snapshotAlpha(1040, 1000, 50)).toBe(0.8);
    expect(snapshotAlpha(1000.5, 1000, 50)).toBe(0.01);
  });

  it('reaches exactly 1 on the snapshot boundary', () => {
    expect(snapshotAlpha(1050, 1000, 50)).toBe(1);
  });

  it('caps at 1.25 once the next snapshot is late', () => {
    // 62.5ms is exactly the cap; anything later stays pinned there.
    expect(snapshotAlpha(1062.5, 1000, 50)).toBe(1.25);
    expect(snapshotAlpha(1063, 1000, 50)).toBe(1.25);
    expect(snapshotAlpha(9000, 1000, 50)).toBe(1.25);
  });

  it('floors the interval at 20ms so a collapsed cadence cannot blow up', () => {
    expect(snapshotAlpha(1010, 1000, 1)).toBe(0.5);
    expect(snapshotAlpha(1010, 1000, 0)).toBe(0.5);
    expect(snapshotAlpha(1010, 1000, -100)).toBe(0.5);
    // The 20ms floor is the divisor, so the cap is reached 25ms in.
    expect(snapshotAlpha(1025, 1000, 5)).toBe(1.25);
  });

  it('has no lower clamp: a clock reading before the last snapshot goes negative', () => {
    expect(snapshotAlpha(990, 1000, 50)).toBe(-0.2);
  });
});
