// OTA update-check API surface for the Capgo capacitor-updater plugin in the
// native mobile shells (scaffolded by `npm run new:endpoint`, filled in per the
// public-read rung, server/leaderboard.ts, and the deeds registry-only shape).
//
// Self-hosted live updates: the plugin POSTs its device/version info here (the
// documented Capgo self-hosted auto-update protocol) and the server answers
// either an update offer { version, url, checksum } pointing at the S3-hosted
// bundle zip, or a no-update body (no `url` key, which the plugin treats as
// "stay put"). The heavy bundle download never touches this process: only the
// JSON check does. The offer comes from a manifest JSON the deploy script
// (scripts/ota/publish_bundle.mjs) uploads next to the bundles; this module
// reads it through a createCachedRead (TTL + single-flight + stale-on-error),
// so a launch stampede costs at most one outbound fetch per TTL window.
//
// Differential updates: when latest.json carries a fileManifestUrl, the offer
// also embeds the published per-file manifest (Capgo `manifest` entries:
// file_name / file_hash / download_url), which plugin 6.1+ uses to download
// only the files a device is missing, reusing anything already inside the
// store binary or its local cache by sha256. The entry list is fetched through
// its own cached read and validated fail-closed like everything else here: any
// malformed entry drops the WHOLE manifest and the offer degrades to the
// proven zip, never to a partially-validated file list. The embedded manifest
// makes an offer body MiB-class (~1.7 MiB raw, ~280 KB gzipped on the real
// dist), so the heavy arm is defended in depth: the body AND its gzip are
// prebuilt once per published version (the reverse proxy never re-compresses
// it per request), only plugin versions that can consume the manifest receive
// it, a per-IP budget caps how often one address can pull the heavy variant
// (past it the offer degrades to the zip, never a 429), and OTA_DELTA_DISABLED=1
// is the ops kill switch that degrades every offer to the zip without
// touching the update channel. The common no-update answer stays tiny.
//
// Fail-closed feature gate: OTA_MANIFEST_URL unset (or the manifest fetch
// failing cold) answers "no update", never an error, so the native apps behave
// exactly as if OTA were not configured. The response bodies are plugin wire
// protocol, not player-visible text (the plugin only logs them natively), so
// they are exempt from the t() rule the same way dev-channel text is.

import type * as http from 'node:http';
import { gzipSync } from 'node:zlib';
import { type CachedRead, createCachedRead } from './cached_read';
import { withBody } from './http/middleware/body';
import { type Infer, object, optional, str } from './http/schema';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited, rateLimitNow, requestIp } from './ratelimit';

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

/**
 * Byte cap on the fetched per-file manifest document. This one is genuinely
 * large (one entry per dist file: ~6.6k files, ~1.7 MiB on the real dist), so
 * it gets its own bound instead of widening the latest.json cap. Sized ~2x
 * the real artifact, deliberately close: this cap is also the worst case a
 * misbehaving origin can make this process buffer, validate, and cache.
 */
export const OTA_FILE_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;

/** Entry-count cap on the per-file manifest; the real bundle is ~6.6k. */
export const OTA_FILE_MANIFEST_MAX_ENTRIES = 20_000;

/**
 * The per-file manifest document is IMMUTABLE by construction (a per-version
 * key the publish script refuses to overwrite, uploaded with an immutable
 * cache-control), so its cached read never needs a freshness window: the URL
 * itself is the invalidation (a new publish points latest.json at a new
 * document, which re-keys the cache). The long TTL only exists so a --force
 * republish is eventually observed without a process restart.
 */
export const OTA_FILE_MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cap on the SERIALIZED offer body. The input-side caps above bound what this
 * process buffers; this one states the response ceiling explicitly, so the
 * anonymous check endpoint's egress amplification is a chosen number, not a
 * byproduct of the input caps (the real body is ~1.7 MiB raw, ~280 KB
 * gzipped). Past it the offer degrades to the zip rather than shipping a
 * bloated manifest.
 */
export const OTA_OFFER_BODY_MAX_BYTES = 3 * 1024 * 1024;

/**
 * The manifest flow shipped in plugin 6.1.0; a device below that (or one not
 * reporting a version) cannot consume the `manifest` key, so embedding it
 * would be pure payload waste. The shells ship 8.x.
 */
export const OTA_DELTA_MIN_PLUGIN_VERSION: [number, number, number] = [6, 1, 0];

/**
 * Per-IP budget for MANIFEST-BEARING offers, the expensive arm of this
 * anonymous endpoint (~1.7 MiB raw / ~280 KB gzipped per response). A real
 * device checks at most every 10 minutes and receives at most one offer per
 * check, so this is many times legitimate use; past it the device still gets
 * a fully working ZIP offer (never a 429), so updates cannot be starved, only
 * the amplification is capped. Bounded map, same backstop idiom as
 * server/ratelimit.ts.
 */
export const OTA_DELTA_OFFERS_PER_WINDOW = 6;
export const OTA_DELTA_OFFER_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_DELTA_IPS = 10_000;

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
  /** The per-version file-manifest document behind differential offers. */
  fileManifestUrl?: string;
  minNativeVersion?: string;
}

/**
 * One per-file delta entry in the plugin's documented shape (snake_case is the
 * wire contract: the native side reads exactly these keys off the offer).
 */
export interface OtaManifestFileEntry {
  file_name: string;
  file_hash: string;
  download_url: string;
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
  plugin_version: optional(str({ maxLength: 64 })),
});
export type OtaUpdatesBody = Infer<typeof otaUpdatesBodySchema>;

/** An update offer in the plugin's response shape; null means "no update". */
export interface OtaUpdateOffer {
  version: string;
  url: string;
  checksum: string;
  /** Delta entries; absent means the plugin falls back to the zip in `url`. */
  manifest?: OtaManifestFileEntry[];
}

/**
 * The outbound-fetch seam so tests (and a future non-HTTP manifest source)
 * inject their own reader; the default is a bounded global fetch.
 */
export interface OtaUpdatesRuntime {
  fetchManifest(url: string, maxBytes?: number): Promise<unknown>;
}

async function defaultFetchManifest(
  url: string,
  maxBytes: number = OTA_MANIFEST_MAX_BYTES,
): Promise<unknown> {
  // Hardened like server/seeker_rpc_transport.ts: no embedded credentials, no
  // redirect following (a 3xx from the pinned origin must never walk this
  // process off-origin), and a declared-length pre-check ahead of the
  // streaming cap below.
  const parsed = new URL(url);
  if (parsed.username || parsed.password) {
    throw new Error('ota manifest url must not embed credentials');
  }
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(OTA_MANIFEST_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ota manifest fetch failed (${res.status})`);
  const declaredLength = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('ota manifest exceeds the size bound');
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('ota manifest fetch returned no body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
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
// The per-file manifest rides its own cached read (same shape), keyed by the
// fileManifestUrl the current latest.json advertises: a new publish points at
// a new per-version document, which rebuilds this cache naturally.
let fileManifestCache: CachedRead<OtaManifestFileEntry[]> | null = null;
let fileManifestCacheUrl: string | null = null;
// The serialized offer body, built once per published version (Hot paths:
// never serialize OR re-encode a viewer-identical MiB-class payload per
// request). Both representations are prebuilt: the raw JSON Buffer and its
// gzip, so the reverse proxy never re-compresses this body per request.
// Keyed on the offer fields AND the entries array IDENTITY: the cached read
// returns a stable reference until a refresh installs a new list, so a
// --force republish (same version, new entries) re-keys this memo the moment
// the new list lands, where an entry COUNT would have matched stale bytes.
interface OfferBodyCache {
  key: string;
  entriesRef: OtaManifestFileEntry[];
  raw: Buffer | null; // null: serialized body exceeded OTA_OFFER_BODY_MAX_BYTES
  gzip: Buffer | null;
}
let offerBodyCache: OfferBodyCache | null = null;
// Per-IP window counters for the delta-offer budget (bounded; see the
// constant's doc comment).
const deltaOfferWindows = new Map<string, { windowStartMs: number; count: number }>();

function clearOtaCaches(): void {
  manifestCache = null;
  manifestCacheUrl = null;
  fileManifestCache = null;
  fileManifestCacheUrl = null;
  offerBodyCache = null;
  deltaOfferWindows.clear();
}

/** Inject a manifest reader (tests). Clears the cached manifests. */
export function configureOtaUpdatesRuntime(rt: OtaUpdatesRuntime): void {
  runtime = rt;
  clearOtaCaches();
}

/** Restore the default fetch-backed runtime and drop the cached manifests. */
export function resetOtaUpdatesRuntimeForTests(): void {
  runtime = defaultRuntime;
  clearOtaCaches();
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
  if (record.fileManifestUrl !== undefined) {
    // Same transport rule as the bundle URL: https, and on the manifest's own
    // origin, so a tampered latest.json can never point the delta channel at
    // another host. Malformed disables updates outright (fail closed), same
    // as every other field here.
    const fileManifestUrl =
      typeof record.fileManifestUrl === 'string' ? record.fileManifestUrl.trim() : '';
    if (!fileManifestUrl.startsWith('https://')) return null;
    if (expectedOrigin !== undefined) {
      try {
        if (new URL(fileManifestUrl).origin !== expectedOrigin) return null;
      } catch {
        return null;
      }
    }
    manifest.fileManifestUrl = fileManifestUrl;
  }
  if (record.minNativeVersion !== undefined) {
    if (parseSemver(record.minNativeVersion) === null) return null;
    manifest.minNativeVersion = (record.minNativeVersion as string).trim();
  }
  return manifest;
}

const FILE_HASH_RE = /^[0-9a-f]{64}$/i;
const MAX_FILE_NAME_LENGTH = 1024;
const MAX_DOWNLOAD_URL_LENGTH = 512;
/**
 * Control characters, DEL, '%', and '\\' are rejected outright: these names
 * double as URL path components in the plugin's own code paths, and a
 * consumer that URL-decodes before joining would turn %2e%2e%2f into the
 * traversal the segment walk refused. Build output never contains any of
 * them legitimately.
 */
function hasBadFileNameChar(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x25 /* % */ || c === 0x5c /* backslash */) return true;
  }
  return false;
}

/**
 * Validate an untrusted fetched per-file manifest into the entry list an offer
 * may embed, or null when ANY of it is unusable. All-or-nothing on purpose: a
 * partially valid file list would assemble a broken bundle on the device, so
 * one malformed entry drops the whole manifest and the offer degrades to the
 * zip. Each file_name must be a safe relative path (the native side guards
 * traversal too; this keeps hostile paths from ever leaving this process),
 * each file_hash a sha256 hex, and each download_url https on
 * `expectedOrigin`, the same origin rule the bundle URL follows.
 */
export function normalizeOtaFileManifest(
  value: unknown,
  expectedOrigin: string,
): OtaManifestFileEntry[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > OTA_FILE_MANIFEST_MAX_ENTRIES) return null;
  const entries: OtaManifestFileEntry[] = [];
  const seenNames = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const fileName = typeof record.file_name === 'string' ? record.file_name : '';
    if (fileName === '' || fileName.length > MAX_FILE_NAME_LENGTH) return null;
    if (hasBadFileNameChar(fileName)) return null;
    const segments = fileName.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
    // Duplicate names would hand the device an ambiguous instruction;
    // impossible from a real filesystem walk, so only hostile input hits it.
    if (seenNames.has(fileName)) return null;
    seenNames.add(fileName);
    const rawHash = typeof record.file_hash === 'string' ? record.file_hash : '';
    if (!FILE_HASH_RE.test(rawHash)) return null;
    // Canonicalize to lowercase so the wire is byte-stable regardless of how
    // the document spelled it (the native compare is case-insensitive anyway).
    const fileHash = rawHash.toLowerCase();
    const downloadUrl = typeof record.download_url === 'string' ? record.download_url.trim() : '';
    if (!downloadUrl.startsWith('https://')) return null;
    if (downloadUrl.length > MAX_DOWNLOAD_URL_LENGTH) return null;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(downloadUrl);
    } catch {
      return null;
    }
    if (parsedUrl.origin !== expectedOrigin) return null;
    // Content-addressing is ENFORCED, not merely the publisher's convention:
    // the URL's last path segment must be the entry's own hash, so a write
    // into the entry document alone can never remap a file to some other
    // blob already in the bucket (defense in depth on top of the device's
    // own post-download hash verification).
    const lastSegment = parsedUrl.pathname.split('/').pop() ?? '';
    if (lastSegment.toLowerCase() !== fileHash) return null;
    entries.push({ file_name: fileName, file_hash: fileHash, download_url: downloadUrl });
  }
  return entries;
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
 * Read the per-file manifest behind a validated fileManifestUrl, or null when
 * it is unreachable or fails validation (the offer then degrades to the zip;
 * the delta channel is an optimization, never a gate on updating). The
 * expected origin for every entry's download_url is the fileManifestUrl's own
 * origin, which normalizeOtaManifest already proved equal to the trust root
 * (the OTA_MANIFEST_URL origin).
 */
async function readFileManifest(url: string): Promise<OtaManifestFileEntry[] | null> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  if (fileManifestCache === null || fileManifestCacheUrl !== url) {
    fileManifestCacheUrl = url;
    fileManifestCache = createCachedRead(
      async () => {
        const entries = normalizeOtaFileManifest(
          await runtime.fetchManifest(url, OTA_FILE_MANIFEST_MAX_BYTES),
          origin,
        );
        // Throw rather than install null: a transient bad response (a CDN
        // error page served as 200, a read racing a --force overwrite) then
        // STALE-SERVES the known-good entry list via cached_read instead of
        // silently downgrading every offer to the full zip for a TTL.
        if (entries === null) throw new Error('ota file manifest failed validation');
        // Dev-channel observability (once per install, never per request):
        // without this a manifest quietly growing toward its cap, or a
        // validation-failure streak, is invisible in production.
        console.log(`[ota] file manifest installed: ${entries.length} entries from ${url}`);
        return entries;
      },
      { ttlMs: OTA_FILE_MANIFEST_TTL_MS },
    );
  }
  try {
    return await fileManifestCache.read();
  } catch {
    return null;
  }
}

/**
 * Build (once per published version) both prebuilt representations of the
 * delta offer body: raw JSON bytes and their gzip. With the embedded manifest
 * the body is MiB-class, so per-request stringify/encode/compress is exactly
 * the per-recipient serialization the Hot paths rules forbid; the reverse
 * proxy sees a body that already carries Content-Encoding and skips its own
 * per-request gzip. Returns null (zip-only offer) when the serialized body
 * exceeds the stated response ceiling.
 */
function offerBodyBuffers(
  manifest: OtaManifest,
  entries: OtaManifestFileEntry[],
  offer: OtaUpdateOffer,
): { raw: Buffer; gzip: Buffer } | null {
  const key = [manifest.version, manifest.url, manifest.checksum].join('\n');
  if (offerBodyCache?.key !== key || offerBodyCache.entriesRef !== entries) {
    const body: OtaUpdateOffer = { ...offer, manifest: entries };
    const raw = Buffer.from(JSON.stringify(body));
    if (raw.byteLength > OTA_OFFER_BODY_MAX_BYTES) {
      offerBodyCache = { key, entriesRef: entries, raw: null, gzip: null };
    } else {
      offerBodyCache = { key, entriesRef: entries, raw, gzip: gzipSync(raw) };
    }
  }
  return offerBodyCache.raw === null || offerBodyCache.gzip === null
    ? null
    : { raw: offerBodyCache.raw, gzip: offerBodyCache.gzip };
}

/** Does the device's plugin understand the manifest key? Fail-safe: no. */
export function pluginSupportsDeltaManifest(pluginVersion: string | undefined): boolean {
  const parsed = parseSemver(pluginVersion);
  if (parsed === null) return false;
  return compareSemver(parsed, OTA_DELTA_MIN_PLUGIN_VERSION) >= 0;
}

/**
 * Consume one slot of the per-IP delta-offer budget; false means this check
 * still gets a fully working zip offer, just without the heavy manifest.
 */
function deltaOfferAllowed(req: http.IncomingMessage): boolean {
  const ip = requestIp(req);
  const now = rateLimitNow();
  const window = deltaOfferWindows.get(ip);
  if (!window || now - window.windowStartMs >= OTA_DELTA_OFFER_WINDOW_MS) {
    if (deltaOfferWindows.size >= MAX_TRACKED_DELTA_IPS && !deltaOfferWindows.has(ip)) {
      // Bounded-map backstop: evict expired windows first, then oldest.
      for (const [key, value] of deltaOfferWindows) {
        if (now - value.windowStartMs >= OTA_DELTA_OFFER_WINDOW_MS) deltaOfferWindows.delete(key);
      }
      if (deltaOfferWindows.size >= MAX_TRACKED_DELTA_IPS) {
        const oldest = deltaOfferWindows.keys().next().value;
        if (oldest !== undefined) deltaOfferWindows.delete(oldest);
      }
    }
    deltaOfferWindows.set(ip, { windowStartMs: now, count: 1 });
    return true;
  }
  window.count += 1;
  return window.count <= OTA_DELTA_OFFERS_PER_WINDOW;
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

function acceptsGzip(req: http.IncomingMessage): boolean {
  const raw = req.headers['accept-encoding'];
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  return typeof value === 'string' && /(^|[\s,])gzip($|[\s,;])/.test(value);
}

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
  if (offer === null || manifest === null) {
    json(ctx.res, 200, NO_UPDATE_BODY);
    return;
  }
  // The delta arm, gated four ways before the heavy read is even attempted:
  // the publish must advertise a document, the ops kill switch must be off
  // (OTA_DELTA_DISABLED=1 degrades every offer to the zip without touching
  // the bucket or the update channel), the device's plugin must understand
  // the manifest key, and the per-IP delta budget must have a slot.
  const wantsDelta =
    manifest.fileManifestUrl !== undefined &&
    process.env.OTA_DELTA_DISABLED !== '1' &&
    pluginSupportsDeltaManifest(decoded.value.plugin_version) &&
    deltaOfferAllowed(ctx.req);
  const entries = wantsDelta ? await readFileManifest(manifest.fileManifestUrl as string) : null;
  if (entries === null) {
    // Zip-only offer: tiny body, per-request stringify is fine here.
    json(ctx.res, 200, offer);
    return;
  }
  const buffers = offerBodyBuffers(manifest, entries, offer);
  if (buffers === null) {
    json(ctx.res, 200, offer);
    return;
  }
  // Same wire bytes json() would produce, minus the per-request stringify,
  // encode, and (for gzip-capable callers, i.e. every real device) the
  // reverse proxy's per-request compression of a MiB-class body.
  const body = acceptsGzip(ctx.req) ? buffers.gzip : buffers.raw;
  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json',
    'Content-Length': body.byteLength,
    Vary: 'Accept-Encoding',
  };
  if (body === buffers.gzip) headers['Content-Encoding'] = 'gzip';
  ctx.res.writeHead(200, headers);
  ctx.res.end(body);
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
