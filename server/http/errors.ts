// Error model for the API request pipeline.
//
// Three pieces, no route wiring:
//  1. HttpError: the throwable a handler/middleware raises (status + stable code + optional
//     params/headers). The stable `code` is the i18n key; the client localizes by code, never
//     by parsing English detail text.
//  2. toAppError: an EXHAUSTIVE normalizer that maps any thrown value to a status + code + the
//     code-implied headers (WWW-Authenticate on a 401 auth.* error, Retry-After on a 429).
//  3. serialize / mapError: the seven per-surface serializers, selected by ErrorSurface, that
//     RETURN a SerializedError ({ status, headers, contentType, body }). mapError does NOT write
//     to ctx.res; the error middleware writes the returned shape.
//
// 500 NO-LEAK: an unexpected throwable maps to 500 internal.error. The serialized body and headers
// are built from the stable code plus generic, leak-free developer text only; the ORIGINAL error
// (stack, SQL, table, column, driver detail) is never stringified into the output and flows ONLY
// to opts.onUnexpected. Server-side, language-agnostic: no t(), no DOM, no sim/client/WS imports.

import type { ErrorCode } from './error_codes';
import type { Issue } from './schema';
import type { Ctx, EnvelopeKind } from './types';

/**
 * The X-Request-Id response header name, single-sourced here (this module is the
 * LIVE error-path emitter via baseHeaders, and a runtime leaf: compose.ts and
 * middleware/request_id.ts consume it through the compose.ts re-export, which the
 * compose -> context -> errors import chain rules out in reverse).
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** A throwable carrying an HTTP status, a stable machine code, and optional params/headers. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly params?: Record<string, string | number>,
    readonly headers?: Record<string, string>,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

/** The serializer selector: which per-surface error envelope to emit. */
export type ErrorSurface =
  | 'problem'
  | 'oauth'
  | 'admin'
  | 'html'
  | 'redirect'
  | 'binary'
  | 'ok_false';

/** A fully serialized error response, ready for the error middleware to write to res. */
export interface SerializedError {
  status: number;
  headers: Record<string, string>;
  contentType: string;
  body: string;
}

/** Options for mapError: which surface to serialize for, and the unexpected-error sink. */
export interface MapErrorOpts {
  surface?: EnvelopeKind | ErrorSurface;
  onUnexpected?: (err: unknown) => void;
}

/** The normalized error: a status, a stable code, and the resolved params/headers. */
export interface AppError {
  status: number;
  code: ErrorCode;
  params?: Record<string, string | number>;
  headers?: Record<string, string>;
  /**
   * True ONLY for the catch-all 500 (an unexpected throwable). The single source of truth for
   * whether mapError routes the ORIGINAL error to opts.onUnexpected. A deliberate HttpError(500)
   * is NOT unexpected, so it does not trigger the sink.
   */
  unexpected: boolean;
}

/** Default sink for an unexpected (mapped-to-500) throwable: log, never surface internals. */
const defaultOnUnexpected = (err: unknown): void => {
  console.error('[http] unhandled error', err);
};

/** Content-Type constants shared by the per-surface serializers. */
const CT_JSON = 'application/json';
const CT_HTML = 'text/html; charset=utf-8';

/** Standard HTTP reason phrases for the statuses this model emits. */
const STATUS_REASON: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/**
 * Per-code GENERIC English DEVELOPER sentences (leak-free). These are developer hints, NOT the
 * source of truth: the client localizes by `code`, never by parsing this text. Fallback is the
 * status reason. The 500 detail is intentionally generic so nothing internal leaks.
 */
const DETAILS: Partial<Record<ErrorCode, string>> = {
  'validation.failed': 'One or more fields failed validation.',
  'json.malformed': 'The request body is not valid JSON.',
  'auth.token_missing': 'Authentication credentials are required.',
  'auth.token_invalid': 'The authentication token is invalid or expired.',
  'auth.forbidden': 'You do not have permission to access this resource.',
  'body.too_large': 'The request body is too large.',
  'body.unsupported_media_type': 'The request Content-Type must be application/json.',
  'origin.cross_site': 'The request origin is not allowed.',
  'db.conflict': 'The request conflicts with the current state of the resource.',
  'rate_limit.exceeded': 'Too many requests. Please retry later.',
  'internal.error': 'An unexpected error occurred.',
};

/** RFC 6749 token error codes for the /oauth surface, keyed by stable code. */
const OAUTH_ERROR: Partial<Record<ErrorCode, string>> = {
  'json.malformed': 'invalid_request',
  'validation.failed': 'invalid_request',
  'body.too_large': 'invalid_request',
  'body.unsupported_media_type': 'invalid_request',
  'origin.cross_site': 'access_denied',
  'db.conflict': 'invalid_request',
  'auth.token_missing': 'invalid_client',
  'auth.token_invalid': 'invalid_client',
  'auth.forbidden': 'access_denied',
  'rate_limit.exceeded': 'temporarily_unavailable',
  'internal.error': 'server_error',
};

function reasonFor(status: number): string {
  return STATUS_REASON[status] ?? 'Error';
}

function detailFor(code: ErrorCode, status: number): string {
  return DETAILS[code] ?? reasonFor(status);
}

/** Case-insensitive presence check so an explicitly-set header is never overwritten. */
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/** The WWW-Authenticate challenge a 401 auth.* error advertises. */
function wwwAuthenticateFor(code: ErrorCode): string {
  if (code === 'auth.token_invalid') return 'Bearer error="invalid_token"';
  return 'Bearer';
}

/**
 * Add the code-implied headers (WWW-Authenticate on a 401 auth.* error, Retry-After on a 429),
 * starting from the base headers and only ADDING when absent (never overwriting an explicit one).
 * Retry-After is sourced from params.retryAfterSeconds (the rate limiter supplies it); it is never
 * fabricated when neither a header nor the param is present.
 *
 * The WWW-Authenticate challenge is scoped to auth.* codes ON PURPOSE. applyImpliedHeaders runs
 * surface-agnostically (before serialization), and a `Bearer` challenge is only meaningful for the
 * bearer-token API surface, not for an oauth or admin 401. A route on another surface that needs a
 * different RFC 7235 challenge sets its own WWW-Authenticate header on the thrown HttpError.
 */
function applyImpliedHeaders(
  status: number,
  code: ErrorCode,
  base: Record<string, string> | undefined,
  params: Record<string, string | number> | undefined,
): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(base ?? {}) };
  if (status === 401 && code.startsWith('auth.') && !hasHeader(headers, 'WWW-Authenticate')) {
    headers['WWW-Authenticate'] = wwwAuthenticateFor(code);
  }
  if (status === 429 && !hasHeader(headers, 'Retry-After')) {
    const retry = params?.retryAfterSeconds;
    if (retry !== undefined) headers['Retry-After'] = String(retry);
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * The draft-11 rate-limit response headers a coded 429 carries. Fields per
 * draft-ietf-httpapi-ratelimit-headers-11 (a NON-FINAL Internet-Draft, pinned at
 * draft 11 on purpose), structured-field syntax per RFC 9651:
 *   q = quota (the policy limit), w = window seconds  -> RateLimit-Policy
 *   r = remaining, t = seconds to reset               -> RateLimit
 * The quoted policy name is the structured-field key of the group. The legacy
 * X-RateLimit-* trio is deliberately never emitted here (draft 11 supersedes it).
 * Retry-After is included explicitly so applyImpliedHeaders' if-absent guard
 * no-ops: it would otherwise derive the same value from params.retryAfterSeconds,
 * so the two paths agree. The two-tier rate limiter supplies these on every rateLimit(policy) 429.
 */
export function rateLimit429Headers(
  policy: { name: string; limit: number; windowSeconds: number },
  outcome: { remaining: number; resetSeconds: number },
): Record<string, string> {
  return {
    'Retry-After': String(outcome.resetSeconds),
    RateLimit: `"${policy.name}";r=${outcome.remaining};t=${outcome.resetSeconds}`,
    'RateLimit-Policy': `"${policy.name}";q=${policy.limit};w=${policy.windowSeconds}`,
  };
}

/** A thrown raw decode-failure from schema.ts: { ok: false, issues: Issue[] }. */
function isDecodeFailure(err: unknown): err is { ok: false; issues: Issue[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { ok?: unknown }).ok === false &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

/** A pg unique-constraint violation. ONLY 23505 maps to conflict; any other pg code is a 500. */
function isPgUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

/** Carry an Issue[] in the params slot (the locked param value type cannot name the array). */
function validationParams(issues: Issue[]): Record<string, string | number> {
  return { issues } as unknown as Record<string, string | number>;
}

function finalize(
  status: number,
  code: ErrorCode,
  params?: Record<string, string | number>,
  headers?: Record<string, string>,
  unexpected = false,
): AppError {
  return {
    status,
    code,
    params,
    headers: applyImpliedHeaders(status, code, headers, params),
    unexpected,
  };
}

/**
 * EXHAUSTIVE normalizer. Maps any thrown value to a status + stable code + code-implied headers:
 *  - HttpError                          -> pass-through status/code/params/headers.
 *  - SyntaxError (JSON.parse failure)   -> 400 json.malformed.
 *  - raw decode-failure { ok:false,... }-> 422 validation.failed (params { issues }).
 *  - pg unique violation (code 23505)   -> 409 db.conflict.
 *  - anything else                      -> 500 internal.error (the original goes to onUnexpected).
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof HttpError) {
    return finalize(err.status, err.code, err.params, err.headers);
  }
  // Any SyntaxError is treated as a malformed-JSON client error (400). This is intentionally broad
  // for the primitive: in the wired pipeline the withBody middleware owns body parsing and throws
  // HttpError(400, 'json.malformed') for a bad body, so a stray internal SyntaxError reaching here
  // is not expected. The body middleware may narrow this to body-parse origin (letting other
  // SyntaxErrors fall to the 500 + onUnexpected branch).
  if (err instanceof SyntaxError) {
    return finalize(400, 'json.malformed');
  }
  if (isDecodeFailure(err)) {
    return finalize(422, 'validation.failed', validationParams(err.issues));
  }
  if (isPgUniqueViolation(err)) {
    return finalize(409, 'db.conflict');
  }
  // Unexpected throwable: flag it (unexpected = true) so mapError routes the ORIGINAL to
  // onUnexpected. The serialized body is built only from the stable code + generic text, so
  // nothing internal (stack, SQL, table, column, driver detail) leaks.
  return finalize(500, 'internal.error', undefined, undefined, true);
}

/**
 * Map an EnvelopeKind (the route's error-surface tag) OR an ErrorSurface OR undefined to the
 * serializer's ErrorSurface union. 'problem+json' -> 'problem', 'legacy405' -> 'ok_false', the
 * other arms are name-identical; the default is 'problem'.
 */
export function normalizeSurface(tag?: EnvelopeKind | ErrorSurface): ErrorSurface {
  switch (tag) {
    case 'problem+json':
      return 'problem';
    case 'legacy405':
      return 'ok_false';
    case 'problem':
    case 'oauth':
    case 'admin':
    case 'html':
    case 'redirect':
    case 'binary':
    case 'ok_false':
      return tag;
    default:
      return 'problem';
  }
}

/**
 * Escape the five HTML-significant characters for safe interpolation into the HTML page.
 * Exported so the escaping is pinned by a direct unit test: today serializeHtml only
 * interpolates the static reason/detail phrases, but this is the defense-in-depth guard for
 * any future change that renders dynamic content into the HTML error surface.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** X-Request-Id (runOnion fallback convention) plus the AppError headers on every response. */
function baseHeaders(app: AppError, ctx: Ctx): Record<string, string> {
  return { [REQUEST_ID_HEADER]: ctx.reqId, ...(app.headers ?? {}) };
}

function serializeProblem(app: AppError, ctx: Ctx): SerializedError {
  // Spread params FIRST so the RFC 9457 reserved members (notably `code`, the REST i18n
  // localization key) always win. An extension member must never shadow a standard member
  // (RFC 9457 section 3.2), so a future catalog param named code/status/type/title/detail/instance
  // cannot corrupt the envelope.
  const body = {
    ...(app.params ?? {}),
    type: 'about:blank',
    title: reasonFor(app.status),
    status: app.status,
    detail: detailFor(app.code, app.status),
    instance: ctx.path,
    code: app.code,
  };
  return {
    status: app.status,
    headers: baseHeaders(app, ctx),
    contentType: 'application/problem+json',
    body: JSON.stringify(body),
  };
}

function serializeOauth(app: AppError, ctx: Ctx): SerializedError {
  const body = {
    error: OAUTH_ERROR[app.code] ?? 'invalid_request',
    error_description: detailFor(app.code, app.status),
  };
  return {
    status: app.status,
    headers: baseHeaders(app, ctx),
    contentType: CT_JSON,
    body: JSON.stringify(body),
  };
}

function serializeAdmin(app: AppError, ctx: Ctx): SerializedError {
  return {
    status: app.status,
    headers: baseHeaders(app, ctx),
    contentType: CT_JSON,
    body: JSON.stringify({ success: false, data: null, error: app.code }),
  };
}

function serializeHtml(app: AppError, ctx: Ctx): SerializedError {
  const title = escapeHtml(reasonFor(app.status));
  const detail = escapeHtml(detailFor(app.code, app.status));
  const body =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<title>${title}</title></head><body><main><h1>${title}</h1>` +
    `<p>${detail}</p></main></body></html>`;
  const headers = baseHeaders(app, ctx);
  headers['Cache-Control'] = 'no-store';
  return {
    status: app.status,
    headers,
    contentType: CT_HTML,
    body,
  };
}

function serializeRedirect(app: AppError, ctx: Ctx): SerializedError {
  const status = app.status >= 300 && app.status < 400 ? app.status : 302;
  const headers = baseHeaders(app, ctx);
  headers.Location = `/error?code=${encodeURIComponent(app.code)}`;
  return {
    status,
    headers,
    contentType: CT_HTML,
    body: '',
  };
}

function serializeBinary(app: AppError, ctx: Ctx): SerializedError {
  return {
    status: app.status,
    headers: baseHeaders(app, ctx),
    contentType: 'text/plain; charset=utf-8',
    body: app.code,
  };
}

function serializeOkFalse(app: AppError, ctx: Ctx): SerializedError {
  return {
    status: app.status,
    headers: baseHeaders(app, ctx),
    contentType: CT_JSON,
    body: JSON.stringify({ ok: false }),
  };
}

function serialize(app: AppError, surface: ErrorSurface, ctx: Ctx): SerializedError {
  switch (surface) {
    case 'problem':
      return serializeProblem(app, ctx);
    case 'oauth':
      return serializeOauth(app, ctx);
    case 'admin':
      return serializeAdmin(app, ctx);
    case 'html':
      return serializeHtml(app, ctx);
    case 'redirect':
      return serializeRedirect(app, ctx);
    case 'binary':
      return serializeBinary(app, ctx);
    case 'ok_false':
      return serializeOkFalse(app, ctx);
  }
}

/**
 * Normalize the thrown value, notify onUnexpected ONCE for an unexpected (mapped-to-500) throwable
 * with the ORIGINAL error, then serialize for the selected surface. RETURNS the SerializedError;
 * it does NOT write to ctx.res (the error middleware owns the write).
 */
export function mapError(err: unknown, ctx: Ctx, opts?: MapErrorOpts): SerializedError {
  const app = toAppError(err);
  if (app.unexpected) {
    (opts?.onUnexpected ?? defaultOnUnexpected)(err);
  }
  return serialize(app, normalizeSurface(opts?.surface), ctx);
}
