import type { Pool } from 'pg';
import type { SocialLoginProvider } from './social_login_oauth';

export const SOCIAL_LOGIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS social_login_links (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (account_id, provider)
);
CREATE INDEX IF NOT EXISTS social_login_links_account ON social_login_links(account_id);

CREATE TABLE IF NOT EXISTS social_login_oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_login_oauth_states_expires ON social_login_oauth_states(expires_at);
`;

export interface SocialLoginLinkRow {
  account_id: number;
  provider: SocialLoginProvider;
  provider_user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export async function createSocialLoginOAuthState(
  pool: Pool,
  params: {
    state: string;
    provider: SocialLoginProvider;
    codeVerifier: string;
    ttlMinutes: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO social_login_oauth_states (state, provider, code_verifier, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [params.state, params.provider, params.codeVerifier, String(params.ttlMinutes)],
  );
}

export async function consumeSocialLoginOAuthState(
  pool: Pool,
  state: string,
): Promise<{ provider: string; code_verifier: string } | null> {
  const res = await pool.query(
    `DELETE FROM social_login_oauth_states
      WHERE state = $1 AND expires_at > now()
      RETURNING provider, code_verifier`,
    [state],
  );
  return res.rows[0] ?? null;
}

export async function pruneSocialLoginOAuthStates(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM social_login_oauth_states WHERE expires_at <= now()');
}

export async function socialLoginLink(
  pool: Pool,
  provider: SocialLoginProvider,
  providerUserId: string,
): Promise<SocialLoginLinkRow | null> {
  const res = await pool.query(
    `SELECT account_id, provider, provider_user_id, display_name, email, avatar_url
       FROM social_login_links
      WHERE provider = $1 AND provider_user_id = $2`,
    [provider, providerUserId],
  );
  return res.rows[0] ?? null;
}

export async function upsertSocialLoginLink(
  pool: Pool,
  params: {
    accountId: number;
    provider: SocialLoginProvider;
    providerUserId: string;
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO social_login_links
       (account_id, provider, provider_user_id, display_name, email, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, provider_user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       email = COALESCE(EXCLUDED.email, social_login_links.email),
       avatar_url = COALESCE(EXCLUDED.avatar_url, social_login_links.avatar_url),
       linked_at = now()`,
    [
      params.accountId,
      params.provider,
      params.providerUserId,
      params.displayName,
      params.email,
      params.avatarUrl,
    ],
  );
}
