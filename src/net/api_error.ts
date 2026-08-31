// The REST error value the whole client shares: ApiError carries the HTTP
// status, the stable machine `code`, and the body params beside the English
// message (moved out of online.ts by the monolith ratchet; online.ts
// re-exports all three names, so importers are unchanged).

// Carries the HTTP status alongside the server's error text so callers can
// distinguish an auth failure (401/403 → clear the stored session) from a
// transient 5xx/network blip (keep the token; the session may still be valid).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // The stable machine code from the server's error body (RFC 9457 problem+json
    // `code`, or the additive `code` on a migrated legacy body), when present. The
    // client matcher (src/ui/api_error_i18n.ts) prefers it over the English message.
    readonly code?: string,
    // The parsed error body, so the matcher can read code params (e.g.
    // retryAfterSeconds, date) that ride top-level alongside the code.
    readonly params?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Builds the ApiError for a non-ok JSON response, capturing the stable `code` and
// the body params when the server sent them (both problem+json and the migrated
// legacy `{ error, code, ... }` bodies carry a top-level `code`).
export function apiErrorFromBody(data: unknown, status: number): ApiError {
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
  const rawError = body?.error;
  const message = typeof rawError === 'string' ? rawError : `request failed (${status})`;
  const rawCode = body?.code;
  const code = typeof rawCode === 'string' && rawCode.length > 0 ? rawCode : undefined;
  return new ApiError(message, status, code, code ? body : undefined);
}

/** True for an auth-class failure where a stored token should be discarded. */
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}
