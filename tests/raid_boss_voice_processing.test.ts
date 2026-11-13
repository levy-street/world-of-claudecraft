import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import {
  buildRaidBossVoiceFilter,
  buildSmithHeartVoiceFilter,
  RAID_BOSS_VOICE_PROCESSING_PRESETS,
  SMITH_HEART_CLEAN_VOICE_PRESETS,
} from '../scripts/voices/raid_boss_voice_processing.mjs';

describe('raid boss voice processing', () => {
  it('offers three increasingly mechanical treatments for the selected performance', () => {
    expect(RAID_BOSS_VOICE_PROCESSING_PRESETS).toEqual([
      {
        id: 'living-construct',
        mainPitchSemitones: -0.8,
        bassPitchSemitones: -4.8,
        bassGain: 0.07,
        metalGain: 0.05,
        tremoloDepth: 0.08,
      },
      {
        id: 'ancient-herald',
        mainPitchSemitones: -1.6,
        bassPitchSemitones: -6,
        bassGain: 0.12,
        metalGain: 0.09,
        tremoloDepth: 0.16,
      },
      {
        id: 'forge-automaton',
        mainPitchSemitones: -2.4,
        bassPitchSemitones: -7,
        bassGain: 0.18,
        metalGain: 0.14,
        tremoloDepth: 0.28,
      },
    ]);
  });

  it('builds a three-layer graph with a controlled loudness ceiling', () => {
    const graph = buildRaidBossVoiceFilter('ancient-herald');

    expect(graph).toContain('asplit=3');
    expect(graph).toContain('amix=inputs=3');
    expect(graph).toContain('tremolo=');
    expect(graph).toContain('aecho=');
    expect(graph).toContain('alimiter=limit=0.9');
    expect(graph).toContain('loudnorm=I=-18:TP=-2:LRA=7');
    expect(() => buildRaidBossVoiceFilter('unknown')).toThrow('Unknown voice processing preset');
  });

  it.each(RAID_BOSS_VOICE_PROCESSING_PRESETS as { id: string }[])(
    'renders the $id graph with the pinned FFmpeg toolchain',
    ({ id }) => {
      expect(ffmpegPath).toBeTruthy();
      const result = spawnSync(
        ffmpegPath as string,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=180:duration=0.4:sample_rate=48000',
          '-filter_complex',
          buildRaidBossVoiceFilter(id),
          '-map',
          '[out]',
          '-f',
          'null',
          '-',
        ],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
    },
  );
});

describe("the Smith's Heart's clean voice treatments", () => {
  it.each(SMITH_HEART_CLEAN_VOICE_PRESETS as { id: string }[])(
    '$id stays clean: no modulation or voice pitch shift, keeps the length',
    ({ id }) => {
      const graph = buildSmithHeartVoiceFilter(id);
      for (const effect of ['tremolo', 'flanger', 'chorus', 'anoisesrc', 'afreqshift'])
        expect(graph).not.toContain(effect);
      // The one rate shift is the sub, an octave under the voice.
      expect(graph.match(/asetrate=/g)).toHaveLength(1);
      expect(graph).toContain('loudnorm=I=-15:TP=-1.5');
      // A 1 s tone renders to about 1 s (the room adds its tail only): an
      // unpinned mix format once made loudnorm's output four times too long.
      const result = spawnSync(
        ffmpegPath as string,
        [
          '-hide_banner',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=180:duration=1:sample_rate=44100',
          '-filter_complex',
          graph,
          '-map',
          '[out]',
          '-ar',
          '44100',
          '-f',
          'null',
          '-',
        ],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      );
      expect(result.status, result.stderr).toBe(0);
      const times = [...result.stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
      const seconds = Number(times?.[1]) * 3600 + Number(times?.[2]) * 60 + Number(times?.[3]);
      expect(seconds).toBeGreaterThan(0.95);
      expect(seconds).toBeLessThan(1.6);
    },
  );
});
