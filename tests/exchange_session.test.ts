// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreValidatedSession, splitSecondFactor } from '../src/exchange/session';
import { AccountSessionApi } from '../src/net/account_session_api';
import { ApiError } from '../src/net/api_error';

describe('Exchange session', () => {
  beforeEach(() => localStorage.clear());

  it('classifies TOTP separately from recovery codes', () => {
    expect(splitSecondFactor(' 123456 ')).toEqual({ code: '123456', recoveryCode: '' });
    expect(splitSecondFactor('recovery-1')).toEqual({ code: '', recoveryCode: 'recovery-1' });
  });

  it('revalidates a restored session', async () => {
    localStorage.setItem('woc_session', JSON.stringify({ token: 'token', username: 'Ada' }));
    const api = new AccountSessionApi();
    vi.spyOn(api, 'getAccount').mockResolvedValue({ username: 'Ada' } as never);
    await expect(restoreValidatedSession(api)).resolves.toMatchObject({ authenticated: true });
  });

  it('clears only auth-class failures', async () => {
    localStorage.setItem('woc_session', JSON.stringify({ token: 'token', username: 'Ada' }));
    const api = new AccountSessionApi();
    vi.spyOn(api, 'getAccount').mockRejectedValue(new ApiError('expired', 401));
    await expect(restoreValidatedSession(api)).resolves.toEqual({ authenticated: false });
    expect(localStorage.getItem('woc_session')).toBeNull();

    localStorage.setItem('woc_session', JSON.stringify({ token: 'token', username: 'Ada' }));
    const forbidden = new AccountSessionApi();
    vi.spyOn(forbidden, 'getAccount').mockRejectedValue(new ApiError('forbidden', 403));
    await expect(restoreValidatedSession(forbidden)).resolves.toEqual({ authenticated: false });
    expect(localStorage.getItem('woc_session')).toBeNull();

    localStorage.setItem('woc_session', JSON.stringify({ token: 'token', username: 'Ada' }));
    const transient = new AccountSessionApi();
    vi.spyOn(transient, 'getAccount').mockRejectedValue(new ApiError('offline', 503));
    await expect(restoreValidatedSession(transient)).resolves.toEqual({ authenticated: false });
    expect(localStorage.getItem('woc_session')).not.toBeNull();
  });
});
