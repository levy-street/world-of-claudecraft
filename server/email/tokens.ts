// Pure token helpers for the email-change + unsubscribe flows. We hand the raw
// token to the user (in a link) and persist only its SHA-256, so a database leak
// cannot be replayed into an inbox takeover. Mirrors the random-bytes approach
// auth.ts uses for session tokens.
import { randomBytes, createHash } from 'node:crypto';

export interface EmailToken {
  // The secret that travels in the email link. Never stored.
  token: string;
  // SHA-256 of the token. The only value written to the database.
  tokenHash: string;
}

export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function makeEmailToken(): EmailToken {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashEmailToken(token) };
}
