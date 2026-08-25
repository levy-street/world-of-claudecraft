import { describe, expect, it } from 'vitest';
import { EntryDetailHorizonAdmission } from '../src/render/entry_detail_horizon';
import {
  advanceEntryDetailHorizon,
  createEntryDetailHorizonState,
  ENTRY_DETAIL_HORIZON_HEADROOM_MS,
  ENTRY_DETAIL_HORIZON_STABLE_FRAMES,
  ENTRY_DETAIL_HORIZON_STEPS,
} from '../src/render/entry_detail_horizon_core';

describe('entry detail horizon admission', () => {
  it('starts with a useful near field rather than the full 700-yard detail bill', () => {
    expect(createEntryDetailHorizonState(700)).toEqual({
      cap: ENTRY_DETAIL_HORIZON_STEPS[0],
      step: 0,
      stableFrames: 0,
      complete: false,
    });
  });

  it('does not expand for elapsed time alone: compile, terrain and frame headroom must agree', () => {
    const initial = createEntryDetailHorizonState(700);
    const blocked = [
      { compileReady: false, terrainReadyFar: 700, frameMs: 10 },
      { compileReady: true, terrainReadyFar: ENTRY_DETAIL_HORIZON_STEPS[1] - 1, frameMs: 10 },
      {
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: ENTRY_DETAIL_HORIZON_HEADROOM_MS + 1,
      },
    ];
    for (const input of blocked) {
      let state = initial;
      for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES * 3; i++) {
        state = advanceEntryDetailHorizon(state, { ...input, targetFar: 700 });
      }
      expect(state.cap).toBe(ENTRY_DETAIL_HORIZON_STEPS[0]);
    }
  });

  it('opens one ring only after consecutive healthy frames, then reaches the target monotonically', () => {
    let state = createEntryDetailHorizonState(700);
    const seen = [state.cap];
    for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES - 1; i++) {
      state = advanceEntryDetailHorizon(state, {
        targetFar: 700,
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: 12,
      });
    }
    expect(state.cap).toBe(ENTRY_DETAIL_HORIZON_STEPS[0]);
    state = advanceEntryDetailHorizon(state, {
      targetFar: 700,
      compileReady: true,
      terrainReadyFar: 700,
      frameMs: 12,
    });
    expect(state.cap).toBe(ENTRY_DETAIL_HORIZON_STEPS[1]);

    while (!state.complete) {
      state = advanceEntryDetailHorizon(state, {
        targetFar: 700,
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: 12,
      });
      seen.push(state.cap);
    }
    expect(state.cap).toBe(700);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('clamps the ladder to a smaller atmospheric target', () => {
    let state = createEntryDetailHorizonState(310);
    for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES; i++) {
      state = advanceEntryDetailHorizon(state, {
        targetFar: 310,
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: 10,
      });
    }
    expect(state.cap).toBe(310);
    expect(state.complete).toBe(true);
  });

  it('arms before presentation and reports why each ring is still held', () => {
    let nowMs = 100;
    const admission = new EntryDetailHorizonAdmission(700, () => nowMs);

    expect(admission.snapshot()).toMatchObject({ active: false, cap: 700, holdReason: 'inactive' });
    expect(admission.arm(700, true)).toBe(ENTRY_DETAIL_HORIZON_STEPS[0]);
    expect(admission.snapshot()).toMatchObject({
      active: true,
      cap: ENTRY_DETAIL_HORIZON_STEPS[0],
      nextCap: ENTRY_DETAIL_HORIZON_STEPS[1],
      armedAtMs: 100,
      holdReason: 'stabilizing',
      transitions: [],
    });

    admission.advanceFromFrame(
      true,
      700,
      [{ submittedAtMs: 1, settledAtMs: null, failedAtMs: null }],
      700,
      10,
    );
    expect(admission.snapshot().holdReason).toBe('compile-debt');

    nowMs = 250;
    for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES; i++) {
      admission.advanceFromFrame(true, 700, [], 700, 10);
    }
    expect(admission.snapshot()).toMatchObject({
      cap: ENTRY_DETAIL_HORIZON_STEPS[1],
      holdReason: 'advanced',
      transitions: [
        { from: ENTRY_DETAIL_HORIZON_STEPS[0], to: ENTRY_DETAIL_HORIZON_STEPS[1], atMs: 250 },
      ],
    });
  });

  it('does not inspect compile lifecycle records after the entry horizon is inactive', () => {
    const admission = new EntryDetailHorizonAdmission(700);
    const records = new Proxy([] as never[], {
      get() {
        throw new Error('inactive horizon scanned compile records');
      },
    });

    expect(admission.advanceFromFrame(true, 700, records, 700, 16)).toBe(700);
    expect(admission.snapshot().holdReason).toBe('inactive');
  });

  it('accepts a healthy externally paced 30 Hz display as frame headroom', () => {
    let state = createEntryDetailHorizonState(700);
    for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES; i++) {
      state = advanceEntryDetailHorizon(state, {
        targetFar: 700,
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: 1000 / 30,
        externallyPaced: true,
      });
    }
    expect(state.cap).toBe(ENTRY_DETAIL_HORIZON_STEPS[1]);
  });
});
