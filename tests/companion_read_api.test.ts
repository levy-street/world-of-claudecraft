// Read-only scoped-token guarantees. The behavioral 403 promise is enforced at a
// single choke point — bearerActiveAccount rejects scope!=='full' — so this suite
// proves (a) the scope policy itself, (b) every mutating route funnels through
// that choke point (a source scan that "loops the list"), and (c) the migration
// is additive with old tokens reading 'full'. main.ts cannot be imported (it
// boots a server + connects to Postgres on import), so the route coverage is
// verified structurally rather than over a live socket.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// db.ts builds a pg Pool at import; give it a dummy URL (no connection is made
// until a query runs, and these tests never query).
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

const { scopeAllowsMutation, scopeAllowsRead, SCHEMA } = await import('../server/db');

const MAIN = readFileSync(join(__dirname, '..', 'server', 'main.ts'), 'utf8');
const SERVER_DIR = join(__dirname, '..', 'server');

function serverTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return serverTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, '');
}

type BearerAccountUse = {
  kind: 'declaration' | 'call' | 'reference';
  enclosingIf: string | null;
};

function bearerAccountUses(source: string): BearerAccountUse[] {
  const sourceFile = ts.createSourceFile(
    'resolver-scan.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const uses: BearerAccountUse[] = [];

  function enclosingIf(node: ts.Node): string | null {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isIfStatement(current)) return current.expression.getText(sourceFile);
    }
    return null;
  }

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === 'bearerAccount') {
      const parent = node.parent;
      if (ts.isFunctionDeclaration(parent) && parent.name === node) {
        uses.push({ kind: 'declaration', enclosingIf: null });
      } else if (ts.isCallExpression(parent) && parent.expression === node) {
        uses.push({ kind: 'call', enclosingIf: enclosingIf(parent) });
      } else {
        uses.push({ kind: 'reference', enclosingIf: enclosingIf(node) });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return uses;
}

describe('token scope policy', () => {
  it('only a full token may mutate', () => {
    expect(scopeAllowsMutation('full')).toBe(true);
    expect(scopeAllowsMutation('read')).toBe(false);
  });
  it('both read and full may read', () => {
    expect(scopeAllowsRead('full')).toBe(true);
    expect(scopeAllowsRead('read')).toBe(true);
  });
});

describe('migration is additive; old tokens read full', () => {
  it('adds the scope and label columns to auth_tokens', () => {
    expect(SCHEMA).toMatch(
      /ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full'/,
    );
    expect(SCHEMA).toMatch(/ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS label TEXT/);
  });
  it("defaults scope to 'full' so pre-existing sessions keep full power", () => {
    // The DEFAULT 'full' on the additive column is what makes every token that
    // predates the scope column read back as a full session.
    expect(SCHEMA).toContain("scope TEXT NOT NULL DEFAULT 'full'");
  });
  it('rejects new token rows whose scope is outside the closed scope vocabulary', () => {
    expect(SCHEMA).toMatch(
      /CONSTRAINT auth_tokens_scope_check CHECK \(scope IN \('full', 'read'\)\) NOT VALID/,
    );
  });
  it('adds the scope column before installing the constraint that references it', () => {
    const authTokensTable = SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS auth_tokens (');
    const scopeColumn = SCHEMA.indexOf(
      "ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full'",
    );
    const scopeConstraint = SCHEMA.indexOf('ADD CONSTRAINT auth_tokens_scope_check');
    expect(authTokensTable).toBeGreaterThanOrEqual(0);
    expect(scopeColumn).toBeGreaterThanOrEqual(0);
    expect(scopeConstraint).toBeGreaterThanOrEqual(0);
    expect(authTokensTable).toBeLessThan(scopeColumn);
    expect(scopeColumn).toBeLessThan(scopeConstraint);
  });
});

describe('legacy scope-blind resolver removal', () => {
  it('strips standalone prose comments without hiding code-like string contents', () => {
    const codeAfterUrl = "const base = 'http://localhost'; accountForToken(token);";
    expect(stripComments(codeAfterUrl)).toContain('accountForToken(token)');

    const codeBetweenBlockMarkers =
      "const open = '/*'; accountForToken(token); const close = '*/';";
    expect(stripComments(codeBetweenBlockMarkers)).toContain('accountForToken(token)');

    const proseOnly = '// accountForToken was removed\nconst safe = true;';
    expect(stripComments(proseOnly)).not.toContain('accountForToken');
  });

  it('has no production reference to the removed accountForToken helper', () => {
    const offenders = serverTypeScriptFiles(SERVER_DIR)
      .filter((file) => /\baccountForToken\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(SERVER_DIR.length + 1))
      .sort();
    expect(offenders).toEqual([]);
  });
});

describe('scope-blind bearerAccount remains confined to read routes', () => {
  const READ_ROUTE_CONDITIONS = [
    "req.method === 'GET' && url === '/api/realms'",
    "req.method === 'GET' && url === '/api/search'",
    "req.method === 'GET' && mapIdMatch",
  ];
  const READ_ROUTE_ANCHORS = READ_ROUTE_CONDITIONS.map((condition) => `if (${condition}) {`);

  it('is called exactly once by each of its three permitted read routes', () => {
    const count = (MAIN.match(/bearerAccount\(req\)/g) ?? []).length;
    expect(count).toBe(READ_ROUTE_ANCHORS.length);
  });

  it('classifies an indirect alias as an unexpected resolver reference', () => {
    const uses = bearerAccountUses(`
      async function bearerAccount(req: unknown): Promise<null> { return null; }
      const lookup = bearerAccount;
      await lookup(req);
    `);
    expect(uses).toEqual([
      { kind: 'declaration', enclosingIf: null },
      { kind: 'reference', enclosingIf: null },
    ]);
  });

  it('has no aliases and owns each call lexically inside a permitted GET branch', () => {
    expect(bearerAccountUses(MAIN)).toEqual([
      { kind: 'declaration', enclosingIf: null },
      ...READ_ROUTE_CONDITIONS.map((enclosingIf) => ({ kind: 'call', enclosingIf })),
    ]);
  });

  for (const anchor of READ_ROUTE_ANCHORS) {
    it(`gates: ${anchor}`, () => {
      const idx = MAIN.indexOf(anchor);
      expect(idx, `anchor not found: ${anchor}`).toBeGreaterThanOrEqual(0);
      expect(MAIN.slice(idx, idx + 500)).toContain('bearerAccount(req)');
    });
  }
});

describe('every mutating / owner-action route funnels through bearerActiveAccount', () => {
  // The reference "loop the list": each of these route handlers must gate on
  // bearerActiveAccount (which rejects read tokens), never on the read/optional
  // helpers. Anchored on the route guard literal in main.ts.
  const MUTATING_ROUTE_ANCHORS = [
    "if (url === '/api/characters') {", // POST create (and GET list)
    "if (req.method === 'POST' && renameMatch) {",
    "if (req.method === 'POST' && takeoverMatch) {",
    "if (req.method === 'DELETE' && delMatch) {",
    "if (req.method === 'GET' && standingMatch) {", // owner-scoped read
    "if (req.method === 'POST' && url === '/api/reports') {",
    "if (req.method === 'POST' && url === '/api/bug-reports') {",
    "if (url === '/api/account/companion-token') {",
    "if (req.method === 'POST' && url === '/api/account/password') {",
    "if (req.method === 'POST' && url === '/api/account/email') {",
    "if (req.method === 'POST' && url === '/api/account/deactivate') {",
    "if (req.method === 'POST' && url === '/api/wallet/link/challenge') {",
    "if (req.method === 'POST' && url === '/api/wallet/link') {",
    "if (req.method === 'DELETE' && url === '/api/wallet/link') {",
    "if (req.method === 'GET' && url === '/api/wallet') {",
    "if (req.method === 'POST' && url === '/api/card') {",
    "if (req.method === 'GET' && url === '/api/referrals') {",
  ];

  for (const anchor of MUTATING_ROUTE_ANCHORS) {
    it(`gates: ${anchor}`, () => {
      const idx = MAIN.indexOf(anchor);
      expect(idx, `anchor not found: ${anchor}`).toBeGreaterThanOrEqual(0);
      // The bearerActiveAccount call is always within the first few lines of the
      // handler block. Scan a generous window after the anchor.
      const window = MAIN.slice(idx, idx + 600);
      expect(window).toContain('bearerActiveAccount(req, res)');
    });
  }
});

describe('sheet routes use the right gate', () => {
  it('owner /sheet accepts read tokens via bearerReadAccount', () => {
    const idx = MAIN.indexOf('const ownerSheetMatch = /^\\/api\\/characters\\/(\\d+)\\/sheet$/');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(MAIN.slice(idx, idx + 600)).toContain('bearerReadAccount(req, res)');
  });

  it('public /sheet requires no auth and is rate-limited', () => {
    const idx = MAIN.indexOf('const publicSheetMatch =');
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = MAIN.slice(idx, idx + 700);
    expect(block).toContain('publicReadRateLimited(req)');
    expect(block).not.toContain('bearerActiveAccount');
    expect(block).not.toContain('bearerReadAccount');
  });

  it('bearerReadAccount gates exactly the four read routes (owner /sheet, /api/me/characters, /api/maps, /api/assets/mine)', () => {
    const count = (MAIN.match(/bearerReadAccount\(req, res\)/g) ?? []).length;
    expect(count).toBe(4);
  });
});

describe('GET /api/me/characters (read-scoped my-characters list)', () => {
  it('is gated by bearerReadAccount and reuses the shared list payload', () => {
    const idx = MAIN.indexOf("url === '/api/me/characters'");
    expect(idx).toBeGreaterThanOrEqual(0);
    // Bound the block at the NEXT route branch (not a fixed width): the list
    // call is multi-line since it gained the Armory loadout argument, and the
    // bearerActiveAccount exclusion below must not swallow the next route.
    const end = MAIN.indexOf('if (url ===', idx + 1);
    const block = MAIN.slice(idx, end === -1 ? idx + 500 : end);
    expect(block).toContain('bearerReadAccount(req, res)');
    // The list payload call gained the account Armory loadout argument (the
    // char-select preview resolves the active weapon skin per character).
    expect(block).toContain('characterListPayload(');
    expect(block).toContain('await listCharacters(accountId)');
    expect(block).toContain('(await loadAccountCosmetics(accountId)).weaponSkinLoadout');
    expect(block).not.toContain('bearerActiveAccount');
  });

  it('returns the same shape as GET /api/characters (both call characterListPayload)', () => {
    const calls = (
      MAIN.match(
        /characterListPayload\(\s*await listCharacters\(accountId\),\s*\(await loadAccountCosmetics\(accountId\)\)\.weaponSkinLoadout,\s*\)/g,
      ) ?? []
    ).length;
    expect(calls).toBe(2); // /api/me/characters and the full-session GET /api/characters
  });

  it('is matched before the generic /api/characters route', () => {
    expect(MAIN.indexOf("url === '/api/me/characters'")).toBeLessThan(
      MAIN.indexOf("if (url === '/api/characters')"),
    );
  });
});

describe('CORS opens only the public read surfaces', () => {
  it('routes public read paths through wide-open CORS, others through the narrow allowlist', () => {
    expect(MAIN).toContain('isPublicCorsPath(path)');
    expect(MAIN).toContain('publicCors(res)');
    // The * is set only in publicCors, not maybeCors.
    const publicCorsIdx = MAIN.indexOf('function publicCors');
    expect(MAIN.slice(publicCorsIdx, publicCorsIdx + 300)).toContain(
      "'Access-Control-Allow-Origin', '*'",
    );
  });
});

describe('OAuth token revocation is scope-restricted', () => {
  const DB = readFileSync(join(__dirname, '..', 'server', 'db.ts'), 'utf8');
  const OAUTH = readFileSync(join(__dirname, '..', 'server', 'oauth.ts'), 'utf8');

  it("revokeReadToken deletes only scope='read' rows (never a full web session)", () => {
    const idx = DB.indexOf('export async function revokeReadToken');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(DB.slice(idx, idx + 300)).toContain("scope = 'read'");
  });

  it('POST /oauth/revoke is dispatched and uses the scope-restricted revoke', () => {
    expect(OAUTH).toContain("path === '/oauth/revoke'");
    const idx = OAUTH.indexOf('async function revokeEndpoint');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(OAUTH.slice(idx, idx + 300)).toContain('revokeReadToken(token)');
  });
});
