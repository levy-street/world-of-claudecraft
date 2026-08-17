import { describe, expect, it } from 'vitest';
import {
  INPUT_SEND_BACKPRESSURE_LIMIT_BYTES,
  INPUT_SEND_MAX_FRAME_BYTES,
  isInputSendBackpressured,
} from '../src/net/send_backpressure';

describe('isInputSendBackpressured', () => {
  it('passes a healthy, draining socket', () => {
    expect(isInputSendBackpressured(0)).toBe(false);
    expect(isInputSendBackpressured(200)).toBe(false);
    expect(isInputSendBackpressured(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES)).toBe(false);
  });

  it('trips once the local unflushed buffer climbs past the limit', () => {
    expect(isInputSendBackpressured(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1)).toBe(true);
  });

  it('honors a caller-supplied limit', () => {
    expect(isInputSendBackpressured(100, 64)).toBe(true);
    expect(isInputSendBackpressured(64, 64)).toBe(false);
  });

  it('leaves headroom for more than 100 maximum-sized input frames', () => {
    const fullInputFrame = JSON.stringify({
      t: 'input',
      seq: Number.MAX_SAFE_INTEGER,
      mi: { f: 1, b: 1, tl: 1, tr: 1, sl: 1, sr: 1, j: 1, dv: 1, sf: 1, ss: 1 },
      facing: Math.PI * 2,
    });
    expect(new TextEncoder().encode(fullInputFrame).byteLength).toBeLessThanOrEqual(
      INPUT_SEND_MAX_FRAME_BYTES,
    );
    expect(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES).toBeGreaterThan(INPUT_SEND_MAX_FRAME_BYTES * 100);
  });

  it('bounds an input admission at the threshold to one additional frame', () => {
    expect(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES).toBe(64 * 1024);
    expect(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + INPUT_SEND_MAX_FRAME_BYTES).toBeLessThan(
      65 * 1024,
    );
  });
});
