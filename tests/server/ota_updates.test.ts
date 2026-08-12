process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_ota_updates_units';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildManifestEntries, planOtaPublish } from '../../scripts/ota/publish_bundle.mjs';
import {
  compareSemver,
  configureOtaUpdatesRuntime,
  normalizeOtaFileManifest,
  normalizeOtaManifest,
  OTA_DELTA_OFFERS_PER_WINDOW,
  OTA_FILE_MANIFEST_MAX_BYTES,
  OTA_FILE_MANIFEST_MAX_ENTRIES,
  OTA_MANIFEST_MAX_BYTES,
  OTA_MANIFEST_TTL_MS,
  type OtaManifest,
  type OtaManifestFileEntry,
  parseSemver,
  planOtaUpdate,
  resetOtaUpdatesRuntimeForTests,
  routes,
} from '../../server/ota_updates';
import { PUBLIC_READ_MAX_PER_MINUTE, resetPublicReadRateLimits } from '../../server/ratelimit';
import { fakeCtx } from './helpers';

interface FakeResShape {
  statusCode: number;
  body: string;
}

function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeResShape;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

const MANIFEST: OtaManifest = {
  version: '0.33.0',
  url: 'https://updates.example.com/ota/bundles/wocc-web-0.33.0.zip',
  checksum: 'ab12cd34',
};

const FILE_MANIFEST_URL = 'https://updates.example.com/ota/manifests/wocc-web-0.33.0.manifest.json';

const HASH_A = 'a'.repeat(64);
const HASH_B = '0123456789abcdef'.repeat(4);

const FILE_ENTRIES: OtaManifestFileEntry[] = [
  {
    file_name: 'assets/index-abc.js',
    file_hash: HASH_A,
    download_url: `https://updates.example.com/ota/files/${HASH_A}`,
  },
  {
    file_name: 'index.html',
    file_hash: HASH_B,
    download_url: `https://updates.example.com/ota/files/${HASH_B}`,
  },
];

function entryWith(overrides: Partial<OtaManifestFileEntry>): OtaManifestFileEntry {
  return { ...FILE_ENTRIES[0], ...overrides };
}

/** A latest.json + file-manifest pair served by URL, the delta-publish shape. */
function deltaRuntime(overrides: { entries?: unknown; latest?: Record<string, unknown> } = {}) {
  const latest = overrides.latest ?? { ...MANIFEST, fileManifestUrl: FILE_MANIFEST_URL };
  const entries = 'entries' in overrides ? overrides.entries : FILE_ENTRIES;
  return vi.fn(async (url: string) => {
    if (url === FILE_MANIFEST_URL) return entries;
    return latest;
  });
}

/** A well-formed plugin check-in body; spread overrides per case. */
function checkinBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: 'ios',
    device_id: 'device-1',
    app_id: 'com.worldofclaudecraft',
    plugin_version: '8.0.0',
    version_build: '0.32.0',
    version_code: '320',
    version_name: 'builtin',
    version_os: '18.0',
    is_emulator: false,
    is_prod: true,
    ...overrides,
  };
}

const NO_UPDATE = { message: 'No new version available', error: 'no_new_version_available' };

/** Drive a check through the route's own rate-limit gate, then the handler. */
async function postCheck(
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const ctx = fakeCtx({ method: 'POST', url: '/api/ota/updates', body });
  const [rateLimitGate] = routes[0].middleware ?? [];
  await rateLimitGate(ctx, async () => {
    await routes[0].handler(ctx);
  });
  return captured(ctx.res);
}

const originalManifestUrl = process.env.OTA_MANIFEST_URL;

afterEach(() => {
  resetOtaUpdatesRuntimeForTests();
  resetPublicReadRateLimits();
  if (originalManifestUrl === undefined) delete process.env.OTA_MANIFEST_URL;
  else process.env.OTA_MANIFEST_URL = originalManifestUrl;
  delete process.env.OTA_DELTA_DISABLED;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ota_updates route table', () => {
  it('exposes exactly the one public POST check route, rate gate ahead of the body parse', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe('POST');
    expect(routes[0].path).toBe('/api/ota/updates');
    expect(routes[0].surface).toBe('api');
    expect(routes[0].middleware).toHaveLength(2);
  });
});

describe('parseSemver / compareSemver', () => {
  it('parses strict numeric triples only', () => {
    expect(parseSemver('0.32.0')).toEqual([0, 32, 0]);
    expect(parseSemver(' 1.2.3 ')).toEqual([1, 2, 3]);
    expect(parseSemver('builtin')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('1.2.3-beta.1')).toBeNull();
    expect(parseSemver(320)).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
  });

  it('compares numerically, not lexically', () => {
    expect(compareSemver([0, 32, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareSemver([0, 32, 0], [0, 32, 0])).toBe(0);
    expect(compareSemver([0, 32, 1], [0, 33, 0])).toBeLessThan(0);
  });
});

describe('normalizeOtaManifest', () => {
  it('accepts a full manifest and ignores unknown fields', () => {
    expect(
      normalizeOtaManifest({ ...MANIFEST, minNativeVersion: '0.30.0', extra: 'ignored' }),
    ).toEqual({ ...MANIFEST, minNativeVersion: '0.30.0' });
    expect(normalizeOtaManifest({ ...MANIFEST })).toEqual(MANIFEST);
  });

  it('rejects a bad version, a non-https url, a missing checksum, and a bad optional field', () => {
    expect(normalizeOtaManifest(null)).toBeNull();
    expect(normalizeOtaManifest([MANIFEST])).toBeNull();
    expect(normalizeOtaManifest({ ...MANIFEST, version: 'latest' })).toBeNull();
    expect(
      normalizeOtaManifest({ ...MANIFEST, url: 'http://updates.example.com/b.zip' }),
    ).toBeNull();
    expect(normalizeOtaManifest({ version: '0.33.0', url: MANIFEST.url })).toBeNull();
    expect(normalizeOtaManifest({ ...MANIFEST, checksum: '' })).toBeNull();
    expect(normalizeOtaManifest({ ...MANIFEST, checksum: 42 })).toBeNull();
    expect(normalizeOtaManifest({ ...MANIFEST, minNativeVersion: 'builtin' })).toBeNull();
  });

  it('pins the bundle url to the expected origin when one is given', () => {
    expect(normalizeOtaManifest({ ...MANIFEST }, 'https://updates.example.com')).toEqual(MANIFEST);
    expect(
      normalizeOtaManifest(
        { ...MANIFEST, url: 'https://evil.example.net/wocc-web-0.33.0.zip' },
        'https://updates.example.com',
      ),
    ).toBeNull();
  });

  it('accepts a same-origin fileManifestUrl and fails the whole manifest on a bad one', () => {
    expect(
      normalizeOtaManifest(
        { ...MANIFEST, fileManifestUrl: FILE_MANIFEST_URL },
        'https://updates.example.com',
      ),
    ).toEqual({ ...MANIFEST, fileManifestUrl: FILE_MANIFEST_URL });
    for (const fileManifestUrl of [
      'http://updates.example.com/ota/m.json',
      'https://evil.example.net/ota/m.json',
      42,
      '',
    ]) {
      expect(
        normalizeOtaManifest({ ...MANIFEST, fileManifestUrl }, 'https://updates.example.com'),
      ).toBeNull();
    }
  });

  it('accepts what the publish script actually uploads, end to end', () => {
    // The publisher planner and this endpoint pin their halves separately;
    // this round-trip keeps them honest together: a full plan (checksum,
    // min-native gate, builtAt) survives validation on the manifest origin,
    // and a checksum-less plan (the planner allows it for the rollback probe)
    // is documented here as unusable rather than as a supported manifest.
    const full = planOtaPublish({
      version: '0.33.0',
      bucket: 'wocc-ota',
      prefix: 'ota',
      publicBaseUrl: 'https://updates.example.com',
      checksum: 'ab12cd34',
      minNative: '0.32.0',
      builtAt: '2026-07-30T00:00:00Z',
    });
    expect(normalizeOtaManifest(full.manifest, 'https://updates.example.com')).toEqual({
      version: '0.33.0',
      url: 'https://updates.example.com/ota/bundles/wocc-web-0.33.0.zip',
      checksum: 'ab12cd34',
      minNativeVersion: '0.32.0',
    });
    const checksumless = planOtaPublish({
      version: '0.33.0',
      bucket: 'wocc-ota',
      prefix: 'ota',
      publicBaseUrl: 'https://updates.example.com',
    });
    expect(normalizeOtaManifest(checksumless.manifest, 'https://updates.example.com')).toBeNull();
  });

  it('accepts a delta publish end to end: latest.json field AND the built entries', () => {
    const plan = planOtaPublish({
      version: '0.33.0',
      bucket: 'wocc-ota',
      prefix: 'ota',
      publicBaseUrl: 'https://updates.example.com',
      checksum: 'ab12cd34',
      withFileManifest: true,
    });
    expect(normalizeOtaManifest(plan.manifest, 'https://updates.example.com')).toEqual({
      version: '0.33.0',
      url: 'https://updates.example.com/ota/bundles/wocc-web-0.33.0.zip',
      checksum: 'ab12cd34',
      fileManifestUrl: 'https://updates.example.com/ota/manifests/wocc-web-0.33.0.manifest.json',
    });
    const entries = buildManifestEntries({
      files: [
        { path: 'index.html', sha256: HASH_B },
        { path: 'assets/index-abc.js', sha256: HASH_A },
      ],
      publicBaseUrl: 'https://updates.example.com',
      prefix: 'ota',
    });
    expect(normalizeOtaFileManifest(entries, 'https://updates.example.com')).toEqual(FILE_ENTRIES);
  });
});

describe('normalizeOtaFileManifest', () => {
  const ORIGIN = 'https://updates.example.com';

  it('accepts a well-formed entry list, canonicalizing hashes to lowercase', () => {
    expect(normalizeOtaFileManifest(FILE_ENTRIES, ORIGIN)).toEqual(FILE_ENTRIES);
    const upper = [entryWith({ file_hash: HASH_A.toUpperCase() })];
    // Accepted case-insensitively, emitted lowercase so the wire is stable.
    expect(normalizeOtaFileManifest(upper, ORIGIN)).toEqual([entryWith({ file_hash: HASH_A })]);
  });

  it('enforces content-addressing: the url tail must be the entry hash itself', () => {
    // A same-origin url pointing at a DIFFERENT blob's hash is refused, so a
    // write into the entry document alone can never remap a file to another
    // object already in the bucket.
    expect(
      normalizeOtaFileManifest(
        [entryWith({ download_url: `https://updates.example.com/ota/files/${HASH_B}` })],
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      normalizeOtaFileManifest(
        [entryWith({ download_url: 'https://updates.example.com/ota/files/latest' })],
        ORIGIN,
      ),
    ).toBeNull();
  });

  it('rejects duplicate file names (an ambiguous instruction to the device)', () => {
    expect(normalizeOtaFileManifest([FILE_ENTRIES[0], { ...FILE_ENTRIES[0] }], ORIGIN)).toBeNull();
  });

  it('rejects a non-array, an empty list, and an oversized list outright', () => {
    expect(normalizeOtaFileManifest({ files: FILE_ENTRIES }, ORIGIN)).toBeNull();
    expect(normalizeOtaFileManifest('[]', ORIGIN)).toBeNull();
    expect(normalizeOtaFileManifest([], ORIGIN)).toBeNull();
    const oversized = new Array(OTA_FILE_MANIFEST_MAX_ENTRIES + 1).fill(FILE_ENTRIES[0]);
    expect(normalizeOtaFileManifest(oversized, ORIGIN)).toBeNull();
  });

  it('one bad entry drops the WHOLE manifest, never a filtered subset', () => {
    expect(
      normalizeOtaFileManifest([FILE_ENTRIES[0], entryWith({ file_hash: 'beef' })], ORIGIN),
    ).toBeNull();
  });

  it('rejects unsafe file names: traversal, absolute, backslash, NUL, percent, controls', () => {
    for (const file_name of [
      '../escape.js',
      'a/../b.js',
      '/etc/passwd',
      'a\\b.js',
      'a\0b.js',
      // Percent is refused outright: a consumer that URL-decodes before
      // joining would turn this into the traversal the segment walk refused.
      '%2e%2e%2fescape.js',
      'a%2fb.js',
      'a\nb.js',
      'a\u0001b.js',
      '',
      'a//b.js',
      './a.js',
      `${'x'.repeat(1025)}.js`,
    ]) {
      expect(normalizeOtaFileManifest([entryWith({ file_name })], ORIGIN)).toBeNull();
    }
  });

  it('rejects malformed hashes and off-origin, non-https, or oversized download urls', () => {
    for (const file_hash of ['', 'beef', `${HASH_A}00`, 'g'.repeat(64)]) {
      expect(normalizeOtaFileManifest([entryWith({ file_hash })], ORIGIN)).toBeNull();
    }
    for (const download_url of [
      `http://updates.example.com/ota/files/${HASH_A}`,
      `https://evil.example.net/ota/files/${HASH_A}`,
      'not a url',
      '',
      `https://updates.example.com/${'p/'.repeat(230)}/files/${HASH_A}`,
    ]) {
      expect(normalizeOtaFileManifest([entryWith({ download_url })], ORIGIN)).toBeNull();
    }
  });
});

describe('planOtaUpdate', () => {
  it('offers the published bundle to an older device, checksum included', () => {
    expect(
      planOtaUpdate(MANIFEST, { platform: 'ios', versionName: 'builtin', versionBuild: '0.32.0' }),
    ).toEqual({ version: '0.33.0', url: MANIFEST.url, checksum: 'ab12cd34' });
    expect(
      planOtaUpdate(MANIFEST, {
        platform: 'android',
        versionName: '0.32.5',
        versionBuild: '0.32.0',
      }),
    ).toEqual({ version: '0.33.0', url: MANIFEST.url, checksum: 'ab12cd34' });
  });

  it('uses the applied bundle version when set, the native version when builtin', () => {
    // Applied bundle already newer than the manifest: no offer even though the
    // NATIVE version is older.
    expect(
      planOtaUpdate(MANIFEST, { platform: 'ios', versionName: '0.34.0', versionBuild: '0.32.0' }),
    ).toBeNull();
    // builtin falls back to version_build.
    expect(
      planOtaUpdate(MANIFEST, { platform: 'ios', versionName: 'builtin', versionBuild: '0.33.0' }),
    ).toBeNull();
  });

  it('never offers an equal or older version', () => {
    for (const versionName of ['0.33.0', '0.34.0']) {
      expect(
        planOtaUpdate(MANIFEST, { platform: 'ios', versionName, versionBuild: '0.32.0' }),
      ).toBeNull();
    }
  });

  it('fail-safes to null on platforms and versions it cannot reason about', () => {
    expect(
      planOtaUpdate(MANIFEST, {
        platform: 'electron',
        versionName: '0.1.0',
        versionBuild: '0.1.0',
      }),
    ).toBeNull();
    expect(planOtaUpdate(MANIFEST, { platform: 'ios' })).toBeNull();
    expect(
      planOtaUpdate(MANIFEST, { platform: 'ios', versionName: 'builtin', versionBuild: 'dev' }),
    ).toBeNull();
  });

  it('gates on minNativeVersion using the NATIVE version, fail-closed', () => {
    const gated: OtaManifest = { ...MANIFEST, minNativeVersion: '0.32.0' };
    // Old shell: blocked even though its bundle is older than the manifest.
    expect(
      planOtaUpdate(gated, { platform: 'ios', versionName: 'builtin', versionBuild: '0.31.0' }),
    ).toBeNull();
    // New-enough shell passes and gets the exact offer.
    expect(
      planOtaUpdate(gated, { platform: 'ios', versionName: 'builtin', versionBuild: '0.32.0' }),
    ).toEqual({ version: '0.33.0', url: MANIFEST.url, checksum: 'ab12cd34' });
    // A gate with no parseable native version fails closed.
    expect(planOtaUpdate(gated, { platform: 'ios', versionName: '0.32.0' })).toBeNull();
  });
});

describe('POST /api/ota/updates handler', () => {
  it('answers no-update when OTA_MANIFEST_URL is unset or not https (feature off)', async () => {
    const fetchManifest = vi.fn();
    configureOtaUpdatesRuntime({ fetchManifest });
    for (const url of [undefined, 'http://updates.example.com/ota/latest.json', 'not a url']) {
      if (url === undefined) delete process.env.OTA_MANIFEST_URL;
      else process.env.OTA_MANIFEST_URL = url;
      expect(await postCheck(checkinBody())).toEqual({ status: 200, body: NO_UPDATE });
    }
    expect(fetchManifest).not.toHaveBeenCalled();
  });

  it('serves the manifest offer to an out-of-date device on BOTH mobile platforms', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    configureOtaUpdatesRuntime({ fetchManifest: async () => ({ ...MANIFEST }) });
    for (const platform of ['ios', 'android']) {
      expect(await postCheck(checkinBody({ platform }))).toEqual({
        status: 200,
        body: { version: '0.33.0', url: MANIFEST.url, checksum: 'ab12cd34' },
      });
    }
  });

  it('answers electron (a valid plugin platform with no OTA channel) with no-update, never 400', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    configureOtaUpdatesRuntime({ fetchManifest: async () => ({ ...MANIFEST }) });
    expect(await postCheck(checkinBody({ platform: 'electron' }))).toEqual({
      status: 200,
      body: NO_UPDATE,
    });
  });

  it('answers no-update to an up-to-date device', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    configureOtaUpdatesRuntime({ fetchManifest: async () => ({ ...MANIFEST }) });
    expect(await postCheck(checkinBody({ version_name: '0.33.0' }))).toEqual({
      status: 200,
      body: NO_UPDATE,
    });
  });

  it('answers no-update when the manifest points off the manifest origin', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    configureOtaUpdatesRuntime({
      fetchManifest: async () => ({ ...MANIFEST, url: 'https://evil.example.net/b.zip' }),
    });
    expect(await postCheck(checkinBody())).toEqual({ status: 200, body: NO_UPDATE });
  });

  it('reads the manifest through the shared cache: one fetch serves many checks', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    const fetchManifest = vi.fn(async () => ({ ...MANIFEST }));
    configureOtaUpdatesRuntime({ fetchManifest });
    for (let i = 0; i < 5; i++) await postCheck(checkinBody());
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(OTA_MANIFEST_TTL_MS).toBe(60_000);
  });

  it('re-keys the cache when OTA_MANIFEST_URL changes', async () => {
    const fetchManifest = vi.fn(async () => ({ ...MANIFEST }));
    configureOtaUpdatesRuntime({ fetchManifest });
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    await postCheck(checkinBody());
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota-staging/latest.json';
    await postCheck(checkinBody());
    expect(fetchManifest).toHaveBeenCalledTimes(2);
    expect(fetchManifest).toHaveBeenLastCalledWith(
      'https://updates.example.com/ota-staging/latest.json',
    );
  });

  it('answers no-update when the cold manifest fetch fails or is malformed', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    configureOtaUpdatesRuntime({
      fetchManifest: async () => {
        throw new Error('boom');
      },
    });
    expect(await postCheck(checkinBody())).toEqual({ status: 200, body: NO_UPDATE });
    configureOtaUpdatesRuntime({ fetchManifest: async () => ({ version: 'nope' }) });
    expect(await postCheck(checkinBody())).toEqual({ status: 200, body: NO_UPDATE });
  });

  it('embeds the validated delta manifest in the offer when latest.json advertises one', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    const fetchManifest = deltaRuntime();
    configureOtaUpdatesRuntime({ fetchManifest });
    expect(await postCheck(checkinBody())).toEqual({
      status: 200,
      body: {
        version: '0.33.0',
        url: MANIFEST.url,
        checksum: 'ab12cd34',
        manifest: FILE_ENTRIES,
      },
    });
    // The file manifest is fetched under its own, larger byte bound.
    expect(fetchManifest).toHaveBeenLastCalledWith(FILE_MANIFEST_URL, OTA_FILE_MANIFEST_MAX_BYTES);
    expect(OTA_FILE_MANIFEST_MAX_BYTES).toBeGreaterThan(OTA_MANIFEST_MAX_BYTES);
  });

  it('never embeds the delta manifest in a no-update answer', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    const fetchManifest = deltaRuntime();
    configureOtaUpdatesRuntime({ fetchManifest });
    expect(await postCheck(checkinBody({ version_name: '0.33.0' }))).toEqual({
      status: 200,
      body: NO_UPDATE,
    });
    // No offer means the file manifest is never even fetched.
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(fetchManifest).not.toHaveBeenCalledWith(FILE_MANIFEST_URL, OTA_FILE_MANIFEST_MAX_BYTES);
  });

  it('degrades to the zip offer when the file manifest is invalid or unreachable', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    const zipOnlyOffer = {
      status: 200,
      body: { version: '0.33.0', url: MANIFEST.url, checksum: 'ab12cd34' },
    };
    // One traversal entry poisons the whole list.
    configureOtaUpdatesRuntime({
      fetchManifest: deltaRuntime({
        entries: [FILE_ENTRIES[0], entryWith({ file_name: '../escape.js' })],
      }),
    });
    expect(await postCheck(checkinBody())).toEqual(zipOnlyOffer);
    // The file-manifest fetch failing outright must not take the offer down.
    configureOtaUpdatesRuntime({
      fetchManifest: vi.fn(async (url: string) => {
        if (url === FILE_MANIFEST_URL) throw new Error('boom');
        return { ...MANIFEST, fileManifestUrl: FILE_MANIFEST_URL };
      }),
    });
    expect(await postCheck(checkinBody())).toEqual(zipOnlyOffer);
  });

  it('serializes the delta offer once: many checks, one file-manifest fetch, identical bytes', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    const fetchManifest = deltaRuntime();
    configureOtaUpdatesRuntime({ fetchManifest });
    const bodies: unknown[] = [];
    for (let i = 0; i < 5; i++) bodies.push((await postCheck(checkinBody())).body);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    // One latest.json fetch plus one file-manifest fetch across all five.
    expect(fetchManifest).toHaveBeenCalledTimes(2);
  });

  it('withholds the manifest from plugins that cannot consume it (below 6.1, or unreported)', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    const fetchManifest = deltaRuntime();
    configureOtaUpdatesRuntime({ fetchManifest });
    const zipOnly = { version: '0.33.0', url: MANIFEST.url, checksum: 'ab12cd34' };
    expect(await postCheck(checkinBody({ plugin_version: '5.9.0' }))).toEqual({
      status: 200,
      body: zipOnly,
    });
    expect(await postCheck(checkinBody({ plugin_version: undefined }))).toEqual({
      status: 200,
      body: zipOnly,
    });
    expect((await postCheck(checkinBody({ plugin_version: '6.1.0' }))).body).toHaveProperty(
      'manifest',
    );
    // The heavy document is only ever fetched for a capable plugin.
    expect(fetchManifest.mock.calls.filter((c) => c[0] === FILE_MANIFEST_URL)).toHaveLength(1);
  });

  it('OTA_DELTA_DISABLED=1 is the kill switch: zip offers continue, manifests stop', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    process.env.OTA_DELTA_DISABLED = '1';
    const fetchManifest = deltaRuntime();
    configureOtaUpdatesRuntime({ fetchManifest });
    expect(await postCheck(checkinBody())).toEqual({
      status: 200,
      body: { version: '0.33.0', url: MANIFEST.url, checksum: 'ab12cd34' },
    });
    // The kill switch also stops the heavy fetch itself, not just the embed.
    expect(fetchManifest.mock.calls.filter((c) => c[0] === FILE_MANIFEST_URL)).toHaveLength(0);
  });

  it('caps manifest-bearing offers per IP, degrading to the zip offer past the budget', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    configureOtaUpdatesRuntime({ fetchManifest: deltaRuntime() });
    const results: boolean[] = [];
    for (let i = 0; i < OTA_DELTA_OFFERS_PER_WINDOW + 2; i++) {
      const { status, body } = await postCheck(checkinBody());
      expect(status).toBe(200); // never a 429: the zip offer still updates the device
      results.push(Object.hasOwn(body as Record<string, unknown>, 'manifest'));
    }
    expect(results.filter(Boolean)).toHaveLength(OTA_DELTA_OFFERS_PER_WINDOW);
    expect(results.slice(OTA_DELTA_OFFERS_PER_WINDOW)).toEqual([false, false]);
  });

  it('serves a prebuilt gzip body to gzip-capable callers, raw JSON otherwise', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    configureOtaUpdatesRuntime({ fetchManifest: deltaRuntime() });
    const plainCtx = fakeCtx({ method: 'POST', url: '/api/ota/updates', body: checkinBody() });
    await routes[0].handler(plainCtx);
    const plainRes = plainCtx.res as unknown as FakeResShape & {
      headers: Record<string, unknown>;
    };
    expect(plainRes.headers['content-encoding']).toBeUndefined();
    expect(plainRes.headers.vary).toBe('Accept-Encoding');
    const rawLength = Number(plainRes.headers['content-length']);
    expect(JSON.parse(plainRes.body)).toHaveProperty('manifest');

    const gzipCtx = fakeCtx({
      method: 'POST',
      url: '/api/ota/updates',
      body: checkinBody(),
      headers: { 'accept-encoding': 'gzip, deflate, br' },
    });
    await routes[0].handler(gzipCtx);
    const gzipRes = gzipCtx.res as unknown as FakeResShape & { headers: Record<string, unknown> };
    expect(gzipRes.headers['content-encoding']).toBe('gzip');
    expect(gzipRes.headers.vary).toBe('Accept-Encoding');
    // The precompressed variant is genuinely smaller than the raw body.
    expect(Number(gzipRes.headers['content-length'])).toBeLessThan(rawLength);
  });

  it('rejects an unknown platform with ota_updates.invalid_input', async () => {
    expect(await postCheck(checkinBody({ platform: 'windows' }))).toEqual({
      status: 400,
      body: { error: 'invalid input', code: 'ota_updates.invalid_input' },
    });
  });

  it('throws the schema decode failure for the pipeline 422, per dimension', async () => {
    const shapeless: Record<string, unknown>[] = [
      {}, // platform is required
      checkinBody({ platform: '' }), // minLength 1
      checkinBody({ platform: 'x'.repeat(33) }), // maxLength 32
      checkinBody({ version_name: 'x'.repeat(65) }), // maxLength 64
      checkinBody({ version_build: 42 }), // string, not number
    ];
    for (const body of shapeless) {
      const ctx = fakeCtx({ method: 'POST', url: '/api/ota/updates', body });
      await expect(routes[0].handler(ctx)).rejects.toMatchObject({ ok: false });
    }
  });

  it('takes the shared public-read budget: floods answer 429 before any fetch', async () => {
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    const fetchManifest = vi.fn(async () => ({ ...MANIFEST }));
    configureOtaUpdatesRuntime({ fetchManifest });
    let last: { status: number; body: unknown } | null = null;
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 1; i++) {
      last = await postCheck(checkinBody());
    }
    expect(last).toEqual({ status: 429, body: { error: 'rate limited' } });
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    // Decisive ordering proof: with the budget exhausted and a FRESH runtime
    // (which also clears the manifest cache), the next check still 429s with
    // ZERO fetches, so the gate really runs ahead of the manifest read and
    // the one call above was the cache warming, not a leak past the limiter.
    const coldFetch = vi.fn(async () => ({ ...MANIFEST }));
    configureOtaUpdatesRuntime({ fetchManifest: coldFetch });
    expect(await postCheck(checkinBody())).toEqual({
      status: 429,
      body: { error: 'rate limited' },
    });
    expect(coldFetch).not.toHaveBeenCalled();
  });

  it('bounds the default manifest fetch: oversized, error, and bodyless responses fail safe', async () => {
    // The default runtime (restored by afterEach) rides global fetch; these
    // arms pin the guards that keep a misbehaving manifest origin from making
    // the game server buffer an unbounded body. Every arm decides no-update.
    expect(OTA_MANIFEST_MAX_BYTES).toBe(65536);
    process.env.OTA_MANIFEST_URL = 'https://updates.example.com/ota/latest.json';
    const chunk = new Uint8Array(48 * 1024);
    const oversized = {
      ok: true,
      body: {
        getReader: () => {
          let reads = 0;
          return {
            read: async () =>
              reads++ < 2 ? { done: false, value: chunk } : { done: true, value: undefined },
            cancel: async () => {},
          };
        },
      },
    };
    for (const response of [oversized, { ok: false, status: 500 }, { ok: true, body: null }]) {
      resetOtaUpdatesRuntimeForTests();
      resetPublicReadRateLimits();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response),
      );
      expect(await postCheck(checkinBody())).toEqual({ status: 200, body: NO_UPDATE });
      vi.unstubAllGlobals();
    }
  });
});
