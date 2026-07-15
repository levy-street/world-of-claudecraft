import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Api, ApiError } from '../src/net/online';
import {
  API_ERROR_KEYS,
  technicalErrorMessage,
  userFacingApiError,
} from '../src/ui/api_error_i18n';
import { formatDateTime, formatDuration, setLanguage, t } from '../src/ui/i18n';
import { tServer } from '../src/ui/server_i18n';

// The matcher and the formatters both default to the active language; pin English so
// the expected values (which use the same t()/formatDuration/formatDateTime helpers)
// are computed against the same table and locale as the code under test.
beforeEach(() => {
  setLanguage('en');
});

describe('userFacingApiError code-first resolution', () => {
  it('resolves a stable code to its apiError key, beating the prose message', () => {
    // The message would prose-resolve to errors.api.notAuthenticated ('Not
    // authenticated.'); the code is a structural one with a different English value,
    // so a code-first win is observable in the output.
    const err = new ApiError('not authenticated', 401, 'auth.token_missing');
    expect(userFacingApiError(err)).toBe(t('apiError.auth.token_missing'));
    expect(userFacingApiError(err)).not.toBe(t('errors.api.notAuthenticated'));
  });

  it('uses the code even when the legacy message has no prose arm', () => {
    // If the code were ignored, an unrecognized message falls through to raw English;
    // proving the coded value wins is decisive here.
    const err = new ApiError('db write failed 0x9', 409, 'account.username_taken');
    expect(userFacingApiError(err)).toBe(t('apiError.account.username_taken'));
    expect(userFacingApiError(err)).not.toBe('db write failed 0x9');
  });

  it('falls back to the prose arm for an un-migrated raw-English error (no code)', () => {
    const err = new Error('username already taken');
    expect(userFacingApiError(err)).toBe(t('errors.api.usernameTaken'));
  });

  it('falls through to prose when the code is not in the table', () => {
    const err = new ApiError('username already taken', 409, 'some.unregistered_code');
    expect(userFacingApiError(err)).toBe(t('errors.api.usernameTaken'));
  });
});

describe('userFacingApiError parametric codes', () => {
  it('formats a suspension date client-side, not as the raw ISO string', () => {
    const iso = '2026-07-09T12:00:00.000Z';
    const err = new ApiError('suspended', 403, 'moderation.suspended_until', { date: iso });
    const rendered = formatDateTime(new Date(iso));
    expect(userFacingApiError(err)).toBe(
      t('apiError.moderation.suspended_until', { date: rendered }),
    );
    expect(userFacingApiError(err)).toContain(rendered);
    expect(userFacingApiError(err)).not.toContain(iso);
  });

  it('passes an unparseable-but-present date through raw', () => {
    const err = new ApiError('suspended', 403, 'moderation.suspended_until', {
      date: 'sometime soon',
    });
    expect(userFacingApiError(err)).toBe(
      t('apiError.moderation.suspended_until', { date: 'sometime soon' }),
    );
  });

  it('falls through to prose when moderation.suspended_until carries no date param', () => {
    // A coded suspension body with no date must defer to the prose arm (which still
    // captures the legacy toUTCString from the message), never render the literal
    // "until undefined".
    const err = new ApiError(
      'This account is suspended until Wed, 09 Jul 2026 12:00:00 GMT.',
      403,
      'moderation.suspended_until',
    );
    expect(userFacingApiError(err)).toBe(
      t('errors.api.accountSuspended', { date: 'Wed, 09 Jul 2026 12:00:00 GMT' }),
    );
  });

  it('formats a rate-limit retry as a localized duration phrase, not a bare number', () => {
    const err = new ApiError('rate limited', 429, 'rate_limit.exceeded', { retryAfterSeconds: 30 });
    const duration = formatDuration(30);
    expect(userFacingApiError(err)).toBe(t('apiError.rate_limit.exceeded', { seconds: duration }));
    expect(userFacingApiError(err)).toContain(duration);
    // A bare '30' with no unit (the un-formatted number) must not be the output.
    expect(userFacingApiError(err)).not.toBe(t('apiError.rate_limit.exceeded', { seconds: '30' }));
  });

  it('falls through to prose when rate_limit.exceeded carries no numeric seconds', () => {
    const err = new ApiError('rate limited', 429, 'rate_limit.exceeded', {});
    // The prose arm for the Discord bare "rate limited" maps to tooManyAttempts.
    expect(userFacingApiError(err)).toBe(t('errors.api.tooManyAttempts'));
  });
});

describe('userFacingApiError transport / server-unreachable failures', () => {
  it('maps a browser fetch failure (server unreachable) to the connection message', () => {
    // When the game server is not running, the browser fetch in Api.post rejects with a
    // TypeError and no HTTP status. The login/register form must show the localized
    // connection message, not the raw "Failed to fetch" browser string.
    expect(userFacingApiError(new TypeError('Failed to fetch'))).toBe(t('loading.connectionLost'));
    expect(userFacingApiError(new TypeError('Failed to fetch'))).not.toBe('Failed to fetch');
  });

  it('recognizes the Firefox, Safari, and Node/undici transport wordings too', () => {
    // Each engine words an unreachable-server fetch failure differently; all resolve to
    // the same connection message rather than leaking their raw diagnostic text.
    expect(
      userFacingApiError(new TypeError('NetworkError when attempting to fetch resource.')),
    ).toBe(t('loading.connectionLost'));
    expect(userFacingApiError(new TypeError('Load failed'))).toBe(t('loading.connectionLost'));
    expect(userFacingApiError(new TypeError('fetch failed'))).toBe(t('loading.connectionLost'));
  });

  it('does NOT treat a real HTTP 5xx from a reachable server as a transport failure', () => {
    // A 500 that carries an HTTP status is an application error from a server that DID
    // answer, not an unreachable server; it stays the English diagnostic (the
    // "diagnostics stay English" rule), unchanged by the transport-failure detection.
    const err = new ApiError('request failed (500)', 500);
    expect(userFacingApiError(err)).toBe('request failed (500)');
  });

  it('maps the dev proxy missing-backend 502 to the connection message', () => {
    // Vite answers a refused /api proxy connection with an empty HTTP 502 response.
    // Api.post therefore throws this generic status-bearing error rather than the
    // TypeError produced when fetch itself cannot reach its destination.
    const err = new ApiError('request failed (502)', 502);
    expect(userFacingApiError(err)).toBe(t('loading.connectionLost'));
  });

  it('requires a genuine TypeError before matching browser transport wording', () => {
    expect(userFacingApiError(new Error('Load failed'))).toBe('Load failed');
    expect(userFacingApiError(new Error('card upload failed (500)'))).toBe(
      'card upload failed (500)',
    );
  });
});

describe('userFacingApiError prose fallback (un-migrated routes, until Phase 25)', () => {
  it('preserves the captured suspension date from the legacy prose message', () => {
    const err = new Error('This account is suspended until Wed, 09 Jul 2026 12:00:00 GMT.');
    expect(userFacingApiError(err)).toBe(
      t('errors.api.accountSuspended', { date: 'Wed, 09 Jul 2026 12:00:00 GMT' }),
    );
    expect(userFacingApiError(err)).toContain('Wed, 09 Jul 2026 12:00:00 GMT');
  });

  it('re-localizes the WebSocket disconnect reasons', () => {
    expect(userFacingApiError('Connection to the server was lost.')).toBe(
      t('loading.connectionLost'),
    );
    expect(userFacingApiError('rejected by server')).toBe(t('loading.connectionRejected'));
    // The realm-at-capacity refusal: the server emit and the FATAL reconnect
    // classification are pinned elsewhere; this pins the localization hop between
    // them, so a drifted matcher literal or target key cannot silently regress the
    // refusal overlay to raw English.
    expect(userFacingApiError('realm is full')).toBe(t('loading.realmFull'));
    // The per-IP connection-cap refusal takes the same localization hop, so its
    // matcher literal and target key are pinned the same way.
    expect(userFacingApiError('too many connections from your network')).toBe(
      t('loading.tooManyConnections'),
    );
  });

  it('re-localizes a moderation kick through tServer', () => {
    expect(userFacingApiError('This account is suspended.')).toBe(tServer('moderation.suspended'));
    expect(userFacingApiError('A moderator requires one of your characters to be renamed.')).toBe(
      tServer('moderation.forceRename'),
    );
  });

  it('returns transport/protocol diagnostics verbatim in English', () => {
    expect(userFacingApiError('authentication timed out')).toBe('authentication timed out');
    expect(userFacingApiError('request failed (500)')).toBe('request failed (500)');
  });
});

describe('API_ERROR_KEYS table', () => {
  it('maps a code to its apiError key verbatim', () => {
    expect(API_ERROR_KEYS['rate_limit.exceeded']).toBe('apiError.rate_limit.exceeded');
    expect(API_ERROR_KEYS['moderation.suspended_until']).toBe(
      'apiError.moderation.suspended_until',
    );
  });

  it('technicalErrorMessage reads Error.message and stringifies non-Errors', () => {
    expect(technicalErrorMessage(new Error('boom'))).toBe('boom');
    expect(technicalErrorMessage('raw string')).toBe('raw string');
  });
});

describe('ApiError captures the stable code and params from the response body', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const mockJson = (status: number, body: unknown) => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  };

  const rejection = async (call: Promise<unknown>): Promise<ApiError> => {
    let caught: unknown;
    try {
      await call;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    return caught as ApiError;
  };

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('captures a top-level code and the body params on a POST failure', async () => {
    mockJson(429, { error: 'slow down', code: 'rate_limit.exceeded', retryAfterSeconds: 30 });
    const err = await rejection(new Api().login('u', 'p'));
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limit.exceeded');
    expect(err.params).toMatchObject({ retryAfterSeconds: 30, code: 'rate_limit.exceeded' });
  });

  it('captures a code on a GET failure', async () => {
    mockJson(401, { error: 'Not authenticated.', code: 'auth.required' });
    const err = await rejection(new Api().getAccount());
    expect(err.status).toBe(401);
    expect(err.code).toBe('auth.required');
  });

  it('leaves code and params undefined when the body carries no code', async () => {
    mockJson(500, { error: 'boom' });
    const err = await rejection(new Api().login('u', 'p'));
    expect(err.message).toBe('boom');
    expect(err.code).toBeUndefined();
    expect(err.params).toBeUndefined();
  });

  it('end-to-end: an empty proxy 502 on registration renders as connection loss', async () => {
    mockJson(502, {});
    const err = await rejection(new Api().register('new-user', 'password', 'new@example.com'));
    expect(err.message).toBe('request failed (502)');
    expect(userFacingApiError(err)).toBe(t('loading.connectionLost'));
  });

  it('end-to-end: an RFC problem code on 503 beats the generic gateway fallback', async () => {
    mockJson(503, {
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The Steam service is temporarily unavailable.',
      instance: '/api/steam/link',
      code: 'steam.upstream',
    });
    const err = await rejection(new Api().steamLink('0123456789abcdef'));
    expect(err.message).toBe('request failed (503)');
    expect(err.code).toBe('steam.upstream');
    expect(userFacingApiError(err)).toBe(t('apiError.steam.upstream'));
  });

  it('end-to-end: a captured rate-limit error renders the localized duration', async () => {
    mockJson(429, { error: 'slow down', code: 'rate_limit.exceeded', retryAfterSeconds: 30 });
    const err = await rejection(new Api().login('u', 'p'));
    setLanguage('en');
    expect(userFacingApiError(err)).toBe(
      t('apiError.rate_limit.exceeded', { seconds: formatDuration(30) }),
    );
  });

  it('end-to-end: a captured suspension error renders the client-formatted date', async () => {
    // The moderationErrorBody legacy shape: prose + code + top-level machine ISO date.
    const iso = '2026-07-09T12:00:00.000Z';
    mockJson(403, {
      error: 'This account is suspended until Wed, 09 Jul 2026 12:00:00 GMT.',
      code: 'moderation.suspended_until',
      date: iso,
    });
    const err = await rejection(new Api().login('u', 'p'));
    expect(err.params).toMatchObject({ date: iso });
    setLanguage('en');
    expect(userFacingApiError(err)).toBe(
      t('apiError.moderation.suspended_until', { date: formatDateTime(new Date(iso)) }),
    );
  });

  it('captures the code on an exportData failure (the text-parsing fetch path)', async () => {
    // exportData reads res.text() (the success body is a raw download), so its error
    // path builds the ApiError from the parsed text instead of the json() helpers; it
    // must still capture the additive code.
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(JSON.stringify({ error: 'not authenticated', code: 'auth.required' })),
    } as unknown as Response);
    const err = await rejection(new Api().exportData());
    expect(err.message).toBe('not authenticated');
    expect(err.code).toBe('auth.required');
    expect(userFacingApiError(err)).toBe(t('apiError.auth.required'));
  });

  it('keeps the diagnostic message for a non-JSON exportData error body', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve('<html>bad gateway</html>'),
    } as unknown as Response);
    const err = await rejection(new Api().exportData());
    expect(err.message).toBe('request failed (502)');
    expect(err.code).toBeUndefined();
  });
});
