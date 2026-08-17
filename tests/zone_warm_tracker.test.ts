// The zone-warm lane's per-frame decision state (src/game/zone_warm_tracker.ts):
// displacement since the last VISIBLE check plus the rift-band exit edge, with
// the desktop hidden latch as a full freeze. The freeze semantics are the
// point: a hidden span must neither consume movement nor eat the rift edge,
// so the reveal frame's blocking-versus-background decision reads exactly as
// if the transition had just happened.

import { describe, expect, it } from 'vitest';
import { createZoneWarmTracker } from '../src/game/zone_warm_tracker';

const RIFT_X = 90_000;
const inRift = (x: number) => x >= RIFT_X;

describe('zone_warm_tracker', () => {
  it('answers displacement 0 and no rift exit on the very first check', () => {
    const track = createZoneWarmTracker(inRift);
    expect(track(123, -456, false)).toEqual({ displacement: 0, riftExit: false });
  });

  it('measures per-frame displacement between consecutive visible checks', () => {
    const track = createZoneWarmTracker(inRift);
    track(0, 0, false);
    expect(track(3, 4, false)?.displacement).toBe(5);
    // and the baseline advances: the next frame measures from (3, 4)
    expect(track(3, 4, false)?.displacement).toBe(0);
  });

  it('answers null while hidden and accumulates the displacement across the whole span', () => {
    const track = createZoneWarmTracker(inRift);
    track(0, 0, false);
    // hidden frames: no answer, and CRITICALLY no baseline consumption
    expect(track(10, 0, true)).toBeNull();
    expect(track(20, 0, true)).toBeNull();
    // the reveal frame measures from the last VISIBLE position, not from the
    // last hidden one: 5 zones walked while minimized reads as 5 zones
    expect(track(30, 40, false)?.displacement).toBe(50);
  });

  it('keeps the rift-exit edge through a hidden span instead of eating it', () => {
    const track = createZoneWarmTracker(inRift);
    track(RIFT_X + 10, 0, false);
    // the exit itself happens while hidden
    expect(track(100, 0, true)).toBeNull();
    // the reveal frame still reports the edge: without it the player lands
    // inside the residency fog clamp with no loading screen
    expect(track(100, 0, false)?.riftExit).toBe(true);
    // an edge, not a level: the next frame is an ordinary overworld frame
    expect(track(100, 0, false)?.riftExit).toBe(false);
  });

  it('reports the exit edge exactly once and never on entry or while inside', () => {
    const track = createZoneWarmTracker(inRift);
    expect(track(0, 0, false)?.riftExit).toBe(false);
    // entering the band is not an exit
    expect(track(RIFT_X + 5, 0, false)?.riftExit).toBe(false);
    // staying inside is not an exit
    expect(track(RIFT_X + 6, 0, false)?.riftExit).toBe(false);
    // leaving is, once
    expect(track(10, 0, false)?.riftExit).toBe(true);
    expect(track(10, 0, false)?.riftExit).toBe(false);
  });

  it('does not report an exit for a crossing contained entirely in one hidden span', () => {
    // Deliberate bound, not an oversight (phase 8 QA): hidden frames sample
    // nothing, so a band entered AND left while hidden was never seen. No rift
    // session was rendered during the span (nothing near the exit was
    // evicted), and the whole-span displacement still routes a teleport-sized
    // reveal to the blocking arm, so the wider rift-exit stream radius is not
    // needed here.
    const track = createZoneWarmTracker(inRift);
    track(0, 0, false);
    expect(track(RIFT_X + 5, 0, true)).toBeNull();
    expect(track(100, 0, true)).toBeNull();
    const reveal = track(100, 0, false);
    expect(reveal?.riftExit).toBe(false);
    // the whole-span displacement still lands
    expect(reveal?.displacement).toBe(100);
  });

  it('reuses one result object across calls (the per-frame path allocates nothing)', () => {
    const track = createZoneWarmTracker(inRift);
    const first = track(0, 0, false);
    const second = track(3, 4, false);
    expect(second).toBe(first);
    // consequence a consumer must respect: the fields are only valid until
    // the next call
    expect(first?.displacement).toBe(5);
  });

  it('stays frozen for arbitrarily long hidden runs', () => {
    const track = createZoneWarmTracker(inRift);
    track(0, 0, false);
    for (let i = 0; i < 1000; i++) expect(track(i, i, true)).toBeNull();
    expect(track(0, 0, false)?.displacement).toBe(0);
  });
});
