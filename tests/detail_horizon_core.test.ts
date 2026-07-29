// The feedback loop that keeps the coarse vista mesh out of the mid-field.
//
// Outdoors on the vista tiers the detail horizon is clamped to just inside the
// nearest UNBUILT ground chunk, and that clamp is radial: unbuilt ground a
// couple of hundred yards over a border collapses the horizon in EVERY
// direction, handing the whole mid-field to the far vista tiles, which carry no
// splat texture and take no shadows. Ground builds per zone at idle-slot pace,
// and only the zone the player STOOD in ever escalated, so the neighbour
// actually binding the horizon crawled: a 700 yard request measured serving 150
// to 244 yards, for minutes, from the Eastbrook spawn.
//
// What is pinned here is the decision, not the escalation: that a real shortfall
// is acted on, that ordinary steady state is not, and that the slack is wide
// enough to cover the clamp's own guard band so this can never latch on forever.

import { describe, expect, it } from 'vitest';
import { UNBUILT_GROUND_FOG_GUARD } from '../src/render/chunk_residency_core';
import {
  DETAIL_HORIZON_ESCALATE_SLACK,
  detailHorizonStarved,
} from '../src/render/detail_horizon_core';
import { FOGLESS_DETAIL_FAR } from '../src/render/far_terrain_core';

describe('detailHorizonStarved', () => {
  it('fires on the shortfall that was measured in the field', () => {
    // The two live readings that opened this: a 700 yard request served at 150
    // and at 244. Both must escalate, or the report reproduces exactly.
    expect(detailHorizonStarved(150, FOGLESS_DETAIL_FAR)).toBe(true);
    expect(detailHorizonStarved(244, FOGLESS_DETAIL_FAR)).toBe(true);
  });

  it('stays quiet once the horizon is open, so nothing escalates forever', () => {
    expect(detailHorizonStarved(FOGLESS_DETAIL_FAR, FOGLESS_DETAIL_FAR)).toBe(false);
    // Fully built ground still reads a few yards short: the clamp sits a guard
    // band inside the nearest pending chunk and the horizon eases in
    // exponentially, so it brushes under the request in ordinary steady state.
    // The slack MUST clear that guard band or a settled world escalates every
    // frame for the rest of the session.
    expect(DETAIL_HORIZON_ESCALATE_SLACK).toBeGreaterThan(UNBUILT_GROUND_FOG_GUARD);
    expect(
      detailHorizonStarved(FOGLESS_DETAIL_FAR - UNBUILT_GROUND_FOG_GUARD, FOGLESS_DETAIL_FAR),
    ).toBe(false);
  });

  it('trades frame time only for a shortfall a player can see', () => {
    // Escalation moves the remaining chunk builds onto macrotasks, competing
    // with the frame loop, so the threshold is a real gate and not decoration.
    expect(detailHorizonStarved(700 - DETAIL_HORIZON_ESCALATE_SLACK, 700)).toBe(false);
    expect(detailHorizonStarved(700 - DETAIL_HORIZON_ESCALATE_SLACK - 1, 700)).toBe(true);
    // and the slack stays well inside the horizon it guards: a threshold near
    // the request itself would never fire on the case above.
    expect(DETAIL_HORIZON_ESCALATE_SLACK).toBeLessThan(FOGLESS_DETAIL_FAR / 2);
  });

  it('never fires on a horizon that is already at or past the request', () => {
    // The non-vista arm passes scene fog for both, and an interior can report a
    // live far wider than the last outdoor request mid-transition.
    expect(detailHorizonStarved(950, 700)).toBe(false);
    expect(detailHorizonStarved(700, 700)).toBe(false);
    expect(detailHorizonStarved(45, 45)).toBe(false);
  });

  it('refuses a non-finite reading instead of escalating on it', () => {
    // lastRequestedFogFar is seeded before the first outdoor frame computes one,
    // and a NaN comparison is false either way: pinned so it stays deliberate.
    expect(detailHorizonStarved(Number.NaN, 700)).toBe(false);
    expect(detailHorizonStarved(150, Number.NaN)).toBe(false);
    expect(detailHorizonStarved(150, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
