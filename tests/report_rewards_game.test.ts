import { describe, expect, it, vi } from 'vitest';
import type { ClientSession } from '../server/game';
import {
  createReportRewardsMeasure,
  createSystemNoticeSender,
} from '../server/report_rewards_game';
import { WS_BACKPRESSURE_LIMIT_BYTES } from '../server/ws_backpressure';

describe('report reward game ports', () => {
  it('acknowledges only a live socket and sends the exact log wire shape', () => {
    const send = vi.fn();
    const notice = createSystemNoticeSender(send);
    const session = {
      left: false,
      linkdead: false,
      ws: { readyState: 1, bufferedAmount: 0 },
    } as ClientSession;
    expect(notice(session, 'An account you reported has been banned')).toBe(true);
    expect(send).toHaveBeenCalledWith(session, {
      t: 'events',
      list: [{ type: 'log', text: 'An account you reported has been banned', color: '#ffd100' }],
    });
    session.linkdead = true;
    expect(notice(session, 'An account you reported has been banned')).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { left: true, linkdead: false, readyState: 1, bufferedAmount: 0 },
    { left: false, linkdead: true, readyState: 1, bufferedAmount: 0 },
    { left: false, linkdead: false, readyState: 3, bufferedAmount: 0 },
    {
      left: false,
      linkdead: false,
      readyState: 1,
      bufferedAmount: WS_BACKPRESSURE_LIMIT_BYTES + 1,
    },
  ])('keeps a notice pending for an unavailable socket: %j', (state) => {
    const send = vi.fn();
    const session = { ...state, ws: state } as unknown as ClientSession;
    expect(createSystemNoticeSender(send)(session, 'An account you reported has been banned')).toBe(
      false,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('bills synchronous work even when the booking callback throws', () => {
    const add = vi.fn();
    const measure = createReportRewardsMeasure(() => ({ add }));
    expect(() =>
      measure(() => {
        throw new Error('failed');
      }),
    ).toThrow('failed');
    expect(add).toHaveBeenCalledWith('reportRewards', expect.any(Number));
  });
});
