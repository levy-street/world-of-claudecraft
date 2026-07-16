// Pure-core tests for the Protect Yumi hold-to-grab bar view (yumi_grab_bar_view.ts):
// hidden unless a channel is running, and a fill that grows 0 -> 1 as the 1.8s
// grab completes.

import { describe, expect, it } from 'vitest';
import { yumiGrabBarState } from '../src/ui/yumi_grab_bar_view';

describe('yumi grab bar view', () => {
  it('is hidden when no grab is in progress', () => {
    expect(yumiGrabBarState({ yumiGrabRemaining: 0, yumiGrabTotal: 0 }).visible).toBe(false);
    expect(yumiGrabBarState({ yumiGrabRemaining: 0, yumiGrabTotal: 1.8 }).visible).toBe(false);
  });

  it('fills from 0 toward 1 as the channel completes', () => {
    const start = yumiGrabBarState({ yumiGrabRemaining: 1.8, yumiGrabTotal: 1.8 });
    expect(start.visible).toBe(true);
    expect(start.frac).toBeCloseTo(0, 5);
    expect(yumiGrabBarState({ yumiGrabRemaining: 0.9, yumiGrabTotal: 1.8 }).frac).toBeCloseTo(
      0.5,
      5,
    );
    const near = yumiGrabBarState({ yumiGrabRemaining: 0.18, yumiGrabTotal: 1.8 });
    expect(near.frac).toBeCloseTo(0.9, 5);
    expect(near.secondsLeft).toBeCloseTo(0.18, 5);
  });

  it('clamps the fill to 0..1 defensively', () => {
    expect(yumiGrabBarState({ yumiGrabRemaining: 3, yumiGrabTotal: 1.8 }).frac).toBe(0);
  });
});
