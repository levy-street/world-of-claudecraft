// The Log Out countdown's pure presentation mapping
// (src/ui/logout_countdown_view.ts).
import { describe, expect, it } from 'vitest';
import { LOGOUT_COUNTDOWN_PLURAL, logoutCountdownAction } from '../src/ui/logout_countdown_view';

describe('logoutCountdownAction', () => {
  it('started shows the countdown with the server-supplied seconds, and announces it', () => {
    expect(logoutCountdownAction({ type: 'logout', phase: 'started', seconds: 30 })).toEqual({
      kind: 'show',
      seconds: 30,
      announce: true,
    });
  });

  it('each later beat moves the countdown on without announcing it again', () => {
    expect(logoutCountdownAction({ type: 'logout', phase: 'countdown', seconds: 29 })).toEqual({
      kind: 'show',
      seconds: 29,
      announce: false,
    });
  });

  it('completed takes it down silently', () => {
    expect(logoutCountdownAction({ type: 'logout', phase: 'completed' })).toEqual({
      kind: 'hide',
      errorKey: null,
    });
  });

  it('an interruption by damage takes it down and says why', () => {
    expect(
      logoutCountdownAction({ type: 'logout', phase: 'cancelled', reason: 'damaged' }),
    ).toEqual({ kind: 'hide', errorKey: 'hudChrome.logout.interrupted' });
  });

  it('a cancel by the player and a dropped connection take it down without a line', () => {
    for (const reason of ['cancelled', 'disconnected'] as const) {
      expect(logoutCountdownAction({ type: 'logout', phase: 'cancelled', reason })).toEqual({
        kind: 'hide',
        errorKey: null,
      });
    }
  });

  it('names the plural family the countdown line is drawn from', () => {
    expect(LOGOUT_COUNTDOWN_PLURAL).toBe('hudChrome.plurals.logoutCountdown');
  });
});
