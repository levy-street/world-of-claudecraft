// OTA update-check API surface for the Capgo capacitor-updater plugin in the
// native mobile shells (scaffolded by `npm run new:endpoint`, filled in per the
// public-read rung, server/leaderboard.ts, and the deeds registry-only shape).
//
// Self-hosted live updates: the plugin POSTs its device/version info here (the
// documented Capgo self-hosted auto-update protocol) and the server answers
// either an update offer { version, url, checksum } pointing at the S3-hosted
// bundle zip, or a no-update body (no `url` key, which the plugin treats as
// "stay put"). The heavy bundle download never touches this process: only the
// tiny JSON check does. The offer comes from a manifest JSON the deploy script
// (scripts/ota/publish_bundle.mjs) uploads next to the bundles; this module
// reads it through a createCachedRead (TTL + single-flight + stale-on-error),
// so a launch stampede costs at most one outbound fetch per TTL window.
//
// Fail-closed feature gate: OTA_MANIFEST_URL unset (or the manifest fetch
// failing cold) answers "no update", never an error, so the native apps behave
// exactly as if OTA were not configured. The response bodies are plugin wire
// protocol, not player-visible text (the plugin only logs them natively), so
// they are exempt from the t() rule the same way dev-channel text is.

import { type CachedRead, createCachedRead } from './cached_read';
import { withBody } from './http/middleware/body';
import { type Infer, object, optional, str } from './http/schema';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';

/** The stable machine code this domain emits on invalid input (see error_codes.ts). */
const INVALID_INPUT_CODE = 'ota_updates.invalid_input';

/** How long one fetched manifest serves update checks before a refetch. */
export const OTA_MANIFEST_TTL_MS = 60_000;

/** Abort a hung manifest fetch well inside the plugin's own response timeout. */
const OTA_MANIFEST_FETCH_TIMEOUT_MS = 10_000;

/**
 * Byte cap on the fetched manifest document (it is a handful of short fields;
 * 64 KiB matches the pipeline's own JSON body bound). Without it a misbehaving
 * manifest origin could make the game server buffer an arbitrarily large body.
 */
export const OTA_MANIFEST_MAX_BYTES = 64 * 1024;

/** The platforms the plugin can report. Only ios/android have an OTA channel. */
const OTA_PLATFORMS = new Set(['ios', 'android', 'electron']);

/**
 * The plugin's documented "no new version available" body: the `error` key
 * tells the native side not to set a version, and this specific literal is the
 * branch Capgo's own backend answers, so the plugin classifies the response as
 * up-to-date instead of falling off its decision chain. Plugin wire
 * vocabulary, never player-visible text.
 */
const NO_UPDATE_BODY = Object.freeze({
  message: 'No new version available',
  error: 'no_new_version_available',
});

/**
 * The published update manifest (latest.json) the deploy script writes to the
 * bucket: the newest bundle version, its public zip URL, the zip's sha256
 * (required: an offer without an integrity check is not served), and
 * optionally the oldest NATIVE shell version the bundle still works on (a
 * bundle that needs a newer native plugin set must never reach an old shell;
 * those users get the existing store-update prompt instead).
 */
export interface OtaManifest {
  version: string;
  url: string;
  checksum: string;
  minNativeVersion?: string;
}

/**
 * Body schema: the subset of the Capgo check-in payload the decision needs.
 * The plugin sends many more fields (device_id, app_id, plugin_version, ...);
 * object() copies only declared keys, so unknown fields pass through ignored
 * and a plugin upgrade can never 422 the check.
 */
export const otaUpdatesBodySchema = object({
  platform: str({ minLength: 1, maxLength: 32 }),
  version_name: optional(str({ maxLength: 64 })),
  version_build: optional(str({ maxLength: 64 })),
});
export type OtaUpdatesBody = Infer<typeof otaUpdatesBodySchema>;

/** An update offer in the plugin's response shape; null means "no update". */
export interface OtaUpdateOffer {
  version: string;
  url: string;
  checksum: string;
}

/**
 * The outbound-fetch seam so tests (and a future non-HTTP manifest source)
 * inject their own reader; the default is a bounded global fetch.
 */
export interface OtaUpdatesRuntime {
  fetchManifest(url: string): Promise<unknown>;
}

async function defaultFetchManifest(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(OTA_MANIFEST_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ota manifest fetch failed (${res.status})`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error('ota manifest fetch returned no body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OTA_MANIFEST_MAX_BYTES) {
      await reader.cancel();
      throw new Error('ota manifest exceeds the size bound');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const defaultRuntime: OtaUpdatesRuntime = { fetchManifest: defaultFetchManifest };
let runtime: OtaUpdatesRuntime = defaultRuntime;
// The manifest is a shared, viewer-identical read, so it goes through the
// single-key cached-read shape (Hot paths): TTL, single-flight, stale-serve.
// Keyed by the URL it was built for so a (test-only) env change rebuilds it.
let manifestCache: CachedRead<OtaManifest | null> | null = null;
let manifestCacheUrl: string | null = null;

/** Inject a manifest reader (tests). Clears the cached manifest. */
export function configureOtaUpdatesRuntime(rt: OtaUpdatesRuntime): void {
  runtime = rt;
  manifestCache = null;
  manifestCacheUrl = null;
}

/** Restore the default fetch-backed runtime and drop the cached manifest. */
export function resetOtaUpdatesRuntimeForTests(): void {
  runtime = defaultRuntime;
  manifestCache = null;
  manifestCacheUrl = null;
}

/** Parse a strict MAJOR.MINOR.PATCH version; null on anything else. */
export function parseSemver(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compare two parsed versions: negative, zero, or positive like a comparator. */
export function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Validate an untrusted fetched manifest into an OtaManifest, or null when it
 * is unusable. Strict on purpose: a malformed manifest (bad version, non-https
 * URL, a missing checksum, an unparseable minNativeVersion) disables updates
 * entirely rather than serving an offer with a gate silently dropped. When
 * `expectedOrigin` is given, the bundle URL must live on that same origin:
 * defense in depth so a write into the manifest alone can never redirect
 * installs to a bundle hosted somewhere else.
 */
export function normalizeOtaManifest(value: unknown, expectedOrigin?: string): OtaManifest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const version = typeof record.version === 'string' ? record.version.trim() : '';
  if (parseSemver(version) === null) return null;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  // https only: Android security policy rejects cleartext, and a tampered
  // manifest must not be able to point installs at a plaintext origin.
  if (!url.startsWith('https://')) return null;
  if (expectedOrigin !== undefined) {
    try {
      if (new URL(url).origin !== expectedOrigin) return null;
    } catch {
      return null;
    }
  }
  if (typeof record.checksum !== 'string' || record.checksum.trim() === '') return null;
  const manifest: OtaManifest = { version, url, checksum: record.checksum.trim() };
  if (record.minNativeVersion !== undefined) {
    if (parseSemver(record.minNativeVersion) === null) return null;
    manifest.minNativeVersion = (record.minNativeVersion as string).trim();
  }
  return manifest;
}

/**
 * The pure update decision: given the published manifest and one device's
 * check-in, return the offer or null for "no update". Every unparseable or
 * unexpected input decides null (fail-safe: a device we cannot reason about
 * keeps its current bundle).
 */
export function planOtaUpdate(
  manifest: OtaManifest,
  req: { platform: string; versionName?: string; versionBuild?: string },
): OtaUpdateOffer | null {
  if (req.platform !== 'ios' && req.platform !== 'android') return null;
  // version_name is the currently applied OTA bundle, or 'builtin' when the
  // device still runs the store-shipped assets; the store bundle's version IS
  // the native version (scripts/version_sync.mjs keeps them in lockstep).
  const currentRaw =
    req.versionName && req.versionName !== 'builtin' ? req.versionName : req.versionBuild;
  const current = parseSemver(currentRaw);
  const published = parseSemver(manifest.version);
  if (current === null || published === null) return null;
  if (manifest.minNativeVersion !== undefined) {
    const min = parseSemver(manifest.minNativeVersion);
    const native = parseSemver(req.versionBuild);
    if (min === null || native === null || compareSemver(native, min) < 0) return null;
  }
  if (compareSemver(published, current) <= 0) return null;
  return { version: manifest.version, url: manifest.url, checksum: manifest.checksum };
}

/**
 * Read the published manifest through the cache, or null when OTA is not
 * configured (OTA_MANIFEST_URL unset or not a valid https URL, the documented
 * env-unset-is-feature-off gate) or the manifest is cold and unreachable. The
 * https requirement is load-bearing: this document decides which JS every
 * phone runs, so it must never be fetchable over a MITM-able transport.
 */
async function readManifest(): Promise<OtaManifest | null> {
  const url = process.env.OTA_MANIFEST_URL;
  if (!url) return null;
  let origin: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    origin = parsed.origin;
  } catch {
    return null;
  }
  if (manifestCache === null || manifestCacheUrl !== url) {
    manifestCacheUrl = url;
    manifestCache = createCachedRead(
      async () => normalizeOtaManifest(await runtime.fetchManifest(url), origin),
      { ttlMs: OTA_MANIFEST_TTL_MS },
    );
  }
  try {
    return await manifestCache.read();
  } catch {
    // Cold cache and the fetch failed: answer "no update" this round rather
    // than surfacing an error to every launching app.
    return null;
  }
}

/**
 * The per-IP gate, mounted AHEAD of withBody so a rate-limited flood never
 * buys a body read or a JSON.parse, let alone a manifest fetch. Anonymous (the
 * plugin runs before any sign-in), so it takes the same tier-1 public-read
 * budget the other anonymous reads use (no pg write on this path), with the
 * established 429 body shape; a 429 just delays the device's next check.
 */
const otaRateLimitGate: Middleware = async (ctx, next) => {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  await next();
};

/** POST /api/ota/updates: the Capgo self-hosted update check. */
async function otaUpdatesHandler(ctx: Ctx): Promise<void> {
  const decoded = otaUpdatesBodySchema.decode(ctx.body ?? {});
  // A schema-shape failure maps to 422 validation.failed through the pipeline.
  if (!decoded.ok) throw decoded;
  if (!OTA_PLATFORMS.has(decoded.value.platform)) {
    json(ctx.res, 400, { error: 'invalid input', code: INVALID_INPUT_CODE });
    return;
  }
  const manifest = await readManifest();
  const offer =
    manifest === null
      ? null
      : planOtaUpdate(manifest, {
          platform: decoded.value.platform,
          versionName: decoded.value.version_name,
          versionBuild: decoded.value.version_build,
        });
  json(ctx.res, 200, offer === null ? NO_UPDATE_BODY : offer);
}

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/ota/updates',
    surface: 'api',
    middleware: [otaRateLimitGate, withBody()],
    handler: otaUpdatesHandler,
  },
];
