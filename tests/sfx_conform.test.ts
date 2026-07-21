import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { describe, expect, it } from 'vitest';
// @ts-expect-error scripts use the repository's untyped Node ESM convention
import * as conformAudioModule from '../scripts/sfx/conform_audio.mjs';
import {
  channelProblem,
  classify,
  expectedChannelsForEntry,
  LOSSLESS_EXTENSIONS,
  MIN_SOURCE_BITRATE,
  NORM_TOLERANCE,
  TARGET_BITRATE,
  TARGET_LUFS,
  TARGET_MONO_CHANNELS,
  TARGET_PEAK_DBFS,
  TARGET_SAMPLE_RATE,
  TARGET_STEREO_CHANNELS,
} from '../scripts/sfx/sfx_conform_rules.mjs';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';

const {
  buildSfxConformArgs,
  conformSfxAudio,
  inspectSfxConformance,
  measureSfxTruePeakDb,
  SFX_AUDIO_EXTENSIONS,
} = conformAudioModule;

import { buildSfxConformPolicy } from '../scripts/sfx/sfx_conform_inventory.mjs';
import { PROBE_EXTENSIONS } from '../scripts/sfx/sfx_manifest_builder.mjs';

// @ts-expect-error scripts use the repository's untyped Node ESM convention
import { UI_SFX_SPECS } from '../scripts/sfx/ui_sfx.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// A file already at every spec dimension.
const AT_SPEC = { duration: 2.0, bitrate: TARGET_BITRATE, sampleRate: TARGET_SAMPLE_RATE };

describe('classify: source quality gate', () => {
  it('rejects a file one kbps below MIN_SOURCE_BITRATE', () => {
    expect(classify({ ...AT_SPEC, bitrate: MIN_SOURCE_BITRATE - 1 }).reject).toBe(true);
  });

  it('does not reject a file at exactly MIN_SOURCE_BITRATE', () => {
    expect(classify({ ...AT_SPEC, bitrate: MIN_SOURCE_BITRATE }).reject).toBe(false);
  });

  it('returns no problems and null normBranch when rejecting', () => {
    const { problems, normBranch } = classify({ ...AT_SPEC, bitrate: 64 });
    expect(problems).toHaveLength(0);
    expect(normBranch).toBeNull();
  });
});

describe('classify: bitrate and sample rate', () => {
  it('passes a file fully at spec', () => {
    const { reject, problems } = classify({ ...AT_SPEC, lufs: TARGET_LUFS });
    expect(reject).toBe(false);
    expect(problems).toHaveLength(0);
  });

  it('flags bitrate below target', () => {
    const { problems } = classify({ ...AT_SPEC, bitrate: 128 });
    expect(problems.some((p) => p.includes('128kbps'))).toBe(true);
  });

  it('flags bitrate significantly above target', () => {
    const { problems } = classify({ ...AT_SPEC, bitrate: 320 });
    expect(problems.some((p) => p.includes('320kbps'))).toBe(true);
  });

  it('does not flag bitrate within the ffprobe tolerance window', () => {
    const { problems } = classify({ ...AT_SPEC, bitrate: TARGET_BITRATE + 4 });
    expect(problems.filter((p) => p.includes('kbps'))).toHaveLength(0);
  });

  it('flags sample rate mismatch', () => {
    const { problems } = classify({ ...AT_SPEC, sampleRate: 48000 });
    expect(problems.some((p) => p.includes('48000Hz'))).toBe(true);
  });

  it('requires an otherwise conformant lossy source to be transcoded to MP3', () => {
    const { reject, problems } = classify({
      ...AT_SPEC,
      isMp3: false,
      lufs: TARGET_LUFS,
    });
    expect(reject).toBe(false);
    expect(problems).toContain('non-MP3 source');
  });
});

describe('classify: normalization branch routing', () => {
  it('routes clips below DURATION_THRESHOLD to peak', () => {
    expect(classify({ ...AT_SPEC, duration: 0.5 }).normBranch).toBe('peak');
  });

  it('routes clips at exactly DURATION_THRESHOLD to lufs', () => {
    expect(classify({ ...AT_SPEC, duration: 1.0 }).normBranch).toBe('lufs');
  });

  it('routes clips above DURATION_THRESHOLD to lufs', () => {
    expect(classify({ ...AT_SPEC, duration: 3.0 }).normBranch).toBe('lufs');
  });
});

describe('shared conform command', () => {
  it('measures and conforms short clips by true peak', () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const directory = mkdtempSync(join(tmpdir(), 'wocc-sfx-true-peak-'));
    const inputFile = join(directory, 'source.wav');
    const outputFile = join(directory, 'output.mp3');

    try {
      // The samples peak at -6 dBFS, but band-limited reconstruction peaks at
      // about -3.9 dBFS. This catches accidental sample-peak measurement.
      execFileSync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'aevalsrc=0.5*sgn(sin(2*PI*1000*t)):s=44100:d=0.5',
          '-c:a',
          'pcm_f32le',
          inputFile,
        ],
        { stdio: 'ignore' },
      );

      const inputTruePeak = measureSfxTruePeakDb(inputFile, ffmpegPath);
      expect(inputTruePeak).toBeCloseTo(-3.9, 1);

      const result = conformSfxAudio({
        inputFile,
        outputFile,
        duration: 0.5,
        ffmpegPath,
      });
      expect(result.normBranch).toBe('peak');
      expect(result.inputLevel).toBe(inputTruePeak);
      expect(Math.abs(result.outputLevel - TARGET_PEAK_DBFS)).toBeLessThanOrEqual(NORM_TOLERANCE);

      const report = inspectSfxConformance(outputFile, {
        ffmpegPath,
        ffprobePath: ffprobeStatic.path,
      });
      expect(report.peakDb).toBe(result.outputLevel);
      expect(report.problems.filter((problem: string) => problem.includes('dBFS'))).toEqual([]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('builds the fixed peak branch for clips below one second', () => {
    const plan = buildSfxConformArgs({
      inputFile: '/tmp/source.wav',
      outputFile: '/tmp/output.mp3',
      duration: 0.999,
      gainDb: 6,
    });

    expect(plan.normBranch).toBe('peak');
    expect(plan.args[plan.args.indexOf('-af') + 1]).toBe(
      `volume=6dB,aformat=sample_rates=${TARGET_SAMPLE_RATE}`,
    );
    expect(plan.args[plan.args.indexOf('-b:a') + 1]).toBe(`${TARGET_BITRATE}k`);
    expect(plan.args[plan.args.indexOf('-ar') + 1]).toBe(String(TARGET_SAMPLE_RATE));
  });

  it('builds the fixed LUFS branch at exactly one second', () => {
    const plan = buildSfxConformArgs({
      inputFile: '/tmp/source.wav',
      outputFile: '/tmp/output.mp3',
      duration: 1,
      gainDb: 3,
    });

    expect(plan.normBranch).toBe('lufs');
    expect(plan.args[plan.args.indexOf('-af') + 1]).toContain('volume=3dB,alimiter=');
    expect(plan.args[plan.args.indexOf('-af') + 1]).toContain(
      `aformat=sample_rates=${TARGET_SAMPLE_RATE}`,
    );
  });

  it('ships every deterministic UI cue through the fixed conform contract', () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    for (const spec of UI_SFX_SPECS) {
      const report = inspectSfxConformance(join(ROOT, 'public/audio/sfx', `${spec.key}.mp3`), {
        ffmpegPath,
        ffprobePath: ffprobeStatic.path,
      });
      expect(report.reject, spec.key).toBe(false);
      expect(report.problems, spec.key).toEqual([]);
      expect(report.sampleRate, spec.key).toBe(TARGET_SAMPLE_RATE);
      expect(report.bitrate, spec.key).toBe(TARGET_BITRATE);
    }
  });

  it('fails strict conformance for an at-spec AAC source instead of publishing it', () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const directory = mkdtempSync(join(tmpdir(), 'wocc-sfx-lossy-source-'));
    const sfxDirectory = join(directory, 'public/audio/sfx');
    const inputFile = join(sfxDirectory, 'amb_water.m4a');

    try {
      mkdirSync(sfxDirectory, { recursive: true });
      execFileSync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'anoisesrc=color=pink:duration=3:sample_rate=44100',
          '-af',
          'loudnorm=I=-14:TP=-1:LRA=7',
          '-ac',
          '2',
          '-ar',
          String(TARGET_SAMPLE_RATE),
          '-c:a',
          'aac',
          '-b:a',
          `${TARGET_BITRATE}k`,
          inputFile,
        ],
        { stdio: 'ignore' },
      );

      const source = inspectSfxConformance(inputFile, {
        ffmpegPath,
        ffprobePath: ffprobeStatic.path,
      });
      expect(source.codec).toBe('aac');
      // ffmpeg's native AAC encoder approximates the requested bitrate rather than hitting it
      // exactly, and can land a couple kbps under a CBR-style `-b:a` target; widen the floor so
      // that rounding doesn't flake this otherwise-at-spec fixture.
      expect(source.bitrate).toBeGreaterThanOrEqual(TARGET_BITRATE - 4);
      expect(source.bitrate).toBeLessThanOrEqual(TARGET_BITRATE + 8);
      expect(source.sampleRate).toBe(TARGET_SAMPLE_RATE);
      expect(Math.abs(source.lufs - TARGET_LUFS)).toBeLessThanOrEqual(NORM_TOLERANCE);

      const result = spawnSync(
        process.execPath,
        [join(ROOT, 'scripts/sfx_conform.mjs'), '--strict'],
        { cwd: directory, encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('amb_water.m4a');
      expect(existsSync(inputFile)).toBe(true);
      expect(existsSync(join(sfxDirectory, 'amb_water.mp3'))).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe('classify: loudness gate', () => {
  it('pins sustained masters to -14 LUFS', () => {
    expect(TARGET_LUFS).toBe(-14);
    expect(classify({ ...AT_SPEC, duration: 2, lufs: -14 })).toMatchObject({
      reject: false,
      normBranch: 'lufs',
      problems: [],
    });
  });

  it('flags peak loudness out of spec for short clips', () => {
    const { problems } = classify({ ...AT_SPEC, duration: 0.5, peakDb: TARGET_PEAK_DBFS - 6 });
    expect(problems.some((p) => p.includes('dBFS'))).toBe(true);
  });

  it('does not flag peak loudness within the tolerance window', () => {
    const inSpec = TARGET_PEAK_DBFS + (NORM_TOLERANCE - 0.1);
    const { problems } = classify({ ...AT_SPEC, duration: 0.5, peakDb: inSpec });
    expect(problems.filter((p) => p.includes('dBFS'))).toHaveLength(0);
  });

  it('flags LUFS out of spec for long clips', () => {
    const { problems } = classify({ ...AT_SPEC, lufs: -20.0 });
    expect(problems.some((p) => p.includes('LUFS'))).toBe(true);
  });

  it('does not flag LUFS within the tolerance window', () => {
    const inSpec = TARGET_LUFS + (NORM_TOLERANCE - 0.1);
    const { problems } = classify({ ...AT_SPEC, lufs: inSpec });
    expect(problems.filter((p) => p.includes('LUFS'))).toHaveLength(0);
  });

  it('still flags an overshooting peakDb on a long clip even with in-spec LUFS', () => {
    // LUFS alone cannot reveal a true-peak overshoot (see the dedicated
    // "flags a long clip whose true peak overshoots" case above); a long
    // clip's peak is checked unconditionally, not "ignored" just because the
    // lufs branch is the one selecting its loudness TARGET.
    const { problems } = classify({ ...AT_SPEC, duration: 2.0, peakDb: 0, lufs: TARGET_LUFS });
    expect(problems.filter((p) => p.includes('dBFS'))).toHaveLength(1);
  });

  it('ignores lufs for short clips (uses peak branch)', () => {
    const { problems } = classify({
      ...AT_SPEC,
      duration: 0.5,
      peakDb: TARGET_PEAK_DBFS,
      lufs: -40,
    });
    expect(problems.filter((p) => p.includes('LUFS'))).toHaveLength(0);
  });

  it('does not check loudness when loudness is not provided', () => {
    // If caller passes neither peakDb nor lufs, no loudness problem is reported.
    const { problems } = classify({ ...AT_SPEC });
    expect(problems.filter((p) => p.includes('dBFS') || p.includes('LUFS'))).toHaveLength(0);
  });

  it('flags a long clip whose true peak overshoots even when LUFS is in spec', () => {
    // A wide-crest-factor source can land exactly on the LUFS target while its
    // true peak still clips: LUFS alone must not be treated as sufficient.
    const { problems } = classify({
      ...AT_SPEC,
      duration: 2.0,
      lufs: TARGET_LUFS,
      peakDb: TARGET_PEAK_DBFS + 1,
    });
    expect(problems.some((p) => p.includes('dBFS'))).toBe(true);
  });

  it('does not flag a long clip whose true peak is within the safety ceiling', () => {
    const { problems } = classify({
      ...AT_SPEC,
      duration: 2.0,
      lufs: TARGET_LUFS,
      peakDb: TARGET_PEAK_DBFS - 3,
    });
    expect(problems.filter((p) => p.includes('dBFS'))).toHaveLength(0);
  });

  it('does not flag a long clip peak sitting under the ceiling by less than the target', () => {
    // Unlike the short-clip peak branch (symmetric tolerance around the
    // target), the long-clip peak check is a one-sided ceiling: a peak well
    // BELOW TARGET_PEAK_DBFS is never a problem for the lufs branch, only an
    // overshoot above it is.
    const { problems } = classify({
      ...AT_SPEC,
      duration: 2.0,
      lufs: TARGET_LUFS,
      peakDb: TARGET_PEAK_DBFS - 20,
    });
    expect(problems.filter((p) => p.includes('dBFS'))).toHaveLength(0);
  });
});

describe('classify: preserveLoudness wrong-branch fingerprint', () => {
  // Regression coverage for a real, previously-shipped bug: 19 custom keys
  // (including ui_achievement) were conformed through the generated-content
  // LUFS-targeting branch before `custom: true` was set on them, and no
  // reconform since re-derived them from a pristine source (conform reads
  // its input from the same public/audio/sfx file it writes back to), so the
  // wrong loudness stayed baked in silently. A preserveLoudness file is never
  // gain-staged toward TARGET_LUFS, so one landing within tolerance of it
  // anyway is CONSISTENT with that exact bug recurring, but an author's own
  // hot mix can coincidentally land there too (confirmed for real keys) and
  // this checker cannot see the external master-store source to tell the two
  // apart, so it is advisory (problems stays empty; the gate never hard-fails
  // it), not a hard failure like the other loudness checks.
  it('surfaces an advisory for a preserveLoudness long clip whose LUFS lands on the generated-content target', () => {
    const { problems, advisories } = classify({
      ...AT_SPEC,
      duration: 2.0,
      lufs: TARGET_LUFS,
      peakDb: TARGET_PEAK_DBFS - 3,
      preserveLoudness: true,
    });
    expect(advisories.some((a) => a.includes('loudness-targeted'))).toBe(true);
    expect(problems).toHaveLength(0);
  });

  it('does not flag a preserveLoudness long clip sitting well under the target (its own mix)', () => {
    const { advisories } = classify({
      ...AT_SPEC,
      duration: 2.0,
      lufs: -22.0,
      peakDb: TARGET_PEAK_DBFS - 3,
      preserveLoudness: true,
    });
    expect(advisories.filter((a) => a.includes('loudness-targeted'))).toHaveLength(0);
  });

  it('does not apply the wrong-branch fingerprint to a non-preserveLoudness key', () => {
    // A normal generated key landing on TARGET_LUFS is the CORRECT, intended
    // result, not a defect; the fingerprint check is preserveLoudness-only.
    const { advisories } = classify({
      ...AT_SPEC,
      duration: 2.0,
      lufs: TARGET_LUFS,
      peakDb: TARGET_PEAK_DBFS - 3,
      preserveLoudness: false,
    });
    expect(advisories.filter((a) => a.includes('loudness-targeted'))).toHaveLength(0);
  });

  it('does not apply the wrong-branch fingerprint on the short-clip peak branch', () => {
    const { advisories } = classify({
      ...AT_SPEC,
      duration: 0.5,
      lufs: TARGET_LUFS,
      peakDb: TARGET_PEAK_DBFS,
      preserveLoudness: true,
    });
    expect(advisories.filter((a) => a.includes('loudness-targeted'))).toHaveLength(0);
  });
});

describe('classify: lossless sources', () => {
  // WAV/FLAC probe at high bitrates that are meaningless for the quality gate.
  const LOSSLESS = {
    duration: 2.0,
    bitrate: 1411,
    sampleRate: TARGET_SAMPLE_RATE,
    isLossless: true,
  };

  it('does not reject lossless sources regardless of bitrate', () => {
    expect(classify(LOSSLESS).reject).toBe(false);
  });

  it('always marks lossless sources for processing (lossless source in problems)', () => {
    const { problems } = classify({ ...LOSSLESS, lufs: TARGET_LUFS });
    expect(problems.some((p) => p.includes('lossless'))).toBe(true);
  });

  it('does not flag lossless bitrate as a kbps problem', () => {
    const { problems } = classify({ ...LOSSLESS, lufs: TARGET_LUFS });
    expect(problems.filter((p) => p.includes('kbps'))).toHaveLength(0);
  });

  it('still checks sample rate for lossless sources', () => {
    const { problems } = classify({ ...LOSSLESS, sampleRate: 48000, lufs: TARGET_LUFS });
    expect(problems.some((p) => p.includes('48000Hz'))).toBe(true);
  });

  it('still checks loudness for lossless sources', () => {
    const { problems } = classify({ ...LOSSLESS, lufs: -20.0 });
    expect(problems.some((p) => p.includes('LUFS'))).toBe(true);
  });

  it('LOSSLESS_EXTENSIONS contains wav, flac, aiff, aif', () => {
    for (const ext of ['.wav', '.flac', '.aiff', '.aif']) {
      expect(LOSSLESS_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it('LOSSLESS_EXTENSIONS does not contain lossy formats', () => {
    for (const ext of ['.mp3', '.ogg', '.opus', '.m4a']) {
      expect(LOSSLESS_EXTENSIONS.has(ext)).toBe(false);
    }
  });

  it('keeps manifest discovery aligned with every format accepted by conform', () => {
    expect(new Set(PROBE_EXTENSIONS)).toEqual(SFX_AUDIO_EXTENSIONS);
  });

  it('inherits catalog channel policy by stem when lossless wins over an MP3', () => {
    const policy = buildSfxConformPolicy([{ key: 'foot_grass' }], {
      foot_grass: {
        key: 'foot_grass',
        tracks: [{ filename: 'foot_grass.mp3' }],
      },
    });
    expect(policy.recognizes('foot_grass.aiff')).toBe(true);
    expect(policy.expectedChannels('foot_grass.aiff')).toBe(TARGET_MONO_CHANNELS);
  });

  it('recognizes a bare lossless master shadowed by numbered runtime takes', () => {
    const policy = buildSfxConformPolicy([{ key: 'foot_grass' }], {
      foot_grass: {
        key: 'foot_grass',
        tracks: [{ filename: 'foot_grass_1.mp3' }],
      },
    });
    expect(policy.recognizes('foot_grass.aiff')).toBe(true);
    expect(policy.expectedChannels('foot_grass.aiff')).toBe(TARGET_MONO_CHANNELS);
  });

  it('recognizes numbered lossless catalog sources before an MP3 is published', () => {
    const policy = buildSfxConformPolicy([{ key: 'foot_grass' }], {});
    expect(policy.recognizes('foot_grass_1.aiff')).toBe(true);
    expect(policy.expectedChannels('foot_grass_1.aiff')).toBe(TARGET_MONO_CHANNELS);
  });

  it('recognizes lossless dynamic mob variants before an MP3 is published', () => {
    const policy = buildSfxConformPolicy([], {});
    expect(policy.recognizes('mob_beast_dire_wolf_attack_1.aiff')).toBe(true);
    expect(policy.expectedChannels('mob_beast_dire_wolf_attack_1.aiff')).toBe(TARGET_MONO_CHANNELS);
  });

  it('matches manifest grammar for catalog and dynamic source variant names', () => {
    const policy = buildSfxConformPolicy([{ key: 'foot_grass' }], {});
    const invalid = [
      'foot_grass_9007199254740992.aiff',
      'mob_Beast_dire_wolf_attack_1.aiff',
      'mob_beast_dire-wolf_attack_1.aiff',
      'mob_unknown_dire_wolf_attack_1.aiff',
      'mob_beast_dire_wolf_attack_9007199254740992.aiff',
    ];
    for (const filename of invalid) {
      expect(policy.recognizes(filename), filename).toBe(false);
      expect(policy.expectedChannels(filename), filename).toBeUndefined();
    }

    expect(policy.recognizes('foot_grass_9007199254740991.aiff')).toBe(true);
    expect(policy.recognizes('mob_beast_dire_wolf_attack_9007199254740991.aiff')).toBe(true);
  });

  it('rejects noncontiguous lossless catalog takes before they become MP3s', () => {
    const policy = buildSfxConformPolicy([{ key: 'foot_grass' }], {}, ['foot_grass_2.aiff']);
    expect(policy.recognizes('foot_grass_2.aiff')).toBe(false);
    expect(policy.expectedChannels('foot_grass_2.aiff')).toBeUndefined();
    expect(policy.violations).toEqual([expect.stringContaining('noncontiguous')]);
  });

  it('accepts a contiguous mixed-format source take sequence', () => {
    const policy = buildSfxConformPolicy([{ key: 'foot_grass' }], {}, [
      'foot_grass_1.aiff',
      'foot_grass_2.wav',
    ]);
    expect(policy.recognizes('foot_grass_1.aiff')).toBe(true);
    expect(policy.recognizes('foot_grass_2.wav')).toBe(true);
    expect(policy.violations).toEqual([]);
  });

  it('does not let --fix publish a gap in catalog source takes', () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const directory = mkdtempSync(join(tmpdir(), 'wocc-sfx-source-gap-'));
    const sfxDirectory = join(directory, 'public/audio/sfx');
    const inputFile = join(sfxDirectory, 'foot_grass_2.aiff');
    const outputFile = join(sfxDirectory, 'foot_grass_2.mp3');

    try {
      mkdirSync(sfxDirectory, { recursive: true });
      execFileSync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=44100:duration=0.5',
          '-c:a',
          'pcm_s16be',
          inputFile,
        ],
        { stdio: 'ignore' },
      );

      const result = spawnSync(process.execPath, [join(ROOT, 'scripts/sfx_conform.mjs'), '--fix'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(existsSync(inputFile)).toBe(true);
      expect(existsSync(outputFile)).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('does not publish a third source after a same-stem duplicate conflict', () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const directory = mkdtempSync(join(tmpdir(), 'wocc-sfx-source-conflict-'));
    const sfxDirectory = join(directory, 'public/audio/sfx');
    const sources = [
      ['foot_grass.aiff', 'pcm_s16be'],
      ['foot_grass.flac', 'flac'],
      ['foot_grass.wav', 'pcm_s16le'],
    ] as const;

    try {
      mkdirSync(sfxDirectory, { recursive: true });
      for (const [filename, codec] of sources) {
        execFileSync(
          ffmpegPath,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-y',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440:sample_rate=44100:duration=0.5',
            '-c:a',
            codec,
            join(sfxDirectory, filename),
          ],
          { stdio: 'ignore' },
        );
      }

      const result = spawnSync(process.execPath, [join(ROOT, 'scripts/sfx_conform.mjs'), '--fix'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(existsSync(join(sfxDirectory, 'foot_grass.mp3'))).toBe(false);
      for (const [filename] of sources) {
        expect(existsSync(join(sfxDirectory, filename)), filename).toBe(true);
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe('channel policy: pure rules', () => {
  it('keeps stereo only for entries flagged stereo', () => {
    expect(expectedChannelsForEntry({ stereo: true })).toBe(TARGET_STEREO_CHANNELS);
    expect(expectedChannelsForEntry({ key: 'foot_grass' })).toBe(TARGET_MONO_CHANNELS);
    expect(expectedChannelsForEntry({ stereo: false })).toBe(TARGET_MONO_CHANNELS);
    expect(expectedChannelsForEntry(undefined)).toBe(TARGET_MONO_CHANNELS);
    expect(expectedChannelsForEntry(null)).toBe(TARGET_MONO_CHANNELS);
  });

  it('names a stereo-where-mono violation', () => {
    expect(channelProblem(TARGET_STEREO_CHANNELS, TARGET_MONO_CHANNELS)).toBe('2ch (want mono)');
  });

  it('names a mono-where-stereo violation', () => {
    expect(channelProblem(TARGET_MONO_CHANNELS, TARGET_STEREO_CHANNELS)).toBe('mono (want stereo)');
  });

  it('reports no problem when channels match policy', () => {
    expect(channelProblem(TARGET_MONO_CHANNELS, TARGET_MONO_CHANNELS)).toBeNull();
    expect(channelProblem(TARGET_STEREO_CHANNELS, TARGET_STEREO_CHANNELS)).toBeNull();
  });

  it('invents no violation from missing channel metadata', () => {
    expect(channelProblem(0, TARGET_MONO_CHANNELS)).toBeNull();
    expect(channelProblem(TARGET_STEREO_CHANNELS, 0)).toBeNull();
  });
});

describe('channel policy: catalog data', () => {
  it('keeps stereo only for non-positional ambience beds', () => {
    const stereoKeys = SFX.filter((entry) => entry.stereo).map((entry) => entry.key);
    const ambienceBeds = SFX.filter(
      (entry) =>
        entry.loop &&
        entry.key.startsWith('amb_') &&
        entry.key !== 'amb_campfire' &&
        entry.key !== 'amb_forge',
    ).map((entry) => entry.key);
    expect(stereoKeys.sort()).toEqual(ambienceBeds.sort());
    expect(stereoKeys.length).toBeGreaterThan(0);
  });

  it('keeps positional campfire and forge loops mono', () => {
    for (const key of ['amb_campfire', 'amb_forge']) {
      const entry = SFX.find((candidate) => candidate.key === key);
      expect(expectedChannelsForEntry(entry), key).toBe(TARGET_MONO_CHANNELS);
    }
  });

  it('keeps every positional, one-shot, cast, voice, and UI cue mono', () => {
    for (const entry of SFX) {
      if (entry.key.startsWith('amb_')) continue;
      expect(expectedChannelsForEntry(entry), entry.key).toBe(TARGET_MONO_CHANNELS);
    }
  });
});

describe('shared conform command: channel downmix', () => {
  it('adds -ac only when a channel target is given', () => {
    const withChannels = buildSfxConformArgs({
      inputFile: '/tmp/source.wav',
      outputFile: '/tmp/output.mp3',
      duration: 0.5,
      gainDb: 0,
      channels: TARGET_MONO_CHANNELS,
    });
    expect(withChannels.args[withChannels.args.indexOf('-ac') + 1]).toBe(
      String(TARGET_MONO_CHANNELS),
    );
    // -ac is an output remap, placed after -ar and before the encoder.
    expect(withChannels.args.indexOf('-ac')).toBeGreaterThan(withChannels.args.indexOf('-ar'));
    expect(withChannels.args.indexOf('-ac')).toBeLessThan(withChannels.args.indexOf('-codec:a'));

    const withoutChannels = buildSfxConformArgs({
      inputFile: '/tmp/source.wav',
      outputFile: '/tmp/output.mp3',
      duration: 0.5,
      gainDb: 0,
    });
    expect(withoutChannels.args).not.toContain('-ac');
  });

  it('rejects a channel target that is neither mono nor stereo', () => {
    expect(() =>
      buildSfxConformArgs({
        inputFile: '/tmp/source.wav',
        outputFile: '/tmp/output.mp3',
        duration: 0.5,
        gainDb: 0,
        channels: 3,
      }),
    ).toThrow(/channel target/);
  });

  it('downmixes a stereo source to a mono master', () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const directory = mkdtempSync(join(tmpdir(), 'wocc-sfx-downmix-'));
    const inputFile = join(directory, 'stereo.wav');
    const outputFile = join(directory, 'mono.mp3');

    try {
      // Distinct tones per channel guarantee a genuine two-channel source.
      execFileSync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=44100:duration=0.5',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=660:sample_rate=44100:duration=0.5',
          '-filter_complex',
          '[0:a][1:a]join=inputs=2:channel_layout=stereo[a]',
          '-map',
          '[a]',
          '-c:a',
          'pcm_s16le',
          inputFile,
        ],
        { stdio: 'ignore' },
      );

      const source = inspectSfxConformance(inputFile, {
        ffmpegPath,
        ffprobePath: ffprobeStatic.path,
      });
      expect(source.channels).toBe(TARGET_STEREO_CHANNELS);

      conformSfxAudio({
        inputFile,
        outputFile,
        duration: 0.5,
        ffmpegPath,
        channels: TARGET_MONO_CHANNELS,
      });

      const conformed = inspectSfxConformance(outputFile, {
        ffmpegPath,
        ffprobePath: ffprobeStatic.path,
      });
      expect(conformed.channels).toBe(TARGET_MONO_CHANNELS);
      expect(channelProblem(conformed.channels, TARGET_MONO_CHANNELS)).toBeNull();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
