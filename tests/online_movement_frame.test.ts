import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { sendOnlineMovementFrame } from '../src/game/online_movement_frame';
import { emptyMoveInput } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

function client(version: 1 | 2, flushResult: boolean) {
  return {
    movementWireVersion: version,
    setMouselookFacing: vi.fn(),
    flushInput: vi.fn(() => flushResult),
  };
}

describe('sendOnlineMovementFrame', () => {
  it('reports a sampled v2 frame and skips the legacy flush', () => {
    const online = client(2, false);
    const sampler = { advance: vi.fn(() => true) };
    const mi = emptyMoveInput();

    expect(sendOnlineMovementFrame(online, sampler, 0.016, mi, 0.8, 50, true)).toBe(true);
    expect(online.setMouselookFacing).toHaveBeenCalledWith(0.8);
    expect(online.flushInput).not.toHaveBeenCalled();
    expect(sampler.advance).toHaveBeenCalledWith(online, 0.016, mi, 0.8, 50, true);
  });

  it('reports an accepted legacy flush when the sampler is inactive', () => {
    const online = client(1, true);
    const sampler = { advance: vi.fn(() => false) };

    expect(sendOnlineMovementFrame(online, sampler, 0.016, emptyMoveInput(), null, 50, false)).toBe(
      true,
    );
    expect(online.flushInput).toHaveBeenCalledWith(50);
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
