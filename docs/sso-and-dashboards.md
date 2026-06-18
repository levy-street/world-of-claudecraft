# OIDC SSO + role-tiered dashboards (admin / moderator / user)

This branch adds three additive features that extend the existing admin
pattern. All opt-in; nothing breaks if you don't apply the db migration.

## What's in here

| File | Purpose |
|---|---|
| `server/oidc.ts` | Generic OpenID Connect SSO routes at `/api/oidc/{login,callback}`. Provider-agnostic via `.well-known/openid-configuration` discovery. Self-disables (501) when env vars aren't set. |
| `server/dashboard.ts` | `/me/api/*` (any logged-in account) + `/mod/api/*` (moderator or admin) handlers. Same `{success,data,error}` envelope as `server/admin.ts`. |
| `src/user/{api,main}.ts` + `user.html` | `/me/` dashboard SPA — own characters, role chips, standing. |
| `src/moderator/{api,main}.ts` + `mod.html` | `/mod/` dashboard SPA — mod login + read-only queue. |

## Integration steps

Three files in your existing codebase need additive edits.

### 1. `server/db.ts` — schema migrations + 3 helpers + 1 upsert

Add to the `SCHEMA` template literal (idempotent, safe to re-run):

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_oauth_identity
  ON accounts(oauth_provider, oauth_sub) WHERE oauth_provider IS NOT NULL;
```

Add these helpers below the existing `isAdminAccount`:

```ts
export async function isModeratorAccount(accountId: number): Promise<boolean> {
  const res = await pool.query(
    'SELECT is_admin, is_moderator FROM accounts WHERE id = $1',
    [accountId],
  );
  const row = res.rows[0];
  return row?.is_admin === true || row?.is_moderator === true;
}

export interface AccountRoleFlags { isAdmin: boolean; isModerator: boolean; }

export async function accountRoleFlags(accountId: number): Promise<AccountRoleFlags> {
  const res = await pool.query(
    'SELECT is_admin, is_moderator FROM accounts WHERE id = $1',
    [accountId],
  );
  const row = res.rows[0];
  return {
    isAdmin: row?.is_admin === true,
    isModerator: row?.is_moderator === true || row?.is_admin === true,
  };
}

export interface OAuthUpsertResult { id: number; username: string; created: boolean; }

function sanitizeUsernameCandidate(raw: string): string {
  const stripped = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  return stripped.length >= 3 ? stripped : (stripped ? `${stripped}_usr` : 'usr');
}

export async function upsertOAuthAccount(input: {
  provider: string;
  sub: string;
  displayName: string;
}): Promise<OAuthUpsertResult> {
  // Existing link wins — no username conflicts to worry about.
  const existing = await pool.query(
    'SELECT id, username FROM accounts WHERE oauth_provider = $1 AND oauth_sub = $2 LIMIT 1',
    [input.provider, input.sub],
  );
  if (existing.rows.length) {
    return { id: existing.rows[0].id, username: existing.rows[0].username, created: false };
  }
  // Brand new identity: derive a free username and create the row.
  const base = sanitizeUsernameCandidate(input.displayName || input.sub);
  let candidate = base;
  for (let n = 1; n < 9999; n++) {
    const dupe = await pool.query('SELECT id FROM accounts WHERE username = $1 LIMIT 1', [candidate]);
    if (!dupe.rows.length) break;
    candidate = `${base.slice(0, 18)}_${n}`;
  }
  // OAuth accounts have no password — store a sentinel that won't pass
  // scrypt verification, so the username can never be logged into via
  // /api/login.
  const res = await pool.query(
    `INSERT INTO accounts (username, password_hash, oauth_provider, oauth_sub)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username`,
    [candidate, 'oauth:' + input.provider, input.provider, input.sub],
  );
  return { id: res.rows[0].id, username: res.rows[0].username, created: true };
}
```

### 2. `server/main.ts` — register the new dispatchers

Add these imports at the top, near `handleAdminApi`:

```ts
import { handleModeratorApi, handleUserApi } from './dashboard';
import { handleOidcRoute, isOidcConfigured } from './oidc';
```

Update the request dispatcher:

```ts
    const isApi =
      url.startsWith('/api/') ||
      url.startsWith('/admin/api/') ||
      url.startsWith('/mod/api/') ||
      url.startsWith('/me/api/');
    if (isApi) maybeCors(req, res);
    if (req.method === 'OPTIONS' && isApi) { res.writeHead(204); res.end(); return; }
    if (url.startsWith('/admin/api/')) void handleAdminApi(req, res, game);
    else if (url.startsWith('/mod/api/')) void handleModeratorApi(req, res);
    else if (url.startsWith('/me/api/')) void handleUserApi(req, res);
    else if (url.startsWith('/api/oidc')) void handleOidcRoute(req, res);
    else if (url.startsWith('/api/')) void handleApi(req, res);
    else serveStatic(req, res);
```

Extend `serveStatic` to swap shells for `/me/` and `/mod/`:

```ts
function dashboardShellFor(urlPath: string): string | null {
  if (urlPath === '/mod' || urlPath === '/mod/') return 'mod.html';
  if (urlPath === '/me' || urlPath === '/me/') return 'user.html';
  return null;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  let urlPath = (req.url ?? '/').split('?')[0];
  const dashShell = dashboardShellFor(urlPath);
  const shell = dashShell ?? (isAdminRequest(req) ? 'admin.html' : 'index.html');
  // …existing wiki redirect…
  if (
    urlPath === '/' ||
    urlPath === '/admin' || urlPath === '/admin/' ||
    urlPath === '/mod'   || urlPath === '/mod/'   ||
    urlPath === '/me'    || urlPath === '/me/'
  ) urlPath = `/${shell}`;
  // …existing static file handling…
}
```

Optional boot log:

```ts
    if (isOidcConfigured()) {
      console.log('  SSO:  OIDC enabled at /api/oidc/login');
    }
```

### 3. `vite.config.ts` — add the two new entries

```ts
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
        user: fileURLToPath(new URL('user.html', import.meta.url)),
        moderator: fileURLToPath(new URL('mod.html', import.meta.url)),
      },
```

## Configuration

### OIDC SSO env vars

All four must be set, otherwise `/api/oidc/login` returns 501 and `/api/login`
keeps being the only entry point.

```
OIDC_ISSUER=https://auth.example.com/application/o/woc
OIDC_CLIENT_ID=<provider issues this when you register WoC>
OIDC_CLIENT_SECRET=<same>
OIDC_REDIRECT_URI=https://your-deploy.example.com/api/oidc/callback
```

The issuer URL is whatever your provider documents as the per-application
issuer (on Authentik it's `https://<auth>/application/o/<app-slug>`). We
fetch `<issuer>/.well-known/openid-configuration` once at first request and
cache the discovered `authorization_endpoint` / `token_endpoint` /
`userinfo_endpoint`. Tested against Authentik 2025.8.x; same code path works
unchanged with any conformant OIDC 1.0 provider (Keycloak / Auth0 /
Ory Hydra / Cognito / Zitadel).

The callback redirects back to `/#auth_token=…&auth_user=…&auth_via=oidc`.
Token format is the same 64-hex Bearer the existing `/api/login` issues.

### Granting moderator access

```sql
UPDATE accounts SET is_moderator = TRUE WHERE username = '<name>';
```

Admins are implicit moderators; no need to grant both.

## Roll-back

The migration columns + index are additive and safe to leave in place even if
you disable the routes. To turn the feature off entirely:

- Unset the `OIDC_*` env vars (route returns 501).
- Remove the dispatcher branches in `server/main.ts`.
- Drop `user.html` and `mod.html` from `vite.config.ts` inputs.
