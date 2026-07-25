// The Open Source's mains-to-backup lighting core. Before the extraction this
// math lived in a private renderer method and had no test at all: the only
// coverage was the browser E2E reading renderer.hemi.intensity live.

import { describe, expect, it } from 'vitest';
import {
  createSourceCaveMainsState,
  type SourceCaveMainsAnchors,
  type SourceCaveMainsState,
  stepSourceCaveMains,
} from '../src/render/source_cave_mains_core';

// The shared delve ambience the blend departs from (renderer.ts constants).
const ANCHORS: SourceCaveMainsAnchors = { hemi: 0.22, env: 0.05, fogFar: 74 };
const DT = 1 / 60;

function settle(
  state: SourceCaveMainsState,
  input: { inCave: boolean; powered: boolean },
  seconds: number,
) {
  let last = stepSourceCaveMains(state, { ...input, dt: DT }, ANCHORS);
  for (let i = 1; i < Math.round(seconds / DT); i++) {
    last = stepSourceCaveMains(state, { ...input, dt: DT }, ANCHORS);
  }
  return last;
}

describe('source cave mains: idle state', () => {
  it('starts lit and outside, and writes nothing while the viewer stays away', () => {
    const state = createSourceCaveMainsState();
    expect(state).toEqual({ mix: 0, power: 1 });
    expect(
      stepSourceCaveMains(state, { inCave: false, powered: true, dt: DT }, ANCHORS),
    ).toBeNull();
  });

  it('keeps writing while the blend fades out after leaving, then stops', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, powered: true }, 3);

    // Still inside the fade: the frame must keep writing or the ambience would
    // snap back to the plain delve baseline the instant you cross the boundary.
    expect(
      stepSourceCaveMains(state, { inCave: false, powered: true, dt: DT }, ANCHORS),
    ).not.toBeNull();

    expect(settle(state, { inCave: false, powered: true }, 5)).toBeNull();
    expect(state).toEqual({ mix: 0, power: 1 });
  });
});

describe('source cave mains: levels', () => {
  it('reaches the lit hall after settling inside on mains', () => {
    const state = createSourceCaveMainsState();
    const lit = settle(state, { inCave: true, powered: true }, 5);
    expect(lit).not.toBeNull();
    expect(lit?.mix).toBeCloseTo(1, 2);
    expect(lit?.power).toBeCloseTo(1, 2);
    expect(lit?.hemi).toBeCloseTo(0.85, 2);
    expect(lit?.env).toBeCloseTo(0.35, 2);
    expect(lit?.fogFar).toBeCloseTo(200, 0);
  });

  it('drops to the torch-lit backup once the button is pressed', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, powered: true }, 5);
    const dark = settle(state, { inCave: true, powered: false }, 5);
    expect(dark?.power).toBeCloseTo(0, 2);
    expect(dark?.hemi).toBeCloseTo(0.1, 2);
    expect(dark?.env).toBeCloseTo(0.02, 2);
    expect(dark?.fogFar).toBeCloseTo(58, 0);
  });

  it('returns to the shared ambience anchors as the viewer leaves', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, powered: false }, 5);
    // One step short of the epsilon cutoff, so levels are still returned.
    let last = stepSourceCaveMains(state, { inCave: false, powered: false, dt: DT }, ANCHORS);
    for (let i = 0; i < 200 && last; i++) {
      const next = stepSourceCaveMains(state, { inCave: false, powered: false, dt: DT }, ANCHORS);
      if (!next) break;
      last = next;
    }
    expect(last?.hemi).toBeCloseTo(ANCHORS.hemi, 2);
    expect(last?.env).toBeCloseTo(ANCHORS.env, 2);
    expect(last?.fogFar).toBeCloseTo(ANCHORS.fogFar, 0);
  });
});

describe('source cave mains: the breaker feel', () => {
  // The cut must read as a breaker snapping, not a dimmer: pressing the button
  // has to darken the room faster than walking back restores it.
  it('falls to backup faster than it recovers to mains', () => {
    const falling = createSourceCaveMainsState();
    settle(falling, { inCave: true, powered: true }, 5);
    const afterCut = settle(falling, { inCave: true, powered: false }, 0.25);

    const rising = createSourceCaveMainsState();
    settle(rising, { inCave: true, powered: false }, 5);
    const afterRestore = settle(rising, { inCave: true, powered: true }, 0.25);

    const droppedBy = 1 - (afterCut?.power ?? 1);
    const recoveredBy = afterRestore?.power ?? 0;
    expect(droppedBy).toBeGreaterThan(recoveredBy * 2);
  });

  it('holds the power state while outside so re-entry does not flash', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, powered: false }, 5);
    const dark = state.power;
    // Walking out with the button still pressed must not relight the hall: only
    // `mix` fades, and it never reaches the reset epsilon in this window.
    settle(state, { inCave: false, powered: true }, 0.5);
    expect(state.power).toBeCloseTo(dark, 5);
  });
});

describe('source cave mains: determinism', () => {
  it('same inputs give the same levels', () => {
    const run = () => {
      const state = createSourceCaveMainsState();
      settle(state, { inCave: true, powered: true }, 2);
      return settle(state, { inCave: true, powered: false }, 2);
    };
    expect(run()).toEqual(run());
  });
});
