import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import {
  buildVarkhulVoiceFilter,
  VARKHUL_VOICE_PROCESSING_PRESET,
} from '../scripts/voices/varkhul_voice_processing.mjs';

describe('Varkhul voice processing', () => {
  it('pins a four-layer non-human forge-colossus treatment', () => {
    expect(VARKHUL_VOICE_PROCESSING_PRESET).toEqual({
      id: 'black-anvil-colossus',
      mainPitchSemitones: -2.8,
      stonePitchSemitones: -9,
      furnacePitchSemitones: -4.5,
      fracturePitchSemitones: -0.6,
    });

    const graph = buildVarkhulVoiceFilter();
    expect(graph).toContain('asplit=4');
    expect(graph).toContain('amix=inputs=4');
    expect(graph).toContain('tremolo=');
    expect(graph).toContain('aecho=');
    expect(graph).toContain('alimiter=limit=0.88');
    expect(graph).toContain('loudnorm=I=-18:TP=-2:LRA=7');
  });

  it('renders with the pinned FFmpeg toolchain', () => {
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
        buildVarkhulVoiceFilter(),
        '-map',
        '[out]',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
