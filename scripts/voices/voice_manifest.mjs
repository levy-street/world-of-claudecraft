// Pure manifest-entry builder for the NPC voice-line pipeline: given the full
// line list and where a line's clip lives on disk, returns the versioned
// public URL for every line whose clip already exists. Kept separate from
// gen_npc_lines.mjs (which needs an ElevenLabs key and an esbuild-bundled sim
// content import just to build the line list) so this half unit-tests on its
// own with plain temp files.
//
// The `?v=<hash12>` suffix mirrors the sampled SFX manifest's cache-busting
// convention (scripts/sfx/manifest.mjs): a stable content hash baked into the
// URL at generation time lets server/static_cache.ts serve the clip with a
// year-long immutable Cache-Control instead of falling through to no-cache.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/** First 12 hex chars of the clip's sha256: same truncation as the SFX
 * manifest, so both audio catalogs share one cache-busting convention. */
export function voiceClipHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

export function voiceLineUrl(voiceNpc, key, hash) {
  return `/audio/voice/${voiceNpc}/${key}.mp3?v=${hash}`;
}

/**
 * @param {Array<{key: string, voiceNpc: string}>} lines
 * @param {(line: {key: string, voiceNpc: string}) => string} diskPathFor
 * @returns {Record<string, string>} lineKey -> versioned public path, for
 *   every line whose clip already exists on disk. Missing clips are silently
 *   omitted, the same idempotent, partial-run-tolerant rebuild gen_npc_lines.mjs
 *   has always done.
 */
export function buildVoiceManifestEntries(lines, diskPathFor) {
  const entries = {};
  for (const line of lines) {
    const dest = diskPathFor(line);
    if (!existsSync(dest)) continue;
    entries[line.key] = voiceLineUrl(line.voiceNpc, line.key, voiceClipHash(readFileSync(dest)));
  }
  return entries;
}
