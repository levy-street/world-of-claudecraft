import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  buildTokenRequestBody,
  githubProfileUrl,
  isGitHubLogin,
  parseGitHubUser,
  parseTokenResponse,
} from '../server/github_oauth';

describe('isGitHubLogin', () => {
  it('accepts valid GitHub logins', () => {
    expect(isGitHubLogin('FernandoX7')).toBe(true);
    expect(isGitHubLogin('jgyy')).toBe(true);
    expect(isGitHubLogin('ryan-foo')).toBe(true);
    expect(isGitHubLogin('a')).toBe(true);
    expect(isGitHubLogin('a'.repeat(39))).toBe(true);
  });

  it('rejects malformed logins', () => {
    expect(isGitHubLogin('-leading')).toBe(false);
    expect(isGitHubLogin('trailing-')).toBe(false);
    expect(isGitHubLogin('double--hyphen')).toBe(false);
    expect(isGitHubLogin('has space')).toBe(false);
    expect(isGitHubLogin('under_score')).toBe(false);
    expect(isGitHubLogin('a'.repeat(40))).toBe(false);
    expect(isGitHubLogin('')).toBe(false);
    expect(isGitHubLogin(42)).toBe(false);
    expect(isGitHubLogin(null)).toBe(false);
  });
});

describe('buildAuthorizeUrl', () => {
  it('encodes all required OAuth params', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://woc.example/api/auth/github/callback',
      state: 'st4te',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('https://woc.example/api/auth/github/callback');
    expect(u.searchParams.get('state')).toBe('st4te');
    expect(u.searchParams.get('scope')).toBe('read:user');
    expect(u.searchParams.get('allow_signup')).toBe('true');
  });

  it('honors allow_signup=false', () => {
    const url = buildAuthorizeUrl({
      clientId: 'c',
      redirectUri: 'https://x/cb',
      state: 's',
      allowSignup: false,
    });
    expect(new URL(url).searchParams.get('allow_signup')).toBe('false');
  });
});

describe('buildTokenRequestBody', () => {
  it('produces a form body with the code, secret and state', () => {
    const body = buildTokenRequestBody({
      clientId: 'cid',
      clientSecret: 'secret',
      code: 'abc',
      redirectUri: 'https://x/cb',
      state: 'st',
    });
    const p = new URLSearchParams(body);
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('client_secret')).toBe('secret');
    expect(p.get('code')).toBe('abc');
    expect(p.get('redirect_uri')).toBe('https://x/cb');
    expect(p.get('state')).toBe('st');
  });
});

describe('response parsers', () => {
  it('parses a valid token response and rejects bad ones', () => {
    expect(
      parseTokenResponse({ access_token: 'tok', token_type: 'bearer', scope: 'read:user' }),
    ).toEqual({ accessToken: 'tok', tokenType: 'bearer', scope: 'read:user' });
    // GitHub returns an { error } body (HTTP 200) for a bad code: no access_token.
    expect(parseTokenResponse({ error: 'bad_verification_code' })).toBeNull();
    expect(parseTokenResponse({})).toBeNull();
    expect(parseTokenResponse(null)).toBeNull();
  });

  it('parses a valid user and rejects a non-integer id or invalid login', () => {
    expect(
      parseGitHubUser({
        id: 16779411,
        login: 'FernandoX7',
        avatar_url: 'https://a/x.png',
        html_url: 'https://github.com/FernandoX7',
      }),
    ).toEqual({
      id: '16779411',
      login: 'FernandoX7',
      avatarUrl: 'https://a/x.png',
      profileUrl: 'https://github.com/FernandoX7',
    });
    // Falls back to the derived profile URL when html_url is absent.
    expect(parseGitHubUser({ id: 5, login: 'jgyy' })?.profileUrl).toBe('https://github.com/jgyy');
    expect(parseGitHubUser({ id: '5', login: 'jgyy' })).toBeNull(); // id not a number
    expect(parseGitHubUser({ id: 0, login: 'jgyy' })).toBeNull(); // non-positive id
    expect(parseGitHubUser({ id: 5, login: '-bad' })).toBeNull(); // invalid login
    expect(parseGitHubUser(null)).toBeNull();
  });

  it('builds the public profile URL', () => {
    expect(githubProfileUrl('jgyy')).toBe('https://github.com/jgyy');
  });
});
