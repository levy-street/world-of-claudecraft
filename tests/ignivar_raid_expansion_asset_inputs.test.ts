import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');
const CONCEPT_DIR = path.join(ROOT, 'docs/screenshots/ignivar-raid-expansion/concepts');

const CONCEPTS = [
  {
    file: 'ignivar_ember_sentinel.png',
    width: 1672,
    height: 941,
    bytes: 1_418_844,
    sha256: 'cabae2c86f6a4908724fefbca121d309f198331a66bc5806406cfff36155d0cf',
  },
  {
    file: 'ignivar_crucible_warden.png',
    width: 1672,
    height: 941,
    bytes: 1_506_934,
    sha256: '310aae74650e675d1e1a425214f7de1b6f220a701edc57f3049e38aaaa7de6c2',
  },
  {
    file: 'ignivar_cinder_artificer.png',
    width: 1672,
    height: 941,
    bytes: 1_490_582,
    sha256: '0673d17183a0d386bbf3a2d52b7852f130f47e489770f6ebbf44780be95723a2',
  },
  {
    file: 'varkhul_forge_master.png',
    width: 1672,
    height: 941,
    bytes: 1_688_965,
    sha256: '37c6f1c6ac727f6ec58327be47d2a43f68189d332ce47f212a4d4f71a816787a',
  },
  {
    file: 'varkhul_warhammer.png',
    width: 1024,
    height: 1536,
    bytes: 1_543_298,
    sha256: '5843ca5e825cffa7848ff8db3251ea1c98bc8b17d5fae47ca2076feae6800bab',
  },
  {
    file: 'varkhul_grand_forge.png',
    width: 1331,
    height: 1182,
    bytes: 1_972_556,
    sha256: '6bad83fe6efd89e450304f4f6f0724c3702acd7647c73fb6b8f9d183cb479be6',
  },
] as const;

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('Ignivar raid expansion asset inputs', () => {
  it('pins every approved first-party concept byte for the paid generation handoff', () => {
    for (const concept of CONCEPTS) {
      const bytes = readFileSync(path.join(CONCEPT_DIR, concept.file));
      expect(bytes.byteLength, concept.file).toBe(concept.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), concept.file).toBe(concept.sha256);
      expect(pngDimensions(bytes), concept.file).toEqual({
        width: concept.width,
        height: concept.height,
      });
    }
  });

  it('keeps exact prompts, provenance, and one resumable job contract per concept', () => {
    const prompts = readFileSync(path.join(CONCEPT_DIR, 'prompts.md'), 'utf8');
    const provenance = readFileSync(path.join(CONCEPT_DIR, 'provenance.md'), 'utf8');
    const wave = readFileSync(path.join(CONCEPT_DIR, 'tripo-wave.md'), 'utf8');
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');

    const jobs = [
      'raid_ember_sentinel_v1',
      'raid_crucible_warden_v1',
      'raid_cinder_artificer_v1',
      'raid_varkhul_forge_master_v1',
      'raid_varkhul_warhammer_v1',
      'raid_varkhul_grand_forge_v1',
    ];
    for (const concept of CONCEPTS) {
      expect(provenance, concept.file).toContain(`\`${concept.file}\``);
      expect(provenance, concept.sha256).toContain(concept.sha256);
      expect(wave, concept.file).toContain(`concepts/${concept.file}`);
    }
    for (const job of jobs) {
      expect(wave.match(new RegExp(job, 'g'))?.length ?? 0, job).toBeGreaterThanOrEqual(4);
    }
    for (const heading of [
      'Ignivar Ember Sentinel',
      'Ignivar Crucible Warden',
      'Ignivar Cinder Artificer',
      'Varkhul Forge Master',
      'Varkhul Warhammer',
      'Varkhul Grand Forge',
    ]) {
      expect(prompts, heading).toContain(`## ${heading}`);
    }
    expect(credits).toContain('docs/screenshots/ignivar-raid-expansion/concepts/');
  });

  it('contains no committed Tripo credential or fake model receipt', () => {
    const corpus = ['prompts.md', 'provenance.md', 'tripo-wave.md']
      .map((name) => readFileSync(path.join(CONCEPT_DIR, name), 'utf8'))
      .join('\n');
    expect(corpus).not.toMatch(/tsk_[A-Za-z0-9]+/);
    expect(corpus).not.toContain('generation-receipts.json` containing placeholder');
    expect(corpus).toContain('No Tripo call was made from this worktree');
  });
});
