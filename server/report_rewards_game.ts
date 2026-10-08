import type { ClientSession } from './game';
import type { TickProfiler } from './tick_profiler';
import { isBackpressureExceeded } from './ws_backpressure';

/** The caller retains its guarded transport; no notice is acknowledged for a
 * socket that left, is reconnecting, or cannot safely accept another frame. */
export function createSystemNoticeSender(send: (session: ClientSession, frame: unknown) => void) {
  return (session: ClientSession, text: string): boolean => {
    if (
      session.left ||
      session.linkdead ||
      session.ws.readyState !== 1 ||
      isBackpressureExceeded(session.ws.bufferedAmount)
    )
      return false;
    send(session, { t: 'events', list: [{ type: 'log', text, color: '#ffd100' }] });
    return true;
  };
}

/** Bill synchronous slices, never the awaited database round trip, to the
 * recurring job's registered world-loop phase. */
export function createReportRewardsMeasure(profiler: () => Pick<TickProfiler, 'add'>) {
  return <T>(work: () => T): T => {
    const start = performance.now();
    try {
      return work();
    } finally {
      profiler().add('reportRewards', performance.now() - start);
    }
  };
}
