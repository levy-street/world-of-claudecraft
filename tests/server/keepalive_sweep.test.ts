import { describe, expect, it } from 'vitest';
import {
  KEEPALIVE_STALL_FACTOR,
  keepaliveSweepDelayed,
  terminateIntoGrace,
} from '../../server/keepalive_sweep';

describe('keepalive sweep stall detection', () => {
  it('pins the stall factor to the literal 1.5', () => {
    // A constant compared against itself proves nothing, so assert the literal:
    // changing the threshold then has to be a deliberate edit that reddens this pin.
    expect(KEEPALIVE_STALL_FACTOR).toBe(1.5);
  });

  it('does not flag an on-time sweep one interval apart', () => {
    // A 30000 ms gap at a 30000 ms interval is the nominal cadence, well under the
    // 45000 ms stall threshold.
    expect(keepaliveSweepDelayed(30_000, 0, 30_000)).toBe(false);
  });

  it('treats the exact 45000 ms boundary as on time and 45001 ms as delayed', () => {
    // The threshold is 1.5 x 30000 = 45000, compared with a strict greater-than, so
    // the boundary sample itself is not a stall but one millisecond past it is.
    expect(keepaliveSweepDelayed(45_000, 0, 30_000)).toBe(false);
    expect(keepaliveSweepDelayed(45_001, 0, 30_000)).toBe(true);
  });

  it('flags a sweep that fired far late', () => {
    // A 70000 ms gap is well beyond the 45000 ms threshold: the process stalled.
    expect(keepaliveSweepDelayed(70_000, 0, 30_000)).toBe(true);
  });
});

describe('terminateIntoGrace (the shared reap)', () => {
  it('terminates the current socket, then hands that same socket to socketClosed', () => {
    const order: string[] = [];
    const ws = { terminate: () => order.push('terminate') };
    const session = { ws };
    const seen: unknown[] = [];
    terminateIntoGrace(session, (s, closedWs) => {
      order.push('socketClosed');
      seen.push(s, closedWs);
      return true;
    });
    expect(order).toEqual(['terminate', 'socketClosed']);
    expect(seen).toEqual([session, ws]);
  });

  it('still enters the grace when terminate throws on an already torn-down socket', () => {
    const ws = {
      terminate: () => {
        throw new Error('socket already destroyed');
      },
    };
    let closed: unknown = null;
    terminateIntoGrace({ ws }, (_s, closedWs) => {
      closed = closedWs;
      return true;
    });
    expect(closed).toBe(ws);
  });
});
