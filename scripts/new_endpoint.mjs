#!/usr/bin/env node
// Scaffold a new endpoint on the server/http/ REST pipeline from one descriptor.
//
// `npm run new:endpoint -- --domain <slug> --method <METHOD> --path </api/...> [--public]`
// emits everything a contributor needs to add an endpoint: a per-domain RouteDef
// module (server/<domain>.ts) with a typed schema derived via Infer, a FakeDb-based
// test (tests/server/<domain>.test.ts), one appended paired error code plus its
// English apiError.* catalog entry and API_ERROR_KEYS client mapping, the append-only
// snapshot rows the two code-parity guards need, and the registry registration.
//
// The AUTH RUNG is derived from the descriptor, never guessed at call sites:
//   --public                        public read (no auth); meta.publicRead if the path has a :param
//   a :param in the path (no flag)  owner-gated: a requireOwned loader + meta.requireOwned, denial 404
//   otherwise                       authenticated: a requireAccount-style bearer guard
//
// The PAIRED CODE for the stub's failure path follows one rule: owner-gated emits
// `<domain>.not_found` (the requireOwned 404), every other rung emits
// `<domain>.invalid_input` (a stub domain-validation reject).
//
// Import specifiers in the emitted files are COMPUTED relative to --repo (the real
// spine), so a --root <tmpdir> emission still resolves against the real repo; when
// --root equals --repo the result is the natural specifier ('./http/types', etc.).
//
// Pure string-building functions are EXPORTED for unit testing; file I/O runs only in
// the CLI main block, mirroring scripts/version_sync.mjs.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative as pathRelative, sep as pathSep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Named constants (single source of truth for every default and magic string).
// ---------------------------------------------------------------------------

export const SCRIPT_NAME = 'new:endpoint';
/** The HTTP methods the scaffold knows how to emit a handler for. */
export const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** A valid domain slug: lowercase, digit, underscore, starting with a letter. */
export const DOMAIN_PATTERN = /^[a-z][a-z0-9_]*$/;
/**
 * A valid request path: a leading slash then only path-segment/param characters
 * (letters, digits, _ - / :). Rejects quotes, backslashes, whitespace, and template
 * characters so the path cannot break out of the emitted TS string literals.
 */
export const PATH_PATTERN = /^\/[A-Za-z0-9_:/-]*$/;
/** The reason half of the paired code, per rung. */
export const OWNER_REASON = 'not_found';
export const OTHER_REASON = 'invalid_input';
/** Path-prefix to Surface, mirroring the four dispatch families in main.ts. */
export const SURFACE_BY_PREFIX = [
  ['/admin/api/', 'admin'],
  ['/oauth/', 'oauth'],
  ['/internal/', 'internal'],
  ['/api/', 'api'],
];
export const DEFAULT_SURFACE = 'api';
/** The ctx.state key + BOLA kind for the owned resource is the domain slug. */
export const OWNED_KEY_FROM_DOMAIN = (domain) => domain;

// The registry anchor comments the scaffold inserts a new domain's import + spread
// ABOVE. They are behind-free one-liners already present in the real registry.ts.
export const REGISTRY_IMPORT_ANCHOR =
  '// new:endpoint imports appear above this line (npm run new:endpoint)';
export const REGISTRY_SPREAD_ANCHOR =
  '  // new:endpoint spreads appear above this line (npm run new:endpoint)';

// Insertion sentinels for the append-only targets. Each is a literal that appears
// exactly once in its file, at the point new content must precede.
export const ERROR_CODES_TAIL = '} as const);';
export const API_ERROR_KEYS_CONST = 'export const API_ERROR_KEYS = {';
export const API_ERROR_KEYS_TAIL = '} satisfies Record<string, TranslationKey>;';
export const CATALOG_CONST = 'export const apiErrorStrings = {';
export const CATALOG_TAIL = '};';
export const EXPECTED_CODES_CONST = 'const EXPECTED_CODES = [';
export const KNOWN_CODES_CONST = 'const KNOWN_CODES = [';

// Repo-relative locations of the append/registration targets.
export const ERROR_CODES_FILE = 'server/http/error_codes.ts';
export const ERROR_CODES_TEST_FILE = 'tests/server/http/error_codes.test.ts';
export const CODE_PARITY_TEST_FILE = 'tests/api_error_code_parity.test.ts';
export const API_ERROR_KEYS_FILE = 'src/ui/api_error_i18n.ts';
export const CATALOG_FILE = 'src/ui/i18n.catalog/api_error.ts';
export const REGISTRY_FILE = 'server/http/registry.ts';

// Spine modules the emitted files import, keyed by a stable name. Values are the
// repo-relative path WITHOUT the .ts extension (specifiers are extensionless).
const SPINE = {
  schema: 'server/http/schema',
  types: 'server/http/types',
  httpUtil: 'server/http_util',
  body: 'server/http/middleware/body',
  requireOwned: 'server/http/middleware/require_owned',
  bearerGuard: 'server/http/middleware/bearer_active_guard',
  db: 'server/db',
  compose: 'server/http/compose',
  helpers: 'tests/server/helpers',
};

// A dummy DATABASE_URL for the emitted test's first line. server/db.ts throws at
// module load when DATABASE_URL is unset, and the spine graph the emitted module
// pulls in may reach it; the fakes replace every query, so the pool never connects.
export const TEST_DATABASE_URL = 'postgres://test:test@127.0.0.1:5433/wocc_new_endpoint_scaffold';

// ---------------------------------------------------------------------------
// Descriptor parsing + derivation (pure).
// ---------------------------------------------------------------------------

/** A concise usage error the CLI prints before exiting nonzero. */
export class UsageError extends Error {}

/**
 * Parse an argv slice (after `node script`) into a raw descriptor. Recognizes
 * --domain/--method/--path/--public/--root/--repo/--help. Throws UsageError on an
 * unknown flag or a missing value so the CLI can exit nonzero with a clear message.
 */
export function parseArgs(argv) {
  const raw = { public: false, help: false, root: undefined, repo: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      i++;
      return value;
    };
    switch (arg) {
      case '--help':
      case '-h':
        raw.help = true;
        break;
      case '--domain':
        raw.domain = next();
        break;
      case '--method':
        raw.method = next();
        break;
      case '--path':
        raw.path = next();
        break;
      case '--public':
        raw.public = true;
        break;
      case '--root':
        raw.root = next();
        break;
      case '--repo':
        raw.repo = next();
        break;
      default:
        throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return raw;
}

/** slug -> PascalCase (widget_thing -> WidgetThing). */
export function toPascal(slug) {
  return slug
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

/** slug -> camelCase (widget_thing -> widgetThing). */
export function toCamel(slug) {
  const pascal = toPascal(slug);
  return pascal.length > 0 ? pascal[0].toLowerCase() + pascal.slice(1) : pascal;
}

/** slug -> UPPER_SNAKE (widget_thing -> WIDGET_THING). */
export function toUpperSnake(slug) {
  return slug.toUpperCase();
}

/** Every :param name in a path, in order. */
export function pathParams(path) {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

/** The Surface a path prefix maps to (defaults to 'api'). */
export function surfaceForPath(path) {
  for (const [prefix, surface] of SURFACE_BY_PREFIX) {
    if (path.startsWith(prefix)) return surface;
  }
  return DEFAULT_SURFACE;
}

/**
 * Validate a raw descriptor and derive the full endpoint plan (pure, no I/O). Throws
 * UsageError on any invalid field. The plan carries the auth rung, the paired code,
 * the derived names, and the resolved absolute root/repo directories.
 */
export function derivePlan(raw, cwd) {
  if (typeof raw.domain !== 'string' || !DOMAIN_PATTERN.test(raw.domain)) {
    throw new UsageError('--domain must be a lowercase slug (letters, digits, underscore)');
  }
  if (typeof raw.method !== 'string' || !ALLOWED_METHODS.includes(raw.method.toUpperCase())) {
    throw new UsageError(`--method must be one of ${ALLOWED_METHODS.join(', ')}`);
  }
  if (typeof raw.path !== 'string' || !raw.path.startsWith('/')) {
    throw new UsageError('--path must be an absolute request path starting with /');
  }
  // The path is interpolated verbatim into emitted TS string literals, so restrict it
  // to a strict charset (segments plus :params) BEFORE templating: no quotes, backslash,
  // whitespace, or template characters can break out of the literal. Mirrors --domain.
  if (!PATH_PATTERN.test(raw.path)) {
    throw new UsageError(
      '--path may contain only letters, digits, and _ - / : (path segments plus :params)',
    );
  }
  const method = raw.method.toUpperCase();
  const domain = raw.domain;
  const params = pathParams(raw.path);
  const isPublic = raw.public === true;
  const authLevel = isPublic ? 'public' : params.length > 0 ? 'owner' : 'authenticated';
  const reason = authLevel === 'owner' ? OWNER_REASON : OTHER_REASON;
  const root = resolve(cwd, raw.root ?? '.');
  const repo = resolve(cwd, raw.repo ?? raw.root ?? '.');
  return {
    domain,
    method,
    path: raw.path,
    authLevel,
    isGet: method === 'GET',
    surface: surfaceForPath(raw.path),
    hasParam: params.length > 0,
    // The last :param is the owned-resource id the loader authorizes.
    paramName: params.length > 0 ? params[params.length - 1] : null,
    reason,
    code: `${domain}.${reason}`,
    pascal: toPascal(domain),
    camel: toCamel(domain),
    upper: toUpperSnake(domain),
    ownedKey: OWNED_KEY_FROM_DOMAIN(domain),
    root,
    repo,
    moduleFile: resolve(root, 'server', `${domain}.ts`),
    testFile: resolve(root, 'tests', 'server', `${domain}.test.ts`),
  };
}

// ---------------------------------------------------------------------------
// Import-specifier computation (pure). Relative from an emitted file to a spine
// module resolved under --repo; POSIX, extensionless, always dot-prefixed.
// ---------------------------------------------------------------------------

/** Relative POSIX specifier from `fromFileAbs` to `toAbsNoExt`, dot-prefixed. */
export function importSpecifier(fromFileAbs, toAbsNoExt) {
  let rel = pathRelative(dirname(fromFileAbs), toAbsNoExt).split(pathSep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/** Build the { name: specifier } map an emitted file needs, resolved against --repo. */
function spineSpecifiers(fromFileAbs, repo) {
  const map = {};
  for (const [name, rel] of Object.entries(SPINE)) {
    map[name] = importSpecifier(fromFileAbs, resolve(repo, rel));
  }
  return map;
}

// ---------------------------------------------------------------------------
// English catalog copy (pure). Plain sentences, no {token} (only the two parametric
// pins may carry one), no em/en dash.
// ---------------------------------------------------------------------------

/**
 * The English apiError.* value for a paired reason. Deliberately TERSE (fewer words
 * = fewer maintainer fills). It cannot dodge the M16 wordy-leaf gate (any real word of
 * 4+ letters trips /[a-z]{4,}/), so a real-tree run also prints the M16 reminder and
 * server/CLAUDE.md documents it: a wordy English apiError leaf needs its five non-Latin
 * fills (zh, zh_TW, ja, ko, ru) in the same change.
 */
export function englishFor(reason) {
  if (reason === OWNER_REASON) return 'Not found.';
  return 'Invalid input.';
}

// ---------------------------------------------------------------------------
// Emitted MODULE renderer (pure).
// ---------------------------------------------------------------------------

/** The schema import list a rung needs from server/http/schema. */
function schemaImports(plan) {
  return plan.isGet
    ? 'import { type Infer, object, optional, str } from'
    : 'import { type Infer, object, str } from';
}

/** The typed schema block (query for GET, body otherwise) + the Infer alias. */
function schemaBlock(plan) {
  if (plan.isGet) {
    return [
      `/** Query schema. Replace the placeholder field with the real query contract. */`,
      `export const ${plan.camel}QuerySchema = object({`,
      `  // TODO(${plan.domain}): declare the real query fields.`,
      `  q: optional(str({ maxLength: 64 }), ''),`,
      `});`,
      `export type ${plan.pascal}Query = Infer<typeof ${plan.camel}QuerySchema>;`,
    ].join('\n');
  }
  return [
    `/** Body schema. Replace the placeholder field with the real request contract. */`,
    `export const ${plan.camel}BodySchema = object({`,
    `  // TODO(${plan.domain}): declare the real body fields.`,
    `  name: str({ minLength: 1, maxLength: 64 }),`,
    `});`,
    `export type ${plan.pascal}Body = Infer<typeof ${plan.camel}BodySchema>;`,
  ].join('\n');
}

/** The decode + stub-validation lines inside a public/authenticated handler. */
function decodeAndValidate(plan) {
  const input = plan.isGet ? 'ctx.query' : 'ctx.body ?? {}';
  const schema = plan.isGet ? `${plan.camel}QuerySchema` : `${plan.camel}BodySchema`;
  const stubGuard = plan.isGet ? `decoded.value.q === ''` : `decoded.value.name.trim() === ''`;
  const okBody = plan.isGet
    ? '{ ok: true, query: decoded.value }'
    : '{ ok: true, name: decoded.value.name }';
  return [
    `  const decoded = ${schema}.decode(${input});`,
    `  // A schema-shape failure maps to 422 validation.failed through the pipeline.`,
    `  if (!decoded.ok) throw decoded;`,
    `  // TODO(${plan.domain}): replace this stub domain check with the real rule.`,
    `  if (${stubGuard}) {`,
    `    json(ctx.res, 400, { error: 'invalid input', code: INVALID_INPUT_CODE });`,
    `    return;`,
    `  }`,
    `  json(ctx.res, 200, ${okBody});`,
  ].join('\n');
}

/**
 * The rate-limiter TODO lines emitted inside a MUTATING route's middleware array. A
 * mutating route with no per-action limiter is a scaffold gap (finding 3), so the stub
 * names the recipe step rather than silently shipping without one.
 */
function rateLimitTodoLines(plan) {
  return [
    `      // TODO(${plan.domain}): add a per-action limiter here, e.g. rateLimit(${plan.upper}_POLICY)`,
    `      // from server/http/middleware/rate_limit.ts. Order: auth guard, limiter, withBody,`,
    `      // then requireOwned (see server/characters.ts). A mutating route needs one.`,
  ];
}

function renderPublicModule(plan, s) {
  const lines = [];
  lines.push(
    `// ${plan.pascal} public-read API surface, scaffolded by \`npm run ${SCRIPT_NAME}\`.`,
  );
  lines.push(`//`);
  lines.push(`// Rung: PUBLIC read (no authentication). Fill in the query decode and the read.`);
  lines.push(`// See server/CLAUDE.md "Adding an endpoint (REST)" and server/leaderboard.ts.`);
  lines.push(``);
  lines.push(`${schemaImports(plan)} '${s.schema}';`);
  if (!plan.isGet) lines.push(`import { withBody } from '${s.body}';`);
  lines.push(`import type { Ctx, RouteDef } from '${s.types}';`);
  lines.push(`import { json } from '${s.httpUtil}';`);
  lines.push(``);
  lines.push(
    `/** The stable machine code this stub emits on invalid input (see error_codes.ts). */`,
  );
  lines.push(`const INVALID_INPUT_CODE = '${plan.code}';`);
  lines.push(``);
  lines.push(schemaBlock(plan));
  lines.push(``);
  lines.push(`/** ${plan.method} ${plan.path}: public read. */`);
  lines.push(`async function ${plan.camel}Handler(ctx: Ctx): Promise<void> {`);
  lines.push(decodeAndValidate(plan));
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const routes: RouteDef[] = [`);
  lines.push(`  {`);
  lines.push(`    method: '${plan.method}',`);
  lines.push(`    path: '${plan.path}',`);
  lines.push(`    surface: '${plan.surface}',`);
  if (!plan.isGet) {
    lines.push(`    middleware: [`);
    lines.push(
      `      // TODO(${plan.domain}): a public write is unauthenticated; add a per-IP limiter here`,
    );
    lines.push(
      `      // (rateLimit(${plan.upper}_POLICY) from server/http/middleware/rate_limit.ts) before shipping.`,
    );
    lines.push(`      withBody(),`);
    lines.push(`    ],`);
  }
  lines.push(`    handler: ${plan.camel}Handler,`);
  if (plan.hasParam) {
    lines.push(
      `    // An intentionally public :param route, so the BOLA coverage helper skips it.`,
    );
    lines.push(`    meta: { publicRead: true },`);
  }
  lines.push(`  },`);
  lines.push(`];`);
  lines.push(``);
  return lines.join('\n');
}

/**
 * The db seam the shared bearer guard reads through. It IS the BearerActiveGuardDb
 * contract (accountAndScopeForToken + moderationStatusForAccount) so the guard is
 * moderation-gated and scope-enforced, defaulting to the REAL db.ts reads (working out
 * of the box), overridable to a fake in tests. The owner rung extends it with the
 * account-scoped resource load.
 */
function dbSeamBlock(plan, withLoad) {
  const lines = [];
  if (withLoad) {
    lines.push(`/** The owned resource row. TODO(${plan.domain}): the real columns. */`);
    lines.push(`export interface ${plan.pascal}Row {`);
    lines.push(`  id: number;`);
    lines.push(`}`);
    lines.push(``);
  }
  lines.push(`// The bearer guard reads its token + moderation status through this seam; the`);
  lines.push(`// production default is the real db.ts reads, so the guard bans/suspensions and`);
  lines.push(`// enforces token scope out of the box. A test swaps in a fake, no Postgres.`);
  if (withLoad) {
    lines.push(`export interface ${plan.pascal}Db extends BearerActiveGuardDb {`);
    lines.push(
      `  /** Account-scoped load (id AND account_id AND realm). TODO(${plan.domain}): a db.ts read. */`,
    );
    lines.push(`  load(accountId: number, id: number): Promise<${plan.pascal}Row | null>;`);
    lines.push(`}`);
  } else {
    lines.push(`export type ${plan.pascal}Db = BearerActiveGuardDb;`);
  }
  lines.push(``);
  lines.push(`const REAL_${plan.upper}_DB: ${plan.pascal}Db = {`);
  lines.push(`  accountAndScopeForToken,`);
  lines.push(`  moderationStatusForAccount,`);
  if (withLoad) {
    lines.push(
      `  // TODO(${plan.domain}): replace with the account-scoped db.ts read (denies by default until then).`,
    );
    lines.push(`  load: async () => null,`);
  }
  lines.push(`};`);
  lines.push(`let ${plan.camel}Db: ${plan.pascal}Db = REAL_${plan.upper}_DB;`);
  lines.push(``);
  lines.push(`/** Override the db seam with a fake (test-only; merges over the real reads). */`);
  lines.push(
    `export function set${plan.pascal}DbForTests(overrides: Partial<${plan.pascal}Db>): void {`,
  );
  lines.push(`  ${plan.camel}Db = { ...REAL_${plan.upper}_DB, ...overrides };`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`/** Restore the real db seam after an override (test-only). */`);
  lines.push(`export function reset${plan.pascal}DbForTests(): void {`);
  lines.push(`  ${plan.camel}Db = REAL_${plan.upper}_DB;`);
  lines.push(`}`);
  return lines.join('\n');
}

/**
 * The auth guard: the SHARED bearer guard factory, not a bespoke stub. GET routes take
 * a read-or-full token; mutating routes require a full token (403 on a read-only token).
 * Both apply the moderation/ban gate for every caller and short-circuit with the legacy
 * { error, code } body. The guard reads the live db seam each request.
 */
function authGuardBlock(plan) {
  const factory = plan.isGet ? 'createReadGuard' : 'createActiveGuard';
  const scopeNote = plan.isGet
    ? 'accepts a read OR full token'
    : 'requires a full (mutating) token, 403 on a read-only one';
  return [
    `// Shared bearer guard (moderation-gated + scope-enforced): ${scopeNote}.`,
    `const authGuard = ${factory}(() => ${plan.camel}Db);`,
  ].join('\n');
}

function renderAuthenticatedModule(plan, s) {
  const lines = [];
  lines.push(
    `// ${plan.pascal} authenticated API surface, scaffolded by \`npm run ${SCRIPT_NAME}\`.`,
  );
  lines.push(`//`);
  lines.push(`// Rung: AUTHENTICATED (bearer required). Fill in the db seam and the handler.`);
  lines.push(`// See server/CLAUDE.md "Adding an endpoint (REST)" and server/auth_routes.ts.`);
  lines.push(``);
  const factory = plan.isGet ? 'createReadGuard' : 'createActiveGuard';
  lines.push(`${schemaImports(plan)} '${s.schema}';`);
  lines.push(`import { accountAndScopeForToken, moderationStatusForAccount } from '${s.db}';`);
  lines.push(`import {`);
  lines.push(`  type BearerActiveGuardDb,`);
  lines.push(`  ${factory},`);
  lines.push(`} from '${s.bearerGuard}';`);
  if (!plan.isGet) lines.push(`import { withBody } from '${s.body}';`);
  lines.push(`import type { Ctx, RouteDef } from '${s.types}';`);
  lines.push(`import { json } from '${s.httpUtil}';`);
  lines.push(``);
  lines.push(`const INVALID_INPUT_CODE = '${plan.code}';`);
  lines.push(``);
  lines.push(dbSeamBlock(plan, false));
  lines.push(``);
  lines.push(authGuardBlock(plan));
  lines.push(``);
  lines.push(schemaBlock(plan));
  lines.push(``);
  lines.push(`/** ${plan.method} ${plan.path}: authenticated. */`);
  lines.push(`async function ${plan.camel}Handler(ctx: Ctx): Promise<void> {`);
  lines.push(decodeAndValidate(plan));
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const routes: RouteDef[] = [`);
  lines.push(`  {`);
  lines.push(`    method: '${plan.method}',`);
  lines.push(`    path: '${plan.path}',`);
  lines.push(`    surface: '${plan.surface}',`);
  if (plan.isGet) {
    lines.push(`    middleware: [authGuard],`);
  } else {
    lines.push(`    middleware: [`);
    lines.push(`      authGuard,`);
    for (const line of rateLimitTodoLines(plan)) lines.push(line);
    lines.push(`      withBody(),`);
    lines.push(`    ],`);
  }
  lines.push(`    handler: ${plan.camel}Handler,`);
  lines.push(`  },`);
  lines.push(`];`);
  lines.push(``);
  return lines.join('\n');
}

function renderOwnerModule(plan, s) {
  const input = plan.isGet ? 'ctx.query' : 'ctx.body ?? {}';
  const schema = plan.isGet ? `${plan.camel}QuerySchema` : `${plan.camel}BodySchema`;
  const lines = [];
  lines.push(
    `// ${plan.pascal} owner-gated API surface, scaffolded by \`npm run ${SCRIPT_NAME}\`.`,
  );
  lines.push(`//`);
  lines.push(`// Rung: OWNER-GATED :id (requireOwned load-then-authorize; denial is a 404`);
  lines.push(`// anti-enumeration). Fill in the db seam and the handler. See server/CLAUDE.md`);
  lines.push(`// "Adding an endpoint (REST)" and server/characters.ts.`);
  lines.push(``);
  const factory = plan.isGet ? 'createReadGuard' : 'createActiveGuard';
  lines.push(`${schemaImports(plan)} '${s.schema}';`);
  lines.push(`import { accountAndScopeForToken, moderationStatusForAccount } from '${s.db}';`);
  lines.push(`import {`);
  lines.push(`  type BearerActiveGuardDb,`);
  lines.push(`  ${factory},`);
  lines.push(`} from '${s.bearerGuard}';`);
  if (!plan.isGet) lines.push(`import { withBody } from '${s.body}';`);
  lines.push(`import { requireOwned } from '${s.requireOwned}';`);
  lines.push(`import type { Ctx, Middleware, RouteDef } from '${s.types}';`);
  lines.push(`import { json } from '${s.httpUtil}';`);
  lines.push(``);
  lines.push(`const NOT_FOUND = { error: 'not found', code: '${plan.code}' } as const;`);
  lines.push(`/** The ctx.state key the owned, authorized row is stashed under. */`);
  lines.push(`const OWNED_RESOURCE = '${plan.ownedKey}';`);
  lines.push(``);
  lines.push(dbSeamBlock(plan, true));
  lines.push(``);
  lines.push(authGuardBlock(plan));
  lines.push(``);
  lines.push(`/** The BOLA loader: account-scoped find, 404 on a miss (anti-enumeration). */`);
  lines.push(`function requireOwned${plan.pascal}(): Middleware {`);
  lines.push(`  return requireOwned<${plan.pascal}Row>({`);
  lines.push(`    resource: OWNED_RESOURCE,`);
  lines.push(`    param: '${plan.paramName}',`);
  lines.push(`    load: (accountId, id) => ${plan.camel}Db.load(accountId, id),`);
  lines.push(`    notFoundBody: NOT_FOUND,`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push(``);
  lines.push(schemaBlock(plan));
  lines.push(``);
  lines.push(`/** ${plan.method} ${plan.path}: owner-gated. */`);
  lines.push(`async function ${plan.camel}Handler(ctx: Ctx): Promise<void> {`);
  lines.push(`  const owned = ctx.state.get(OWNED_RESOURCE) as ${plan.pascal}Row;`);
  lines.push(`  const decoded = ${schema}.decode(${input});`);
  lines.push(`  if (!decoded.ok) throw decoded;`);
  lines.push(`  // TODO(${plan.domain}): build the real response body from the owned row + input.`);
  lines.push(`  json(ctx.res, 200, { ok: true, id: owned.id });`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`/** The meta marking an account-owned (BOLA-protected) :id route. */`);
  lines.push(`const OWNED_META = {`);
  lines.push(`  requireOwned: { kind: OWNED_RESOURCE, ownerScope: 'account' },`);
  lines.push(`} as const;`);
  lines.push(``);
  lines.push(`export const routes: RouteDef[] = [`);
  lines.push(`  {`);
  lines.push(`    method: '${plan.method}',`);
  lines.push(`    path: '${plan.path}',`);
  lines.push(`    surface: '${plan.surface}',`);
  if (plan.isGet) {
    lines.push(`    middleware: [authGuard, requireOwned${plan.pascal}()],`);
  } else {
    lines.push(`    middleware: [`);
    lines.push(`      authGuard,`);
    for (const line of rateLimitTodoLines(plan)) lines.push(line);
    lines.push(`      withBody(),`);
    lines.push(`      requireOwned${plan.pascal}(),`);
    lines.push(`    ],`);
  }
  lines.push(`    handler: ${plan.camel}Handler,`);
  lines.push(`    meta: OWNED_META,`);
  lines.push(`  },`);
  lines.push(`];`);
  lines.push(``);
  return lines.join('\n');
}

/** Render the domain module for the plan (dispatches on the derived rung). */
export function renderModule(plan) {
  const s = spineSpecifiers(plan.moduleFile, plan.repo);
  if (plan.authLevel === 'public') return renderPublicModule(plan, s);
  if (plan.authLevel === 'authenticated') return renderAuthenticatedModule(plan, s);
  return renderOwnerModule(plan, s);
}

// ---------------------------------------------------------------------------
// Emitted TEST renderer (pure). FakeDb idiom via the tests/server/helpers barrel;
// drives the handler through its route, no pg.
// ---------------------------------------------------------------------------

/** A GET body override is empty; a mutating one carries a valid-shape body. */
function happyBody(plan) {
  return plan.isGet ? '' : `, body: { name: 'Widget' }`;
}

/** The shared FakeRes reader + interface block emitted tests use. */
function capturedBlock() {
  return [
    `interface FakeResShape {`,
    `  statusCode: number;`,
    `  body: string;`,
    `}`,
    ``,
    `function captured(res: http.ServerResponse): { status: number; body: unknown } {`,
    `  const fake = res as unknown as FakeResShape;`,
    `  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };`,
    `}`,
  ].join('\n');
}

/** The public rung test: the handler has no auth, so drive it directly. */
function renderPublicTest(plan, moduleSpec, s) {
  const happyInput = plan.isGet ? `query: { q: 'ok' }` : `body: { name: 'Widget' }`;
  const invalidInput = plan.isGet ? `query: {}` : `body: { name: ' ' }`;
  const lines = [];
  lines.push(`process.env.DATABASE_URL ||= '${TEST_DATABASE_URL}';`);
  lines.push(``);
  lines.push(`import type * as http from 'node:http';`);
  lines.push(`import { describe, expect, it } from 'vitest';`);
  lines.push(`import { fakeCtx } from '${s.helpers}';`);
  lines.push(`import { routes } from '${moduleSpec}';`);
  lines.push(``);
  lines.push(capturedBlock());
  lines.push(``);
  lines.push(`describe('${plan.domain} public route', () => {`);
  lines.push(`  it('serves the happy path', async () => {`);
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', ${happyInput} });`,
  );
  lines.push(`    await routes[0].handler(ctx);`);
  lines.push(`    expect(captured(ctx.res).status).toBe(200);`);
  lines.push(`  });`);
  lines.push(``);
  lines.push(`  it('rejects invalid input with ${plan.code}', async () => {`);
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', ${invalidInput} });`,
  );
  lines.push(`    await routes[0].handler(ctx);`);
  lines.push(
    `    expect(captured(ctx.res)).toEqual({ status: 400, body: { error: 'invalid input', code: '${plan.code}' } });`,
  );
  lines.push(`  });`);
  lines.push(`});`);
  lines.push(``);
  return lines.join('\n');
}

/** The full AccountModerationStatus fixtures the emitted guard tests inject. */
function moderationStatusHelpersBlock() {
  return [
    `// Full AccountModerationStatus fixtures for the guard's moderation gate.`,
    `function okStatus() {`,
    `  return {`,
    `    locked: false,`,
    `    banned: false,`,
    `    suspendedUntil: null,`,
    `    reason: '',`,
    `    message: '',`,
    `    chatMutedUntil: null,`,
    `    chatStrikes: 0,`,
    `  };`,
    `}`,
    `function bannedStatus() {`,
    `  return {`,
    `    locked: true,`,
    `    banned: true,`,
    `    suspendedUntil: null,`,
    `    reason: 'banned',`,
    `    message: 'This account has been banned.',`,
    `    chatMutedUntil: null,`,
    `    chatStrikes: 0,`,
    `  };`,
    `}`,
  ].join('\n');
}

/** An okScope injection object literal string (a full-token, unlocked caller, plus `extra`). */
function okInject(scope, extra) {
  const parts = [
    `accountAndScopeForToken: async () => ({ accountId: 1, scope: '${scope}' })`,
    `moderationStatusForAccount: async () => okStatus()`,
  ];
  if (extra) parts.push(extra);
  return `{ ${parts.join(', ')} }`;
}

/** The authenticated rung test: drive the route (guard + handler) through the onion. */
function renderAuthenticatedTest(plan, moduleSpec, s) {
  const happyInput = plan.isGet ? `query: { q: 'ok' }` : `body: { name: 'Widget' }`;
  const invalidInput = plan.isGet ? `query: {}` : `body: { name: ' ' }`;
  const set = `set${plan.pascal}DbForTests`;
  const lines = [];
  lines.push(`process.env.DATABASE_URL ||= '${TEST_DATABASE_URL}';`);
  lines.push(``);
  lines.push(`import type * as http from 'node:http';`);
  lines.push(`import { afterEach, describe, expect, it } from 'vitest';`);
  lines.push(`import { compose } from '${s.compose}';`);
  lines.push(`import { fakeCtx } from '${s.helpers}';`);
  lines.push(`import { reset${plan.pascal}DbForTests, routes, ${set} } from '${moduleSpec}';`);
  lines.push(``);
  lines.push(capturedBlock());
  lines.push(``);
  lines.push(moderationStatusHelpersBlock());
  lines.push(``);
  lines.push(`const VALID_BEARER = \`Bearer \${'a'.repeat(64)}\`;`);
  lines.push(``);
  lines.push(
    `function runRoute(ctx: Parameters<(typeof routes)[0]['handler']>[0]): Promise<void> {`,
  );
  lines.push(`  const route = routes[0];`);
  lines.push(`  return compose([...(route.middleware ?? [])])(ctx, async () => {`);
  lines.push(`    await route.handler(ctx);`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`afterEach(() => reset${plan.pascal}DbForTests());`);
  lines.push(``);
  lines.push(`describe('${plan.domain} authenticated route', () => {`);
  lines.push(`  it('serves the happy path for an authenticated caller', async () => {`);
  lines.push(`    ${set}(${okInject('full')});`);
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', headers: { authorization: VALID_BEARER }, ${happyInput} });`,
  );
  lines.push(`    await runRoute(ctx);`);
  lines.push(`    expect(captured(ctx.res).status).toBe(200);`);
  lines.push(`  });`);
  lines.push(``);
  lines.push(`  it('rejects invalid input with ${plan.code}', async () => {`);
  lines.push(`    ${set}(${okInject('full')});`);
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', headers: { authorization: VALID_BEARER }, ${invalidInput} });`,
  );
  lines.push(`    await runRoute(ctx);`);
  lines.push(
    `    expect(captured(ctx.res)).toEqual({ status: 400, body: { error: 'invalid input', code: '${plan.code}' } });`,
  );
  lines.push(`  });`);
  lines.push(``);
  lines.push(`  it('401s without a bearer token', async () => {`);
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', ${happyInput} });`,
  );
  lines.push(`    await runRoute(ctx);`);
  lines.push(`    expect(captured(ctx.res).status).toBe(401);`);
  lines.push(`  });`);
  lines.push(``);
  lines.push(`  it('403s a banned account (moderation gate)', async () => {`);
  lines.push(
    `    ${set}({ accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }), moderationStatusForAccount: async () => bannedStatus() });`,
  );
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', headers: { authorization: VALID_BEARER }, ${happyInput} });`,
  );
  lines.push(`    await runRoute(ctx);`);
  lines.push(`    expect(captured(ctx.res).status).toBe(403);`);
  lines.push(`  });`);
  if (!plan.isGet) {
    lines.push(``);
    lines.push(`  it('403s a read-only token on this mutating route (scope gate)', async () => {`);
    lines.push(`    ${set}(${okInject('read')});`);
    lines.push(
      `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', headers: { authorization: VALID_BEARER }, ${happyInput} });`,
    );
    lines.push(`    await runRoute(ctx);`);
    lines.push(
      `    expect(captured(ctx.res)).toEqual({ status: 403, body: { error: 'this token is read-only', code: 'auth.forbidden' } });`,
    );
    lines.push(`  });`);
  }
  lines.push(`});`);
  lines.push(``);
  return lines.join('\n');
}

function renderOwnerTest(plan, moduleSpec, s) {
  const paramLiteral = `params: { ${plan.paramName}: '7' }`;
  const paramMiss = `params: { ${plan.paramName}: '999' }`;
  const set = `set${plan.pascal}DbForTests`;
  const lines = [];
  lines.push(`process.env.DATABASE_URL ||= '${TEST_DATABASE_URL}';`);
  lines.push(``);
  lines.push(`import type * as http from 'node:http';`);
  lines.push(`import { afterEach, describe, expect, it } from 'vitest';`);
  lines.push(`import { compose } from '${s.compose}';`);
  lines.push(`import { fakeCtx } from '${s.helpers}';`);
  lines.push(`import { reset${plan.pascal}DbForTests, routes, ${set} } from '${moduleSpec}';`);
  lines.push(``);
  lines.push(capturedBlock());
  lines.push(``);
  lines.push(moderationStatusHelpersBlock());
  lines.push(``);
  lines.push(`const VALID_BEARER = \`Bearer \${'a'.repeat(64)}\`;`);
  lines.push(``);
  lines.push(`// Drive the whole route (its middleware onion, then the handler) via compose.`);
  lines.push(
    `function runRoute(ctx: Parameters<(typeof routes)[0]['handler']>[0]): Promise<void> {`,
  );
  lines.push(`  const route = routes[0];`);
  lines.push(`  return compose([...(route.middleware ?? [])])(ctx, async () => {`);
  lines.push(`    await route.handler(ctx);`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`afterEach(() => reset${plan.pascal}DbForTests());`);
  lines.push(``);
  lines.push(`describe('${plan.domain} owner-gated route', () => {`);
  lines.push(`  it('404s ${plan.code} when the owned resource is absent', async () => {`);
  lines.push(`    ${set}(${okInject('full', 'load: async () => null')});`);
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', headers: { authorization: VALID_BEARER }, ${paramMiss}${happyBody(plan)} });`,
  );
  lines.push(`    await runRoute(ctx);`);
  lines.push(
    `    expect(captured(ctx.res)).toEqual({ status: 404, body: { error: 'not found', code: '${plan.code}' } });`,
  );
  lines.push(`  });`);
  lines.push(``);
  lines.push(`  it('serves the owned resource on the happy path', async () => {`);
  lines.push(`    ${set}(${okInject('full', 'load: async () => ({ id: 7 })')});`);
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', headers: { authorization: VALID_BEARER }, ${paramLiteral}${happyBody(plan)} });`,
  );
  lines.push(`    await runRoute(ctx);`);
  lines.push(`    const { status, body } = captured(ctx.res);`);
  lines.push(`    expect(status).toBe(200);`);
  lines.push(`    expect((body as { id: number }).id).toBe(7);`);
  lines.push(`  });`);
  lines.push(``);
  lines.push(`  it('401s without a bearer token', async () => {`);
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', ${paramLiteral}${happyBody(plan)} });`,
  );
  lines.push(`    await runRoute(ctx);`);
  lines.push(`    expect(captured(ctx.res).status).toBe(401);`);
  lines.push(`  });`);
  lines.push(``);
  lines.push(`  it('403s a banned account before loading the resource', async () => {`);
  lines.push(
    `    ${set}({ accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }), moderationStatusForAccount: async () => bannedStatus(), load: async () => ({ id: 7 }) });`,
  );
  lines.push(
    `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', headers: { authorization: VALID_BEARER }, ${paramLiteral}${happyBody(plan)} });`,
  );
  lines.push(`    await runRoute(ctx);`);
  lines.push(`    expect(captured(ctx.res).status).toBe(403);`);
  lines.push(`  });`);
  if (!plan.isGet) {
    lines.push(``);
    lines.push(`  it('403s a read-only token on this mutating route (scope gate)', async () => {`);
    lines.push(`    ${set}(${okInject('read', 'load: async () => ({ id: 7 })')});`);
    lines.push(
      `    const ctx = fakeCtx({ method: '${plan.method}', url: '${plan.path}', headers: { authorization: VALID_BEARER }, ${paramLiteral}${happyBody(plan)} });`,
    );
    lines.push(`    await runRoute(ctx);`);
    lines.push(
      `    expect(captured(ctx.res)).toEqual({ status: 403, body: { error: 'this token is read-only', code: 'auth.forbidden' } });`,
    );
    lines.push(`  });`);
  }
  lines.push(``);
  lines.push(`  it('marks the route meta.requireOwned account-scoped', () => {`);
  lines.push(
    `    expect(routes[0].meta?.requireOwned).toEqual({ kind: '${plan.ownedKey}', ownerScope: 'account' });`,
  );
  lines.push(`  });`);
  lines.push(`});`);
  lines.push(``);
  return lines.join('\n');
}

/** Render the FakeDb test for the plan (dispatches on the derived rung). */
export function renderTest(plan) {
  const s = spineSpecifiers(plan.testFile, plan.repo);
  // The module under test is a sibling under --root, so its specifier is root-relative.
  const moduleSpec = importSpecifier(plan.testFile, resolve(plan.root, 'server', plan.domain));
  if (plan.authLevel === 'owner') return renderOwnerTest(plan, moduleSpec, s);
  if (plan.authLevel === 'authenticated') return renderAuthenticatedTest(plan, moduleSpec, s);
  return renderPublicTest(plan, moduleSpec, s);
}

// ---------------------------------------------------------------------------
// Append-only insertion helpers (pure). Each inserts new lines at a stable point
// and NEVER reorders or removes existing content.
// ---------------------------------------------------------------------------

/** Insert `block` immediately BEFORE the first line that trims-equal to `anchor`. */
export function insertBeforeLine(src, anchor, block) {
  const lines = src.split('\n');
  const index = lines.findIndex((line) => line.trimEnd() === anchor.trimEnd());
  if (index === -1) throw new UsageError(`anchor not found: ${JSON.stringify(anchor)}`);
  lines.splice(index, 0, block);
  return lines.join('\n');
}

/** Insert `block` immediately BEFORE the first exact line `marker` after `after`. */
export function insertBeforeMarkerAfter(src, after, marker, block) {
  const lines = src.split('\n');
  const start = lines.findIndex((line) => line.includes(after));
  if (start === -1) throw new UsageError(`section not found: ${JSON.stringify(after)}`);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === marker.trimEnd()) {
      lines.splice(i, 0, block);
      return lines.join('\n');
    }
  }
  throw new UsageError(`marker not found after section: ${JSON.stringify(marker)}`);
}

/** Append a new code entry to ERROR_CODES (before the `} as const);` tail). */
export function appendErrorCode(src, code) {
  return insertBeforeLine(src, ERROR_CODES_TAIL, `  '${code}': { params: [] },`);
}

/** Append a new code to a sorted literal array snapshot (EXPECTED_CODES / KNOWN_CODES). */
export function appendCodeToArray(src, constMarker, code) {
  return insertBeforeMarkerAfter(src, constMarker, '];', `  '${code}',`);
}

/** Append the identity row to the API_ERROR_KEYS table. */
export function appendApiErrorKey(src, code) {
  return insertBeforeMarkerAfter(
    src,
    API_ERROR_KEYS_CONST,
    API_ERROR_KEYS_TAIL,
    `  '${code}': 'apiError.${code}',`,
  );
}

/**
 * Append a new top-level domain block to the apiErrorStrings catalog. Refuses when a
 * `<domain>:` block already exists (a scaffold owns a NEW domain module; a second
 * endpoint in an existing domain adds its leaf by hand).
 */
export function appendCatalogLeaf(src, domain, reason, english) {
  const existing = new RegExp(`^  ${domain}: \\{$`, 'm');
  if (existing.test(src)) {
    throw new UsageError(
      `apiError catalog already has a "${domain}" block; add the "${reason}" leaf by hand`,
    );
  }
  const block = [`  ${domain}: {`, `    ${reason}: '${english}',`, `  },`].join('\n');
  return insertBeforeMarkerAfter(src, CATALOG_CONST, CATALOG_TAIL, block);
}

/** Register a domain in registry.ts: an import and a spread, each above its anchor. */
export function registerInRegistry(src, domain) {
  const camel = toCamel(domain);
  const withImport = insertBeforeLine(
    src,
    REGISTRY_IMPORT_ANCHOR,
    `import { routes as ${camel}Routes } from '../${domain}';`,
  );
  return insertBeforeLine(withImport, REGISTRY_SPREAD_ANCHOR, `  ...${camel}Routes,`);
}

// ---------------------------------------------------------------------------
// The full write plan (pure): every file the generator creates or appends to, as
// { path, mode, content|transform }. The CLI main applies it; the golden test
// reuses the pure renderers directly.
// ---------------------------------------------------------------------------

/**
 * Compute the ordered list of file operations for a plan, relative to plan.root.
 * `create` ops carry final content; `append` ops carry a transform(existingSrc).
 */
export function planFileOps(plan) {
  const english = englishFor(plan.reason);
  const ops = [
    { rel: `server/${plan.domain}.ts`, mode: 'create', content: `${renderModule(plan)}` },
    { rel: `tests/server/${plan.domain}.test.ts`, mode: 'create', content: `${renderTest(plan)}` },
    { rel: ERROR_CODES_FILE, mode: 'append', transform: (src) => appendErrorCode(src, plan.code) },
    {
      rel: ERROR_CODES_TEST_FILE,
      mode: 'append',
      transform: (src) => appendCodeToArray(src, EXPECTED_CODES_CONST, plan.code),
    },
    {
      rel: CODE_PARITY_TEST_FILE,
      mode: 'append',
      transform: (src) => appendCodeToArray(src, KNOWN_CODES_CONST, plan.code),
    },
    {
      rel: API_ERROR_KEYS_FILE,
      mode: 'append',
      transform: (src) => appendApiErrorKey(src, plan.code),
    },
    {
      rel: CATALOG_FILE,
      mode: 'append',
      transform: (src) => appendCatalogLeaf(src, plan.domain, plan.reason, english),
    },
    {
      rel: REGISTRY_FILE,
      mode: 'append',
      transform: (src) => registerInRegistry(src, plan.domain),
    },
  ];
  return ops;
}

// ---------------------------------------------------------------------------
// CLI (the only place with file I/O).
// ---------------------------------------------------------------------------

export const HELP = `Usage: npm run ${SCRIPT_NAME} -- --domain <slug> --method <METHOD> --path </api/...> [--public]

Scaffolds one endpoint on the server/http/ REST pipeline from a single descriptor.

Options:
  --domain <slug>   Domain slug for the module (server/<slug>.ts). Lowercase, digits, underscore.
  --method <METHOD> One of: ${ALLOWED_METHODS.join(', ')}.
  --path </api/...> The absolute request path. A :param segment selects the owner rung.
                    Charset: a leading / then only letters, digits, and _ - / : (no quotes,
                    backslashes, whitespace, or template characters).
  --public          Emit a public read (no auth); adds meta.publicRead for a :param path.
  --root <dir>      Where to write (default: current directory).
  --repo <dir>      Where the real spine lives for import specifiers (default: --root).
  -h, --help        Print this help.

Auth rung (derived, never guessed):
  --public                      public read; meta.publicRead when the path has a :param
  a :param and no --public       owner-gated: a requireOwned loader + meta.requireOwned (404 denial)
  otherwise                     authenticated: the shared bearer guard
The authenticated and owner rungs compose the shared moderation-gated, scope-enforced
bearer guard (createReadGuard on a GET, createActiveGuard on a mutating route: a read-only
token is 403ed, a banned/suspended account is 403ed).

Paired error code (the stub's failure path):
  owner-gated                   <domain>.not_found
  public / authenticated        <domain>.invalid_input

Files written (created, refuses to overwrite):
  server/<domain>.ts                       the RouteDef module (typed schema via Infer)
  tests/server/<domain>.test.ts            a FakeDb test driving the route (no pg)
Files appended (append-only; each must exist):
  ${ERROR_CODES_FILE}          the paired error code
  ${ERROR_CODES_TEST_FILE}   the code-catalog snapshot row
  ${CODE_PARITY_TEST_FILE}      the code-parity snapshot row
  ${API_ERROR_KEYS_FILE}          the API_ERROR_KEYS client mapping
  ${CATALOG_FILE}    the English apiError.* catalog entry
  ${REGISTRY_FILE}         the domain import + routes spread
`;

function applyOps(plan) {
  const ops = planFileOps(plan);
  // Validate all preconditions first so a failure writes nothing (all-or-nothing).
  for (const op of ops) {
    const abs = resolve(plan.root, op.rel);
    if (op.mode === 'create' && existsSync(abs)) {
      throw new UsageError(`refusing to overwrite existing file: ${op.rel}`);
    }
    if (op.mode === 'append' && !existsSync(abs)) {
      throw new UsageError(`append target is missing: ${op.rel}`);
    }
  }
  // Pre-compute every append transform (so a bad anchor fails before any write).
  const writes = ops.map((op) => {
    const abs = resolve(plan.root, op.rel);
    if (op.mode === 'create') return { abs, content: op.content };
    return { abs, content: op.transform(readFileSync(abs, 'utf8')) };
  });
  for (const write of writes) writeFileSync(write.abs, write.content);
  return writes.map((write) => write.abs);
}

function main(argv, cwd) {
  const raw = parseArgs(argv);
  if (raw.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const plan = derivePlan(raw, cwd);
  // A public write is unauthenticated and (in the stub) unlimited: warn loudly before
  // scaffolding it, so the contributor adds auth + a limiter before shipping.
  if (plan.authLevel === 'public' && !plan.isGet) {
    process.stderr.write(
      `${SCRIPT_NAME}: warning: --public with ${plan.method} scaffolds an UNAUTHENTICATED, ` +
        'UNLIMITED write endpoint. Add auth and a per-IP rate limiter before shipping.\n',
    );
  }
  const written = applyOps(plan);
  process.stdout.write(
    `${SCRIPT_NAME}: scaffolded ${plan.authLevel} ${plan.method} ${plan.path} ` +
      `(code ${plan.code})\n`,
  );
  for (const abs of written) process.stdout.write(`  ${pathRelative(plan.root, abs)}\n`);
  // The emitted files are valid TS but not import-sorted / width-wrapped to Biome's
  // output; the house workflow formats changed files, so point the contributor at it.
  process.stdout.write(
    `${SCRIPT_NAME}: run \`npx @biomejs/biome check --write server/${plan.domain}.ts ` +
      `tests/server/${plan.domain}.test.ts\` to sort imports and format the generated files.\n`,
  );
  // M16 reminder: the appended apiError English leaf is terse but still wordy (any real
  // word of 4+ letters trips the gate), so if you reword it into a sentence, add its five
  // non-Latin fills (zh, zh_TW, ja, ko, ru) in the same change, or i18n_completeness reds.
  process.stdout.write(
    `${SCRIPT_NAME}: note: if you reword the apiError.${plan.code} English value into wordy prose, ` +
      'add its five non-Latin fills (zh, zh_TW, ja, ko, ru) in the same change (M16).\n',
  );
  return 0;
}

// Run only as a CLI, never on import (so the golden test imports the pure builders).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2), process.cwd()));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${SCRIPT_NAME}: ${err.message}\n`);
      process.stderr.write(`Run \`npm run ${SCRIPT_NAME} -- --help\` for usage.\n`);
      process.exit(2);
    }
    throw err;
  }
}
