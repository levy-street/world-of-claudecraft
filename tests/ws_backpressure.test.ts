import { describe, expect, it } from 'vitest';
import { isBackpressureExceeded, WS_BACKPRESSURE_LIMIT_BYTES } from '../server/ws_backpressure';

describe('isBackpressureExceeded', () => {
  it('passes a healthy, draining socket', () => {
    expect(isBackpressureExceeded(0)).toBe(false);
    expect(isBackpressureExceeded(16 * 1024)).toBe(false);
    expect(isBackpressureExceeded(WS_BACKPRESSURE_LIMIT_BYTES)).toBe(false);
  });

  it('trips once the unflushed buffer climbs past the limit', () => {
    expect(isBackpressureExceeded(WS_BACKPRESSURE_LIMIT_BYTES + 1)).toBe(true);
  });

  it('honors a caller-supplied limit', () => {
    expect(isBackpressureExceeded(100, 64)).toBe(true);
    expect(isBackpressureExceeded(64, 64)).toBe(false);
  });

  it('treats a default limit far above one legitimate inbound frame (16 KiB maxPayload)', () => {
    expect(WS_BACKPRESSURE_LIMIT_BYTES).toBeGreaterThan(16 * 1024 * 16);
  });
});
