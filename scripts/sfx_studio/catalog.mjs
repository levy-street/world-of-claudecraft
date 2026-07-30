// Complete studio inventory: prompt catalog, current render analysis, authored
// mix state, runtime loading metadata, integration reachability, and context.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildSfxManifestData,
  categoryForSfx,
  preloadForSfx,
  readSfxMix,
  spatialForSfx,
} from '../sfx/manifest.mjs';
import { SFX } from '../sfx/sfx_prompts.mjs';
import { associationsForSfx, integrationForSfx, missingRuntimeCues } from './associations.mjs';
import {
  analyzeLoudness,
  hashFile,
  inspectAudio,
  publishedPath,
  publishedUrl,
  REPO_ROOT,
  STUDIO_ROOT,
  toolchainStatus,
} from './audio_io.mjs';

const ANALYSIS_CACHE = join(STUDIO_ROOT, 'analysis.json');

function readCache() {
  if (!existsSync(ANALYSIS_CACHE)) return { version: 1, files: {} };
  try {
    const parsed = JSON.parse(readFileSync(ANALYSIS_CACHE, 'utf8'));
    return parsed.version === 1 && parsed.files ? parsed : { version: 1, files: {} };
  } catch {
    return { version: 1, files: {} };
  }
}

function writeCache(cache) {
  mkdirSync(dirname(ANALYSIS_CACHE), { recursive: true });
  const temporary = `${ANALYSIS_CACHE}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`);
  renameSync(temporary, ANALYSIS_CACHE);
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

export async function collectSfxCatalog({ loudness = true } = {}) {
  const cache = readCache();
  const mix = readSfxMix(REPO_ROOT);
  const runtime = buildSfxManifestData(REPO_ROOT);
  const toolchain = await toolchainStatus();
  const clips = await mapLimit(SFX, 4, async (source) => {
    const path = publishedPath(source.key);
    const hash = hashFile(path);
    let analysis = cache.files[hash];
    if (!analysis) {
      try {
        const info = await inspectAudio(path);
        const levels = loudness ? await analyzeLoudness(path) : null;
        analysis = { info, levels };
        cache.files[hash] = analysis;
      } catch (error) {
        analysis = { error: String(error.message ?? error) };
      }
    }
    const runtimeProfile = runtime[source.key] ?? null;
    const playbackModified =
      !!runtimeProfile &&
      (Math.abs(runtimeProfile.gain - 1) > 0.000001 ||
        Math.abs(runtimeProfile.playbackRate - 1) > 0.000001);
    return {
      key: source.key,
      prompt: source.prompt,
      designedDuration: source.duration,
      loop: !!source.loop,
      category: categoryForSfx(source.key),
      preload: preloadForSfx(source.key),
      spatial: spatialForSfx(source.key),
      hash,
      url: publishedUrl(source.key),
      analysis,
      mix: mix.clips[source.key] ?? null,
      modified: !!mix.clips[source.key] || playbackModified,
      integration: integrationForSfx(source.key),
      associations: associationsForSfx(source.key),
      runtime: runtimeProfile,
      tracks: runtimeProfile?.variants ?? [],
    };
  });
  if (loudness) writeCache(cache);
  return {
    version: 1,
    clips,
    missingRuntimeCues: missingRuntimeCues(),
    toolchain,
    summary: {
      clips: clips.length,
      tracks: clips.reduce((sum, clip) => sum + clip.tracks.length, 0),
      loops: clips.filter((clip) => clip.loop).length,
      routed: clips.filter((clip) => clip.integration.routed).length,
      modified: clips.filter((clip) => clip.modified).length,
      bytes: clips.reduce((sum, clip) => sum + (clip.analysis.info?.bytes ?? 0), 0),
    },
  };
}
