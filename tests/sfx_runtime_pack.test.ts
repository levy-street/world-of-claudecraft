import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SFX_CATALOG_HASH,
  SFX_CLIPS,
  SFX_MAX_RUNTIME_PACK_BYTES,
  type SfxEntry,
} from '../src/game/sfx_manifest.generated';
import { loadRuntimeSfxPack, parseRuntimeSfxPack } from '../src/game/sfx_runtime_pack';

type RuntimeEntries = Record<string, SfxEntry>;

function generatedPack(): Record<string, unknown> {
  return JSON.parse(readFileSync('public/audio/sfx/runtime-pack.json', 'utf8'));
}

function clonePack(): Record<string, unknown> {
  return structuredClone(generatedPack());
}

function clips(pack: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return pack.clips as Record<string, Record<string, unknown>>;
}

function resealPack(pack: Record<string, unknown>): Record<string, unknown> {
  const canonicalClips = Object.fromEntries(
    Object.entries(clips(pack))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, clip]) => [
        key,
        {
          variants: (clip.variants as Record<string, unknown>[]).map((variant) => ({
            id: variant.id,
            url: variant.url,
            bytes: variant.bytes,
            sha256: variant.sha256,
          })),
          gain: clip.gain,
          playbackRate: clip.playbackRate,
        },
      ]),
  );
  pack.bundleId = createHash('sha256')
    .update(JSON.stringify({ catalogHash: pack.catalogHash, clips: canonicalClips }))
    .digest('hex');
  return pack;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runtime SFX production pack validation', () => {
  it('accepts the generated exact-key pack and reconstructs the bundled entries', async () => {
    const parsed = await parseRuntimeSfxPack(
      generatedPack(),
      SFX_CATALOG_HASH,
      SFX_CLIPS as RuntimeEntries,
    );

    expect(parsed).toEqual(SFX_CLIPS);
  });

  it('accepts same-origin immutable blob variants', async () => {
    const pack = clonePack();
    const clip = clips(pack).foot_grass;
    const variant = (clip.variants as Record<string, unknown>[])[0];
    variant.url = `/audio/sfx/blobs/${variant.sha256}.mp3`;
    resealPack(pack);

    await expect(
      parseRuntimeSfxPack(pack, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.not.toBeNull();
  });

  it('accepts release-style numbered variant URLs tied to the exact key and hash', async () => {
    const pack = clonePack();
    const variant = (clips(pack).foot_grass.variants as Record<string, unknown>[])[0];
    variant.id = '1';
    variant.url = `/audio/sfx/foot_grass_1.mp3?v=${String(variant.sha256).slice(0, 12)}`;
    resealPack(pack);

    await expect(
      parseRuntimeSfxPack(pack, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.not.toBeNull();
  });

  it('accepts a hashed bare lossless source retained from the release manifest', async () => {
    const pack = clonePack();
    const variant = (clips(pack).foot_grass.variants as Record<string, unknown>[])[0];
    variant.url = `/audio/sfx/foot_grass.wav?v=${String(variant.sha256).slice(0, 12)}`;
    resealPack(pack);

    await expect(
      parseRuntimeSfxPack(pack, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.not.toBeNull();
  });

  it('accepts sparse numeric mob extension ids and supplies fixed runtime metadata', async () => {
    const pack = clonePack();
    const key = 'mob_beast_wolf_attack';
    const sha256 = 'a'.repeat(64);
    clips(pack)[key] = {
      variants: [
        {
          id: '1',
          url: `/audio/sfx/${key}_1.mp3?v=${sha256.slice(0, 12)}`,
          bytes: 10,
          sha256,
        },
        {
          id: '2',
          url: `/audio/sfx/${key}_2.mp3?v=${sha256.slice(0, 12)}`,
          bytes: 10,
          sha256,
        },
        {
          id: '10',
          url: `/audio/sfx/${key}_10.mp3?v=${sha256.slice(0, 12)}`,
          bytes: 10,
          sha256,
        },
      ],
      gain: 0.5,
      playbackRate: 1.1,
    };
    resealPack(pack);

    const parsed = await parseRuntimeSfxPack(pack, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries);
    expect(parsed?.[key]).toMatchObject({
      loop: false,
      category: 'voices',
      preload: 'lazy',
      spatial: true,
      gain: 0.5,
      playbackRate: 1.1,
    });
    expect(parsed?.[key].variants.map((variant) => variant.id)).toEqual(['1', '2', '10']);
  });

  it('keeps fixed catalog variants contiguous and mob extension ids canonical', async () => {
    const fixed = clonePack();
    const fixedVariant = (clips(fixed).foot_grass.variants as Record<string, unknown>[])[0];
    clips(fixed).foot_grass.variants = [
      {
        ...fixedVariant,
        id: '1',
        url: `/audio/sfx/foot_grass_1.mp3?v=${String(fixedVariant.sha256).slice(0, 12)}`,
      },
      {
        ...fixedVariant,
        id: '3',
        url: `/audio/sfx/foot_grass_3.mp3?v=${String(fixedVariant.sha256).slice(0, 12)}`,
      },
    ];
    resealPack(fixed);
    await expect(
      parseRuntimeSfxPack(fixed, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();

    for (const ids of [['01'], ['2', '1'], [String(Number.MAX_SAFE_INTEGER + 1)]]) {
      const extension = clonePack();
      const key = 'mob_beast_wolf_attack';
      const sha256 = 'a'.repeat(64);
      clips(extension)[key] = {
        variants: ids.map((id) => ({
          id,
          url: `/audio/sfx/${key}_${id}.mp3?v=${sha256.slice(0, 12)}`,
          bytes: 10,
          sha256,
        })),
        gain: 0.5,
        playbackRate: 1,
      };
      resealPack(extension);
      await expect(
        parseRuntimeSfxPack(extension, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
        ids.join(','),
      ).resolves.toBeNull();
    }
  });

  it('rejects a stale or forged bundle identity', async () => {
    const stale = clonePack();
    clips(stale).foot_grass.gain = 0.5;
    await expect(
      parseRuntimeSfxPack(stale, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();

    const forged = clonePack();
    forged.bundleId = '0'.repeat(64);
    await expect(
      parseRuntimeSfxPack(forged, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();
  });

  it('rebases a valid remote pack to its trusted request origin and preserves local fallback', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const remotePackUrl = 'https://prod.example/audio/sfx/runtime-pack.json';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(generatedPack())));
    vi.stubGlobal('fetch', fetchMock);

    const loaded = await loadRuntimeSfxPack(
      remotePackUrl,
      SFX_CATALOG_HASH,
      SFX_CLIPS as RuntimeEntries,
    );
    expect(fetchMock).toHaveBeenCalledWith(remotePackUrl, expect.any(Object));
    expect(loaded.foot_grass.url).toMatch(
      /^https:\/\/prod\.example\/audio\/sfx\/foot_grass\.mp3\?v=[a-f0-9]{12}$/,
    );
    expect(loaded.foot_grass.variants[0].url).toBe(loaded.foot_grass.url);
    expect(SFX_CLIPS.foot_grass.url).toMatch(/^\/audio\/sfx\//);

    fetchMock.mockResolvedValueOnce(new Response('{"broken":true}'));
    const fallback = await loadRuntimeSfxPack(
      remotePackUrl,
      SFX_CATALOG_HASH,
      SFX_CLIPS as RuntimeEntries,
    );
    expect(fallback).toBe(SFX_CLIPS);
    expect(fallback.foot_grass.url).toMatch(/^\/audio\/sfx\//);
  });

  it('loads the stable manifest without HTTP caching and falls back coherently', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(generatedPack()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const loaded = await loadRuntimeSfxPack(
      '/audio/sfx/runtime-pack.json',
      SFX_CATALOG_HASH,
      SFX_CLIPS as RuntimeEntries,
    );
    expect(loaded).toEqual(SFX_CLIPS);
    expect(fetchMock).toHaveBeenCalledWith(
      '/audio/sfx/runtime-pack.json',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    );

    fetchMock.mockResolvedValueOnce(new Response('{"broken":true}', { status: 200 }));
    const fallback = await loadRuntimeSfxPack(
      '/audio/sfx/runtime-pack.json',
      SFX_CATALOG_HASH,
      SFX_CLIPS as RuntimeEntries,
    );
    expect(fallback).toBe(SFX_CLIPS);

    fetchMock.mockResolvedValueOnce(
      new Response('\u00e9'.repeat(Math.floor(SFX_MAX_RUNTIME_PACK_BYTES / 2) + 1), {
        status: 200,
      }),
    );
    const oversizedFallback = await loadRuntimeSfxPack(
      '/audio/sfx/runtime-pack.json',
      SFX_CATALOG_HASH,
      SFX_CLIPS as RuntimeEntries,
    );
    expect(oversizedFallback).toBe(SFX_CLIPS);
  });

  it('rejects incompatible, incomplete, and expanded key sets as one unit', async () => {
    const wrongCatalog = clonePack();
    wrongCatalog.catalogHash = '0'.repeat(64);
    await expect(
      parseRuntimeSfxPack(wrongCatalog, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();

    const missing = clonePack();
    delete clips(missing).foot_grass;
    resealPack(missing);
    await expect(
      parseRuntimeSfxPack(missing, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();

    const extra = clonePack();
    clips(extra).unknown_cue = structuredClone(clips(extra).foot_grass);
    resealPack(extra);
    await expect(
      parseRuntimeSfxPack(extra, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();
  });

  it('rejects external, traversal, unhashed, and mismatched blob URLs', async () => {
    for (const url of [
      'https://attacker.invalid/foot_grass.mp3',
      '/audio/sfx/../secrets.mp3?v=000000000000',
      '/audio/sfx/foot_grass.mp3',
      `/audio/sfx/blobs/${'0'.repeat(64)}.mp3`,
    ]) {
      const pack = clonePack();
      const variant = (clips(pack).foot_grass.variants as Record<string, unknown>[])[0];
      variant.url = url;
      resealPack(pack);
      await expect(
        parseRuntimeSfxPack(pack, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
        url,
      ).resolves.toBeNull();
    }
  });

  it('rejects unsafe mix values, duplicate takes, and excessive take counts', async () => {
    const unsafeGain = clonePack();
    clips(unsafeGain).foot_grass.gain = 1.01;
    resealPack(unsafeGain);
    await expect(
      parseRuntimeSfxPack(unsafeGain, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();

    const unsafeRate = clonePack();
    clips(unsafeRate).foot_grass.playbackRate = 4.01;
    resealPack(unsafeRate);
    await expect(
      parseRuntimeSfxPack(unsafeRate, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();

    const duplicate = clonePack();
    const first = (clips(duplicate).foot_grass.variants as Record<string, unknown>[])[0];
    clips(duplicate).foot_grass.variants = [first, structuredClone(first)];
    resealPack(duplicate);
    await expect(
      parseRuntimeSfxPack(duplicate, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();

    const excessive = clonePack();
    const base = (clips(excessive).foot_grass.variants as Record<string, unknown>[])[0];
    clips(excessive).foot_grass.variants = Array.from({ length: 9 }, (_, index) => ({
      ...base,
      id: String(index + 1),
      url: `/audio/sfx/foot_grass_${index + 1}.mp3?v=${String(base.sha256).slice(0, 12)}`,
    }));
    resealPack(excessive);
    await expect(
      parseRuntimeSfxPack(excessive, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();
  });

  it('rejects named take ids and the removed double-underscore filename convention', async () => {
    const named = clonePack();
    const namedVariant = (clips(named).foot_grass.variants as Record<string, unknown>[])[0];
    namedVariant.id = 'alternate';
    namedVariant.url = `/audio/sfx/blobs/${namedVariant.sha256}.mp3`;
    resealPack(named);
    await expect(
      parseRuntimeSfxPack(named, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();

    const doubleUnderscore = clonePack();
    const numberedVariant = (
      clips(doubleUnderscore).foot_grass.variants as Record<string, unknown>[]
    )[0];
    numberedVariant.id = '1';
    numberedVariant.url = `/audio/sfx/foot_grass__1.mp3?v=${String(numberedVariant.sha256).slice(0, 12)}`;
    resealPack(doubleUnderscore);
    await expect(
      parseRuntimeSfxPack(doubleUnderscore, SFX_CATALOG_HASH, SFX_CLIPS as RuntimeEntries),
    ).resolves.toBeNull();
  });
});
