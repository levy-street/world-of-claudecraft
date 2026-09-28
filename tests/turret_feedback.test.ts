import { describe, expect, it } from 'vitest';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import {
  recordTurretFeedback,
  TURRET_FEEDBACK_LIMIT,
  type TurretFeedback,
  turretFeedbackSince,
} from '../src/sim/minigames/turret_feedback';

const event = (wave: number): TurretEvent => ({ type: 'waveStart', wave, count: 1 });

describe('the turret feedback ring', () => {
  it('numbers events from the next seq with their tick, in order, and freezes them', () => {
    const ring: TurretFeedback[] = [];
    const next = recordTurretFeedback(ring, 1, 7, [event(0), event(1)]);
    expect(next).toBe(3);
    expect(ring.map((f) => [f.seq, f.tick, f.event])).toEqual([
      [1, 7, event(0)],
      [2, 7, event(1)],
    ]);
    expect(Object.isFrozen(ring[0])).toBe(true);
    expect(Object.isFrozen(ring[0].event)).toBe(true);
    expect(recordTurretFeedback(ring, next, 8, [])).toBe(next);
    expect(ring).toHaveLength(2);
  });

  it('keeps only the newest entries once past the limit', () => {
    const ring: TurretFeedback[] = [];
    let next = recordTurretFeedback(ring, 1, 0, [event(0), event(1)]);
    const burst = Array.from({ length: TURRET_FEEDBACK_LIMIT + 5 }, (_, i) => event(i + 2));
    next = recordTurretFeedback(ring, next, 1, burst);
    expect(next).toBe(3 + burst.length);
    expect(ring).toHaveLength(TURRET_FEEDBACK_LIMIT);
    expect(ring[0].seq).toBe(next - TURRET_FEEDBACK_LIMIT);
    expect(ring.map((f) => f.event)).toEqual(burst.slice(-TURRET_FEEDBACK_LIMIT));
  });

  it('hands a consumer each entry once, by seq', () => {
    const ring: TurretFeedback[] = [];
    recordTurretFeedback(ring, 1, 0, [event(0), event(1), event(2)]);
    expect(turretFeedbackSince(ring, 0).map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(turretFeedbackSince(ring, 2).map((f) => f.seq)).toEqual([3]);
    expect(turretFeedbackSince(ring, 3)).toEqual([]);
    expect(turretFeedbackSince([], 5)).toEqual([]);
    expect(turretFeedbackSince(ring, 0)).not.toBe(ring);
  });

  it('shows a consumer that fell behind the ring where the gap is', () => {
    const ring: TurretFeedback[] = [];
    const burst = Array.from({ length: TURRET_FEEDBACK_LIMIT + 3 }, (_, i) => event(i));
    recordTurretFeedback(ring, 1, 0, burst);
    const fresh = turretFeedbackSince(ring, 1);
    expect(fresh).toHaveLength(TURRET_FEEDBACK_LIMIT);
    expect(fresh[0].seq).toBeGreaterThan(1 + 1);
  });
});
