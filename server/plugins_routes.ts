// Plugin store route layer: registry-only RouteDefs (no legacy ladder twin, by
// design, per the new-route rule in server/http/CLAUDE.md). The business rules
// stay in server/plugins.ts (PluginsService, zero HTTP); this module owns the
// service singleton (with a test seam), the guards, the cached public catalog
// read, and the thin Ctx handlers. Errors are HttpError with stable
// plugins.* codes (error_codes.ts); the client localizes code-first via
// API_ERROR_KEYS (src/ui/api_error_i18n.ts).

import { createCachedRead } from './cached_read';
import { accountAndScopeForToken, moderationStatusForAccount, pool } from './db';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { createActiveGuard, createReadGuard } from './http/middleware/bearer_active_guard';
import { withBody } from './http/middleware/body';
import {
  PLUGIN_MUTATION_POLICY,
  PUBLIC_READ_POLICY,
  rateLimit,
} from './http/middleware/rate_limit';
import { requireOwned } from './http/middleware/require_owned';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { contentLengthExceeds, json } from './http_util';
import {
  catalogRowJson,
  detailJson,
  installedRowJson,
  MAX_PLUGIN_SUBMIT_BYTES,
  mineRowJson,
  type PluginRecord,
  PluginsService,
  pluginsErrorStatus,
} from './plugins';
import { PgPluginsDb } from './plugins_db';

// ---------------------------------------------------------------------------
// The service singleton. Construction is pure (PgPluginsDb stores the pool
// reference; no query runs until a request), so module-scope wiring is safe for
// every harness that imports main.ts without a database. The setter lets a unit
// test drive the handlers with an in-memory fake.
// ---------------------------------------------------------------------------

const REAL_PLUGINS_SERVICE = new PluginsService(new PgPluginsDb(pool));
let pluginsService: PluginsService = REAL_PLUGINS_SERVICE;

/** Override the plugins service with a fake (test-only). */
export function setPluginsServiceForTests(service: PluginsService): void {
  pluginsService = service;
  catalogCache.bust();
}

/** Restore the real Postgres-backed plugins service (test-only). */
export function resetPluginsServiceForTests(): void {
  pluginsService = REAL_PLUGINS_SERVICE;
  catalogCache.bust();
}

/** The live plugins service (read at call time so the test seam applies).
 * server/admin.ts drives the review/delist actions through this. */
export function livePluginsService(): PluginsService {
  return pluginsService;
}

// ---------------------------------------------------------------------------
// The cached catalog. The public catalog is viewer-identical (Hot paths,
// server/CLAUDE.md), so it reads through a single-flight TTL cache; install
// counts may lag by the TTL, which is cosmetic. Every moderation or listing
// change (approve, delist, relist, owner delete) MUST bust it in the same
// change so an operator kill switch is never masked by a warm cache.
// ---------------------------------------------------------------------------

const CATALOG_TTL_MS = 30_000;
const catalogCache = createCachedRead(
  async () => (await pluginsService.catalog()).map(catalogRowJson),
  { ttlMs: CATALOG_TTL_MS },
);

/** Drop the cached public catalog (approve / delist / relist / delete paths). */
export function bustPluginsCatalog(): void {
  catalogCache.bust();
}

// ---------------------------------------------------------------------------
// Guards. The bearer guards come from the shared factories (LAZY db reads, the
// lazy-db-bundle insurance against partial db mocks; the maps_routes shape),
// with a test seam so the ownership sweep can drive the deny paths without
// Postgres.
// ---------------------------------------------------------------------------

const REAL_GUARD_DB = { accountAndScopeForToken, moderationStatusForAccount };
let guardDbBundle = REAL_GUARD_DB;

/** Override the bearer-guard db reads with fakes (test-only). */
export function setPluginsGuardDbForTests(overrides: Partial<typeof REAL_GUARD_DB>): void {
  guardDbBundle = { ...REAL_GUARD_DB, ...overrides };
}

/** Restore the real bearer-guard db reads (test-only). */
export function resetPluginsGuardDbForTests(): void {
  guardDbBundle = REAL_GUARD_DB;
}

const activeAccount = createActiveGuard(() => guardDbBundle);
const readAccount = createReadGuard(() => guardDbBundle);

/** Content-Length precheck BEFORE auth on the submit lanes (the map-save 413
 * treatment): refuse an oversized upload without reading a byte of it. */
const submitContentLengthGuard: Middleware = async (ctx, next) => {
  if (contentLengthExceeds(ctx.req, MAX_PLUGIN_SUBMIT_BYTES)) {
    ctx.res.shouldKeepAlive = false;
    ctx.res.setHeader('Connection', 'close');
    throw new HttpError(413, 'plugins.source_too_large');
  }
  await next();
};

const NOT_FOUND_BODY = { error: 'not found', code: 'plugins.not_found' } as const;

/** The BOLA owner loader for the author-only :id routes (submit update,
 * delete). Account-scoped; a missing or non-owned plugin answers 404. */
const requireOwnedPlugin = requireOwned<PluginRecord>({
  resource: 'plugin',
  param: 'id',
  load: async (accountId, id) => {
    const plugin = await livePluginsService().getPlugin(id);
    return plugin !== null && plugin.accountId === accountId ? plugin : null;
  },
  notFoundBody: NOT_FOUND_BODY,
});

/** The owned plugin row the requireOwnedPlugin loader stashed. */
function ownedPlugin(ctx: Ctx): PluginRecord {
  return ctx.state.get('plugin') as PluginRecord;
}

/** Decode the :id for the non-owned (publicRead) :id routes; a non-numeric id
 * answers the plugins 404 (these routes are new, no legacy body to mirror). */
function publicPluginId(ctx: Ctx): number {
  const raw = ctx.params.id ?? '';
  if (!/^\d+$/.test(raw)) throw new HttpError(404, 'plugins.not_found');
  return Number(raw);
}

function throwPluginsError(code: Parameters<typeof pluginsErrorStatus>[0]): never {
  throw new HttpError(pluginsErrorStatus(code), code);
}

// ---------------------------------------------------------------------------
// Thin Ctx handlers.
// ---------------------------------------------------------------------------

/** GET /api/plugins: the public catalog (listed plugins, live versions). */
async function catalogHandler(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, { rows: await catalogCache.read() });
}

/** GET /api/plugins/:id: public detail incl. the live source (view source). */
async function detailHandler(ctx: Ctx): Promise<void> {
  const detail = await livePluginsService().detail(publicPluginId(ctx));
  if (!detail) throw new HttpError(404, 'plugins.not_found');
  json(ctx.res, 200, { plugin: detailJson(detail.plugin, detail.live) });
}

/** GET /api/plugins/installed: the viewer's installs WITH approved sources
 * (the one boot round trip the client runtime loads from). */
async function installedHandler(ctx: Ctx): Promise<void> {
  const rows = await livePluginsService().installed(ctxAccountId(ctx));
  json(ctx.res, 200, { rows: rows.map(installedRowJson) });
}

/** GET /api/plugins/mine: the author's plugins including review state. */
async function mineHandler(ctx: Ctx): Promise<void> {
  const rows = await livePluginsService().mine(ctxAccountId(ctx));
  json(ctx.res, 200, { rows: rows.map(mineRowJson) });
}

/** POST /api/plugins: submit a new plugin (metadata + version 1, pending). */
async function createHandler(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const result = await livePluginsService().createPlugin(ctxAccountId(ctx), {
    name: body.name,
    summary: body.summary,
    description: body.description,
    category: body.category,
    source: body.source,
    notes: body.notes,
    authorHandle: body.author,
  });
  if (!result.ok) throwPluginsError(result.error);
  json(ctx.res, 200, {
    plugin: { id: result.value.id, slug: result.value.slug, status: result.value.status },
  });
}

/** POST /api/plugins/:id/versions: submit an update for review (owner only). */
async function submitVersionHandler(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const result = await livePluginsService().submitVersion(ownedPlugin(ctx), {
    name: body.name,
    summary: body.summary,
    description: body.description,
    category: body.category,
    source: body.source,
    notes: body.notes,
  });
  if (!result.ok) throwPluginsError(result.error);
  json(ctx.res, 200, {
    version: {
      version: result.value.version,
      status: result.value.status,
      submittedAt: result.value.submittedAt,
    },
  });
}

/** POST /api/plugins/:id/install: install, or flip the enabled bit. */
async function installHandler(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const enabled = body.enabled !== false;
  const error = await livePluginsService().install(ctxAccountId(ctx), publicPluginId(ctx), enabled);
  if (error) throwPluginsError(error);
  json(ctx.res, 200, { ok: true, enabled });
}

/** DELETE /api/plugins/:id/install: uninstall. */
async function uninstallHandler(ctx: Ctx): Promise<void> {
  const error = await livePluginsService().uninstall(ctxAccountId(ctx), publicPluginId(ctx));
  if (error) throwPluginsError(error);
  json(ctx.res, 200, { ok: true });
}

/** DELETE /api/plugins/:id: the author retires their plugin entirely. */
async function deleteHandler(ctx: Ctx): Promise<void> {
  const plugin = ownedPlugin(ctx);
  await livePluginsService().deletePlugin(ctxAccountId(ctx), plugin.id);
  bustPluginsCatalog();
  json(ctx.res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes (most-specific
// first, so the static /installed and /mine reads win over /:id). Guard order
// on the submit lanes: Content-Length precheck BEFORE auth, then the bearer
// guard, then the fused ip+account limiter, then the body parser, then (on
// owner-only :id routes) the BOLA owner loader.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/plugins',
    surface: 'api',
    middleware: [rateLimit(PUBLIC_READ_POLICY)],
    handler: catalogHandler,
  },
  {
    method: 'GET',
    path: '/api/plugins/installed',
    surface: 'api',
    middleware: [readAccount],
    handler: installedHandler,
  },
  {
    method: 'GET',
    path: '/api/plugins/mine',
    surface: 'api',
    middleware: [readAccount],
    handler: mineHandler,
  },
  {
    method: 'GET',
    path: '/api/plugins/:id',
    surface: 'api',
    middleware: [rateLimit(PUBLIC_READ_POLICY)],
    meta: { publicRead: true },
    handler: detailHandler,
  },
  {
    method: 'POST',
    path: '/api/plugins',
    surface: 'api',
    middleware: [
      submitContentLengthGuard,
      activeAccount,
      rateLimit(PLUGIN_MUTATION_POLICY),
      withBody(MAX_PLUGIN_SUBMIT_BYTES),
    ],
    handler: createHandler,
  },
  {
    method: 'POST',
    path: '/api/plugins/:id/versions',
    surface: 'api',
    middleware: [
      submitContentLengthGuard,
      activeAccount,
      rateLimit(PLUGIN_MUTATION_POLICY),
      withBody(MAX_PLUGIN_SUBMIT_BYTES),
      requireOwnedPlugin,
    ],
    meta: { requireOwned: { kind: 'plugin', ownerScope: 'account' } },
    handler: submitVersionHandler,
  },
  {
    method: 'POST',
    path: '/api/plugins/:id/install',
    surface: 'api',
    middleware: [activeAccount, rateLimit(PLUGIN_MUTATION_POLICY), withBody()],
    meta: { publicRead: true },
    handler: installHandler,
  },
  {
    method: 'DELETE',
    path: '/api/plugins/:id/install',
    surface: 'api',
    middleware: [activeAccount, rateLimit(PLUGIN_MUTATION_POLICY)],
    meta: { publicRead: true },
    handler: uninstallHandler,
  },
  {
    method: 'DELETE',
    path: '/api/plugins/:id',
    surface: 'api',
    middleware: [activeAccount, rateLimit(PLUGIN_MUTATION_POLICY), requireOwnedPlugin],
    meta: { requireOwned: { kind: 'plugin', ownerScope: 'account' } },
    handler: deleteHandler,
  },
];
