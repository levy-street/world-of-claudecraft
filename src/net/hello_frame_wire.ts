// Field decodes for the server `hello` frame (and the `censor` frame's word list),
// kept out of ClientWorld (src/net/online.ts) in the wire-decode sibling idiom:
// every field re-validated, a malformed value read as absent.

// The soft (cosmetic) profanity words a `hello` or `censor` frame carries, string
// entries only, or null when the field is not a list at all.
export function softWordList(raw: unknown): string[] | null {
  return Array.isArray(raw) ? raw.filter((w: unknown): w is string => typeof w === 'string') : null;
}

// The same-client resume token a `hello` carries (server/session_hello.ts), or null
// when it carries none (an older server binary mid rolling deploy). ClientWorld keeps
// it in memory only and echoes it through buildWebSocketAuthMessage on reconnect.
export function helloResumeToken(hello: { resumeToken?: unknown }): string | null {
  return typeof hello.resumeToken === 'string' && hello.resumeToken ? hello.resumeToken : null;
}
