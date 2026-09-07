import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { sendOnlineMovementFrame } from '../src/game/online_movement_frame';
import { emptyMoveInput } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

function client() {
  return { setMouselookFacing: vi.fn() };
}

describe('sendOnlineMovementFrame', () => {
  it('mirrors the facing onto the wire and reports the sampled frame', () => {
    const online = client();
    const sampler = { advance: vi.fn(() => true) };
    const mi = emptyMoveInput();

    expect(sendOnlineMovementFrame(online, sampler, 0.016, mi, 0.8, 50, true)).toBe(true);
    expect(online.setMouselookFacing).toHaveBeenCalledWith(0.8);
    expect(sampler.advance).toHaveBeenCalledWith(online, 0.016, mi, 0.8, 50, true);
  });

  it('still mirrors the facing when the sampler emits nothing this frame', () => {
    const online = client();
    const sampler = { advance: vi.fn(() => false) };

    expect(sendOnlineMovementFrame(online, sampler, 0.016, emptyMoveInput(), null, 50, false)).toBe(
      false,
    );
    expect(online.setMouselookFacing).toHaveBeenCalledWith(null);
  });

  it('marks input telemetry only after the online frame path reports an emission', () => {
    const source = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
    const send = source.indexOf('const movementFrameEmitted = sendOnlineMovementFrame(');
    const mark = source.indexOf(
      'if (movementFrameEmitted) perf.markInputSent(performance.now());',
      send,
    );
    const release = source.indexOf('if (movementFrameEmitted) pendingReleaseFacing = null;', send);

    expect(send).toBeGreaterThanOrEqual(0);
    expect(mark).toBeGreaterThan(send);
    expect(release).toBeGreaterThan(mark);
  });
});
