import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import ffmpegPath from 'ffmpeg-static';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import { buildSfxGenerationPlan } from '../scripts/sfx/generation_plan.mjs';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import * as manifestModule from '../scripts/sfx/manifest.mjs';

import { SFX } from '../scripts/sfx/sfx_prompts.mjs';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import * as associationModule from '../scripts/sfx_studio/associations.mjs';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import * as audioIoModule from '../scripts/sfx_studio/audio_io.mjs';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import * as projectModule from '../scripts/sfx_studio/project.mjs';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';

const { associationsForSfx, integrationForSfx, missingRuntimeCues } = associationModule;
const { buildSfxManifestData, SFX_MAX_TRACK_BYTES, SFX_MAX_TRACKS_PER_KEY } = manifestModule;
const {
  assertPublishedMasterIsMp3,
  audioWorkspaceHash,
  canonicalRenderRecipe,
  codecCorrectionDb,
  exportProductionBundle,
  getPlaybackProfileState,
  loadDraft,
  MASTERING_REVISION,
  migrateLegacyWorkspacePlayback,
  neutralPublishedProject,
  normalizeProductionMastering,
  parseLoudnormReport,
  playbackProfileHash,
  publishPlaybackProfile,
  publishProject,
  publishedPath,
  publishedStateHashForKey,
  publishedStateIdentity,
  rebaseCleanPlaybackDraft,
  resetAudioDraft,
  restoredMixEntry,
  restoreVersion,
  saveUpload,
  saveDraft,
  savePlaybackProfileDraft,
  sourceUrl,
  STUDIO_ROOT,
  unpublishedAudioDraftKeys,
  validatePublishedBudget,
  validateUploadSourceQuality,
  verifyEncodedMaster,
  verifyProductionMaster,
} = audioIoModule;
const {
  buildAuthoringPcmArgs,
  buildFfmpegArgs,
  buildLoudnessMeasureArgs,
  effectiveTruePeakDb,
  normalizeProject,
} = projectModule;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoots: string[] = [];
const playbackDraftPath = join(STUDIO_ROOT, 'playback_profile.json');
let playbackBackupSequence = 0;

async function withIsolatedPlaybackDraft<T>(action: () => T | Promise<T>): Promise<T> {
  mkdirSync(STUDIO_ROOT, { recursive: true });
  const backup = `${playbackDraftPath}.test-backup-${process.pid}-${++playbackBackupSequence}`;
  const existed = existsSync(playbackDraftPath);
  if (existed) renameSync(playbackDraftPath, backup);
  try {
    return await action();
  } finally {
    rmSync(playbackDraftPath, { force: true });
    if (existed) renameSync(backup, playbackDraftPath);
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function manifestFixture(runtimeGainDb: unknown): { root: string; bytes: Buffer } {
  const root = mkdtempSync(join(tmpdir(), 'woc-sfx-manifest-'));
  temporaryRoots.push(root);
  const audioDir = join(root, 'public/audio/sfx');
  const mixDir = join(root, 'scripts/sfx');
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(mixDir, { recursive: true });
  const bytes = Buffer.from('fixture audio bytes');
  writeFileSync(join(audioDir, 'foot_grass.mp3'), bytes);
  writeFileSync(
    join(mixDir, 'sfx_mix.json'),
    `${JSON.stringify({ version: 1, clips: { foot_grass: { runtimeGainDb } } })}\n`,
  );
  return { root, bytes };
}

describe('SFX Studio project schema', () => {
  it('rejects low-bitrate lossy uploads while lossless sources bypass the floor', async () => {
    expect(() => validateUploadSourceQuality('.mp3', { bitrate: 111_999, codec: 'mp3' })).toThrow(
      'lossy audio source must be at least 112 kbps',
    );
    expect(validateUploadSourceQuality('.mp3', { bitrate: 112_000, codec: 'mp3' })).toMatchObject({
      lossless: false,
    });
    expect(validateUploadSourceQuality('.wav', { bitrate: 1, codec: 'pcm_s24le' })).toEqual({
      lossless: true,
    });
    expect(() => validateUploadSourceQuality('.wav', { bitrate: 96_000, codec: 'mp3' })).toThrow(
      'lossy audio source must be at least 112 kbps',
    );

    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const fixture = mkdtempSync(join(tmpdir(), 'woc-sfx-upload-quality-'));
    temporaryRoots.push(fixture);
    const lowLossy = join(fixture, 'low.mp3');
    const lossless = join(fixture, 'source.wav');
    execFileSync(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=0.5',
      '-ac',
      '1',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      lowLossy,
    ]);
    execFileSync(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=0.5',
      '-ac',
      '1',
      '-codec:a',
      'pcm_s24le',
      lossless,
    ]);

    await expect(saveUpload('ui_coin', 'low.mp3', readFileSync(lowLossy))).rejects.toThrow(
      'lossy audio source must be at least 112 kbps',
    );
    await expect(saveUpload('ui_coin', 'renamed.wav', readFileSync(lowLossy))).rejects.toThrow(
      'lossy audio source must be at least 112 kbps',
    );
    const existing = await loadDraft('ui_coin');
    const lowBytes = readFileSync(lowLossy);
    const legacySourceId = `${createHash('sha256').update(lowBytes).digest('hex')}.mp3`;
    const legacySourceDir = join(STUDIO_ROOT, 'sources', 'ui_coin');
    mkdirSync(legacySourceDir, { recursive: true });
    writeFileSync(join(legacySourceDir, legacySourceId), lowBytes);
    await expect(
      saveDraft('ui_coin', { ...existing, sourceId: legacySourceId }, audioWorkspaceHash(existing)),
    ).rejects.toThrow('lossy audio source must be at least 112 kbps');
    rmSync(join(legacySourceDir, legacySourceId), { force: true });
    try {
      await expect(
        saveUpload('ui_coin', 'source.wav', readFileSync(lossless)),
      ).resolves.toMatchObject({ info: { codec: 'pcm_s24le' } });
    } finally {
      await resetAudioDraft('ui_coin');
    }
  });

  it('requires the complete published hash for optimistic-concurrency checks', async () => {
    await expect(publishProject('foot_grass', {}, '18153d1b82cb')).rejects.toThrow(
      'full SHA-256 digest',
    );
  });

  it('requires the complete current published hash before restoring a version', async () => {
    await expect(restoreVersion('foot_grass', '0'.repeat(64))).rejects.toThrow(
      'expected published hash must be a full SHA-256 digest',
    );
  });

  it('restores the exact audio bytes and published identity after two publishes', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'woc-sfx-restore-repo-'));
    temporaryRoots.push(repoRoot);
    cpSync(join(ROOT, 'public/audio/sfx'), join(repoRoot, 'public/audio/sfx'), {
      recursive: true,
    });
    cpSync(join(ROOT, 'scripts/sfx'), join(repoRoot, 'scripts/sfx'), { recursive: true });
    mkdirSync(join(repoRoot, 'src/game'), { recursive: true });
    cpSync(
      join(ROOT, 'src/game/sfx_manifest.generated.ts'),
      join(repoRoot, 'src/game/sfx_manifest.generated.ts'),
    );

    const previousTestRoot = process.env.WOC_SFX_STUDIO_TEST_ROOT;
    const previousRepoRoot = process.env.WOC_SFX_STUDIO_TEST_REPO_ROOT;
    const studioTestRoot = join(repoRoot, 'studio-test');
    mkdirSync(studioTestRoot);
    process.env.WOC_SFX_STUDIO_TEST_ROOT = studioTestRoot;
    process.env.WOC_SFX_STUDIO_TEST_REPO_ROOT = repoRoot;

    try {
      const moduleUrl = new URL('../scripts/sfx_studio/audio_io.mjs', import.meta.url);
      moduleUrl.searchParams.set('restore-roundtrip', `${process.pid}-${Date.now()}`);
      const isolated = await import(/* @vite-ignore */ moduleUrl.href);
      expect(isolated.REPO_ROOT).toBe(repoRoot);

      const key = 'ui_error';
      const audioPath = isolated.publishedPath(key);
      const mixPath = join(repoRoot, 'scripts/sfx/sfx_mix.json');
      const firstDraft = await isolated.loadDraft(key);
      const first = await isolated.publishProject(
        key,
        firstDraft,
        isolated.publishedStateHashForKey(key),
        isolated.audioWorkspaceHash(firstDraft),
      );
      const firstAudio = readFileSync(audioPath);
      const firstMix = JSON.parse(readFileSync(mixPath, 'utf8')).clips[key];
      const secondDraft = await isolated.saveDraft(
        key,
        { ...first.project, reverse: !first.project.reverse },
        first.audioWorkspaceHash,
      );
      const second = await isolated.publishProject(
        key,
        secondDraft.project,
        first.hash,
        secondDraft.audioWorkspaceHash,
      );

      expect(readFileSync(audioPath)).not.toEqual(firstAudio);

      const restored = await isolated.restoreVersion(
        key,
        first.hash,
        second.hash,
        second.audioWorkspaceHash,
      );
      expect(readFileSync(audioPath)).toEqual(firstAudio);
      expect(JSON.parse(readFileSync(mixPath, 'utf8')).clips[key]).toEqual(firstMix);
      expect(restored.hash).toBe(first.hash);
      expect(isolated.publishedStateHashForKey(key)).toBe(first.hash);
    } finally {
      if (previousTestRoot === undefined) delete process.env.WOC_SFX_STUDIO_TEST_ROOT;
      else process.env.WOC_SFX_STUDIO_TEST_ROOT = previousTestRoot;
      if (previousRepoRoot === undefined) delete process.env.WOC_SFX_STUDIO_TEST_REPO_ROOT;
      else process.env.WOC_SFX_STUDIO_TEST_REPO_ROOT = previousRepoRoot;
    }
  }, 60_000);

  it('binds optimistic published state to both audio bytes and its tracked recipe', () => {
    const audioHash = 'a'.repeat(64);
    expect(publishedStateIdentity(audioHash, { project: { reverse: false } })).not.toBe(
      publishedStateIdentity(audioHash, { project: { reverse: true } }),
    );
  });

  it('requires an exact optimistic hash before publishing the saved playback profile', async () => {
    await withIsolatedPlaybackDraft(async () => {
      await expect(publishPlaybackProfile('foot_grass', 'short')).rejects.toThrow(
        'full SHA-256 digest',
      );
      const state = getPlaybackProfileState('foot_grass');
      await expect(
        publishPlaybackProfile('foot_grass', '0'.repeat(64), state.playbackWorkspaceHash),
      ).rejects.toThrow('based on a different published profile');
    });
  });

  it('blocks production export while saved playback changes are unapplied', async () => {
    await withIsolatedPlaybackDraft(async () => {
      const initial = getPlaybackProfileState('foot_grass');
      const tuned = savePlaybackProfileDraft(
        'foot_grass',
        {
          categoryBaselineDb: initial.playback.categoryBaselineDb,
          keyTrimDb: initial.playback.keyTrimDb,
          playbackRate: initial.playback.playbackRate === 1 ? 1.1 : 1,
        },
        initial.playbackWorkspaceHash,
      );

      await expect(
        exportProductionBundle(tuned.playbackProfileHash, tuned.playbackWorkspaceHash),
      ).rejects.toThrow('apply the saved playback mix');
    });
  });

  it('publishes a tuned profile in a disposable repository without touching any MP3', async () => {
    await withIsolatedPlaybackDraft(async () => {
      const fixture = mkdtempSync(join(tmpdir(), 'woc-sfx-publish-'));
      temporaryRoots.push(fixture);
      const audioRoot = join(fixture, 'public/audio/sfx');
      const profileRoot = join(fixture, 'scripts/sfx');
      const manifestPath = join(fixture, 'src/game/sfx_manifest.generated.ts');
      mkdirSync(audioRoot, { recursive: true });
      mkdirSync(profileRoot, { recursive: true });
      mkdirSync(join(fixture, 'src/game'), { recursive: true });
      const audioBefore = new Map<string, Buffer>();
      for (const cue of SFX) {
        const bytes = Buffer.from(`fixture audio ${cue.key}`);
        audioBefore.set(cue.key, bytes);
        writeFileSync(join(audioRoot, `${cue.key}.mp3`), bytes);
      }
      for (const name of ['sfx_gain_map.json', 'sfx_speed_map.json']) {
        writeFileSync(join(profileRoot, name), readFileSync(join(ROOT, 'scripts/sfx', name)));
      }
      const mixPath = join(profileRoot, 'sfx_mix.json');
      const mixBytes = Buffer.from('{"version":1,"clips":{"foot_grass":{"note":"keep"}}}\n');
      writeFileSync(mixPath, mixBytes);
      writeFileSync(manifestPath, '// disposable manifest\n');
      const realTrackedPaths = [
        join(ROOT, 'scripts/sfx/sfx_gain_map.json'),
        join(ROOT, 'scripts/sfx/sfx_speed_map.json'),
        join(ROOT, 'src/game/sfx_manifest.generated.ts'),
      ];
      const realTrackedBefore = realTrackedPaths.map((path) => readFileSync(path));

      const initial = getPlaybackProfileState('foot_grass');
      const tuned = savePlaybackProfileDraft(
        'foot_grass',
        { categoryBaselineDb: -6, keyTrimDb: 3, playbackRate: 1.2 },
        initial.playbackWorkspaceHash,
      );
      const audioPath = join(audioRoot, 'foot_grass.mp3');
      const beforeStat = statSync(audioPath);
      const result = await publishPlaybackProfile(
        'foot_grass',
        tuned.playbackProfileHash,
        tuned.playbackWorkspaceHash,
        fixture,
      );
      const afterStat = statSync(audioPath);

      expect(result.audioUnchanged).toBe(true);
      expect(result.audioHashAfter).toBe(result.audioHashBefore);
      expect(afterStat.ino).toBe(beforeStat.ino);
      expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
      expect(result.playbackWorkspaceHash).toBe(result.playbackProfileHash);
      for (const cue of SFX) {
        expect(readFileSync(join(audioRoot, `${cue.key}.mp3`)), cue.key).toEqual(
          audioBefore.get(cue.key),
        );
      }
      expect(readFileSync(mixPath)).toEqual(mixBytes);
      const manifest = buildSfxManifestData(fixture);
      // foot_grass is explicitly overridden by this draft (categoryBaselineDb
      // -6, keyTrimDb 3 => -3dB), unaffected by its own pinned ceiling trim.
      // foot_stone shares the same movement category baseline (-6dB) but
      // keeps its OWN currently-pinned keyTrimDb (a real custom-key gain
      // ceiling value, not neutral), so its resolved gain reflects that too.
      expect(manifest.foot_grass).toMatchObject({ gain: 0.707946, playbackRate: 1.2 });
      expect(manifest.foot_stone).toMatchObject({ gain: 0.912011, playbackRate: 1 });
      realTrackedPaths.forEach((path, index) => {
        expect(readFileSync(path)).toEqual(realTrackedBefore[index]);
      });
    });
  });

  it('keeps workspace playback maps strict, resolved, and separate from render projects', async () => {
    await withIsolatedPlaybackDraft(() => {
      const initial = getPlaybackProfileState('foot_grass');
      // foot_grass is a custom key currently pinned to its own computed gain
      // ceiling in the real checked-in gain map (not neutral), so its initial
      // (undrafted) resolved state reflects that real pinned value.
      expect(initial.playback).toMatchObject({
        category: 'movement',
        categoryBaselineDb: 0,
        keyTrimDb: 5.1,
        resolvedGainDb: 5.1,
        gain: 1.798871,
        playbackRate: 1,
      });
      expect(initial.playbackProfileHash).toMatch(/^[a-f0-9]{64}$/);
      expect(initial.playbackWorkspaceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(initial.playbackProfileDirty).toBe(false);

      const changed = savePlaybackProfileDraft(
        'foot_grass',
        {
          categoryBaselineDb: -3,
          keyTrimDb: -2,
          playbackRate: 0.75,
        },
        initial.playbackWorkspaceHash,
      );
      expect(changed.playback).toMatchObject({
        categoryBaselineDb: -3,
        keyTrimDb: -2,
        resolvedGainDb: -5,
        playbackRate: 0.75,
      });
      expect(changed.playbackProfileHash).toBe(initial.playbackProfileHash);
      expect(changed.playbackWorkspaceHash).not.toBe(initial.playbackWorkspaceHash);
      expect(changed.playbackProfileDirty).toBe(true);
      expect(() =>
        savePlaybackProfileDraft(
          'foot_stone',
          { categoryBaselineDb: 0, keyTrimDb: 0, playbackRate: 1.1 },
          initial.playbackWorkspaceHash,
        ),
      ).toThrow('changed in another Studio tab');
      const shared = savePlaybackProfileDraft(
        'foot_grass',
        { categoryBaselineDb: -6, keyTrimDb: 6, playbackRate: 1 },
        changed.playbackWorkspaceHash,
      );
      const sibling = getPlaybackProfileState('foot_stone').playback;
      expect(shared.playback.resolvedGainDb).toBe(0);
      // foot_stone is a custom key currently pinned to its own real ceiling
      // trim in the checked-in gain map (not neutral), so its resolved state
      // reflects that pin on top of the shared category baseline this draft
      // just set; categoryBaselineMaxDb likewise reflects the tightest actual
      // ceiling headroom across the real 'movement' category's custom keys.
      expect(sibling).toMatchObject({
        categoryBaselineDb: -6,
        categoryBaselineMaxDb: -6.1,
        keyTrimDb: 5.2,
        resolvedGainDb: -0.7999999999999998,
      });
      expect(() =>
        savePlaybackProfileDraft('foot_grass', {
          categoryBaselineDb: 0,
          keyTrimDb: 0,
          playbackRate: 1,
          outputPath: '/tmp/escape',
        }),
      ).toThrow('unknown field');
    });
  });

  it('migrates legacy playback once and excludes source and sync metadata from render identity', async () => {
    await withIsolatedPlaybackDraft(() => {
      const migrated = migrateLegacyWorkspacePlayback('ui_whisper', {
        version: 2,
        gainDb: -3,
        runtimeGainDb: -4,
        speed: 99,
      });
      expect(migrated?.playback).toMatchObject({
        resolvedGainDb: -7,
        playbackRate: 4,
      });
      expect(migrateLegacyWorkspacePlayback('ui_whisper', { version: 3, speed: 0.5 })).toBeNull();
    });

    const first = normalizeProject(
      { sourceId: `${'a'.repeat(64)}.wav`, syncOffsetMs: -500 },
      { duration: 1 },
    );
    const second = normalizeProject(
      { sourceId: `${'b'.repeat(64)}.wav`, syncOffsetMs: 750 },
      { duration: 1 },
    );
    expect(first.sourceId).not.toBe(second.sourceId);
    expect(first.syncOffsetMs).not.toBe(second.syncOffsetMs);
    expect(canonicalRenderRecipe(first)).toEqual(canonicalRenderRecipe(second));
  });

  it('rebases a clean workspace when checked-in playback maps advance', () => {
    const oldProfile = {
      gainMap: { version: 1, categoryBaselineDb: {}, keyTrimDb: {} },
      speedMap: { version: 1, rateByKey: {} },
    };
    const nextProfile = {
      gainMap: { version: 1, categoryBaselineDb: { movement: -3 }, keyTrimDb: {} },
      speedMap: { version: 1, rateByKey: { foot_grass: 0.9 } },
    };
    const oldHash = playbackProfileHash(oldProfile);
    const clean = { version: 1, baseHash: oldHash, ...oldProfile };
    const rebased = rebaseCleanPlaybackDraft(clean, nextProfile);

    expect(rebased.baseHash).toBe(playbackProfileHash(nextProfile));
    expect(rebased.gainMap.categoryBaselineDb.movement).toBe(-3);
    expect(rebased.speedMap.rateByKey.foot_grass).toBe(0.9);

    const dirty = {
      ...clean,
      gainMap: { ...clean.gainMap, keyTrimDb: { foot_grass: -2 } },
    };
    const preserved = rebaseCleanPlaybackDraft(dirty, nextProfile);
    expect(preserved.baseHash).toBe(oldHash);
    expect(preserved.gainMap.categoryBaselineDb.movement).toBe(0);
    expect(preserved.gainMap.keyTrimDb.foot_grass).toBe(-2);
    expect(preserved.speedMap.rateByKey).toEqual({});
  });

  it('never emits an invalid null source route for a clean draft', () => {
    expect(sourceUrl('foot_grass', null)).toMatch(/^\/audio\/foot_grass\.mp3\?v=[a-f0-9]{12}$/);
  });

  it('seeds a clean draft with an immutable published-source snapshot', async () => {
    const key = 'ui_whisper';
    const draft = join(STUDIO_ROOT, 'projects', `${key}.json`);
    const sources = join(STUDIO_ROOT, 'sources', key);
    const suffix = `.test-backup-${process.pid}`;
    const draftBackup = `${draft}${suffix}`;
    const sourcesBackup = `${sources}${suffix}`;
    mkdirSync(join(STUDIO_ROOT, 'projects'), { recursive: true });
    mkdirSync(join(STUDIO_ROOT, 'sources'), { recursive: true });
    if (existsSync(draft)) renameSync(draft, draftBackup);
    if (existsSync(sources)) renameSync(sources, sourcesBackup);
    try {
      const project = await loadDraft(key);
      expect(project.sourceId).toMatch(/^[a-f0-9]{64}\.mp3$/);
      expect(sourceUrl(key, project.sourceId)).toBe(`/source/${key}/${project.sourceId}`);
    } finally {
      rmSync(draft, { force: true });
      rmSync(sources, { recursive: true, force: true });
      if (existsSync(draftBackup)) renameSync(draftBackup, draft);
      if (existsSync(sourcesBackup)) renameSync(sourcesBackup, sources);
    }
  });

  it('detects unpublished audio edits and can reset only that audio draft', async () => {
    const key = 'ui_click';
    const initial = await loadDraft(key);
    const initialHash = audioWorkspaceHash(initial);
    const saved = await saveDraft(key, { ...initial, fadeInMs: initial.fadeInMs + 5 }, initialHash);

    await expect(
      saveDraft(key, { ...initial, fadeInMs: initial.fadeInMs + 9 }, initialHash),
    ).rejects.toThrow('audio draft changed in another Studio tab');

    expect(await unpublishedAudioDraftKeys()).toContain(key);

    const reset = await resetAudioDraft(key, saved.audioWorkspaceHash);
    expect(reset.project.sourceId).toMatch(/^[a-f0-9]{64}\.mp3$/);
    expect(await unpublishedAudioDraftKeys()).not.toContain(key);
  });

  it('resets to the exact published authoring baseline without reapplying its recipe', async () => {
    const key = 'ui_bag_open';
    const statePath = join(STUDIO_ROOT, 'draft_publication_state.json');
    const projectPath = join(STUDIO_ROOT, 'projects', `${key}.json`);
    const previousState = existsSync(statePath) ? readFileSync(statePath) : null;
    const previousProject = existsSync(projectPath) ? readFileSync(projectPath) : null;
    try {
      const initial = await loadDraft(key);
      const baseline = await saveDraft(key, { ...initial, fadeInMs: 7 });
      const publishedHash = publishedStateHashForKey(key);
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.cues[key] = {
        draftHash: createHash('sha256').update(JSON.stringify(baseline.project)).digest('hex'),
        publishedHash,
        project: baseline.project,
      };
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
      await saveDraft(key, { ...baseline.project, fadeInMs: 13 });

      const reset = await resetAudioDraft(key);
      expect(reset.project).toEqual(baseline.project);
      expect(await unpublishedAudioDraftKeys()).not.toContain(key);
    } finally {
      if (previousProject) writeFileSync(projectPath, previousProject);
      else rmSync(projectPath, { force: true });
      if (previousState) writeFileSync(statePath, previousState);
      else rmSync(statePath, { force: true });
    }
  });

  it('normalizes hostile and out-of-range values into the bounded versioned schema', () => {
    const project = normalizeProject(
      {
        version: 999,
        sourceId: '../outside.wav',
        segments: 'not-an-array',
        reverse: 'true',
        speed: 99,
        preservePitch: 0,
        delayMs: -1,
        fadeInMs: 50_000,
        fadeOutMs: Number.NaN,
        gainDb: -999,
        runtimeGainDb: 999,
        syncOffsetMs: -9999,
        eq: {
          highpassHz: 99_999,
          lowGainDb: -99,
          lowFreqHz: 9999,
          midGainDb: 99,
          midFreqHz: 1,
          midQ: 99,
          highGainDb: -99,
          highFreqHz: 99_999,
          lowpassHz: 1,
        },
        compressor: {
          enabled: 'yes',
          thresholdDb: -999,
          ratio: 99,
          attackMs: 0,
          releaseMs: 99_999,
          knee: 0,
          makeupDb: 99,
          mix: -1,
        },
        normalize: { enabled: true, targetLufs: 0, truePeakDb: 5, loudnessRange: 99 },
        limiter: { enabled: false, ceilingDb: -99, releaseMs: 0 },
        output: { channels: 'surround', bitrateKbps: 999 },
      },
      { loop: true, duration: 10 },
    );

    expect(project).toMatchObject({
      version: 3,
      sourceId: null,
      segments: [],
      sliceCrossfadeMs: 5,
      reverse: false,
      delayMs: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      syncOffsetMs: -5000,
      loop: { enabled: true, start: 0, end: 10, crossfadeMs: 20 },
      eq: {
        highpassHz: 10_000,
        lowGainDb: -24,
        lowFreqHz: 1000,
        midGainDb: 24,
        midFreqHz: 100,
        midQ: 18,
        highGainDb: -24,
        highFreqHz: 20_000,
        lowpassHz: 10_010,
      },
      compressor: {
        enabled: false,
        thresholdDb: -60,
        ratio: 20,
        attackMs: 0.01,
        releaseMs: 9000,
        knee: 1,
        makeupDb: 24,
        mix: 0,
      },
      normalize: { enabled: true, targetLufs: -5, truePeakDb: 0, loudnessRange: 20 },
      limiter: { enabled: false, ceilingDb: -9, releaseMs: 1 },
      output: { channels: 'auto', bitrateKbps: 192 },
    });
    expect(project).not.toHaveProperty('speed');
    expect(project).not.toHaveProperty('preservePitch');
    expect(project).not.toHaveProperty('gainDb');
    expect(project).not.toHaveProperty('runtimeGainDb');
  });

  it('keeps valid source ids and normalizes ordered edit segments to the source duration', () => {
    const project = normalizeProject(
      {
        sourceId: 'abcdefabcdef.wav',
        segments: [
          { start: 8, end: 12 },
          { start: 3, end: 4 },
          { start: -1, end: 1 },
          { start: 1.5, end: 1.5005 },
        ],
      },
      { duration: 10 },
    );

    expect(project.sourceId).toBe('abcdefabcdef.wav');
    expect(project.segments).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 4 },
      { start: 8, end: 10 },
    ]);
  });

  it('locks seam processing to the loop contract and strips destructive playback fields', () => {
    const runtimeLoop = normalizeProject(
      {
        speed: 0.5,
        preservePitch: true,
        loop: { enabled: false, start: 1, end: 5 },
      },
      { loop: true, duration: 8 },
    );
    expect(runtimeLoop.loop.enabled).toBe(true);
    expect(runtimeLoop).not.toHaveProperty('speed');
    expect(runtimeLoop).not.toHaveProperty('preservePitch');
    const loopPlan = buildFfmpegArgs({
      input: '/tmp/loop.wav',
      output: '/tmp/loop.mp3',
      project: runtimeLoop,
      duration: 8,
      sampleRate: 48_000,
      loop: true,
    });
    expect(loopPlan.outputDuration).toBe(3.98);
    expect(loopPlan.graph).not.toContain('asetrate=');
    expect(loopPlan.graph).not.toContain('atempo=');
    expect(loopPlan.graph).not.toContain('volume=');

    const oneShot = normalizeProject(
      { preservePitch: true, loop: { enabled: true, start: 0, end: 0.25 } },
      { loop: false, duration: 0.5 },
    );
    expect(oneShot.loop.enabled).toBe(false);
    expect(oneShot).not.toHaveProperty('preservePitch');
  });

  it('rejects overlapping segments after normalization', () => {
    expect(() =>
      normalizeProject(
        {
          segments: [
            { start: 0, end: 2 },
            { start: 1.9, end: 3 },
          ],
        },
        { duration: 4 },
      ),
    ).toThrow('segments must not overlap');
  });

  it('builds deterministic FFmpeg graphs and keeps hostile paths as individual arguments', () => {
    const input = '/tmp/input name;$(touch nope).wav';
    const output = '/tmp/output name.mp3';
    const project = {
      segments: [
        { start: 0.25, end: 1.25 },
        { start: 2, end: 2.5 },
      ],
      reverse: true,
      speed: 2,
      preservePitch: true,
      delayMs: 100,
      fadeInMs: 50,
      fadeOutMs: 100,
      gainDb: 3,
      limiter: { enabled: false },
      output: { channels: 'mono', bitrateKbps: 96 },
    };
    const options = { input, output, project, duration: 3, sampleRate: 44_100, loop: false };
    const first = buildFfmpegArgs(options);
    const second = buildFfmpegArgs(options);

    expect(second).toEqual(first);
    expect(first.graph).toBe(
      '[0:a]atrim=start=0.25:end=1.25,asetpts=PTS-STARTPTS[s0];' +
        '[0:a]atrim=start=2:end=2.5,asetpts=PTS-STARTPTS[s1];' +
        '[s0][s1]acrossfade=d=0.005:c1=tri:c2=tri[cut];' +
        '[cut]areverse,adelay=100:all=1,' +
        'afade=t=in:st=0.1:d=0.05:curve=qsin,' +
        'afade=t=out:st=1.495:d=0.1:curve=qsin,aresample=48000[out]',
    );
    expect(first.outputDuration).toBe(1.595);
    expect(first.graph).not.toContain('atempo=');
    expect(first.graph).not.toContain('asetrate=');
    expect(first.graph).not.toContain('volume=3dB');
    expect(first.args[first.args.indexOf('-i') + 1]).toBe(input);
    expect(first.args.at(-1)).toBe(output);
    expect(first.args).toContain(first.graph);
    expect(first.args).not.toContain('sh');
    expect(first.args).not.toContain('-c');
  });

  it('keeps playback gain and speed out of every render plan and duration', () => {
    const common = {
      input: '/tmp/source.wav',
      output: '/tmp/master.mp3',
      duration: 2,
      loop: false,
    };
    const first = buildFfmpegArgs({
      ...common,
      project: { gainDb: -30, runtimeGainDb: -12, speed: 0.25, preservePitch: true },
    });
    const second = buildFfmpegArgs({
      ...common,
      project: { gainDb: 24, runtimeGainDb: 0, speed: 4, preservePitch: false },
    });

    expect(second.graph).toBe(first.graph);
    expect(second.outputDuration).toBe(first.outputDuration);
    expect(second.project).toEqual(first.project);
    expect(first.graph).not.toMatch(/(?:atempo|asetrate|volume=)/);
  });

  it('preserves mono sources for non-positional auto output', () => {
    const plan = buildFfmpegArgs({
      input: '/tmp/ui.wav',
      output: '/tmp/ui.mp3',
      project: { output: { channels: 'auto' } },
      duration: 0.5,
      sampleRate: 48_000,
      sourceChannels: 1,
      spatial: false,
    });

    expect(plan.args[plan.args.indexOf('-ac') + 1]).toBe('1');
  });

  it('rotates loop regions through a bounded equal-power seam crossfade', () => {
    const plan = buildFfmpegArgs({
      input: '/tmp/loop.wav',
      output: '/tmp/loop.mp3',
      project: {
        loop: { enabled: true, start: 1, end: 5, crossfadeMs: 100 },
        limiter: { enabled: false },
      },
      duration: 6,
      sampleRate: 48_000,
      loop: true,
    });

    expect(plan.outputDuration).toBe(3.9);
    expect(plan.graph).toBe(
      '[0:a]atrim=start=1:end=5,asetpts=PTS-STARTPTS[s0];' +
        '[s0]aformat=channel_layouts=stereo,aresample=48000[loopbase];' +
        '[loopbase]asplit=3[loopheadsrc][loopmidsrc][looptailsrc];' +
        '[loopheadsrc]atrim=start=0:end=0.1,asetpts=PTS-STARTPTS[loophead];' +
        '[loopmidsrc]atrim=start=0.1:end=3.9,asetpts=PTS-STARTPTS[loopmid];' +
        '[looptailsrc]atrim=start=3.9:end=4,asetpts=PTS-STARTPTS[looptail];' +
        '[looptail][loophead]acrossfade=d=0.1:c1=qsin:c2=qsin[loopseam];' +
        '[loopseam][loopmid]concat=n=2:v=0:a=1[loopjoined];' +
        '[loopjoined]anull[out]',
    );

    const limited = buildFfmpegArgs({
      input: '/tmp/loop.wav',
      output: '/tmp/loop.mp3',
      project: { gainDb: 24, loop: { enabled: true, start: 0, end: 6 } },
      duration: 6,
      sampleRate: 48_000,
      loop: true,
    });
    expect(limited.graph.indexOf('alimiter=')).toBeLessThan(limited.graph.indexOf('asplit=3'));
    expect(limited.graph.slice(limited.graph.indexOf('[loopjoined]'))).not.toContain('alimiter=');
  });

  it('plans a padded measurement and exact linear second pass after output layout conversion', () => {
    const project = {
      normalize: { enabled: true, targetLufs: -18, truePeakDb: -1.5, loudnessRange: 5 },
      limiter: { enabled: true, ceilingDb: -2 },
      output: { channels: 'mono' },
    };
    const common = {
      input: '/tmp/short input;not-shell.wav',
      project,
      duration: 0.1,
      sampleRate: 44_100,
      loop: false,
    };
    const measure = buildLoudnessMeasureArgs(common);
    expect(measure.graph).toContain('aformat=channel_layouts=mono,aresample=48000,alimiter=');
    expect(measure.graph).toContain(
      'apad=whole_len=19200,loudnorm=I=-18:TP=-2:LRA=5:print_format=json[out]',
    );
    expect(measure.graph).not.toContain('atrim=end_sample');
    expect(measure.args[measure.args.indexOf('-i') + 1]).toBe(common.input);

    const apply = buildFfmpegArgs({
      ...common,
      output: '/tmp/master.mp3',
      loudnessMeasurement: {
        measuredI: -24.1,
        measuredTp: -3.2,
        measuredLra: 1.4,
        measuredThresh: -34.5,
        offset: 0.1,
      },
    });
    expect(apply.graph).toContain(
      'measured_I=-24.1:measured_TP=-3.2:measured_LRA=1.4:' +
        'measured_thresh=-34.5:offset=0.1:linear=true:print_format=json',
    );
    expect(apply.graph).toContain(
      'aresample=48000,atrim=end_sample=4800,asetpts=PTS-STARTPTS[out]',
    );
    expect(() =>
      buildFfmpegArgs({
        ...common,
        output: '/tmp/bad.mp3',
        loudnessMeasurement: { measuredI: '-inf' },
      }),
    ).toThrow('loudness measurement is incomplete');
  });

  it('renders the authoring graph losslessly before the fixed production conform pass', () => {
    const plan = buildAuthoringPcmArgs({
      input: '/tmp/source.wav',
      output: '/tmp/authoring.wav',
      project: { output: { channels: 'mono', bitrateKbps: 48 } },
      duration: 0.5,
      sampleRate: 44_100,
      spatial: false,
    });

    expect(plan.args[plan.args.indexOf('-codec:a') + 1]).toBe('pcm_s24le');
    expect(plan.args[plan.args.indexOf('-f') + 1]).toBe('wav');
    expect(plan.args).not.toContain('libmp3lame');
    expect(plan.project.output.bitrateKbps).toBe(192);
  });

  it('parses bounded loudnorm reports without interpolating non-finite metrics', () => {
    const finite = parseLoudnormReport(`noise\n{
      "input_i": "-24.10", "input_tp": "-3.20", "input_lra": "1.40",
      "input_thresh": "-34.50", "output_i": "-18.01", "output_tp": "-2.05",
      "output_lra": "1.30", "output_thresh": "-28.10", "normalization_type": "linear",
      "target_offset": "0.10"
    }`);
    expect(finite.measurement).toEqual({
      measuredI: -24.1,
      measuredTp: -3.2,
      measuredLra: 1.4,
      measuredThresh: -34.5,
      offset: 0.1,
    });
    expect(finite.normalizationType).toBe('linear');

    const belowGate = parseLoudnormReport(`{
      "input_i": "-inf", "input_tp": "-inf", "input_lra": "0.00",
      "input_thresh": "-70.00", "output_i": "-inf", "output_tp": "-inf",
      "output_lra": "0.00", "output_thresh": "-70.00",
      "normalization_type": "dynamic", "target_offset": "inf"
    }`);
    expect(belowGate.measurement).toBeNull();
    expect(belowGate.input.integratedLufs).toBeNull();
  });

  it('verifies encoded peak and loudness targets and computes peak-first codec correction', () => {
    const project = normalizeProject({
      normalize: { enabled: true, targetLufs: -16, truePeakDb: -1 },
      limiter: { enabled: true, ceilingDb: -1.5 },
    });
    expect(effectiveTruePeakDb(project)).toBe(-1.5);
    expect(verifyEncodedMaster({ integratedLufs: -16.45, truePeakDb: -1.55 }, project).ok).toBe(
      true,
    );
    expect(codecCorrectionDb({ integratedLufs: -17, truePeakDb: -1.55 }, project)).toBe(0);
    expect(
      verifyEncodedMaster({ integratedLufs: -17, truePeakDb: -1.4 }, project).errors,
    ).toHaveLength(2);

    const noLimiter = normalizeProject({
      normalize: { enabled: true, targetLufs: -16, truePeakDb: 0 },
      limiter: { enabled: false },
    });
    expect(effectiveTruePeakDb(noLimiter)).toBe(-0.1);
    expect(verifyEncodedMaster({ integratedLufs: -16, truePeakDb: 0 }, noLimiter).ok).toBe(false);

    const loopProject = normalizeProject({}, { loop: true, duration: 8 });
    expect(
      verifyEncodedMaster({ integratedLufs: -20, truePeakDb: -2 }, loopProject, {
        maxDelta: 0.01,
        maxRatio: 2,
      }).ok,
    ).toBe(true);
    expect(
      verifyEncodedMaster({ integratedLufs: -20, truePeakDb: -2 }, loopProject, {
        maxDelta: 0.08,
        maxRatio: 20,
      }).errors,
    ).toContain('decoded loop seam is discontinuous (0.0800 delta, 20.0x local derivative)');
  });

  it('accepts only decoded-QA-verified production masters and loop seams', () => {
    const conforming = {
      codec: 'mp3',
      channels: 1,
      normBranch: 'peak',
      problems: [],
    };
    expect(verifyProductionMaster(conforming).ok).toBe(true);
    expect(
      verifyProductionMaster({ ...conforming, problems: ['peak is outside tolerance'] }).ok,
    ).toBe(false);
    expect(verifyProductionMaster({ ...conforming, reject: true }).ok).toBe(false);
    expect(verifyProductionMaster(conforming, null, true).errors).toContain(
      'decoded loop continuity was not measured',
    );
  });

  it('strictly validates cached production-mastering metadata', () => {
    const mastering = {
      revision: MASTERING_REVISION,
      mode: 'production-conform',
      authoringMode: 'direct',
      measurement: null,
      conform: {
        normBranch: 'peak',
        inputLevel: -12,
        outputLevel: -6,
        gainDb: 6,
        attempts: [{ gainDb: 6, measuredOutput: -6, error: 0 }],
      },
    };
    expect(normalizeProductionMastering(mastering)).toEqual(mastering);
    expect(() =>
      normalizeProductionMastering({ ...mastering, revision: MASTERING_REVISION - 1 }),
    ).toThrow('incompatible revision or mode');
    expect(
      normalizeProductionMastering(
        { ...mastering, revision: MASTERING_REVISION - 1 },
        { allowHistoricalRevision: true },
      ),
    ).toEqual({ ...mastering, revision: MASTERING_REVISION - 1 });
    expect(() => normalizeProductionMastering({ ...mastering, mode: 'direct' })).toThrow(
      'incompatible revision or mode',
    );
    expect(() =>
      normalizeProductionMastering({ ...mastering, outputFile: '/tmp/untrusted.mp3' }),
    ).toThrow('unknown field: outputFile');
    expect(() =>
      normalizeProductionMastering({
        ...mastering,
        conform: { ...mastering.conform, attempts: [] },
      }),
    ).toThrow('invalid attempts');
  });

  it('keeps restored recipes intact and mastered-loop working drafts neutral', () => {
    const archivedProject = normalizeProject(
      { segments: [{ start: 8, end: 9 }] },
      { duration: 10 },
    );
    const restored = restoredMixEntry(
      {
        project: archivedProject,
        mastering: { revision: MASTERING_REVISION, mode: 'production-conform' },
      },
      { duration: 1, channels: 1, sampleRate: 44_100, bitrate: 192_000 },
      { integratedLufs: -20, truePeakDb: -6 },
      'foot_grass',
    );
    expect(restored.project.segments).toEqual([{ start: 8, end: 9 }]);

    const historicalMastering = {
      revision: MASTERING_REVISION - 1,
      mode: 'production-conform',
      authoringMode: 'direct',
      measurement: null,
      conform: {
        normBranch: 'peak',
        inputLevel: -10,
        outputLevel: -6,
        gainDb: 4,
        attempts: [{ gainDb: 4, measuredOutput: -6, error: 0 }],
      },
    };
    const historicalOutput = {
      channels: 1,
      sampleRate: 44_100,
      bitrate: 192_000,
      integratedLufs: -18.25,
      truePeakDb: -6.1,
    };
    const historical = restoredMixEntry(
      {
        project: archivedProject,
        mastering: historicalMastering,
        output: historicalOutput,
      },
      { duration: 1, channels: 1, sampleRate: 44_100, bitrate: 191_997 },
      { integratedLufs: -18, truePeakDb: -6 },
      'foot_grass',
    );
    expect(historical.mastering).toEqual(historicalMastering);
    expect(historical.output).toEqual(historicalOutput);

    const neutral = neutralPublishedProject('amb_dungeon', `${'a'.repeat(64)}.mp3`, 5);
    expect(neutral).toMatchObject({
      limiter: { enabled: false },
      loop: { enabled: true, start: 0, end: 5, crossfadeMs: 0 },
    });
    const plan = buildFfmpegArgs({
      input: '/tmp/restored.mp3',
      output: '/tmp/restored-master.mp3',
      project: neutral,
      duration: 5,
      loop: true,
    });
    expect(plan.outputDuration).toBe(5);
    expect(plan.graph).not.toContain('acrossfade=');
    expect(plan.graph).not.toContain('alimiter=');
  });

  it('rejects published files outside duration, size, sample-rate, and channel budgets', () => {
    expect(() =>
      validatePublishedBudget('foot_grass', {
        codec: 'mp3',
        duration: 15,
        bytes: 1024,
        sampleRate: 44_100,
        channels: 1,
      }),
    ).not.toThrow();
    expect(() =>
      validatePublishedBudget('foot_grass', {
        codec: 'mp3',
        duration: 16,
        bytes: 1024,
        sampleRate: 44_100,
        channels: 1,
      }),
    ).toThrow('duration must be at most 15 seconds');
    expect(() =>
      validatePublishedBudget('foot_grass', {
        codec: 'wav',
        duration: 1,
        bytes: 1024,
        sampleRate: 44_100,
        channels: 1,
      }),
    ).toThrow('output codec must be MP3');
    const legacyMaster = {
      codec: 'mp3',
      duration: 1,
      bytes: 1024,
      sampleRate: 48_000,
      channels: 2,
    };
    expect(() => validatePublishedBudget('foot_grass', legacyMaster)).toThrow(
      'sample rate must be 44100 Hz',
    );
    expect(() =>
      validatePublishedBudget('foot_grass', legacyMaster, { allowLegacySampleRate: true }),
    ).not.toThrow();
    expect(() =>
      validatePublishedBudget('amb_dungeon', {
        codec: 'wav',
        duration: 61,
        bytes: 5 * 1024 * 1024,
        sampleRate: 44_100,
        channels: 8,
      }),
    ).toThrow('published SFX budget failed');
  });
});

describe('SFX Studio module-load robustness', () => {
  it('loads the export bundle validator lazily so its import-time ffmpeg-static throw cannot take down the Studio', () => {
    // export_bundle.mjs throws at import time when ffmpeg-static exports null
    // (unsupported platform, PR #1930). audio_io.mjs must reach it only through a
    // dynamic import at the export call site: a top-level import would break the
    // playback/encode paths that keep working via the resolver's PATH fallback.
    const audioIoSrc = readFileSync(join(ROOT, 'scripts/sfx_studio/audio_io.mjs'), 'utf8');
    expect(audioIoSrc).not.toMatch(/^import[^;]*from '\.\/export_bundle\.mjs';/m);
    expect(audioIoSrc).toContain("await import('./export_bundle.mjs')");
  });
});

describe('SFX Studio catalog associations', () => {
  it('provides an existing contextual model for every sampled cue', () => {
    const keys = SFX.map((entry: { key: string }) => entry.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);

    for (const key of keys) {
      const associations = associationsForSfx(key);
      expect(associations.length, key).toBeGreaterThan(0);
      for (const association of associations) {
        expect(['animation', 'environment', 'ui'], key).toContain(association.kind);
        expect(association.label, key).toEqual(expect.any(String));
        if (association.kind === 'ui') expect(association.screen, key).toEqual(expect.any(String));
        else {
          expect(existsSync(join(ROOT, association.model)), `${key}: ${association.model}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('has no runtime cue requests outside the sampled catalog', () => {
    expect(missingRuntimeCues()).toEqual([]);
    expect(integrationForSfx('melee_unarmed').routed).toBe(true);
    expect(integrationForSfx('foot_wood').routed).toBe(true);
    expect(integrationForSfx('amb_campfire').routed).toBe(true);
    expect(integrationForSfx('amb_forge').routed).toBe(true);
    expect(integrationForSfx('combat_block')).toMatchObject({
      routed: false,
      note: 'The authoritative combat model has no block outcome yet.',
    });
  });

  it('matches every preferred animation against a real clip in its context model', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const animationCache = new Map<string, string[]>();

    for (const cue of SFX) {
      for (const association of associationsForSfx(cue.key)) {
        if (association.kind !== 'animation' || !association.clip) continue;
        let names = animationCache.get(association.model);
        if (!names) {
          const document = await io.read(join(ROOT, association.model));
          names = document
            .getRoot()
            .listAnimations()
            .map((animation) => animation.getName());
          animationCache.set(association.model, names);
        }
        const preferred = new RegExp(association.clip, 'i');
        expect(
          names.some((name) => preferred.test(name)),
          `${cue.key}: ${association.clip}`,
        ).toBe(true);
      }
    }
  });
});

describe('SFX runtime manifest generation', () => {
  it('stays in exact parity with the catalog and committed generated manifest', () => {
    const built = buildSfxManifestData(ROOT);
    const catalogKeys = SFX.map((entry: { key: string }) => entry.key).sort();

    // Every declared catalog key must be present; the manifest may ALSO carry
    // mob subfamily extension keys (mob_<family>_<sub>_<action>, e.g.
    // mob_beast_wolf_attack) that are purely filesystem-discovered and never
    // appear in the static catalog array by design (see sfx_prompts.mjs).
    const builtKeys = Object.keys(built).sort();
    for (const key of catalogKeys) {
      expect(builtKeys, key).toContain(key);
    }
    const extraKeys = builtKeys.filter((key) => !catalogKeys.includes(key));
    for (const key of extraKeys) {
      expect(key, key).toMatch(/^mob_[a-z]+_[a-z]+_(aggro|attack|death|hurt|idle)$/);
    }
    expect(built).toEqual(SFX_CLIPS);
  });

  it('records the content hash, size, and cache-busting URL of every published clip', () => {
    const built = buildSfxManifestData(ROOT);
    for (const [key, entry] of Object.entries(
      built as Record<
        string,
        {
          bytes: number;
          hash: string;
          url: string;
          variants: { url: string; bytes: number; sha256: string }[];
        }
      >,
    )) {
      const relative = entry.variants[0].url.split('?')[0].replace('/audio/sfx/', '');
      const path = join(ROOT, 'public/audio/sfx', relative);
      const fullHash = createHash('sha256').update(readFileSync(path)).digest('hex');
      const expectedHash = fullHash.slice(0, 12);
      expect(entry.hash, key).toBe(expectedHash);
      expect(entry.bytes, key).toBe(statSync(path).size);
      expect(entry.url, key).toBe(`/audio/sfx/${relative}?v=${expectedHash}`);
      expect(entry.variants[0]).toMatchObject({
        bytes: statSync(path).size,
        sha256: fullHash,
      });
    }
  });

  it('emits explicitly ordered round-robin tracks from the catalog contract', () => {
    const fixture = manifestFixture(0);
    const alternate = Buffer.from('alternate fixture audio');
    writeFileSync(join(fixture.root, 'public/audio/sfx/foot_grass_1.mp3'), alternate);
    const entry = buildSfxManifestData(fixture.root, { requireComplete: false }).foot_grass;
    expect(entry.variants.map((variant: { id: string }) => variant.id)).toEqual(['1']);
    expect(entry.variants[0]).toMatchObject({
      url: expect.stringMatching(/^\/audio\/sfx\/foot_grass_1\.mp3\?v=[a-f0-9]{12}$/),
      bytes: alternate.length,
      sha256: createHash('sha256').update(alternate).digest('hex'),
    });
  });

  it('targets the first numbered round-robin master for Studio edits and publishes', () => {
    const fixture = manifestFixture(0);
    writeFileSync(join(fixture.root, 'public/audio/sfx/foot_grass_1.mp3'), 'primary take');
    writeFileSync(join(fixture.root, 'public/audio/sfx/foot_grass_2.mp3'), 'alternate take');
    expect(basename(publishedPath('foot_grass', fixture.root))).toBe('foot_grass_1.mp3');
    expect(() => assertPublishedMasterIsMp3('/tmp/custom-source.wav')).toThrow(
      'must be conformed to MP3',
    );
  });

  it('rejects catalogs that exceed the shared runtime track cap', () => {
    expect(SFX_MAX_TRACKS_PER_KEY).toBe(8);
    const source = SFX.find((entry: { key: string }) => entry.key === 'foot_grass') as {
      key: string;
      variants?: { id: string }[];
    };
    const previous = source.variants;
    source.variants = Array.from({ length: 9 }, (_, index) => ({
      id: `take_${index + 1}`,
    }));
    try {
      expect(() =>
        buildSfxManifestData(manifestFixture(0).root, { requireComplete: false }),
      ).toThrow('maximum is 8');
    } finally {
      if (previous === undefined) delete source.variants;
      else source.variants = previous;
    }
  });

  it('preflights every generation track with release-compatible numeric ids', () => {
    const valid = { key: 'first', prompt: 'first', duration: 1 };
    const invalid = {
      key: 'second',
      prompt: 'second',
      duration: 1,
      variants: [{ id: 'main' }],
    };
    const plan = buildSfxGenerationPlan([valid, invalid]);
    expect(plan[0].tracks).toMatchObject([{ trackId: 'main', filename: 'first.mp3' }]);
    expect(plan[1].tracks).toMatchObject([{ trackId: '1', filename: 'second_1.mp3' }]);
  });

  it('rejects empty and oversized tracks before emitting a runtime pack', () => {
    const fixture = manifestFixture(0);
    const path = join(fixture.root, 'public/audio/sfx/foot_grass.mp3');
    writeFileSync(path, Buffer.alloc(0));
    expect(() => buildSfxManifestData(fixture.root, { requireComplete: false })).toThrow(
      'must be 1..',
    );

    writeFileSync(path, Buffer.alloc(SFX_MAX_TRACK_BYTES + 1));
    expect(() => buildSfxManifestData(fixture.root, { requireComplete: false })).toThrow(
      'must be 1..',
    );
  });

  it('preloads interface cues as non-positional UI audio', () => {
    const built = buildSfxManifestData(ROOT);
    expect(built.ui_click).toMatchObject({
      category: 'ui',
      preload: 'startup',
      spatial: false,
      loop: false,
    });
  });

  it('keeps authored mix metadata out of the runtime playback profile', () => {
    const fixture = manifestFixture(-40);
    const entry = buildSfxManifestData(fixture.root, { requireComplete: false }).foot_grass;
    expect(entry.gain).toBe(1);
    expect(entry.playbackRate).toBe(1);
    expect(entry.bytes).toBe(fixture.bytes.length);
  });

  it('fails production generation for missing sampled files', () => {
    const fixture = manifestFixture(0);
    rmSync(join(fixture.root, 'public/audio/sfx/foot_grass.mp3'));
    expect(() => buildSfxManifestData(fixture.root)).toThrow('missing sampled SFX file');
  });
});
