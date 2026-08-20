// The foliage bucket first-reveal policy (foliage_bucket_reveal_core.ts): the
// foliage twin of prop_cull_core. A species bucket first met mid-travel
// consults the gate and holds while cold; a bucket already near the camera
// (login, hearth, teleport) reveals at once; a held bucket never takes the near
// escape again; a bucket at collider reach reveals whatever the gate says; a
// revealed bucket never consults again; no gate keeps the historical immediate
// cull.

import { describe, expect, it } from 'vitest';
import {
  FOLIAGE_BUCKET_REVEAL_NEAR_FRACTION,
  FOLIAGE_BUCKET_REVEAL_REACH,
  type FoliageBucketRevealState,
  foliageBucketReveal,
  foliageBucketVisible,
} from '../src/render/foliage_bucket_reveal_core';
import { createRevealGateCore } from '../src/render/reveal_gate_core';

const FOG = 400;
const NEAR = FOG * FOLIAGE_BUCKET_REVEAL_NEAR_FRACTION;

const state = (
  key = 'bark|instanced+color|color:4,normal:3,position:3',
): FoliageBucketRevealState => ({
  key,
  revealed: false,
  held: false,
});

/** A gate that holds every key until the test settles it, and records the
 *  requests so a re-request is visible. */
function heldGate() {
  const requests: string[] = [];
  const gate = createRevealGateCore((key) => {
    requests.push(key);
  });
  return { gate, requests };
}

describe('foliage bucket reveal policy', () => {
  it('holds a far bucket on its first reveal and requests its compile once', () => {
    const { gate, requests } = heldGate();
    const s = state();
    expect(foliageBucketReveal(true, FOG - 20, FOG, s, gate)).toBe('held');
    expect(foliageBucketVisible(true, FOG - 20, FOG, s, gate)).toBe(false);
    expect(s.held).toBe(true);
    expect(s.revealed).toBe(false);
    expect(requests).toEqual([s.key]);
  });

  it('reveals the held bucket once the gate settles, and never consults again', () => {
    const { gate, requests } = heldGate();
    const s = state();
    expect(foliageBucketVisible(true, FOG - 20, FOG, s, gate)).toBe(false);
    gate.settle(s.key);
    expect(foliageBucketVisible(true, FOG - 20, FOG, s, gate)).toBe(true);
    expect(s.revealed).toBe(true);
    // Cull it out and back in: a revealed bucket is a plain cull flip, so the
    // gate is neither consulted nor re-requested (a hide-then-show between
    // frames would move three's counted light set).
    expect(foliageBucketVisible(false, FOG - 20, FOG, s, gate)).toBe(false);
    expect(foliageBucketVisible(true, FOG - 20, FOG, s, gate)).toBe(true);
    expect(requests).toEqual([s.key]);
  });

  it('reveals a bucket already inside half the fog on its first consult', () => {
    const { gate, requests } = heldGate();
    const s = state();
    expect(foliageBucketVisible(true, NEAR - 1, FOG, s, gate)).toBe(true);
    expect(s.revealed).toBe(true);
    expect(requests).toEqual([]);
  });

  it('denies the near escape to a bucket the gate already holds', () => {
    const { gate } = heldGate();
    const s = state();
    expect(foliageBucketVisible(true, FOG - 20, FOG, s, gate)).toBe(false);
    expect(s.held).toBe(true);
    // The fog opens after an arrival and the bucket crosses the near line
    // mid-compile: only the settle may reveal it now.
    expect(foliageBucketReveal(true, NEAR - 1, FOG, s, gate)).toBe('held');
  });

  it('reveals at the collider reach floor even while held', () => {
    const { gate } = heldGate();
    const s = state();
    expect(foliageBucketVisible(true, FOG - 20, FOG, s, gate)).toBe(false);
    expect(s.held).toBe(true);
    expect(foliageBucketReveal(true, FOLIAGE_BUCKET_REVEAL_REACH, FOG, s, gate)).toBe('revealed');
    // The floor is absolute: it also survives a fog clamped tighter than it.
    const clamped = state();
    clamped.held = true;
    expect(foliageBucketReveal(true, FOLIAGE_BUCKET_REVEAL_REACH, 20, clamped, gate)).toBe(
      'revealed',
    );
  });

  it('never reveals a bucket its own cull hides, and latches nothing', () => {
    const { gate, requests } = heldGate();
    const s = state();
    expect(foliageBucketReveal(false, 10, FOG, s, gate)).toBe('hidden');
    expect(foliageBucketVisible(false, 10, FOG, s, gate)).toBe(false);
    expect(s.revealed).toBe(false);
    expect(s.held).toBe(false);
    expect(requests).toEqual([]);
  });

  it('keeps the historical immediate cull with no gate', () => {
    const s = state();
    expect(foliageBucketVisible(true, FOG - 20, FOG, s, null)).toBe(true);
    expect(foliageBucketVisible(false, FOG - 20, FOG, s, null)).toBe(false);
    expect(s.held).toBe(false);
  });

  it('gates each program key on its own, so one species settling frees only it', () => {
    const { gate } = heldGate();
    const bark = state('bark|instanced+color|position:3');
    const leaves = state('leaves|instanced+color|position:3');
    expect(foliageBucketVisible(true, FOG - 20, FOG, bark, gate)).toBe(false);
    expect(foliageBucketVisible(true, FOG - 20, FOG, leaves, gate)).toBe(false);
    gate.settle(bark.key);
    expect(foliageBucketVisible(true, FOG - 20, FOG, bark, gate)).toBe(true);
    expect(foliageBucketVisible(true, FOG - 20, FOG, leaves, gate)).toBe(false);
  });
});
