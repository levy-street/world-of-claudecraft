// The client half of the Log Out button (src/net/logout_flow.ts): the client
// asks, the server answers, and only a `completed` answer (or the legacy
// fallback for a server that never answers) ends the session.
import { describe, expect, it } from 'vitest';
import { LOGOUT_ACK_TIMEOUT_MS, LogoutFlow } from '../src/net/logout_flow';

function harness(open = true) {
  const sent: Array<{ t: 'logout'; cancel?: true }> = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 1;
  let finished = 0;
  const state = { open };
  const flow = new LogoutFlow({
    send: (frame) => {
      if (!state.open) return false;
      sent.push(frame);
      return true;
    },
    finish: () => {
      finished++;
    },
    setTimer: (run, ms) => {
      timers.set(nextTimer, { run, ms });
      return nextTimer++;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
  });
  const fireTimers = (): void => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.run();
    }
  };
  return { flow, sent, timers, state, fireTimers, finished: () => finished };
}

describe('the Log Out request flow', () => {
  it('asks the server and does not end the session by itself', () => {
    const h = harness();
    h.flow.request();
    expect(h.sent).toEqual([{ t: 'logout' }]);
    expect(h.flow.active).toBe(true);
    expect(h.finished()).toBe(0);
  });

  it('an instant logout: the server answers completed and the session ends once', () => {
    const h = harness();
    h.flow.request();
    h.flow.onEvent({ type: 'logout', phase: 'completed' });
    expect(h.finished()).toBe(1);
    expect(h.flow.active).toBe(false);
    expect(h.timers.size).toBe(0);
    // Nothing after that can end it twice.
    h.flow.onEvent({ type: 'logout', phase: 'completed' });
    h.fireTimers();
    expect(h.finished()).toBe(1);
  });

  it('a countdown: stays in the world until the server says completed', () => {
    const h = harness();
    h.flow.request();
    h.flow.onEvent({ type: 'logout', phase: 'started', seconds: 30 });
    // The legacy fallback is disarmed once the server has answered.
    expect(h.timers.size).toBe(0);
    expect(h.flow.active).toBe(true);
    expect(h.finished()).toBe(0);
    h.flow.onEvent({ type: 'logout', phase: 'completed' });
    expect(h.finished()).toBe(1);
  });

  it('a second press before the server has answered sends nothing more', () => {
    const h = harness();
    h.flow.request();
    h.flow.request();
    expect(h.sent).toEqual([{ t: 'logout' }]);
  });

  it('pressing Log Out again while the countdown is up cancels it', () => {
    const h = harness();
    h.flow.request();
    h.flow.onEvent({ type: 'logout', phase: 'started', seconds: 10 });
    h.flow.request();
    expect(h.sent).toEqual([{ t: 'logout' }, { t: 'logout', cancel: true }]);
    expect(h.finished()).toBe(0);
  });

  it('a longer wait announced mid countdown keeps the flow counting', () => {
    const h = harness();
    h.flow.request();
    h.flow.onEvent({ type: 'logout', phase: 'started', seconds: 10 });
    h.flow.onEvent({ type: 'logout', phase: 'started', seconds: 25 });
    expect(h.flow.active).toBe(true);
    expect(h.finished()).toBe(0);
  });

  it('the Cancel button sends a cancel frame; the server confirms and the button works again', () => {
    const h = harness();
    h.flow.request();
    h.flow.onEvent({ type: 'logout', phase: 'started', seconds: 10 });
    h.flow.cancel();
    expect(h.sent.at(-1)).toEqual({ t: 'logout', cancel: true });
    expect(h.flow.active).toBe(true); // until the server confirms
    h.flow.onEvent({ type: 'logout', phase: 'cancelled', reason: 'cancelled' });
    expect(h.flow.active).toBe(false);
    expect(h.finished()).toBe(0);
    h.flow.request();
    expect(h.sent.at(-1)).toEqual({ t: 'logout' });
  });

  it('a cancel with nothing in flight sends nothing', () => {
    const h = harness();
    h.flow.cancel();
    expect(h.sent).toEqual([]);
  });

  it('damage interrupting the countdown returns the flow to idle without ending the session', () => {
    const h = harness();
    h.flow.request();
    h.flow.onEvent({ type: 'logout', phase: 'started', seconds: 15 });
    h.flow.onEvent({ type: 'logout', phase: 'cancelled', reason: 'damaged' });
    expect(h.flow.active).toBe(false);
    expect(h.finished()).toBe(0);
  });

  it('a server from before the countdown never answers: the fallback ends the session', () => {
    const h = harness();
    h.flow.request();
    expect([...h.timers.values()].map((timer) => timer.ms)).toEqual([LOGOUT_ACK_TIMEOUT_MS]);
    expect(LOGOUT_ACK_TIMEOUT_MS).toBe(5000);
    h.fireTimers();
    expect(h.finished()).toBe(1);
  });

  it('an answer that arrives after the fallback already ended the session changes nothing', () => {
    const h = harness();
    h.flow.request();
    h.fireTimers();
    h.flow.onEvent({ type: 'logout', phase: 'started', seconds: 30 });
    h.flow.onEvent({ type: 'logout', phase: 'completed' });
    expect(h.finished()).toBe(1);
    expect(h.flow.active).toBe(false);
  });

  it('with no open socket there is nothing to wait on: the session ends at once', () => {
    const h = harness(false);
    h.flow.request();
    expect(h.finished()).toBe(1);
    expect(h.timers.size).toBe(0);
  });

  it('a dropped connection abandons the countdown and leaves the reconnect to run', () => {
    const h = harness();
    h.flow.request();
    h.flow.onEvent({ type: 'logout', phase: 'started', seconds: 30 });
    expect(h.flow.onSocketClosed()).toBe(true);
    expect(h.flow.active).toBe(false);
    expect(h.finished()).toBe(0);
    // An ordinary drop with no logout in flight reports nothing.
    expect(h.flow.onSocketClosed()).toBe(false);
  });

  it('a close before the server answered finishes the logout: no reconnect into the world', () => {
    // A server from before the countdown answers a held logout by closing the socket.
    const h = harness();
    h.flow.request();
    expect(h.flow.onSocketClosed()).toBe(false);
    expect(h.finished()).toBe(1);
    h.fireTimers();
    expect(h.finished()).toBe(1);
  });
});
