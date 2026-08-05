// The Open Source's mains lighting core. Before the extraction this math lived
// in a private renderer method and had no test at all: the only coverage was the
// browser E2E reading renderer.hemi.intensity live.

import { describe, expect, it } from 'vitest';
import {
  createSourceCaveMainsState,
  type SourceCaveMainsAnchors,
  type SourceCaveMainsPhase,
  type SourceCaveMainsState,
  stepSourceCaveMains,
} from '../src/render/source_cave_mains_core';

// The shared delve ambience the blend departs from (renderer.ts constants).
const ANCHORS: SourceCaveMainsAnchors = { hemi: 0.22, env: 0.05, fogFar: 74 };
const DT = 1 / 60;

function settle(
  state: SourceCaveMainsState,
  input: { inCave: boolean; phase: SourceCaveMainsPhase },
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
    expect(state).toEqual({ mix: 0, power: 1, reach: 0 });
    expect(
      stepSourceCaveMains(state, { inCave: false, phase: 'mains', dt: DT }, ANCHORS),
    ).toBeNull();
  });

  it('keeps writing while the blend fades out after leaving, then stops', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'mains' }, 3);

    // Still inside the fade: the frame must keep writing or the ambience would
    // snap back to the plain delve baseline the instant you cross the boundary.
    expect(
      stepSourceCaveMains(state, { inCave: false, phase: 'mains', dt: DT }, ANCHORS),
    ).not.toBeNull();

    expect(settle(state, { inCave: false, phase: 'mains' }, 5)).toBeNull();
    expect(state).toEqual({ mix: 0, power: 1, reach: 0 });
  });

  it('resets the aftermath reach on the way out, so a fresh claim starts unwrecked', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'aftermath' }, 8);
    expect(state.reach).toBeGreaterThan(0.9);
    expect(settle(state, { inCave: false, phase: 'aftermath' }, 8)).toBeNull();
    expect(state.reach).toBe(0);
  });
});

describe('source cave mains: levels', () => {
  it('reaches the lit hall after settling inside on mains', () => {
    const state = createSourceCaveMainsState();
    const lit = settle(state, { inCave: true, phase: 'mains' }, 5);
    expect(lit).not.toBeNull();
    expect(lit?.mix).toBeCloseTo(1, 2);
    expect(lit?.power).toBeCloseTo(1, 2);
    expect(lit?.hemi).toBeCloseTo(0.85, 2);
    expect(lit?.env).toBeCloseTo(0.35, 2);
    expect(lit?.fogFar).toBeCloseTo(200, 0);
  });

  it('drops to the torch-lit backup once the button is pressed', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'mains' }, 5);
    const dark = settle(state, { inCave: true, phase: 'outage' }, 5);
    expect(dark?.power).toBeCloseTo(0, 2);
    expect(dark?.hemi).toBeCloseTo(0.1, 2);
    expect(dark?.env).toBeCloseTo(0.02, 2);
    expect(dark?.fogFar).toBeCloseTo(58, 0);
  });

  it('returns to the shared ambience anchors as the viewer leaves', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'outage' }, 5);
    // One step short of the epsilon cutoff, so levels are still returned.
    let last = stepSourceCaveMains(state, { inCave: false, phase: 'outage', dt: DT }, ANCHORS);
    for (let i = 0; i < 200 && last; i++) {
      const next = stepSourceCaveMains(state, { inCave: false, phase: 'outage', dt: DT }, ANCHORS);
      if (!next) break;
      last = next;
    }
    expect(last?.hemi).toBeCloseTo(ANCHORS.hemi, 2);
    expect(last?.env).toBeCloseTo(ANCHORS.env, 2);
    expect(last?.fogFar).toBeCloseTo(ANCHORS.fogFar, 0);
  });
});

describe('source cave mains: the aftermath is a wreck, not a repair', () => {
  // The clear must NOT read as the lights coming back on: the raid broke this
  // room and it stays broken. Only the murk thins, and only far enough that the
  // reward chest 42u away becomes readable from the centre seal.
  it('thins the murk without relighting the room', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'mains' }, 5);
    const fighting = settle(state, { inCave: true, phase: 'outage' }, 5);
    const after = settle(state, { inCave: true, phase: 'aftermath' }, 12);

    expect(after?.fogFar).toBeCloseTo(100, 0);
    expect(after?.fogFar ?? 0).toBeGreaterThan(fighting?.fogFar ?? 0);
    // The two that would light the ROOM are untouched by the clear.
    expect(after?.hemi).toBeCloseTo(fighting?.hemi ?? -1, 4);
    expect(after?.env).toBeCloseTo(fighting?.env ?? -1, 4);
    expect(after?.hemi).toBeCloseTo(0.1, 2);
    expect(after?.power).toBeCloseTo(0, 2);
    // And nowhere near the lit hall it started as.
    expect(after?.fogFar ?? 0).toBeLessThan(200);
  });

  it('settles slowly enough to read as an aftermath beat, not a state flip', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'outage' }, 5);
    // Half a second after the last mob dies the murk has barely moved.
    const early = settle(state, { inCave: true, phase: 'aftermath' }, 0.5);
    expect(early?.reach ?? 1).toBeLessThan(0.4);
    expect(settle(state, { inCave: true, phase: 'aftermath' }, 10)?.reach).toBeCloseTo(1, 2);
  });

  it('leaves the outage exactly as claustrophobic as before', () => {
    // The aftermath moves only the DARK end of the blend, so an encounter still
    // running is bit-for-bit the room it always was.
    const state = createSourceCaveMainsState();
    const fighting = settle(state, { inCave: true, phase: 'outage' }, 6);
    expect(fighting?.reach).toBe(0);
    expect(fighting?.fogFar).toBeCloseTo(58, 4);
  });

  it('does not reach past the mains hall when the power comes back', () => {
    // A wipe reset makes the button pressable again (phase mains). Reach must
    // decay back out rather than stack an aftermath fog onto a lit room.
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'aftermath' }, 10);
    const relit = settle(state, { inCave: true, phase: 'mains' }, 10);
    expect(relit?.reach).toBeCloseTo(0, 2);
    expect(relit?.fogFar).toBeCloseTo(200, 0);
  });
});

describe('source cave mains: the breaker feel', () => {
  // The cut must read as a breaker snapping, not a dimmer: pressing the button
  // has to darken the room faster than walking back restores it.
  it('falls to backup faster than it recovers to mains', () => {
    const falling = createSourceCaveMainsState();
    settle(falling, { inCave: true, phase: 'mains' }, 5);
    const afterCut = settle(falling, { inCave: true, phase: 'outage' }, 0.25);

    const rising = createSourceCaveMainsState();
    settle(rising, { inCave: true, phase: 'outage' }, 5);
    const afterRestore = settle(rising, { inCave: true, phase: 'mains' }, 0.25);

    const droppedBy = 1 - (afterCut?.power ?? 1);
    const recoveredBy = afterRestore?.power ?? 0;
    expect(droppedBy).toBeGreaterThan(recoveredBy * 2);
  });

  it('holds the power state while outside so re-entry does not flash', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'outage' }, 5);
    const dark = state.power;
    // Walking out with the button still pressed must not relight the hall: only
    // `mix` fades, and it never reaches the reset epsilon in this window.
    settle(state, { inCave: false, phase: 'mains' }, 0.5);
    expect(state.power).toBeCloseTo(dark, 5);
  });

  it('holds the aftermath reach while outside too', () => {
    const state = createSourceCaveMainsState();
    settle(state, { inCave: true, phase: 'aftermath' }, 10);
    const settled = state.reach;
    settle(state, { inCave: false, phase: 'outage' }, 0.5);
    expect(state.reach).toBeCloseTo(settled, 5);
  });
});

describe('source cave mains: determinism', () => {
  it('same inputs give the same levels', () => {
    const run = () => {
      const state = createSourceCaveMainsState();
      settle(state, { inCave: true, phase: 'mains' }, 2);
      settle(state, { inCave: true, phase: 'outage' }, 2);
      return settle(state, { inCave: true, phase: 'aftermath' }, 2);
    };
    expect(run()).toEqual(run());
  });
});
