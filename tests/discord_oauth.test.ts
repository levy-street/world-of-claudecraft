import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  buildGuildJoinRequest,
  buildTokenRequestBody,
  DISCORD_SCOPES_WITH_JOIN,
  discordAvatarUrl,
  discordDisplayName,
  discordScopes,
  GUILD_JOIN_SCOPE,
  grantedScope,
  isDiscordLinkMode,
  isDiscordSnowflake,
  isMemberOfGuild,
  parseDiscordUser,
  parseGuildIds,
  parseTokenResponse,
  pkceChallengeFromVerifier,
} from '../server/discord_oauth';

describe('pkce', () => {
  it('matches the RFC 7636 S256 test vector', () => {
    // The canonical example from RFC 7636 Appendix B.
    expect(pkceChallengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('is deterministic and url-safe (no +/=)', () => {
    const a = pkceChallengeFromVerifier('verifier-one');
    const b = pkceChallengeFromVerifier('verifier-one');
    expect(a).toBe(b);
    expect(a).not.toMatch(/[+/=]/);
  });
});

describe('buildAuthorizeUrl', () => {
  it('encodes all required OAuth params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: '123',
        redirectUri: 'https://worldofclaudecraft.com/api/auth/discord/callback',
        state: 'nonce-abc',
        codeChallenge: 'chal',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://worldofclaudecraft.com/api/auth/discord/callback',
    );
    expect(url.searchParams.get('scope')).toBe('identify email guilds');
    expect(url.searchParams.get('state')).toBe('nonce-abc');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('buildTokenRequestBody', () => {
  it('produces a form body with the verifier and grant type', () => {
    const body = new URLSearchParams(
      buildTokenRequestBody({
        clientId: '123',
        clientSecret: 'sek',
        code: 'the-code',
        redirectUri: 'https://x/cb',
        codeVerifier: 'ver',
      }),
    );
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('ver');
    expect(body.get('client_secret')).toBe('sek');
  });
});

describe('response parsers', () => {
  it('parses a valid token response and rejects a bad one', () => {
    expect(
      parseTokenResponse({
        access_token: 'tok',
        token_type: 'Bearer',
        scope: 'identify',
        expires_in: 604800,
      }),
    ).toEqual({ accessToken: 'tok', tokenType: 'Bearer', scope: 'identify', expiresIn: 604800 });
    expect(parseTokenResponse({ error: 'invalid_grant' })).toBeNull();
    expect(parseTokenResponse(null)).toBeNull();
  });

  it('parses a valid user and rejects a non-snowflake id', () => {
    expect(
      parseDiscordUser({
        id: '80351110224678912',
        username: 'nelly',
        global_name: 'Nelly',
        avatar: 'abc',
      }),
    ).toEqual({
      id: '80351110224678912',
      username: 'nelly',
      globalName: 'Nelly',
      avatar: 'abc',
      email: null,
      emailVerified: false,
    });
    expect(parseDiscordUser({ id: 'not-a-snowflake', username: 'x' })).toBeNull();
    expect(parseDiscordUser({})).toBeNull();
  });

  it('captures a verified email from the email scope', () => {
    const user = parseDiscordUser({
      id: '80351110224678912',
      username: 'nelly',
      email: 'nelly@example.com',
      verified: true,
    });
    expect(user?.email).toBe('nelly@example.com');
    expect(user?.emailVerified).toBe(true);
  });

  it('keeps an unverified Discord email but does not mark it verified', () => {
    const user = parseDiscordUser({
      id: '80351110224678912',
      username: 'nelly',
      email: 'nelly@example.com',
      verified: false,
    });
    expect(user?.email).toBe('nelly@example.com');
    expect(user?.emailVerified).toBe(false);
  });

  it('drops a missing or malformed Discord email (email scope not granted)', () => {
    // No email field (scope not granted): email is null, never verified.
    const noScope = parseDiscordUser({ id: '80351110224678912', username: 'nelly' });
    expect(noScope?.email).toBeNull();
    expect(noScope?.emailVerified).toBe(false);
    // A malformed address is rejected even if `verified` is true.
    const bad = parseDiscordUser({
      id: '80351110224678912',
      username: 'nelly',
      email: 'not-an-email',
      verified: true,
    });
    expect(bad?.email).toBeNull();
    expect(bad?.emailVerified).toBe(false);
    // An over-254-char address is rejected (parity with the account validator cap).
    const tooLong = parseDiscordUser({
      id: '80351110224678912',
      username: 'nelly',
      email: `${'a'.repeat(250)}@example.com`,
      verified: true,
    });
    expect(tooLong?.email).toBeNull();
  });

  it('prefers the global display name over the legacy username', () => {
    expect(discordDisplayName({ username: 'legacy', globalName: 'Display' })).toBe('Display');
    expect(discordDisplayName({ username: 'legacy', globalName: null })).toBe('legacy');
    expect(discordDisplayName({ username: '', globalName: '  ' })).toBe('Discord user');
  });

  it('builds CDN avatar urls and detects animated avatars', () => {
    expect(discordAvatarUrl('80351110224678912', 'abc')).toContain(
      '/avatars/80351110224678912/abc.png',
    );
    expect(discordAvatarUrl('80351110224678912', 'a_anim')).toContain('.gif');
    expect(discordAvatarUrl('80351110224678912', null)).toBeNull();
  });

  it('extracts guild ids and checks membership', () => {
    const ids = parseGuildIds([{ id: '111111111111111111' }, { nope: true }, { id: 'bad' }]);
    expect(ids).toEqual(['111111111111111111']);
    expect(isMemberOfGuild(ids, '111111111111111111')).toBe(true);
    expect(isMemberOfGuild(ids, '222222222222222222')).toBe(false);
    expect(parseGuildIds('not an array')).toEqual([]);
  });
});

describe('auto-join (guilds.join)', () => {
  it('always requests the email scope, and guilds.join only when auto-join is enabled', () => {
    expect(discordScopes({ autoJoin: false })).toEqual(['identify', 'email', 'guilds']);
    expect(discordScopes({ autoJoin: true })).toEqual([
      'identify',
      'email',
      'guilds',
      'guilds.join',
    ]);
    // The email scope is present in both scope sets so every OAuth flow can capture it.
    expect(discordScopes({ autoJoin: false })).toContain('email');
    expect(DISCORD_SCOPES_WITH_JOIN).toContain('email');
    expect(DISCORD_SCOPES_WITH_JOIN).toContain(GUILD_JOIN_SCOPE);
  });

  it('adds guilds.join to the authorize URL scope when configured', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: '123',
        redirectUri: 'https://x/cb',
        state: 's',
        codeChallenge: 'c',
        scopes: discordScopes({ autoJoin: true }),
      }),
    );
    expect(url.searchParams.get('scope')).toBe('identify email guilds guilds.join');
  });

  it('detects the email scope in the granted-scope string (re-consent capture gate)', () => {
    expect(grantedScope('identify email guilds', 'email')).toBe(true);
    // A pre-email link (granted before the scope existed) reads as NOT granting email.
    expect(grantedScope('identify guilds', 'email')).toBe(false);
  });

  it('detects a granted scope in the space-separated token scope string', () => {
    expect(grantedScope('identify guilds guilds.join', GUILD_JOIN_SCOPE)).toBe(true);
    expect(grantedScope('identify guilds', GUILD_JOIN_SCOPE)).toBe(false);
    // A user who stripped the scope must not be treated as having granted it.
    expect(grantedScope('  identify   guilds  ', 'guilds')).toBe(true);
    expect(grantedScope('', GUILD_JOIN_SCOPE)).toBe(false);
  });

  it('builds the PUT guild-member request with the access token in the body', () => {
    const req = buildGuildJoinRequest({
      apiBase: 'https://discord.com/api/v10',
      guildId: '111111111111111111',
      userId: '999999999999999999',
      accessToken: 'user-access-tok',
    });
    expect(req).not.toBeNull();
    expect(req?.url).toBe(
      'https://discord.com/api/v10/guilds/111111111111111111/members/999999999999999999',
    );
    expect(JSON.parse(req?.body ?? '{}')).toEqual({ access_token: 'user-access-tok' });
  });

  it('refuses to build a request for a non-snowflake guild or user id', () => {
    const base = {
      apiBase: 'https://discord.com/api/v10',
      accessToken: 'tok',
    };
    expect(
      buildGuildJoinRequest({ ...base, guildId: 'nope', userId: '999999999999999999' }),
    ).toBeNull();
    expect(
      buildGuildJoinRequest({ ...base, guildId: '111111111111111111', userId: 'bad' }),
    ).toBeNull();
  });
});

describe('guards', () => {
  it('validates snowflakes and link modes', () => {
    expect(isDiscordSnowflake('80351110224678912')).toBe(true);
    expect(isDiscordSnowflake('123')).toBe(false);
    expect(isDiscordSnowflake(12345 as unknown)).toBe(false);
    expect(isDiscordLinkMode('login')).toBe(true);
    expect(isDiscordLinkMode('link')).toBe(true);
    expect(isDiscordLinkMode('hack')).toBe(false);
  });
});
