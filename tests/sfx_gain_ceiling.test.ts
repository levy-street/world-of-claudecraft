// Real ffmpeg-backed tests for the computed per-key gain-ceiling math (the
// lavfi-synthesis pattern from sfx_conform.test.ts): builds a temp repoRoot
// fixture with real audio at known true peaks under REAL custom catalog key
// names (computeSfxGainCeilings imports the actual catalog, not an injected
// one, so the fixture must use real keys; discoverSfxTracks gracefully skips
// any catalog key with no file present, so only the keys under test matter).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import { computeSfxGainCeilings } from '../scripts/sfx/sfx_gain_ceiling.mjs';

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
