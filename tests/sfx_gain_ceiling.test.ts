// Real ffmpeg-backed tests for the computed per-key gain-ceiling math (the
// lavfi-synthesis pattern from sfx_conform.test.ts): builds a temp repoRoot
// fixture with real audio at known true peaks under REAL custom catalog key
// names (computeSfxGainCeilings imports the actual catalog, not an injected
// one, so the fixture must use real keys; discoverSfxTracks gracefully skips
// any catalog key with no file present, so only the keys under test matter).
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import {
  computeSfxGainCeilingRecords,
  computeSfxGainCeilings,
  readSfxGainCeilings,
  writeSfxGainCeilings,
} from '../scripts/sfx/sfx_gain_ceiling.mjs';

// Not a real ffmpeg binary: any measurement attempt through this path throws
// (ENOENT on spawn), so a test that passes it and still succeeds proves the
// skip-unchanged cache, not just a lucky pass, actually avoided the subprocess.
const BROKEN_FFMPEG_PATH = '/nonexistent/ffmpeg-does-not-exist';

function synthesizeTone(outputFile: string, peakLinear: number): void {
  execFileSync(
    ffmpegPath as string,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=${peakLinear}*sgn(sin(2*PI*1000*t)):s=44100:d=0.5`,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      outputFile,
    ],
    { stdio: 'ignore' },
  );
}

describe('computeSfxGainCeilings', () => {
  it('gives a quiet single-take custom key real headroom below the safety floor', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      const sfxDir = join(root, 'public/audio/sfx');
      mkdirSync(sfxDir, { recursive: true });
      // 0.5 linear ~= -6dBFS true peak; -1 (floor) - (-6) = 5dB of real headroom.
      synthesizeTone(join(sfxDir, 'buff_apply.mp3'), 0.5);

      const ceilings = computeSfxGainCeilings(root, ffmpegPath as string);
      expect(ceilings.buff_apply).toBeGreaterThanOrEqual(3);
      expect(ceilings.buff_apply).toBeLessThan(7);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('uses the worst-case (loudest) take across every variant, not the quietest', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      const sfxDir = join(root, 'public/audio/sfx');
      mkdirSync(sfxDir, { recursive: true });
      // foot_grass has real numbered takes in the actual catalog; take 1 quiet,
      // take 2 hot and close to the floor. The ceiling must reflect take 2,
      // since one keyTrimDb value applies uniformly to every take of a key.
      synthesizeTone(join(sfxDir, 'foot_grass_1.mp3'), 0.1); // very quiet, ~-20dBFS
      synthesizeTone(join(sfxDir, 'foot_grass_2.mp3'), 0.9); // hot, close to 0dBFS

      const ceilings = computeSfxGainCeilings(root, ffmpegPath as string);
      // A quiet-take-only ceiling would be double digits; the real, worst-case
      // ceiling must stay small since take 2 has almost no headroom left.
      expect(ceilings.foot_grass).toBeLessThan(3);
      expect(ceilings.foot_grass).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('floors at 0dB for a take already at or over the safety ceiling, never negative', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      const sfxDir = join(root, 'public/audio/sfx');
      mkdirSync(sfxDir, { recursive: true });
      // 1.0 linear = 0dBFS, already past the -1dBFS safety floor.
      synthesizeTone(join(sfxDir, 'buff_apply.mp3'), 1.0);

      const ceilings = computeSfxGainCeilings(root, ffmpegPath as string);
      expect(ceilings.buff_apply).toBe(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('omits a custom key entirely when no audio file exists for it', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      mkdirSync(join(root, 'public/audio/sfx'), { recursive: true });
      const ceilings = computeSfxGainCeilings(root, ffmpegPath as string);
      expect(Object.keys(ceilings)).toHaveLength(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('skip-unchanged fingerprint cache', () => {
  it('persists a per-track fingerprint and peak alongside the ceiling', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      const sfxDir = join(root, 'public/audio/sfx');
      mkdirSync(sfxDir, { recursive: true });
      mkdirSync(join(root, 'scripts/sfx'), { recursive: true });
      synthesizeTone(join(sfxDir, 'buff_apply.mp3'), 0.5);

      const { ceilings } = writeSfxGainCeilings(root, ffmpegPath as string);
      const stored = JSON.parse(
        readFileSync(join(root, 'scripts/sfx/sfx_gain_ceiling.generated.json'), 'utf8'),
      );

      expect(stored.buff_apply.ceilingDb).toBe(ceilings.buff_apply);
      expect(stored.buff_apply.tracks).toEqual([
        {
          filename: 'buff_apply.mp3',
          sha256: expect.any(String),
          size: expect.any(Number),
          peakDb: expect.any(Number),
        },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('reuses the stored ceiling without re-measuring a track whose fingerprint is unchanged', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      const sfxDir = join(root, 'public/audio/sfx');
      mkdirSync(sfxDir, { recursive: true });
      mkdirSync(join(root, 'scripts/sfx'), { recursive: true });
      synthesizeTone(join(sfxDir, 'buff_apply.mp3'), 0.5);

      const first = writeSfxGainCeilings(root, ffmpegPath as string);

      // A broken ffmpeg path would throw on any real measurement attempt, so
      // succeeding here (with the SAME ceiling) proves the cached fingerprint
      // was reused instead of spawning ffmpeg again.
      const second = computeSfxGainCeilings(root, BROKEN_FFMPEG_PATH);
      expect(second.buff_apply).toBe(first.ceilings.buff_apply);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('re-measures a track once its fingerprint changes (file replaced)', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      const sfxDir = join(root, 'public/audio/sfx');
      const file = join(sfxDir, 'buff_apply.mp3');
      mkdirSync(sfxDir, { recursive: true });
      mkdirSync(join(root, 'scripts/sfx'), { recursive: true });
      synthesizeTone(file, 0.5); // ~-6dBFS: several dB of headroom
      const first = writeSfxGainCeilings(root, ffmpegPath as string);

      synthesizeTone(file, 1.0); // 0dBFS: no headroom left, forces a different mtime too
      const changed = writeSfxGainCeilings(root, ffmpegPath as string);
      expect(changed.ceilings.buff_apply).toBe(0);
      expect(changed.ceilings.buff_apply).not.toBe(first.ceilings.buff_apply);

      // A further call with the SAME (now-current) fingerprint reuses the
      // just-persisted peak, so it must succeed even through a broken path.
      expect(computeSfxGainCeilings(root, BROKEN_FFMPEG_PATH).buff_apply).toBe(
        changed.ceilings.buff_apply,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('re-measures a track whose mtime is untouched but whose byte size changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      const sfxDir = join(root, 'public/audio/sfx');
      const file = join(sfxDir, 'buff_apply.mp3');
      mkdirSync(sfxDir, { recursive: true });
      mkdirSync(join(root, 'scripts/sfx'), { recursive: true });
      synthesizeTone(file, 0.5);
      const first = writeSfxGainCeilings(root, ffmpegPath as string);
      const firstStat = statSync(file);

      synthesizeTone(file, 1.0);
      // Pin the mtime back to the original value so ONLY size differs: the
      // fingerprint must still be treated as changed.
      utimesSync(file, firstStat.atime, firstStat.mtime);

      const records = computeSfxGainCeilingRecords(root, ffmpegPath as string);
      expect(records.buff_apply.ceilingDb).toBe(0);
      expect(records.buff_apply.ceilingDb).not.toBe(first.ceilings.buff_apply);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('readSfxGainCeilings back-compat and corruption handling', () => {
  it('still loads the old pre-fingerprint flat {key: ceilingDb} shape', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      mkdirSync(join(root, 'scripts/sfx'), { recursive: true });
      writeFileSync(
        join(root, 'scripts/sfx/sfx_gain_ceiling.generated.json'),
        `${JSON.stringify({ buff_apply: 3.5, foot_grass: 0 })}\n`,
      );

      expect(readSfxGainCeilings(root)).toEqual({ buff_apply: 3.5, foot_grass: 0 });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('triggers a full re-measure of every track when the stored shape is the old flat number form', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      const sfxDir = join(root, 'public/audio/sfx');
      mkdirSync(sfxDir, { recursive: true });
      mkdirSync(join(root, 'scripts/sfx'), { recursive: true });
      synthesizeTone(join(sfxDir, 'buff_apply.mp3'), 0.5);
      // Old shape has no per-track fingerprint to match against, so it must
      // never be treated as a cache hit: this call has to actually measure,
      // and does, since a real ffmpeg path is passed here.
      writeFileSync(
        join(root, 'scripts/sfx/sfx_gain_ceiling.generated.json'),
        `${JSON.stringify({ buff_apply: 99 })}\n`,
      );

      const records = computeSfxGainCeilingRecords(root, ffmpegPath as string);
      // A real measurement of a 0.5-linear (~-6dBFS) tone yields several dB
      // of headroom, nothing close to the stale flat value of 99.
      expect(records.buff_apply.ceilingDb).toBeGreaterThanOrEqual(3);
      expect(records.buff_apply.ceilingDb).toBeLessThan(7);
      expect(records.buff_apply.tracks[0].sha256).toEqual(expect.any(String));

      // With a broken ffmpeg path, the old flat shape cannot supply a cache
      // hit, so the measurement attempt throws instead of silently reusing 99.
      expect(() => computeSfxGainCeilingRecords(root, BROKEN_FFMPEG_PATH)).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('throws on a genuinely corrupt stored ceilings file instead of silently returning empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      mkdirSync(join(root, 'scripts/sfx'), { recursive: true });
      writeFileSync(
        join(root, 'scripts/sfx/sfx_gain_ceiling.generated.json'),
        'this is not valid json{{{',
      );

      expect(() => readSfxGainCeilings(root)).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('returns empty (not a throw) when the ceilings file simply does not exist yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-gain-ceiling-'));
    try {
      expect(readSfxGainCeilings(root)).toEqual({});
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
