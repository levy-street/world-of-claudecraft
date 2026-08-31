import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import {
  buildIgnivarRoboticVoiceFilter,
  IGNIVAR_ROBOTIC_VOICE_PRESETS,
} from '../scripts/voices/ignivar_robotic_voice_processing.mjs';

describe('Ignivar robotic voice processing', () => {
  it('pins one moderate and one unmistakably mechanical treatment', () => {
    expect(IGNIVAR_ROBOTIC_VOICE_PRESETS).toEqual([
      {
        id: 'robotic-moderate',
        mainPitchSemitones: -1.7,
        mainGain: 0.91,
        bassPitchSemitones: -6.2,
        bassGain: 0.13,
        metalGain: 0.11,
        metalTremoloFrequency: 31,
        metalTremoloDepth: 0.32,
        servoPitchSemitones: -3.4,
        servoGain: 0.045,
        servoTremoloFrequency: 47,
        servoTremoloDepth: 0.74,
        presenceGainDb: 2.4,
      },
      {
        id: 'robotic-automaton',
        mainPitchSemitones: -2.1,
        mainGain: 0.86,
        bassPitchSemitones: -7.4,
        bassGain: 0.18,
        metalGain: 0.17,
        metalTremoloFrequency: 34,
        metalTremoloDepth: 0.52,
        servoPitchSemitones: -4.2,
        servoGain: 0.085,
        servoTremoloFrequency: 53,
        servoTremoloDepth: 0.9,
        presenceGainDb: 3.6,
      },
    ]);
  });

  it('keeps the actor-led main signal beside distinct bass, metal, and servo layers', () => {
    const graph = buildIgnivarRoboticVoiceFilter('robotic-moderate');

    expect(graph).toContain('asplit=4');
    expect(graph).toContain('amix=inputs=4');
    expect(graph).toContain('equalizer=f=720');
    expect(graph).toContain('tremolo=f=31');
    expect(graph).toContain('tremolo=f=47');
    expect(graph).toContain('alimiter=limit=0.88');
    expect(graph).toContain('loudnorm=I=-18:TP=-2:LRA=7');
    expect(() => buildIgnivarRoboticVoiceFilter('unknown')).toThrow(
      'Unknown Ignivar robotic voice preset',
    );
  });

  it.each(IGNIVAR_ROBOTIC_VOICE_PRESETS as { id: string }[])(
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
          buildIgnivarRoboticVoiceFilter(id),
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
