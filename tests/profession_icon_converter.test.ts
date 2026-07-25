import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts/convert_profession_icons_webp.mjs');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/AP7+KKKKAP/Z',
  'base64',
);

let cwd = '';
const makeCase = (files: Record<string, Buffer>): string => {
  cwd = mkdtempSync(path.join(tmpdir(), 'woc-profession-icons-'));
  const professions = path.join(cwd, 'public/ui/professions');
  mkdirSync(professions, { recursive: true });
  mkdirSync(path.join(cwd, 'src/ui'), { recursive: true });
  for (const [name, buffer] of Object.entries(files))
    writeFileSync(path.join(professions, name), buffer);
  return professions;
};

const run = (): { status: number | null; stderr: string } => {
  const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
};

const generatedRegistry = (): string =>
  readFileSync(path.join(cwd, 'src/ui/profession_image_ids.ts'), 'utf8');

afterEach(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
  cwd = '';
});

describe('convert_profession_icons_webp', () => {
  it('refuses a destination collision without destroying either source', () => {
    const professions = makeCase({
      'prof_alchemy.png': PNG_1X1,
      'prof_alchemy.jpg': JPEG_1X1,
    });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toContain('multiple sources map to the same .webp');
    expect(existsSync(path.join(professions, 'prof_alchemy.png'))).toBe(true);
    expect(existsSync(path.join(professions, 'prof_alchemy.jpg'))).toBe(true);
    expect(existsSync(path.join(professions, 'prof_alchemy.webp'))).toBe(false);
  });

  it('encodes source art, deletes the public-side source, and generates its registry', () => {
    const professions = makeCase({ 'prof_alchemy.png': PNG_1X1 });

    expect(run().status).toBe(0);

    expect(readdirSync(professions)).toEqual(['prof_alchemy.webp']);
    expect(generatedRegistry()).toContain("  'prof_alchemy',");
  });

  it('is byte-stable across a second run for both generated registry and output webps', () => {
    const professions = makeCase({
      'gather_mining.png': PNG_1X1,
      'prof_alchemy.png': PNG_1X1,
    });

    expect(run().status).toBe(0);
    const firstRegistry = readFileSync(path.join(cwd, 'src/ui/profession_image_ids.ts'));
    const firstMining = readFileSync(path.join(professions, 'gather_mining.webp'));
    const firstAlchemy = readFileSync(path.join(professions, 'prof_alchemy.webp'));

    expect(run().status).toBe(0);

    expect(readFileSync(path.join(cwd, 'src/ui/profession_image_ids.ts'))).toEqual(firstRegistry);
    expect(readFileSync(path.join(professions, 'gather_mining.webp'))).toEqual(firstMining);
    expect(readFileSync(path.join(professions, 'prof_alchemy.webp'))).toEqual(firstAlchemy);
  });

  it('preserves malformed source bytes when encoding fails', () => {
    const malformed = Buffer.from('not a decodable png');
    const professions = makeCase({ 'prof_broken.png': malformed });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toContain('[assets:professions] failed:');
    expect(readFileSync(path.join(professions, 'prof_broken.png'))).toEqual(malformed);
    expect(existsSync(path.join(professions, 'prof_broken.webp'))).toBe(false);
  });

  it('regenerates a sorted registry for an already-webp tree without re-encoding it', () => {
    const professions = makeCase({});
    const webp = Buffer.from('RIFF____WEBPVP8 ');
    writeFileSync(path.join(professions, 'prof_tailoring.webp'), webp);
    writeFileSync(path.join(professions, 'archetype_smith.webp'), webp);

    expect(run().status).toBe(0);

    expect(readdirSync(professions)).toEqual(['archetype_smith.webp', 'prof_tailoring.webp']);
    expect(generatedRegistry()).toContain("  'archetype_smith',\n  'prof_tailoring',");
    // The "without re-encoding" half of the contract, asserted on the bytes:
    // a re-encode of these deliberately undecodable stubs could not reproduce
    // them, so byte equality proves the no-op left the tree untouched.
    expect(readFileSync(path.join(professions, 'prof_tailoring.webp'))).toEqual(webp);
    expect(readFileSync(path.join(professions, 'archetype_smith.webp'))).toEqual(webp);
  });
});
