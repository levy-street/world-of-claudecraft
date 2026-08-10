import { describe, expect, it } from 'vitest';
import { stepLichHeartbeat } from '../src/render/lich_audio_state_core';

describe('Lich heartbeat state', () => {
  it('waits 2.4 seconds, then repeats every 3.2 seconds', () => {
    const entered = stepLichHeartbeat(0, 10, true, true);
    expect(entered).toEqual({ nextAt: 12.4, play: false });

    expect(stepLichHeartbeat(entered.nextAt, 12.39, true, true).play).toBe(false);
    const first = stepLichHeartbeat(entered.nextAt, 12.4, true, true);
    expect(first.play).toBe(true);
    expect(first.nextAt).toBeCloseTo(15.6);

    expect(stepLichHeartbeat(first.nextAt, 15.59, true, true).play).toBe(false);
    const second = stepLichHeartbeat(first.nextAt, first.nextAt, true, true);
    expect(second.play).toBe(true);
    expect(second.nextAt).toBeCloseTo(18.8);
  });

  it('stays silent while inaudible and resets after death or leaving the form', () => {
    expect(stepLichHeartbeat(2.4, 5, true, false)).toEqual({ nextAt: 2.4, play: false });
    expect(stepLichHeartbeat(2.4, 5, false, true)).toEqual({ nextAt: 0, play: false });
    expect(stepLichHeartbeat(0, 6, true, true)).toEqual({ nextAt: 8.4, play: false });
  });
});
