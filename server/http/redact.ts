// A pure, host-agnostic secret/PII redactor for the structured logger
// (logger.ts). It scrubs the known secret and PII classes out of any
// value BEFORE it is serialized to a log line, so an operational log can never
// carry a live credential:
//   (a) Authorization header values (any key casing) and inline 'Bearer <token>'
//       substrings inside strings;
//   (b) standalone 64-hex bearer tokens (the newToken() shape) anywhere in a string;
//   (c) password fields (password, passwd, and the *Password variants);
//   (d) cookie and set-cookie headers;
//   (e) OAuth secrets: the PKCE code_verifier and the access/refresh tokens (the
//       authorization code and device code VALUES are 64-hex, caught by rule (b));
//   (f) TOTP secrets (the base32 shared secret) and numeric one-time codes;
//   (g) wallet private-key-shaped fields (private_key / mnemonic / seed_phrase);
//   (h) raw byte values (Buffer / TypedArray / ArrayBuffer) collapse to the
//       placeholder wholesale, so a secret held as bytes under a non-secret key
//       name can never serialize into a line;
//   (i) email addresses (local@domain.tld) anywhere in a string. Signup requires an
//       email, so raw addresses flow through register / set-initial / Discord-capture
//       bodies and must never land in a swept log field.
//
// It is defensive by construction: it recurses into nested objects and arrays with
// path-based cycle protection, is idempotent (redact(redact(x)) deep-equals
// redact(x)), never mutates its input (it returns a structural copy), preserves
// non-secret fields verbatim (Dates and numbers pass through untouched, and a short
// apiError-style code like 'auth.invalid' survives), and NEVER throws: a logger must
// not crash a request, so any internal failure collapses to a safe placeholder.
//
// No dependency, no DOM, no sim/client import. Server-side, dev-channel only.

import { Buffer } from 'node:buffer';

/** The single placeholder every redaction collapses a secret to. */
export const REDACTED = '[redacted]';

/**
 * Case-insensitive substring needles that mark a field NAME as secret-shaped. A
 * key whose lowercased name contains any needle has its ENTIRE value replaced,
 * regardless of the value's type. Deliberately does NOT include a bare 'code': the
 * OAuth authorization/device code VALUES are 64-hex (caught by the value patterns),
 * and a blanket 'code' rule would wrongly scrub apiError codes like 'auth.invalid'.
 */
const SECRET_KEY_NEEDLES: readonly string[] = [
  'password',
  'passwd',
  'authorization',
  'cookie', // covers 'set-cookie'
  'secret', // covers 'client_secret', 'pendingSecret', 'totpSecret', 'secret_key'
  'code_verifier', // PKCE client secret
  'codeverifier',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'private_key', // wallet private-key-shaped fields (never expected, redacted defensively)
  'privatekey',
  'privkey',
  'mnemonic',
  'seed_phrase',
  'seedphrase',
  'recovery_code', // TOTP recovery codes (covers 'recoveryCodes')
  'recoverycode',
  'api_key',
  'apikey',
  'token', // any bearer/session token field
];

/**
 * Keys whose numeric one-time-code VALUE should be scrubbed. Scoped so a dotted
 * machine code under a 'code' key (e.g. 'auth.invalid') survives while a 6-digit
 * TOTP code or a dashed user code does not.
 */
function isOtpKey(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'code' ||
    lower.includes('user_code') ||
    lower.includes('usercode') ||
    lower.includes('otp') ||
    lower.includes('totp')
  );
}

/** A numeric one-time code (TOTP is 6 digits; allow a small range of OTP lengths). */
const NUMERIC_OTP_RE = /^\d{4,12}$/;
/** A dashed user code display form (e.g. 'WXYZ-1234'). */
const DASHED_USER_CODE_RE = /^[a-z0-9]{4,}-[a-z0-9]{4,}$/i;

/** True for a value that is a bare numeric OTP or a dashed user code. */
function looksLikeOtpValue(value: unknown): boolean {
  return (
    typeof value === 'string' && (NUMERIC_OTP_RE.test(value) || DASHED_USER_CODE_RE.test(value))
  );
}

/** True when a field name is a known secret-shaped key. */
function isSecretKey(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_KEY_NEEDLES.some((needle) => lower.includes(needle));
}

// An inline 'Bearer <token>' credential; the whole match collapses to the
// placeholder (which contains no 'Bearer', so a second pass is a no-op).
const BEARER_RE = /Bearer\s+[\w.\-~+/=]+/gi;
// A standalone 64-hex bearer token (the newToken() shape) anywhere in a string.
const HEX64_RE = /\b[a-f0-9]{64}\b/gi;
// An email address (local@domain.tld) anywhere in a string. Deliberately RFC-lite and
// conservative: it requires a dotted TLD of 2 to 24 letters, so a bare '@handle' or a
// 'name@build' version tag (no dot-TLD) survives while a real address is redacted.
// BOUNDED quantifiers (the RFC 5321 caps: 64-char local part, 255-char domain) keep the
// per-position backtracking constant, so a non-matching adversarial value scans in time
// linear in its length. The unbounded form was measurably quadratic (seconds on a 60 KB
// value), and the redactor runs on the same event-loop thread as the 20 Hz world loop,
// so that mattered. A local part longer than 64 chars is not a real email; its tail 64
// chars still redact, which destroys the address linkage either way.
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;

/** Scrub inline Bearer credentials, 64-hex tokens, and email addresses from a string. */
function redactString(raw: string): string {
  const scrubbed = raw.replace(BEARER_RE, REDACTED).replace(HEX64_RE, REDACTED);
  // The '@' probe skips the email pass entirely for the common no-address value.
  return scrubbed.includes('@') ? scrubbed.replace(EMAIL_RE, REDACTED) : scrubbed;
}

/**
 * Recursively redact `value`. `seen` is the ancestor set for path-based cycle
 * protection: an object that references one of its own ancestors resolves to the
 * placeholder (no infinite loop), while a value merely referenced twice in sibling
 * positions is still fully redacted each time (which keeps the result idempotent).
 */
function redactValue(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string') return redactString(value as string);
  if (type !== 'object') return value; // number, boolean, bigint, undefined, symbol, function
  const obj = value as object;
  // Do not clone-mangle an opaque Date leaf: it is returned by reference.
  if (obj instanceof Date) return obj;
  // Raw bytes are opaque to the key/pattern rules, so they collapse wholesale: a
  // secret held as a Buffer under a non-secret key must never serialize.
  if (Buffer.isBuffer(obj) || ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    return REDACTED;
  }
  if (seen.has(obj)) return REDACTED;
  seen.add(obj);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        out[key] = REDACTED;
      } else if (isOtpKey(key) && looksLikeOtpValue(val)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactValue(val, seen);
      }
    }
    return out;
  } finally {
    // Drop `obj` from the ancestor set on the way out so a legitimate second
    // reference in a sibling branch is not mistaken for a cycle.
    seen.delete(obj);
  }
}

/**
 * Return a redacted structural copy of `value` with every known secret/PII class
 * scrubbed to REDACTED. Total and side-effect-free: it never throws (an internal
 * failure yields the placeholder) and never mutates the input.
 */
export function redact(value: unknown): unknown {
  try {
    return redactValue(value, new Set<object>());
  } catch {
    return REDACTED;
  }
}
