// Pure-leaf pins for Gravefire (src/sim/nythraxis_gravefire.ts): the tuning
// literals the guide quotes, the sliding lit window, the point test, the cap,
// and the reconnect-safe readout.

import { describe, expect, it } from 'vitest';
import {
  activeNythraxisGravefires,
  igniteNythraxisGravefire,
  NYTHRAXIS_GRAVEFIRE_CAP,
  NYTHRAXIS_GRAVEFIRE_FIRST_SECONDS,
  NYTHRAXIS_GRAVEFIRE_HALF_WIDTH,
  NYTHRAXIS_GRAVEFIRE_LENGTH,
  NYTHRAXIS_GRAVEFIRE_SPEED,
  type NythraxisGravefire,
  nythraxisGravefireBurnSeconds,
  nythraxisGravefireCadence,
  nythraxisGravefireDirection,
  nythraxisGravefireExtent,
  nythraxisGravefireId,
  nythraxisGravefireLifetime,
  nythraxisGravefireTickMaxHp,
  pointInNythraxisGravefire,
} from '../src/sim/nythraxis_gravefire';

describe('Nythraxis Gravefire', () => {
  it('pins the player-facing tuning literally on both difficulties', () => {
    expect([nythraxisGravefireCadence('normal'), nythraxisGravefireCadence('heroic')]).toEqual([
      12, 10,
    ]);
    expect([
      nythraxisGravefireBurnSeconds('normal'),
      nythraxisGravefireBurnSeconds('heroic'),
    ]).toEqual([6, 8]);
    expect([nythraxisGravefireTickMaxHp('normal'), nythraxisGravefireTickMaxHp('heroic')]).toEqual([
      0.1, 0.15,
    ]);
    expect(NYTHRAXIS_GRAVEFIRE_SPEED).toBe(12);
    expect(NYTHRAXIS_GRAVEFIRE_LENGTH).toBe(40);
    expect(NYTHRAXIS_GRAVEFIRE_HALF_WIDTH).toBe(1.5);
    expect(NYTHRAXIS_GRAVEFIRE_FIRST_SECONDS).toBe(9);
    expect(NYTHRAXIS_GRAVEFIRE_CAP).toBe(6);
    // 40 yd at 12 yd/s plus the burn: the whole line is gone in 9.33 s (normal).
    expect(nythraxisGravefireLifetime(6)).toBeCloseTo(40 / 12 + 6, 6);
  });

  it('slides the lit window along the line: head first, tail one burn behind', () => {
    // Live from ignition (the readout carries it at once), reaching nobody yet.
    expect(nythraxisGravefireExtent(0, 6)).toEqual({ tail: 0, head: 0 });
    expect(nythraxisGravefireExtent(1, 6)).toEqual({ tail: 0, head: 12 });
    // Fully lit once the head reaches the end, before the tail starts moving.
    expect(nythraxisGravefireExtent(4, 6)).toEqual({ tail: 0, head: 40 });
    // The tail chases the head off the end.
    expect(nythraxisGravefireExtent(7, 6)).toEqual({ tail: 12, head: 40 });
    expect(nythraxisGravefireExtent(40 / 12 + 6, 6)).toBeNull();
    expect(nythraxisGravefireExtent(-1, 6)).toBeNull();
    // Heroic burns longer, so the window is wider at the same moment.
    expect(nythraxisGravefireExtent(7, 8)).toEqual({ tail: 0, head: 40 });
  });

  it('runs from the origin toward the target, and +z when they coincide', () => {
    expect(nythraxisGravefireDirection({ x: 0, z: 0 }, { x: 3, z: 4 })).toEqual({
      dirX: 0.6,
      dirZ: 0.8,
    });
    expect(nythraxisGravefireDirection({ x: 5, z: 5 }, { x: 5, z: 5 })).toEqual({
      dirX: 0,
      dirZ: 1,
    });
  });

  it('burns inside the lit window and the half-width, edges inclusive', () => {
    const line = { x: 0, z: 0, dirX: 0, dirZ: 1 };
    const extent = { tail: 12, head: 36 };
    expect(pointInNythraxisGravefire(line, extent, { x: 0, z: 20 })).toBe(true);
    expect(pointInNythraxisGravefire(line, extent, { x: 1.5, z: 20 })).toBe(true);
    expect(pointInNythraxisGravefire(line, extent, { x: 1.51, z: 20 })).toBe(false);
    expect(pointInNythraxisGravefire(line, extent, { x: 0, z: 12 })).toBe(true);
    expect(pointInNythraxisGravefire(line, extent, { x: 0, z: 36 })).toBe(true);
    // Behind the tail (burnt out) and past the head (not yet lit) are safe.
    expect(pointInNythraxisGravefire(line, extent, { x: 0, z: 11.9 })).toBe(false);
    expect(pointInNythraxisGravefire(line, extent, { x: 0, z: 36.1 })).toBe(false);
    // Behind the origin is never lit.
    expect(pointInNythraxisGravefire(line, extent, { x: 0, z: -1 })).toBe(false);
  });

  it('caps the live lines oldest-first and numbers them in order', () => {
    const lines: NythraxisGravefire[] = [];
    let seq = 0;
    for (let i = 0; i < NYTHRAXIS_GRAVEFIRE_CAP + 2; i++) {
      seq = igniteNythraxisGravefire(lines, { x: 0, z: 0 }, { x: 10, z: i }, seq);
    }
    expect(seq).toBe(NYTHRAXIS_GRAVEFIRE_CAP + 2);
    expect(lines).toHaveLength(NYTHRAXIS_GRAVEFIRE_CAP);
    expect(lines[0].seq).toBe(2);
    expect(lines.every((l) => l.elapsed === 0 && l.tickTimer === 1)).toBe(true);
    expect(Math.hypot(lines[0].dirX, lines[0].dirZ)).toBeCloseTo(1, 9);
  });

  it('projects live lines with stable ids and drops burnt-out ones', () => {
    const lines: NythraxisGravefire[] = [
      { seq: 3, x: 1, z: 2, dirX: 0, dirZ: 1, elapsed: 1, tickTimer: 0.2 },
      { seq: 4, x: 1, z: 2, dirX: 1, dirZ: 0, elapsed: 20, tickTimer: 0.2 },
    ];
    const rows = activeNythraxisGravefires(9, lines, 'normal');
    expect(rows).toEqual([
      {
        id: nythraxisGravefireId(9, 3),
        sourceId: 9,
        x: 1,
        z: 2,
        dirX: 0,
        dirZ: 1,
        tail: 0,
        head: 12,
        halfWidth: 1.5,
        remaining: expect.closeTo(40 / 12 + 6 - 1, 6),
      },
    ]);
    expect(rows[0].id).toBe('9:gfl:3');
  });
});
