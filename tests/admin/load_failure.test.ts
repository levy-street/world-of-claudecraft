// Pure helper, so it runs in the default Node environment (no ./_setup, no DOM).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/admin/api';
import { ADMIN_LOAD_FAILURES, classifyAdminLoadFailure } from '../../src/admin/load_failure';

describe('classifyAdminLoadFailure', () => {
  it('calls a 403 forbidden', () => {
    expect(
      classifyAdminLoadFailure(new ApiError(403, 'you do not have permission to do this')),
    ).toBe('forbidden');
  });

  it('calls every other ApiError status a generic error', () => {
    // 401 never reaches here (auth.handleAuthFailure logs out first), but the
    // classifier must not invent a second special case if it ever does: only
    // 403 is the permission verdict.
    for (const status of [400, 401, 404, 409, 429, 500, 502, 503]) {
      expect(classifyAdminLoadFailure(new ApiError(status, 'boom')), `status ${status}`).toBe(
        'error',
      );
    }
  });

  it('calls a non-ApiError error, and a non-error value, a generic error', () => {
    // A transport failure (fetch rejects with a TypeError) carries no status at
    // all; nothing about it says "permission", so it must never read as one.
    expect(classifyAdminLoadFailure(new TypeError('Failed to fetch'))).toBe('error');
    expect(classifyAdminLoadFailure(new Error('boom'))).toBe('error');
    expect(classifyAdminLoadFailure('boom')).toBe('error');
    expect(classifyAdminLoadFailure(null)).toBe('error');
    expect(classifyAdminLoadFailure(undefined)).toBe('error');
    // A bare object carrying a 403-looking status is NOT an ApiError: the
    // status field alone is not the contract, the class is.
    expect(classifyAdminLoadFailure({ status: 403 })).toBe('error');
  });

  it('never returns the quiet state: a classified failure is always a failure', () => {
    // The tri-state's 'none' is the caller's success value, never a verdict
    // this function can produce; a page that renders on `!== 'none'` would
    // silently swallow the panel if it could.
    for (const err of [new ApiError(403, 'x'), new ApiError(500, 'x'), new Error('x'), 'x']) {
      expect(classifyAdminLoadFailure(err)).not.toBe('none');
    }
  });

  it('pins the tri-state vocabulary', () => {
    expect([...ADMIN_LOAD_FAILURES]).toEqual(['none', 'forbidden', 'error']);
  });
});
