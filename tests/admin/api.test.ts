// @vitest-environment jsdom
import './_setup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiLogin, clearSession, getToken } from '../../src/admin/api';

const fetchMock = vi.fn<typeof fetch>();

function response(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  clearSession();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('admin apiLogin two-factor flow', () => {
  it('returns a challenge without persisting an undefined token', async () => {
    fetchMock.mockResolvedValueOnce(response({ twoFactorRequired: true }));

    await expect(apiLogin('alice', 'pw', '123456', '')).resolves.toEqual({
      twoFactorRequired: true,
    });
    expect(getToken()).toBeNull();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      username: 'alice',
      password: 'pw',
      code: '123456',
      recoveryCode: '',
    });
  });

  it('sends a recovery code in its own field and persists only the final token', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        token: 'tok',
        username: 'alice',
        roles: ['viewer'],
        permissions: ['analytics.read'],
      }),
    );

    await expect(apiLogin('alice', 'pw', '', 'abcd-1234')).resolves.toEqual({
      username: 'alice',
      roles: ['viewer'],
      permissions: ['analytics.read'],
    });
    expect(getToken()).toBe('tok');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      code: '',
      recoveryCode: 'abcd-1234',
    });
  });
});
