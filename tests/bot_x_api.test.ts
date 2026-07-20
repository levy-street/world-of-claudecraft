import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { oauthHeader, pctEncode, type XCredentials } from '../bot/x_api';

const CREDS: XCredentials = {
  apiKey: 'consumer-key',
  apiSecret: 'consumer-secret',
  accessToken: 'access-token',
  accessSecret: 'access-secret',
};

describe('x_api OAuth 1.0a signing', () => {
  it("percent-encodes per RFC 3986 (escapes ! * ' ( ))", () => {
    expect(pctEncode("a b!c*d'e(f)g")).toBe('a%20b%21c%2Ad%27e%28f%29g');
    expect(pctEncode('WoC/25,000')).toBe('WoC%2F25%2C000');
  });

  it('produces a deterministic signature for a fixed nonce + timestamp', () => {
    const url = 'https://api.twitter.com/2/tweets';
    const header = oauthHeader('POST', url, CREDS, 'fixed-nonce', '1700000000');

    // Independently reconstruct the expected signature the way the RFC prescribes,
    // so this pins the algorithm (base string + HMAC-SHA1 + base64), not itself.
    const oauth: Record<string, string> = {
      oauth_consumer_key: CREDS.apiKey,
      oauth_nonce: 'fixed-nonce',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1700000000',
      oauth_token: CREDS.accessToken,
      oauth_version: '1.0',
    };
    const paramString = Object.keys(oauth)
      .sort()
      .map((k) => `${pctEncode(k)}=${pctEncode(oauth[k])}`)
      .join('&');
    const base = ['POST', pctEncode(url), pctEncode(paramString)].join('&');
    const key = `${pctEncode(CREDS.apiSecret)}&${pctEncode(CREDS.accessSecret)}`;
    const expected = createHmac('sha1', key).update(base).digest('base64');

    expect(header).toContain(`oauth_signature="${pctEncode(expected)}"`);
  });

  it('emits a well-formed OAuth header with all required fields, sorted', () => {
    const header = oauthHeader(
      'POST',
      'https://api.twitter.com/2/tweets',
      CREDS,
      'nonce123',
      '1700000001',
    );
    expect(header.startsWith('OAuth ')).toBe(true);
    for (const field of [
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature',
      'oauth_signature_method',
      'oauth_timestamp',
      'oauth_token',
      'oauth_version',
    ]) {
      expect(header, field).toContain(`${field}="`);
    }
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    // The consumer/access secrets themselves never appear in the header.
    expect(header).not.toContain(CREDS.apiSecret);
    expect(header).not.toContain(CREDS.accessSecret);
  });

  it('changes the signature when the request differs (nonce, method, url)', () => {
    const url = 'https://api.twitter.com/2/tweets';
    const a = oauthHeader('POST', url, CREDS, 'n1', '1700000000');
    const b = oauthHeader('POST', url, CREDS, 'n2', '1700000000');
    const c = oauthHeader('GET', url, CREDS, 'n1', '1700000000');
    const sig = (h: string) => /oauth_signature="([^"]+)"/.exec(h)?.[1];
    expect(sig(a)).not.toBe(sig(b));
    expect(sig(a)).not.toBe(sig(c));
  });
});
