import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import {
  buildVarkhulFinalistFilter,
  VARKHUL_FINALIST_TREATMENTS,
  VARKHUL_FINALISTS,
} from '../scripts/voices/varkhul_voice_finalists.mjs';

describe('Varkhul voice finalists', () => {
  it('pins the two performances selected during review', () => {
    expect(VARKHUL_FINALISTS).toEqual([
      {
        id: 'obsidian-forge-idol-candidate-2',
        source: '03-obsidian-forge-idol-candidate-2.mp3',
      },
      {
        id: 'black-anvil-colossus-candidate-1',
        source: '01-black-anvil-colossus-candidate-1.mp3',
      },
    ]);
  });

  it('offers the exact selection plus deeper and stone-forge treatments', () => {
    expect(VARKHUL_FINALIST_TREATMENTS.map(({ id }) => id)).toEqual([
      'original',
      'deeper',
      'stone-forge',
    ]);
    expect(buildVarkhulFinalistFilter('original')).toBeNull();
    expect(buildVarkhulFinalistFilter('deeper')).toBe(
      'aresample=44100,asplit=3[main_in][sub_in][furnace_in];' +
        '[main_in]asetrate=41147,aresample=44100,atempo=1.071773,' +
        'highpass=f=38,lowpass=f=6500,volume=0.78[main];' +
        '[sub_in]asetrate=29775,aresample=44100,atempo=1.481098,' +
        'highpass=f=32,lowpass=f=220,volume=0.34[sub];' +
        '[furnace_in]asetrate=36658,aresample=44100,atempo=1.203025,' +
        'highpass=f=50,lowpass=f=1250,tremolo=f=14:d=0.16,' +
        'aecho=0.8:0.15:43:0.09,volume=0.17[furnace];' +
        '[main][sub][furnace]amix=inputs=3:duration=longest:' +
        'dropout_transition=0:normalize=0,acompressor=threshold=0.1:' +
        'ratio=2.8:attack=9:release=170:makeup=1.1,' +
        'alimiter=limit=0.88,loudnorm=I=-18:TP=-2:LRA=7[out]',
    );
    expect(buildVarkhulFinalistFilter('stone-forge')).toBe(
      'aresample=44100,asplit=3[main_in][body_in][fracture_in];' +
        '[main_in]asetrate=43093,aresample=44100,atempo=1.023374,' +
        'highpass=f=42,lowpass=f=6200,volume=0.8[main];' +
        '[body_in]asetrate=34600,aresample=44100,atempo=1.274561,' +
        'highpass=f=48,lowpass=f=1250,tremolo=f=17:d=0.1,volume=0.22[body];' +
        '[fracture_in]asetrate=45920,aresample=44100,atempo=0.960373,' +
        'highpass=f=280,lowpass=f=2500,tremolo=f=27:d=0.12,' +
        'aecho=0.8:0.18:13|29:0.1|0.05,volume=0.1[fracture];' +
        '[main][body][fracture]amix=inputs=3:duration=longest:' +
        'dropout_transition=0:normalize=0,acompressor=threshold=0.1:' +
        'ratio=3:attack=7:release=145:makeup=1.12,' +
        'alimiter=limit=0.88,loudnorm=I=-18:TP=-2:LRA=7[out]',
    );
  });

  it.each(['deeper', 'stone-forge'] as const)(
    'renders the %s treatment with the pinned FFmpeg toolchain',
    (treatment) => {
      expect(ffmpegPath).toBeTruthy();
      const filter = buildVarkhulFinalistFilter(treatment);
      expect(filter).toBeTruthy();
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
          filter as string,
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

  it('rejects an unknown treatment', () => {
    expect(() => buildVarkhulFinalistFilter('unknown')).toThrow(
      'Unknown Varkhul finalist treatment: unknown',
    );
  });
});
