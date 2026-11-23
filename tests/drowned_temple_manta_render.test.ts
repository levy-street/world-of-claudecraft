// The Moonmantle Ray's effects plan (src/render/drowned_temple/temple_manta_core.ts):
// the glide wake reads its charge off its speed, the Wingbeat's ring ends where
// the gust's shove does, the cocoon dims and cracks with its ward, and a dead
// ray melts into a spreading pool of moonwater that fades out.

import { describe, expect, it } from 'vitest';
import {
  MANTA_DISSOLVE_SECONDS,
  MANTA_ID,
  MANTA_WINGBEAT_SECONDS,
  mantaCocoonFull,
  mantaCocoonLook,
  mantaDissolve,
  mantaGlideStrength,
  mantaWingbeatRadius,
  mantaWingbeatRing,
} from '../src/render/drowned_temple/temple_manta_core';
import { MOBS } from '../src/sim/data';

describe('the Moonmantle Ray effects plan', () => {
  it('keys on the frozen sentinel id', () => {
    expect(MANTA_ID).toBe('pearlguard_sentinel');
    expect(MOBS[MANTA_ID]?.name).toBe('Moonmantle Ray');
  });

  it('glides only well past its walk (the charge dashes at three times it)', () => {
    expect(mantaGlideStrength(6.5, 6.5)).toBe(0);
    expect(mantaGlideStrength(6.5 * 1.6, 6.5)).toBe(0);
    expect(mantaGlideStrength(6.5 * 3, 6.5)).toBe(1);
    expect(mantaGlideStrength(10, 0)).toBe(0);
  });

  it('the Wingbeat ring grows to the gust reach and fades out', () => {
    expect(mantaWingbeatRadius()).toBe(MOBS[MANTA_ID]?.trashKit?.wingGust?.radius);
    const start = mantaWingbeatRing(0);
    const end = mantaWingbeatRing(MANTA_WINGBEAT_SECONDS);
    expect(start.alpha).toBe(1);
    expect(end.reach).toBeCloseTo(1, 9);
    expect(end.alpha).toBe(0);
    expect(mantaWingbeatRing(0.3).reach).toBeGreaterThan(start.reach);
  });

  it('the cocoon glows whole and cracks open as its ward is spent', () => {
    const full = mantaCocoonFull(1000);
    expect(full).toBe(250);
    expect(mantaCocoonLook(full, full)).toEqual({ glow: 1, crack: 0 });
    const half = mantaCocoonLook(full / 2, full);
    expect(half.crack).toBeCloseTo(0.5, 9);
    expect(mantaCocoonLook(0, full).crack).toBe(1);
  });

  it('melts into a pool that spreads, then gives up its light', () => {
    expect(mantaDissolve(0).alpha).toBe(0);
    expect(mantaDissolve(0.5).alpha).toBeGreaterThan(0.5);
    expect(mantaDissolve(MANTA_DISSOLVE_SECONDS).alpha).toBe(0);
    expect(mantaDissolve(MANTA_DISSOLVE_SECONDS).spread).toBeGreaterThan(mantaDissolve(0).spread);
  });
});
