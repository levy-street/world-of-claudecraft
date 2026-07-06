// Frozen type contracts for the API pipeline re-architecture.
//
// This module is TYPE-ONLY: it must emit zero runtime JS. It uses only
// `import type`, `export type`, and `export interface` declarations so the
// compiled output is empty (verified: just comments + `export {}`). Do not add
// a `const`, `enum`, `class`, `namespace`, or any value export here.
//
// This is the SINGLE home of RouteDef, Ctx, EnvelopeKind, Method, Surface,
// Middleware/Next and the RateLimitStore interface. The pipeline modules IMPORT
// these types and never redefine them.

import type * as http from 'node:http';

/** A value that may or may not be wrapped in a promise. */
export type Awaitable<T> = T | Promise<T>;

/** HTTP methods the route table dispatches on. */
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

/**
 * The coarse dispatch family a route belongs to. Each surface maps to a default
 * response envelope (see EnvelopeKind); an individual route may override the
 * envelope via RouteMeta.envelope (e.g. a binary card route inside 'api', or the
 * HTML unsubscribe page). These mirror the prefix arms of main.ts's
 * routeHttpRequest dispatcher (/api, /oauth, /admin/api, /internal).
 */
export type Surface =
  | 'api' // /api/*       default envelope: 'problem+json' (RFC 9457)
  | 'oauth' // /oauth/*     default envelope: 'oauth' (RFC 6749)
  | 'admin' // /admin/api/* default envelope: 'admin' ({ success, data, error })
  | 'internal'; // /internal/*  secret-gated ops endpoints

/**
 * The seven per-surface response envelopes from the canonical design. The stable
 * error codes (the catalog the client i18n matcher keys on) serialize THROUGH
 * one of these; this is the envelope seam, not a code source.
 */
export type EnvelopeKind =
  | 'problem+json' // /api errors: RFC 9457 application/problem+json
  | 'oauth' // /oauth errors: RFC 6749 { error, error_description }
  | 'admin' // /admin/api: { success, data, error }
  | 'html' // an HTML error page (e.g. the email-unsubscribe page)
  | 'redirect' // a 302 redirect (e.g. the Discord OAuth callback)
  | 'binary' // a binary body (e.g. the shareable player-card PNG)
  | 'legacy405'; // the legacy { ok: false } 405 envelope

/**
 * Whether an owned resource is player-owned or operator-scoped. Drives the BOLA
 * denial code and the registry-introspection coverage rule:
 *  - 'account'  player-owned: denial is 404 (anti-enumeration); these :id routes
 *               MUST carry a requireOwned loader.
 *  - 'operator' admin/operator-scoped: denial is 403; EXCLUDED from the
 *               account-owner clause of the BOLA coverage helper.
 */
export type OwnerScope = 'account' | 'operator';

/** Token scope mirrored onto Ctx.account (see db.ts accountAndScopeForToken). */
export type TokenScope = 'read' | 'full';

/**
 * Marks a route whose :id resource must be loaded and ownership-authorized
 * before the handler runs; the require_owned middleware is the loader that
 * fetches and authorizes it.
 */
export interface RequireOwned {
  /** The resource kind the loader fetches and authorizes (e.g. 'character'). */
  readonly kind: string;
  /** Player-owned ('account') vs operator-scoped ('operator'); see OwnerScope. */
  readonly ownerScope: OwnerScope;
}

/** Per-route metadata. All fields optional; absent meta means a plain route. */
export interface RouteMeta {
  /** Present on a route that must BOLA-load and authorize an owned :id resource. */
  readonly requireOwned?: RequireOwned;
  /**
   * Marks a :id route that is INTENTIONALLY public (no ownership check), so the
   * registry-introspection coverage helper does not flag it as missing a
   * requireOwned loader. Set on the genuinely public character/leaderboard :id
   * read routes.
   */
  readonly publicRead?: boolean;
  /** Overrides the surface's default response envelope for this one route. */
  readonly envelope?: EnvelopeKind;
  /**
   * The REQUEST-body media type this route accepts (the response side is
   * `envelope`). Read by the Content-Type 415 gate: absent means the /api
   * surface default (application/json); 'binary' marks a raw-bytes upload (the
   * card PNG) the JSON 415 gate must exempt. Declared here so the gate reads
   * matched-RouteDef metadata, never a hardcoded path list.
   */
  readonly requestBody?: 'json' | 'binary';
  /** Frozen now, unused until the deferred deprecation conventions land. */
  readonly deprecated?: boolean;
  /** ISO-8601 date; frozen now, unused until the deprecation conventions land. */
  readonly sunset?: string;
}

/**
 * A validation schema slot. The contract is Standard Schema v1 (the locked,
 * published interface); the zero-dep validator (schema.ts) produces objects that
 * satisfy it. This module holds the type contract only (the validator runtime
 * lives in schema.ts). Flattened into standalone interfaces (no TS namespace)
 * to stay Biome-clean.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaProps<Input, Output>;
}

export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) => Awaitable<StandardSchemaResult<Output>>;
  readonly types?: StandardSchemaTypes<Input, Output>;
}

export type StandardSchemaResult<Output> = StandardSchemaSuccess<Output> | StandardSchemaFailure;

export interface StandardSchemaSuccess<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

export interface StandardSchemaFailure {
  readonly issues: ReadonlyArray<StandardSchemaIssue>;
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | StandardSchemaPathSegment>;
}

export interface StandardSchemaPathSegment {
  readonly key: PropertyKey;
}

export interface StandardSchemaTypes<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}

/** Convenience alias for a route's body/params/query schema slot. */
export type RouteSchema<Output = unknown> = StandardSchemaV1<unknown, Output>;

/** The authenticated identity attached to Ctx after the auth middleware runs. */
export interface CtxAccount {
  readonly accountId: number;
  /** 'read' tokens may hit read routes; mutating routes require 'full'. */
  readonly scope: TokenScope;
}

/**
 * The per-request context. context.ts's buildContext produces this; handlers and
 * middleware read/write it instead of touching req/res directly, which is what
 * keeps the route core req/res-free and usable from both REST and WS.
 */
export interface Ctx {
  /** The underlying node request (kept for the few primitives that need it). */
  readonly req: http.IncomingMessage;
  /** The underlying node response (compose serializes through this). */
  readonly res: http.ServerResponse;
  readonly method: Method;
  /** The parsed WHATWG URL. */
  readonly url: URL;
  /** url.pathname, for convenience. */
  readonly path: string;
  /**
   * The matched route's :param TEMPLATE (e.g. '/api/characters/:id'), set by
   * buildContext for a registry-matched request. It is the ONLY route identity a
   * middleware may put in a metric or log label (ctx.path is concrete and would
   * explode cardinality / leak the requested id).
   */
  readonly route?: string;
  /** Parsed query string; a repeated key becomes a string[]. */
  readonly query: Record<string, string | string[]>;
  /** Path params extracted by the router (e.g. { id: '42' } for /api/x/:id). */
  readonly params: Record<string, string>;
  /** Resolved client IP (X-Forwarded-For aware; see ratelimit.requestIp). */
  readonly ip: string;
  /** Per-request id (AsyncLocalStorage-backed: context.ts runWithReqId/newReqId). */
  readonly reqId: string;
  /** Parsed/validated request body; populated by the withBody/validator middleware. */
  body?: unknown;
  /** Present only after the auth middleware authenticates the request. */
  account?: CtxAccount;
  /**
   * Per-request mutable bag for middleware to stash loaded resources (e.g. the
   * BOLA loader stores the owned, authorized object here for the handler).
   */
  readonly state: Map<string, unknown>;
}

/** A route handler: req/res-free, takes the Ctx, returns a value to serialize. */
export type RouteHandler = (ctx: Ctx) => Awaitable<unknown>;

/** Calls the next middleware (or the handler) in the onion. */
export type Next = () => Promise<void>;

/** A Koa-style onion middleware: do work, await next(), do work. */
export type Middleware = (ctx: Ctx, next: Next) => Promise<void>;

/**
 * One route in the table. The handler stays req/res-free (takes a Ctx) so the
 * same core can serve REST and WS and is unit-testable. schema/params/query are
 * the schema.ts validation slots; meta carries the BOLA + envelope markers.
 */
export interface RouteDef {
  readonly method: Method;
  /** Path pattern, e.g. '/api/characters/:id'. */
  readonly path: string;
  readonly surface: Surface;
  /** Route-local middleware, composed after the global onion. */
  readonly middleware?: ReadonlyArray<Middleware>;
  /** Request body schema. */
  readonly schema?: RouteSchema;
  /** Path params schema. */
  readonly params?: RouteSchema;
  /** Query string schema. */
  readonly query?: RouteSchema;
  readonly handler: RouteHandler;
  readonly meta?: RouteMeta;
}

/**
 * The outcome of recording one rate-limit attempt. This is the shape the
 * PgRateLimitStore, the in-memory FakeRateLimitStore test fake, and every
 * ratelimit.ts limiter all speak.
 */
export interface RateLimitOutcome {
  /** true if the attempt is under the limit and allowed. */
  readonly allowed: boolean;
  /** Attempts remaining in the current window after this one (>= 0). */
  readonly remaining: number;
  /** Whole seconds until the current window resets (for Retry-After). */
  readonly resetSeconds: number;
}

/**
 * A keyed sliding-window rate-limit store. Implementations are clock-
 * parameterized via an injected now() supplied at construction (NOT a method
 * arg), so windows and resetSeconds are deterministic in tests. The
 * FakeRateLimitStore test fake and the PgRateLimitStore both implement this.
 */
export interface RateLimitStore {
  /** Record an attempt for `key` under `maxPerMinute` and report the outcome. */
  hit(key: string, maxPerMinute: number): Awaitable<RateLimitOutcome>;
  /** Clear all windows (test isolation / global reset). */
  reset(): Awaitable<void>;
}
