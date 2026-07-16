// Deterministic deployable SFX pack. Immutable audio blobs are installed first;
// the stable runtime manifest is replaced last by the bundled installer.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import ffmpegStaticPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { inspectSfxConformance } from '../sfx/conform_audio.mjs';
import {
  buildSfxManifestData,
  catalogHashForEntries,
  SFX_MAX_TOTAL_AUDIO_BYTES,
  SFX_RUNTIME_PACK_FORMAT,
  SFX_RUNTIME_PACK_VERSION,
  serializeRuntimeSfxPack,
} from '../sfx/manifest.mjs';
import { readSfxPlaybackProfile } from '../sfx/playback_profile.mjs';
import {
  DURATION_THRESHOLD,
  MIN_SOURCE_BITRATE,
  TARGET_BITRATE,
  TARGET_SAMPLE_RATE,
} from '../sfx/sfx_conform_rules.mjs';
import { buildDeterministicZip } from './zip.mjs';

const EXPORT_FORMAT = 'woc-sfx-production-bundle';
const EXPORT_VERSION = 1;
const MAX_CONFORMANCE_CACHE_ENTRIES = 1024;
const conformanceCache = new Set();

// The published-conformance verdict must be measured with the same toolchain that
// gates the checked-in assets: npm run sfx:check (scripts/sfx_conform.mjs) and the
// SFX generators resolve ffmpeg-static/ffprobe-static, not the PATH ffmpeg the
// Studio spawns for playback and encoding. A newer PATH ffmpeg reports MP3 duration
// a few tens of milliseconds shorter, enough to flip a clip across the one-second
// peak/LUFS branch boundary and demand the wrong loudness target, so a clip the gate
// accepts would fail export. Keep validation bound to the bundled binaries.
if (!ffmpegStaticPath || !ffprobeStatic?.path) {
  // ffmpeg-static exports null on an unsupported platform; fail here with a
  // clear message instead of handing inspectSfxConformance a null binary path.
  throw new Error('sfx export: bundled ffmpeg-static/ffprobe-static unavailable on this platform');
}
export const CONFORMANCE_FFMPEG_PATH = ffmpegStaticPath;
export const CONFORMANCE_FFPROBE_PATH = ffprobeStatic.path;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sourcePathForVariant(repoRoot, variant) {
  const match = variant.url.match(
    /^\/audio\/sfx\/([a-z0-9]+(?:_[a-z0-9]+)*\.mp3)\?v=[a-f0-9]{12}$/,
  );
  if (!match) throw new Error(`generated SFX variant URL is invalid: ${variant.url}`);
  return join(repoRoot, 'public/audio/sfx', match[1]);
}

function validateProductionTrack(path, identity, bytes) {
  if (conformanceCache.has(identity)) return;
  const validationPath = join(
    tmpdir(),
    `.woc-sfx-export-${process.pid}-${randomBytes(8).toString('hex')}.mp3`,
  );
  let report;
  try {
    writeFileSync(validationPath, bytes, { flag: 'wx', mode: 0o600 });
    report = inspectSfxConformance(validationPath, {
      ffmpegPath: CONFORMANCE_FFMPEG_PATH,
      ffprobePath: CONFORMANCE_FFPROBE_PATH,
    });
  } catch (error) {
    throw new Error(
      `published SFX is not decodable: ${basename(path)} (${error.message ?? error})`,
    );
  } finally {
    rmSync(validationPath, { force: true });
  }

  const errors = [...report.problems];
  if (report.reject) errors.push(`lossy source is below ${MIN_SOURCE_BITRATE} kbps`);
  if (report.codec !== 'mp3') errors.push('codec must be MP3');
  if (![1, 2].includes(report.channels)) errors.push('channels must be mono or stereo');
  if (report.sampleRate !== TARGET_SAMPLE_RATE) {
    errors.push(`sample rate must be ${TARGET_SAMPLE_RATE} Hz`);
  }
  if (report.bitrate !== TARGET_BITRATE) errors.push(`bitrate must be ${TARGET_BITRATE} kbps`);
  const expectedBranch = report.duration < DURATION_THRESHOLD ? 'peak' : 'lufs';
  if (report.normBranch !== expectedBranch) {
    errors.push(`normalization branch must be ${expectedBranch}`);
  }
  if (expectedBranch === 'peak' && !Number.isFinite(report.peakDb)) {
    errors.push('peak loudness must be measurable');
  }
  if (expectedBranch === 'lufs' && !Number.isFinite(report.lufs)) {
    errors.push('integrated loudness must be measurable');
  }
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) {
    throw new Error(
      `published SFX is not production-conforming: ${basename(path)} (${uniqueErrors.join('; ')})`,
    );
  }

  if (conformanceCache.size >= MAX_CONFORMANCE_CACHE_ENTRIES) conformanceCache.clear();
  conformanceCache.add(identity);
}

export function assertExportableSfxTrack(path) {
  const bytes = readFileSync(path);
  const identity = sha256(bytes);
  validateProductionTrack(path, identity, bytes);
  return identity;
}

function nodeInstallScript() {
  return Buffer.from(`#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const staticRoot = process.argv[2];
if (!staticRoot) {
  console.error('usage: node install.mjs <production-static-root>');
  process.exit(2);
}
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const runtimeSource = join(sourceRoot, 'activate/audio/sfx/runtime-pack.json');
const metadata = JSON.parse(readFileSync(join(sourceRoot, 'sfx-pack.json'), 'utf8'));
if (hash(runtimeSource) !== metadata.runtimeManifestSha256) {
  throw new Error('artifact runtime manifest checksum failed');
}
const runtime = JSON.parse(readFileSync(runtimeSource, 'utf8'));
const runtimeIdentity = createHash('sha256')
  .update(JSON.stringify({ catalogHash: runtime.catalogHash, clips: runtime.clips }))
  .digest('hex');
if (runtime.bundleId !== runtimeIdentity || runtime.bundleId !== metadata.runtimeBundleId) {
  throw new Error('artifact runtime identity failed');
}

const sources = new Map();
for (const clip of Object.values(runtime.clips)) {
  for (const variant of clip.variants) {
    if (!/^[a-f0-9]{64}$/.test(variant.sha256)) throw new Error('artifact audio identity failed');
    const source = join(sourceRoot, 'payload/audio/sfx/blobs', variant.sha256 + '.mp3');
    if (!existsSync(source) || hash(source) !== variant.sha256) {
      throw new Error('artifact audio checksum failed');
    }
    sources.set(variant.sha256, source);
  }
}

const targetSfx = join(staticRoot, 'audio/sfx');
for (const identity of sources.keys()) {
  const target = join(targetSfx, 'blobs', identity + '.mp3');
  if (
    existsSync(target) &&
    (!statSync(target).isFile() || hash(target) !== identity)
  ) {
    throw new Error('existing audio blob checksum failed');
  }
}

mkdirSync(join(targetSfx, 'blobs'), { recursive: true });
for (const [identity, source] of sources) {
  const target = join(targetSfx, 'blobs', identity + '.mp3');
  if (existsSync(target)) {
    continue;
  }
  const temporary = target + '.' + process.pid + '.' + randomBytes(4).toString('hex') + '.tmp';
  try {
    copyFileSync(source, temporary, 1);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

mkdirSync(targetSfx, { recursive: true });
const runtimeTarget = join(targetSfx, 'runtime-pack.json');
const temporary = runtimeTarget + '.' + process.pid + '.' + randomBytes(4).toString('hex') + '.tmp';
try {
  copyFileSync(runtimeSource, temporary);
  renameSync(temporary, runtimeTarget);
} finally {
  rmSync(temporary, { force: true });
}
console.log('Activated SFX bundle ' + runtime.bundleId + ' in ' + targetSfx);
`);
}

function posixInstallScript({ runtimeManifestSha256, runtimeBundleId, installBlobsSha256 }) {
  return Buffer.from(`#!/bin/sh
set -eu

source_root=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
static_root=\${1:-}
if [ -z "$static_root" ]; then
  echo "usage: sh install.sh <production-static-root>" >&2
  exit 2
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "install.sh requires sha256sum or shasum" >&2
    exit 1
  fi
}

temporary=
cleanup() {
  if [ -n "$temporary" ]; then rm -f "$temporary"; fi
}
trap cleanup 0 HUP INT TERM

install_atomic() {
  source_file=$1
  target_file=$2
  temporary=$(mktemp "\${target_file}.tmp.XXXXXX")
  cp "$source_file" "$temporary"
  mv -f "$temporary" "$target_file"
  temporary=
}

runtime_source="$source_root/activate/audio/sfx/runtime-pack.json"
if [ "$(hash_file "$runtime_source")" != "${runtimeManifestSha256}" ]; then
  echo "artifact runtime manifest checksum failed" >&2
  exit 1
fi

install_blobs="$source_root/install-blobs.txt"
if [ ! -f "$install_blobs" ] || [ "$(hash_file "$install_blobs")" != "${installBlobsSha256}" ]; then
  echo "artifact audio list checksum failed" >&2
  exit 1
fi

identity_count=0
while IFS= read -r identity || [ -n "$identity" ]; do
  case "$identity" in
    ''|*[!0-9a-f]*) echo "artifact audio identity failed" >&2; exit 1 ;;
  esac
  if [ "\${#identity}" -ne 64 ]; then
    echo "artifact audio identity failed" >&2
    exit 1
  fi
  source_file="$source_root/payload/audio/sfx/blobs/\${identity}.mp3"
  if [ ! -f "$source_file" ] || [ "$(hash_file "$source_file")" != "$identity" ]; then
    echo "artifact audio checksum failed: $identity" >&2
    exit 1
  fi
  identity_count=$((identity_count + 1))
done < "$install_blobs"
if [ "$identity_count" -eq 0 ]; then
  echo "artifact audio list is empty" >&2
  exit 1
fi

target_sfx="$static_root/audio/sfx"
while IFS= read -r identity || [ -n "$identity" ]; do
  target_file="$target_sfx/blobs/\${identity}.mp3"
  if [ -e "$target_file" ]; then
    if [ ! -f "$target_file" ] || [ "$(hash_file "$target_file")" != "$identity" ]; then
      echo "existing audio blob checksum failed: $identity" >&2
      exit 1
    fi
  fi
done < "$install_blobs"

mkdir -p "$target_sfx/blobs"
while IFS= read -r identity || [ -n "$identity" ]; do
  if [ ! -e "$target_sfx/blobs/\${identity}.mp3" ]; then
    source_file="$source_root/payload/audio/sfx/blobs/\${identity}.mp3"
    target_file="$target_sfx/blobs/\${identity}.mp3"
    install_atomic "$source_file" "$target_file"
  fi
done < "$install_blobs"

install_atomic "$runtime_source" "$target_sfx/runtime-pack.json"
echo "Activated SFX bundle ${runtimeBundleId} in $target_sfx"
`);
}

function readme(bundleId) {
  return Buffer.from(`World of ClaudeCraft SFX production bundle

Bundle: ${bundleId}

This artifact contains every published SFX master, ordered runtime take list,
applied gain and playback rate, authoring maps, and integrity metadata. It does
not contain local uploads, previews, version history, music, or NPC voice lines.

Recommended deployment (requires only POSIX shell and SHA-256 tooling):

  sh install.sh /path/to/the/production/static/root

Node.js alternative:

  node install.mjs /path/to/the/production/static/root

The static root is the directory that contains index.html and audio/. The
installer verifies and copies immutable audio blobs first, then atomically
replaces audio/sfx/runtime-pack.json last. Keep old blobs for open clients and
rollback. If the game server uses SFX_PACK_DIR, pass the parent static overlay
directory whose audio/sfx child is mapped by that setting.
`);
}

function uniqueBlobEntries(repoRoot, entries) {
  const blobs = new Map();
  let totalAudioBytes = 0;
  let trackCount = 0;
  for (const entry of Object.values(entries)) {
    for (const variant of entry.variants) {
      const path = sourcePathForVariant(repoRoot, variant);
      const descriptor = openSync(path, 'r');
      let bytes;
      try {
        const before = fstatSync(descriptor);
        if (!before.isFile() || before.size !== variant.bytes) {
          throw new Error(`published SFX changed while exporting: ${basename(path)}`);
        }
        if (totalAudioBytes + before.size > SFX_MAX_TOTAL_AUDIO_BYTES) {
          throw new Error('published SFX exceed the export audio budget');
        }
        bytes = readFileSync(descriptor);
        const after = fstatSync(descriptor);
        if (bytes.length !== before.size || after.size !== before.size) {
          throw new Error(`published SFX changed while exporting: ${basename(path)}`);
        }
      } finally {
        closeSync(descriptor);
      }
      const identity = sha256(bytes);
      if (identity !== variant.sha256) {
        throw new Error(`published SFX changed while exporting: ${basename(path)}`);
      }
      validateProductionTrack(path, identity, bytes);
      totalAudioBytes += bytes.length;
      trackCount++;
      if (!blobs.has(identity)) blobs.set(identity, bytes);
    }
  }
  return { blobs, totalAudioBytes, trackCount };
}

export function buildSfxProductionBundle(repoRoot) {
  const entries = buildSfxManifestData(repoRoot);
  const catalogHash = catalogHashForEntries(entries);
  const playbackProfile = readSfxPlaybackProfile(repoRoot);
  const mixPath = join(repoRoot, 'scripts/sfx/sfx_mix.json');
  const mix = JSON.parse(readFileSync(mixPath, 'utf8'));
  const gainBytes = jsonBytes(playbackProfile.gainMap);
  const speedBytes = jsonBytes(playbackProfile.speedMap);
  const mixBytes = jsonBytes(mix);
  const { blobs, totalAudioBytes, trackCount } = uniqueBlobEntries(repoRoot, entries);

  const clipIdentity = Object.fromEntries(
    Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [
        key,
        {
          variants: entry.variants.map(({ id, bytes, sha256: identity }) => ({
            id,
            bytes,
            sha256: identity,
          })),
          loop: entry.loop,
          category: entry.category,
          preload: entry.preload,
          spatial: entry.spatial,
          gain: entry.gain,
          playbackRate: entry.playbackRate,
        },
      ]),
  );
  const authoring = {
    gainMapSha256: sha256(gainBytes),
    speedMapSha256: sha256(speedBytes),
    mixSha256: sha256(mixBytes),
  };
  const bundleId = sha256(jsonBytes({ catalogHash, clips: clipIdentity, authoring }));
  const runtimeClips = Object.fromEntries(
    Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [
        key,
        {
          variants: entry.variants.map(({ id, bytes, sha256: identity }) => ({
            id,
            url: `/audio/sfx/blobs/${identity}.mp3`,
            bytes,
            sha256: identity,
          })),
          gain: entry.gain,
          playbackRate: entry.playbackRate,
        },
      ]),
  );
  const runtimeBundleId = sha256(Buffer.from(JSON.stringify({ catalogHash, clips: runtimeClips })));
  const runtimePack = {
    format: SFX_RUNTIME_PACK_FORMAT,
    version: SFX_RUNTIME_PACK_VERSION,
    bundleId: runtimeBundleId,
    catalogHash,
    clips: runtimeClips,
  };
  const runtimeBytes = Buffer.from(serializeRuntimeSfxPack(runtimePack));
  const runtimeManifestSha256 = sha256(runtimeBytes);
  const installBlobsBytes = Buffer.from([...blobs.keys()].sort().join('\n'));
  const installBlobsSha256 = sha256(installBlobsBytes);
  const metadata = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    bundleId,
    runtimeBundleId,
    catalogHash,
    keyCount: Object.keys(entries).length,
    trackCount,
    uniqueBlobCount: blobs.size,
    totalAudioBytes,
    runtimeManifestSha256,
    authoring,
    clips: clipIdentity,
  };

  const files = [
    { name: 'README.txt', bytes: readme(bundleId) },
    { name: 'activate/audio/sfx/runtime-pack.json', bytes: runtimeBytes },
    { name: 'authoring/sfx_gain_map.json', bytes: gainBytes },
    { name: 'authoring/sfx_mix.json', bytes: mixBytes },
    { name: 'authoring/sfx_speed_map.json', bytes: speedBytes },
    {
      name: 'install.sh',
      bytes: posixInstallScript({
        runtimeManifestSha256,
        runtimeBundleId,
        installBlobsSha256,
      }),
      mode: 0o100755,
    },
    { name: 'install.mjs', bytes: nodeInstallScript(), mode: 0o100755 },
    {
      name: 'install-blobs.txt',
      bytes: installBlobsBytes,
    },
    { name: 'sfx-pack.json', bytes: jsonBytes(metadata) },
  ];
  for (const [identity, bytes] of blobs) {
    files.push({ name: `payload/audio/sfx/blobs/${identity}.mp3`, bytes });
  }
  const checksums = files
    .map((file) => `${sha256(file.bytes)}  ${file.name}`)
    .sort()
    .join('\n');
  files.push({ name: 'SHA256SUMS', bytes: Buffer.from(`${checksums}\n`) });
  const zip = buildDeterministicZip(files);
  return {
    zip,
    metadata,
    runtimePack,
    sha256: sha256(zip),
    filename: `world-of-claudecraft-sfx-${bundleId.slice(0, 16)}.zip`,
  };
}

export function writeSfxProductionBundle(repoRoot, outputRoot) {
  const bundle = buildSfxProductionBundle(repoRoot);
  mkdirSync(outputRoot, { recursive: true });
  const path = join(outputRoot, bundle.filename);
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, bundle.zip, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { ...bundle, path };
}
