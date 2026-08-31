import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import {
  buildRaidBossVoiceFilter,
  RAID_BOSS_VOICE_PROCESSING_PRESETS,
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
