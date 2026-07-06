// A dynamic-field normalizer for the golden-master and parity drivers. It masks
// EXACTLY a named set of dynamic placeholders and nothing else. Masking is
// FIELD-NAME-DRIVEN (by key / header name, never by value shape), so a non-dynamic
// field that merely looks numeric or id-like (a score, a level) is left untouched.
//
// The placeholder set (NORMALIZER_PLACEHOLDERS) is a load-bearing, exported named
// constant: the characterization corpus imports it to assert that a fixture's dynamic fields were
// masked to the expected stable tokens. The field-name matchers are likewise
// single-source named constants, never inline literals (server "no magic values").

/**
 * The stable placeholder tokens this normalizer masks dynamic fields to. EXPORTED
 * and load-bearing: the characterization corpus imports this exact set. Each masked category
 * maps to exactly one of these tokens.
 */
export const NORMALIZER_PLACEHOLDERS = {
  id: '<ID>',
  timestamp: '<TIMESTAMP>',
  token: '<TOKEN>',
  requestId: '<REQUEST_ID>',
  date: '<DATE>',
  expires: '<EXPIRES>',
  nonce: '<NONCE>',
} as const;

/** A captured (or normalized) response triple: the shape the drivers compare on. */
export interface CapturedResponse {
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
}

// --- Field-name matchers (single source of truth) --------------------------
//
// Exact key names are matched case-INSENSITIVELY (so 'Token' and 'token' agree);
// the camelCase suffix matchers are case-SENSITIVE (so 'createdAt' masks but the
// English word 'flat' does not, 'accountId' masks but 'valid' does not).

/** Expiry seconds / timestamps: expiresIn, expiresAt, expires. Checked first so
 *  expiresAt resolves to <EXPIRES>, not the generic *At timestamp token. */
const EXPIRES_KEYS: ReadonlySet<string> = new Set(['expires', 'expiresin', 'expiresat']);
/** Bearer/access/refresh tokens. */
const TOKEN_KEYS: ReadonlySet<string> = new Set(['token', 'accesstoken', 'refreshtoken', 'bearer']);
/** Nonces / CSRF tokens. NOTE: the generic key 'state' is deliberately NOT here:
 *  it is too broad a field name (characters.state, moderation state, etc.) and
 *  would over-mask non-CSRF bodies, hiding real divergences in the characterization corpus.
 *  OAuth's CSRF `state` is masked by the oauth surface capture, which has surface context. */
const NONCE_KEYS: ReadonlySet<string> = new Set(['nonce', 'csrf', 'csrftoken']);
/** Per-request ids carried in the body. Checked before the generic *Id id rule. */
const REQUEST_ID_KEYS: ReadonlySet<string> = new Set(['reqid', 'requestid']);
/** Exact timestamp key. */
const TIMESTAMP_KEYS: ReadonlySet<string> = new Set(['timestamp']);
/** Exact date key. */
const DATE_KEYS: ReadonlySet<string> = new Set(['date']);

/** camelCase suffix for ids (accountId, characterId). */
const ID_SUFFIX = 'Id';
/** camelCase suffix for timestamps (createdAt, updatedAt). */
const TIMESTAMP_SUFFIX = 'At';
/** camelCase suffix for dates (birthDate, startDate). */
const DATE_SUFFIX = 'Date';

/** Response headers whose value is dynamic and is masked to a stable token. */
const DYNAMIC_HEADER_PLACEHOLDERS: Readonly<Record<string, string>> = {
  date: NORMALIZER_PLACEHOLDERS.date,
  'x-request-id': NORMALIZER_PLACEHOLDERS.requestId,
  'set-cookie': NORMALIZER_PLACEHOLDERS.token,
};

/** A non-empty camelCase suffix match (the key must be longer than the suffix). */
function endsWithCamel(key: string, suffix: string): boolean {
  return key.length > suffix.length && key.endsWith(suffix);
}

/**
 * The placeholder token a body field with this key masks to, or null if the key
 * is not a dynamic field. Precedence is fixed (expires before *At, requestId
 * before *Id) so each key resolves to exactly one category.
 */
function placeholderForKey(key: string): string | null {
  const lower = key.toLowerCase();
  if (EXPIRES_KEYS.has(lower)) return NORMALIZER_PLACEHOLDERS.expires;
  if (TOKEN_KEYS.has(lower)) return NORMALIZER_PLACEHOLDERS.token;
  if (NONCE_KEYS.has(lower)) return NORMALIZER_PLACEHOLDERS.nonce;
  if (REQUEST_ID_KEYS.has(lower)) return NORMALIZER_PLACEHOLDERS.requestId;
  if (DATE_KEYS.has(lower) || endsWithCamel(key, DATE_SUFFIX)) return NORMALIZER_PLACEHOLDERS.date;
  if (TIMESTAMP_KEYS.has(lower) || endsWithCamel(key, TIMESTAMP_SUFFIX)) {
    return NORMALIZER_PLACEHOLDERS.timestamp;
  }
  if (lower === 'id' || endsWithCamel(key, ID_SUFFIX)) return NORMALIZER_PLACEHOLDERS.id;
  return null;
}

/**
 * Recursively return a copy with object keys sorted ascending (arrays keep order),
 * so a value serializes deterministically regardless of original key insertion
 * order. Primitives pass through unchanged.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON: stable (sorted) key order. `space` indents for readability. */
export function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(sortKeysDeep(value), null, space) ?? '';
}

/** Recursively replace dynamic fields by key with their placeholder token. */
function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const placeholder = placeholderForKey(key);
      out[key] = placeholder !== null ? placeholder : maskValue(child);
    }
    return out;
  }
  return value;
}

/** Sentinel returned when a string body is not JSON (so a literal `null` body is
 *  not mistaken for unparseable). */
const NOT_JSON = Symbol('not-json');

function tryParseJson(text: string): unknown {
  if (text.trim().length === 0) return NOT_JSON;
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

/** Mask the named dynamic headers to their placeholder; leave every other header. */
function normalizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    const placeholder = DYNAMIC_HEADER_PLACEHOLDERS[name.toLowerCase()];
    out[name] = placeholder !== undefined ? placeholder : value;
  }
  return out;
}

function normalizeBody(body: unknown): unknown {
  if (typeof body === 'string') {
    const parsed = tryParseJson(body);
    // Non-JSON/text body: leave the body verbatim (headers are still normalized).
    if (parsed === NOT_JSON) return body;
    // JSON-string body: mask by key, then re-serialize deterministically.
    return stableStringify(maskValue(parsed));
  }
  if (body !== null && typeof body === 'object') return maskValue(body);
  return body;
}

/**
 * Return a normalized COPY of a captured response: dynamic body fields and the
 * named dynamic headers are masked to their stable placeholder tokens; everything
 * else is preserved. Never throws on unparseable input.
 */
export function normalizeResponse(captured: CapturedResponse): CapturedResponse {
  return {
    status: captured.status,
    headers: normalizeHeaders(captured.headers ?? {}),
    body: normalizeBody(captured.body),
  };
}
