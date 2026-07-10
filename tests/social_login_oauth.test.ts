import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  parseGoogleUser,
  parseKickUser,
  parseTokenResponse,
  parseTwitchUser,
  pkceChallengeFromVerifier,
} from '../server/social_login_oauth';

describe('social login oauth helpers', () => {
  it('builds provider authorize URLs with PKCE and provider scopes', () => {
    const url = new URL(
      buildAuthorizeUrl({
        provider: 'google',
        clientId: 'client',
        redirectUri: 'https://game.example/api/auth/google/callback',
        state: 'state',
        codeChallenge: pkceChallengeFromVerifier('verifier'),
      }),
    );

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client');
    expect(url.searchParams.get('state')).toBe('state');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
  });

  it('parses token and provider profile responses', () => {
    expect(parseTokenResponse({ access_token: 'tok', token_type: 'Bearer' })).toEqual({
      accessToken: 'tok',
      tokenType: 'Bearer',
    });
    expect(
      parseGoogleUser({
        sub: 'google-user',
        name: 'Ada',
        email: 'ada@example.com',
        email_verified: true,
        picture: 'https://example.com/a.png',
      }),
    ).toMatchObject({ providerUserId: 'google-user', displayName: 'Ada', emailVerified: true });
    expect(
      parseTwitchUser({
        data: [{ id: '123', display_name: 'Streamer', email: 's@example.com' }],
      }),
    ).toMatchObject({ providerUserId: '123', displayName: 'Streamer' });
    expect(parseKickUser({ data: [{ user_id: 456, name: 'Kicker' }] })).toMatchObject({
      providerUserId: '456',
      displayName: 'Kicker',
    });
  });
});
