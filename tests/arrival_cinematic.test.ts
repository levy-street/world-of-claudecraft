// The first-visit island arrival cinematic (game/arrival_cinematic.ts): the
// camera falls from a fixed sky framing onto the player's ordinary chase
// framing over a few seconds, monotonic in both knobs, cancellable, and
// exact at both ends.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_CINEMATIC_SECONDS,
  ARRIVAL_CINEMATIC_START_DIST,
  ARRIVAL_CINEMATIC_START_PITCH,
  arrivalCinematicActive,
  cancelArrivalCinematic,
  createArrivalCinematic,
  startArrivalCinematic,
  stepArrivalCinematic,
} from '../src/game/arrival_cinematic';

describe('arrival cinematic', () => {
  it('falls from the sky framing to the remembered chase framing, monotonic', () => {
    const state = createArrivalCinematic();
    expect(arrivalCinematicActive(state)).toBe(false);
    startArrivalCinematic(state, 12, 0.32);
    expect(arrivalCinematicActive(state)).toBe(true);

    let last = { dist: ARRIVAL_CINEMATIC_START_DIST + 1, pitch: ARRIVAL_CINEMATIC_START_PITCH + 1 };
    let frame = stepArrivalCinematic(state, 1 / 60);
    expect(frame).not.toBeNull();
    // The first frame starts at (or a hair under) the sky framing.
    expect(frame!.dist).toBeLessThanOrEqual(ARRIVAL_CINEMATIC_START_DIST);
    expect(frame!.dist).toBeGreaterThan(12);
    while (frame) {
      expect(frame.dist).toBeLessThanOrEqual(last.dist + 1e-9);
      expect(frame.pitch).toBeLessThanOrEqual(last.pitch + 1e-9);
      last = frame;
      if (!arrivalCinematicActive(state)) break;
      frame = stepArrivalCinematic(state, 1 / 60);
    }
    // Settles EXACTLY on the remembered framing, then goes inactive.
    expect(last.dist).toBeCloseTo(12, 5);
    expect(last.pitch).toBeCloseTo(0.32, 5);
    expect(arrivalCinematicActive(state)).toBe(false);
    expect(stepArrivalCinematic(state, 1 / 60)).toBeNull();
  });

  it('a cancel stops it instantly and leaves the camera alone', () => {
    const state = createArrivalCinematic();
    startArrivalCinematic(state, 9, 0.2);
    stepArrivalCinematic(state, 0.5);
    cancelArrivalCinematic(state);
    expect(arrivalCinematicActive(state)).toBe(false);
    expect(stepArrivalCinematic(state, 1 / 60)).toBeNull();
  });

  it('the whole fall takes the authored seconds', () => {
    const state = createArrivalCinematic();
    startArrivalCinematic(state, 12, 0.32);
    let frames = 0;
    while (stepArrivalCinematic(state, 0.1)) frames++;
    expect(frames).toBe(Math.ceil(ARRIVAL_CINEMATIC_SECONDS / 0.1));
  });
});

describe('the landing fall yields to the spawn intro (source pin)', () => {
  it('main.ts never starts the fall while the first-spawn intro owns the camera', () => {
    const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const hook = src.indexOf('hud.onIslandFirstArrival = () => {');
    expect(hook).toBeGreaterThan(-1);
    const body = src.slice(hook, src.indexOf('startArrivalCinematic(arrivalCinematic', hook));
    expect(body).toContain('if (intro !== null ||');
  });
});
