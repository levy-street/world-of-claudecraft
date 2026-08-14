import { describe, expect, it } from 'vitest';
import {
  applyCheaterMark,
  CHEATER_MARK_MAX_HOURS,
  cheaterMarkHoursToSeconds,
  liftCheaterMark,
} from '../../src/admin/cheater_mark_form';
import { t } from '../../src/admin/i18n';
import { en } from '../../src/admin/i18n.en';
import { CHEATER_MARK_MAX_SECONDS } from '../../src/sim/moderation';

// Pure validation + endpoint/body shaping for the Cheater mark panel. Runs in the
// default Node env (no DOM): pins the hours-to-seconds conversion, the bounds, and
// the request each action sends (the moderation_actions.test.ts pattern).

describe('cheater_mark_form', () => {
  it('converts whole hours to seconds', () => {
    expect(cheaterMarkHoursToSeconds(1)).toBe(3600);
    expect(cheaterMarkHoursToSeconds(6)).toBe(21600);
    expect(cheaterMarkHoursToSeconds(CHEATER_MARK_MAX_HOURS)).toBe(CHEATER_MARK_MAX_SECONDS);
  });

  it('rejects everything moderation_db would clamp or refuse', () => {
    expect(cheaterMarkHoursToSeconds(0)).toBeNull();
    expect(cheaterMarkHoursToSeconds(-1)).toBeNull();
    expect(cheaterMarkHoursToSeconds(1.5)).toBeNull();
    expect(cheaterMarkHoursToSeconds(CHEATER_MARK_MAX_HOURS + 1)).toBeNull();
    expect(cheaterMarkHoursToSeconds(Number.NaN)).toBeNull();
    expect(cheaterMarkHoursToSeconds(undefined)).toBeNull();
    expect(cheaterMarkHoursToSeconds('6')).toBeNull();
  });

  it('keeps the form ceiling equal to the sim ceiling', () => {
    // The admin SPA cannot import from src/sim (src/admin/CLAUDE.md), so the
    // 100-hour bound is restated in cheater_mark_form.ts. This pin fails loudly
    // if either side moves alone.
    expect(CHEATER_MARK_MAX_HOURS * 3600).toBe(CHEATER_MARK_MAX_SECONDS);
  });

  it('parameterizes the duration alert with the shared ceiling, not a literal', () => {
    // Same contract as alert.restoreCountRange: the prose carries {max} and the
    // call site (CheaterMarkControls) threads CHEATER_MARK_MAX_HOURS in, so moving
    // the ceiling can never leave a stale number in front of an operator.
    const template = (en as Record<string, string>)['alert.cheaterMarkDurationInvalid'];
    expect(template).toContain('{max}');
    expect(template).not.toContain(String(CHEATER_MARK_MAX_HOURS));
    expect(t('alert.cheaterMarkDurationInvalid', { max: CHEATER_MARK_MAX_HOURS })).toContain(
      String(CHEATER_MARK_MAX_HOURS),
    );
  });

  it('requires a note for both actions', () => {
    expect(applyCheaterMark(5, 6, '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(liftCheaterMark(5, '')).toEqual({ errorKey: 'alert.noteRequired' });
  });

  it('refuses an out-of-contract duration before it reaches the wire', () => {
    expect(applyCheaterMark(5, undefined, 'win-trading')).toEqual({
      errorKey: 'alert.cheaterMarkDurationInvalid',
    });
    expect(applyCheaterMark(5, 0, 'win-trading')).toEqual({
      errorKey: 'alert.cheaterMarkDurationInvalid',
    });
    expect(applyCheaterMark(5, 101, 'win-trading')).toEqual({
      errorKey: 'alert.cheaterMarkDurationInvalid',
    });
  });

  it('builds the apply request with the converted seconds', () => {
    const built = applyCheaterMark(41858, 6, 'win-trading the 1v1 arena');
    if ('errorKey' in built) throw new Error(`unexpected refusal: ${built.errorKey}`);
    expect(built.pending.endpoint).toBe('/admin/api/moderation/accounts/41858/cheater-mark');
    expect(built.pending.body).toEqual({ reason: 'win-trading the 1v1 arena', seconds: 21600 });
    expect(built.pending.danger).toBe(true);
  });

  it('builds the lift request with the reason only', () => {
    const built = liftCheaterMark(41858, 'appeal accepted');
    if ('errorKey' in built) throw new Error(`unexpected refusal: ${built.errorKey}`);
    expect(built.pending.endpoint).toBe('/admin/api/moderation/accounts/41858/lift-cheater-mark');
    expect(built.pending.body).toEqual({ reason: 'appeal accepted' });
    expect(built.pending.danger).toBeUndefined();
  });
});
