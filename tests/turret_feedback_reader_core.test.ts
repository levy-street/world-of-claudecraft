import { describe, expect, it } from 'vitest';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import { TurretFeedbackReader } from '../src/ui/hud/vehicle/turret_feedback_reader_core';
import type { TurretSessionView } from '../src/world_api/vehicles';

const event: TurretEvent = { type: 'waveCleared', wave: 0 };

function session(seqs: number[], startTick = 0): TurretSessionView {
  return {
    origin: { x: 0, y: 0, z: 0 },
    defense: { startTick } as TurretSessionView['defense'],
    waveCount: 6,
    monstersLeft: 0,
    feedback: seqs.map((seq): TurretFeedback => ({ seq, tick: seq, event })),
  };
}

const seqs = (entries: readonly TurretFeedback[]) => entries.map((e) => e.seq);

describe('the turret feedback reader', () => {
  it('hands out each entry once, oldest first', () => {
    const reader = new TurretFeedbackReader();
    expect(seqs(reader.read(session([1, 2])))).toEqual([1, 2]);
    expect(reader.newSeat).toBe(true);
    expect(reader.read(session([1, 2]))).toHaveLength(0);
    expect(reader.newSeat).toBe(false);
    expect(seqs(reader.read(session([2, 3, 4])))).toEqual([3, 4]);
  });

  it('starts over with a new start tick, even when the new ring runs past the old sequence', () => {
    const reader = new TurretFeedbackReader();
    reader.read(session([1, 2, 3]));
    expect(seqs(reader.read(session([1, 2, 3, 4], 40)))).toEqual([1, 2, 3, 4]);
    expect(reader.newSeat).toBe(true);
  });

  it('starts over when the sequence goes back on the same start tick', () => {
    const reader = new TurretFeedbackReader();
    reader.read(session([1, 2, 3]));
    expect(seqs(reader.read(session([1])))).toEqual([1]);
    expect(reader.newSeat).toBe(true);
  });

  it('reads an empty ring as nothing new', () => {
    const reader = new TurretFeedbackReader();
    expect(reader.read(session([]))).toHaveLength(0);
    expect(reader.newSeat).toBe(true);
  });
});
