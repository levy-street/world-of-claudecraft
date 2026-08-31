import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SFX_CONFORMANCE_FFPROBE_PATH } from '../scripts/sfx/ffmpeg_paths.mjs';
import { yellKey } from '../scripts/voices/extra_lines.mjs';
import { VOICE_LINES } from '../src/game/voice_manifest.generated';
import { IGNIVAR_DIALOGUE_LINES } from '../src/sim/encounters/ignivar_dialogue';
import { VARKHUL_DIALOGUE_LINES } from '../src/sim/encounters/varkhul_dialogue';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const voiceFiles = execFileSync(
  'git',
  [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    ':(glob)public/audio/voice/**/*.mp3',
  ],
  { cwd: repoRoot, encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => existsSync(join(repoRoot, file)))
  .sort();

const PACKS = [
  { boss: 'ignivar', lines: IGNIVAR_DIALOGUE_LINES },
  { boss: 'varkhul', lines: VARKHUL_DIALOGUE_LINES },
] as const;

interface AudioProbe {
  streams: Array<{
    bit_rate?: string;
    channels?: number;
    codec_name?: string;
    sample_rate?: string;
  }>;
  format?: { duration?: string };
}

function probeAudio(file: string): AudioProbe {
  return JSON.parse(
    execFileSync(
      SFX_CONFORMANCE_FFPROBE_PATH,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,sample_rate,channels,bit_rate:format=duration',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8' },
    ),
  );
}

describe('raid boss production voice assets', () => {
  it.each(PACKS)('ships exactly the approved $boss files and manifest rows', ({ boss, lines }) => {
    const expectedFiles = lines.map((text) => `${yellKey(text)}.mp3`).sort();
    const packDir = join(repoRoot, 'public', 'audio', 'voice', boss);
    const shippedFiles = voiceFiles
      .filter((file) => file.startsWith(`public/audio/voice/${boss}/`))
      .map((file) => basename(file))
      .sort();
    expect(shippedFiles).toEqual(expectedFiles);

    const manifestFiles = Object.values(VOICE_LINES)
      .filter((url) => url.startsWith(`/audio/voice/${boss}/`))
      .map((url) => basename(url.split('?')[0]))
      .sort();
    expect(manifestFiles).toEqual(expectedFiles);

    for (const file of shippedFiles) {
      const absolute = join(packDir, file);
      const version = createHash('sha256')
        .update(readFileSync(absolute))
        .digest('hex')
        .slice(0, 12);
      expect(VOICE_LINES[file.slice(0, -4)]).toBe(`/audio/voice/${boss}/${file}?v=${version}`);
    }
  });

  it('keeps every shipped voice clip represented exactly once in the manifest', () => {
    const manifestFiles = Object.values(VOICE_LINES)
      .map((url) => `public${url.split('?')[0]}`)
      .sort();
    expect(voiceFiles).toEqual(manifestFiles);
  });

  it.each(PACKS)('decodes every $boss clip at the production voice format', ({ boss, lines }) => {
    for (const text of lines) {
      const file = join(repoRoot, 'public', 'audio', 'voice', boss, `${yellKey(text)}.mp3`);
      const probe = probeAudio(file);
      expect(probe.streams).toHaveLength(1);
      expect(probe.streams[0], text).toMatchObject({
        codec_name: 'mp3',
        sample_rate: '44100',
        channels: 1,
        bit_rate: '192000',
      });
      expect(Number(probe.format?.duration), text).toBeGreaterThan(0);
    }
  });
});
