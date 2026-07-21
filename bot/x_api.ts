// Minimal X (Twitter) API v2 client for posting the on-chain activity feed. Zero
// new dependencies: OAuth 1.0a user-context signing with node's crypto (HMAC-SHA1),
// POST to /2/tweets with a JSON body. Posting to X requires user-context OAuth 1.0a
// (an app-only bearer cannot create tweets), so the four credentials below are all
// required. The signing logic is pure and injectable (nonce + timestamp) so it is
// unit-tested against a fixed vector; postTweet is the thin IO shell.
import { createHmac, randomBytes } from 'node:crypto';

export interface XCredentials {
  apiKey: string; // OAuth1 consumer key
  apiSecret: string; // OAuth1 consumer secret
  accessToken: string; // user access token
  accessSecret: string; // user access token secret
}

const TWEETS_URL = 'https://api.twitter.com/2/tweets';

/** RFC 3986 percent-encoding (encodeURIComponent leaves ! * ' ( ) unescaped). */
export function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Build the OAuth 1.0a Authorization header for a request. For a JSON POST body the
 * body is NOT part of the signature base (only form-encoded bodies are), so the base
 * is just method + url + the sorted oauth_* params. nonce + timestamp are injected so
 * the signature is deterministic under test.
 */
export function oauthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  nonce: string,
  timestamp: string,
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(oauth[k])}`)
    .join('&');
  const base = [method.toUpperCase(), pctEncode(url), pctEncode(paramString)].join('&');
  const signingKey = `${pctEncode(creds.apiSecret)}&${pctEncode(creds.accessSecret)}`;
  const signature = createHmac('sha1', signingKey).update(base).digest('base64');
  const header: Record<string, string> = { ...oauth, oauth_signature: signature };
  return `OAuth ${Object.keys(header)
    .sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(header[k])}"`)
    .join(', ')}`;
}

/** Post one tweet. Returns the HTTP status; never throws on a non-2xx (the caller
 * logs it). Network/crypto errors reject and the caller catches. */
export async function postTweet(
  text: string,
  creds: XCredentials,
): Promise<{ ok: boolean; status: number }> {
  const nonce = randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const auth = oauthHeader('POST', TWEETS_URL, creds, nonce, timestamp);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(TWEETS_URL, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    return { ok: resp.ok, status: resp.status };
  } finally {
    clearTimeout(timer);
  }
}
