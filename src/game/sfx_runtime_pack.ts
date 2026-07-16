import {
  SFX_FIXED_CATALOG_KEYS,
  SFX_MAX_RUNTIME_PACK_BYTES,
  SFX_MAX_TOTAL_AUDIO_BYTES,
  SFX_MAX_TRACK_BYTES,
  SFX_MAX_TRACKS_PER_KEY,
  SFX_MOB_EXTENSION_FAMILIES,
  SFX_MOB_EXTENSION_KEY_SOURCE,
  type SfxEntry,
  type SfxVariant,
} from './sfx_manifest.generated';

const PACK_FORMAT = 'woc-sfx-runtime-pack';
const PACK_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;
const FIXED_KEYS = new Set<string>(SFX_FIXED_CATALOG_KEYS);
const MOB_EXTENSION_FAMILIES = new Set<string>(SFX_MOB_EXTENSION_FAMILIES);
const MOB_EXTENSION_KEY = new RegExp(SFX_MOB_EXTENSION_KEY_SOURCE);

type RuntimeEntries = Record<string, SfxEntry>;

interface RuntimePackClip {
  variants: SfxVariant[];
  gain: number;
  playbackRate: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isMobExtensionKey(key: string): boolean {
  if (FIXED_KEYS.has(key)) return false;
  const match = key.match(MOB_EXTENSION_KEY);
  return !!match && MOB_EXTENSION_FAMILIES.has(match[1]);
}

function validVariantUrl(key: string, variant: SfxVariant, expectedId: string): boolean {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const catalogUrl =
    expectedId === 'main'
      ? new RegExp(`^/audio/sfx/${escapedKey}\\.(?:mp3|wav|flac|ogg)\\?v=([a-f0-9]{12})$`)
      : new RegExp(`^/audio/sfx/${escapedKey}_${expectedId}\\.mp3\\?v=([a-f0-9]{12})$`);
  const blobUrl = /^\/audio\/sfx\/blobs\/([a-f0-9]{64})\.mp3$/;
  const blobHash = variant.url.match(blobUrl)?.[1];
  const catalogHash = variant.url.match(catalogUrl)?.[1];
  return catalogHash === variant.sha256.slice(0, 12) || blobHash === variant.sha256;
}

function parseVariant(key: string, raw: unknown, expectedId: string): SfxVariant | null {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ['id', 'url', 'bytes', 'sha256'])) return null;
  if (raw.id !== expectedId) return null;
  if (typeof raw.url !== 'string' || typeof raw.sha256 !== 'string') return null;
  if (!SHA256.test(raw.sha256)) return null;
  if (
    typeof raw.bytes !== 'number' ||
    !Number.isSafeInteger(raw.bytes) ||
    raw.bytes <= 0 ||
    raw.bytes > SFX_MAX_TRACK_BYTES
  ) {
    return null;
  }
  const variant = {
    id: raw.id,
    url: raw.url,
    bytes: raw.bytes,
    sha256: raw.sha256,
  };
  return validVariantUrl(key, variant, expectedId) ? variant : null;
}

function mobExtensionVariantId(raw: unknown, previousId: number): string | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !/^[1-9]\d*$/.test(raw.id)) return null;
  const numericId = Number(raw.id);
  if (!Number.isSafeInteger(numericId) || String(numericId) !== raw.id || numericId <= previousId) {
    return null;
  }
  return raw.id;
}

async function sha256(value: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function runtimePackBundleId(
  catalogHash: string,
  clips: Record<string, RuntimePackClip>,
): Promise<string | null> {
  return sha256(JSON.stringify({ catalogHash, clips }));
}

async function readBoundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error('SFX runtime pack exceeds its byte budget');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function rebaseRuntimeAudioUrls(entries: RuntimeEntries, packUrl: string): RuntimeEntries {
  if (!/^https?:\/\//.test(packUrl)) return entries;
  const origin = new URL(packUrl).origin;
  const rebased: RuntimeEntries = {};
  for (const key of Object.keys(entries)) {
    const entry = entries[key];
    const variants = entry.variants.map((variant) => ({
      ...variant,
      url: new URL(variant.url, origin).href,
    }));
    rebased[key] = {
      ...entry,
      url: variants[0].url,
      variants,
    };
  }
  return rebased;
}

export async function parseRuntimeSfxPack(
  raw: unknown,
  catalogHash: string,
  fallback: RuntimeEntries,
): Promise<RuntimeEntries | null> {
  if (
    !isRecord(raw) ||
    !hasOnlyKeys(raw, ['format', 'version', 'bundleId', 'catalogHash', 'clips'])
  ) {
    return null;
  }
  if (
    raw.format !== PACK_FORMAT ||
    raw.version !== PACK_VERSION ||
    typeof raw.bundleId !== 'string' ||
    !SHA256.test(raw.bundleId) ||
    raw.catalogHash !== catalogHash ||
    !isRecord(raw.clips)
  ) {
    return null;
  }
  const clips = raw.clips as Record<string, unknown>;
  const fallbackKeys = Object.keys(fallback);
  if ([...FIXED_KEYS].some((key) => !fallback[key])) return null;
  if (fallbackKeys.some((key) => !FIXED_KEYS.has(key) && !isMobExtensionKey(key))) return null;
  const receivedKeys = Object.keys(clips).sort();
  if ([...FIXED_KEYS].some((key) => !Object.hasOwn(clips, key))) return null;
  if (receivedKeys.some((key) => !FIXED_KEYS.has(key) && !isMobExtensionKey(key))) return null;

  let totalBytes = 0;
  const parsed: Record<string, SfxEntry> = {};
  const identityClips: Record<string, RuntimePackClip> = {};
  for (const key of receivedKeys) {
    const clip = clips[key];
    if (!isRecord(clip) || !hasOnlyKeys(clip, ['variants', 'gain', 'playbackRate'])) return null;
    if (!Array.isArray(clip.variants) || clip.variants.length < 1) return null;
    if (clip.variants.length > SFX_MAX_TRACKS_PER_KEY) return null;
    if (typeof clip.gain !== 'number' || !Number.isFinite(clip.gain)) return null;
    if (clip.gain < 0 || clip.gain > 1) return null;
    if (typeof clip.playbackRate !== 'number' || !Number.isFinite(clip.playbackRate)) return null;
    if (clip.playbackRate < 0.25 || clip.playbackRate > 4) return null;

    const mainTrack =
      clip.variants.length === 1 && isRecord(clip.variants[0])
        ? clip.variants[0].id === 'main'
        : false;
    const extension = isMobExtensionKey(key);
    let previousExtensionId = 0;
    const variants: SfxVariant[] = [];
    for (const [index, rawVariant] of clip.variants.entries()) {
      const expectedId = extension
        ? mobExtensionVariantId(rawVariant, previousExtensionId)
        : mainTrack
          ? 'main'
          : String(index + 1);
      if (!expectedId) return null;
      const variant = parseVariant(key, rawVariant, expectedId);
      if (!variant) return null;
      if (extension) previousExtensionId = Number(expectedId);
      totalBytes += variant.bytes;
      if (totalBytes > SFX_MAX_TOTAL_AUDIO_BYTES) return null;
      variants.push(variant);
    }
    identityClips[key] = {
      variants,
      gain: clip.gain,
      playbackRate: clip.playbackRate,
    };
    const primary = variants[0];
    const compiled = fallback[key];
    if (FIXED_KEYS.has(key) && !compiled) return null;
    const metadata = compiled ?? {
      url: primary.url,
      loop: false,
      category: 'voices',
      preload: 'lazy' as const,
      spatial: true,
      gain: clip.gain,
      playbackRate: clip.playbackRate,
      bytes: primary.bytes,
      hash: primary.sha256.slice(0, 12),
      variants,
    };
    parsed[key] = {
      ...metadata,
      ...(isMobExtensionKey(key)
        ? { loop: false, category: 'voices', preload: 'lazy' as const, spatial: true }
        : {}),
      url: primary.url,
      gain: clip.gain,
      playbackRate: clip.playbackRate,
      bytes: primary.bytes,
      hash: primary.sha256.slice(0, 12),
      variants,
    };
  }
  if ((await runtimePackBundleId(raw.catalogHash as string, identityClips)) !== raw.bundleId) {
    return null;
  }
  return parsed as RuntimeEntries;
}

export async function loadRuntimeSfxPack(
  url: string,
  catalogHash: string,
  fallback: RuntimeEntries,
): Promise<RuntimeEntries> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return fallback;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) return fallback;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > SFX_MAX_RUNTIME_PACK_BYTES) return fallback;
    const body = await readBoundedResponseText(response, SFX_MAX_RUNTIME_PACK_BYTES);
    const parsed = await parseRuntimeSfxPack(JSON.parse(body), catalogHash, fallback);
    return parsed ? rebaseRuntimeAudioUrls(parsed, url) : fallback;
  } catch {
    return fallback;
  } finally {
    window.clearTimeout(timeout);
  }
}
