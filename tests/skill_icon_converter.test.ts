import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts/convert_skill_icons_webp.mjs');
const Q82_PNG_1X1_SHA256 = '6fc7c24837963e73225c4923dfa94a0e25f3318f8eda90bc5c7d5420a8d0571e';
const Q90_PNG_1X1_SHA256 = 'a1d840ae059b3a09f3f558a4c444ee632e85e0ae40a7f874175dc5cb84c1e3f4';
const Q75_NOISY_SHA256 = '0d9908b50eda31a187d9d7fcbe44ccdfc9b729c5cb82eb790b8c579cd1a04221';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/AP7+KKKKAP/Z',
  'base64',
);

const noisyPng = async (randomAlphaFraction: number): Promise<Buffer> => {
  const size = 128;
  const data = Buffer.alloc(size * size * 4);
  let state = 0x12345678;
  const next = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
  for (let pixel = 0; pixel < size * size; pixel++) {
    const offset = pixel * 4;
    data[offset] = next() >>> 24;
    data[offset + 1] = next() >>> 24;
    data[offset + 2] = next() >>> 24;
    const randomizeAlpha = next() / 2 ** 32 < randomAlphaFraction;
    data[offset + 3] = randomizeAlpha ? next() >>> 24 : 255;
  }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
};

const alternatePng = (): Promise<Buffer> =>
  sharp(Buffer.from([20, 70, 230, 255]), {
    raw: { width: 1, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const filesUnder = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(file) : entry.isFile() ? [file] : [];
      })
    : [];

const expectBytesDiscoverable = (root: string, expected: Buffer): void => {
  expect(filesUnder(root).some((file) => readFileSync(file).equals(expected))).toBe(true);
};

const expectCleanRollback = (dir: string, expected: Readonly<Record<string, Buffer>>): void => {
  for (const [name, bytes] of Object.entries(expected)) {
    expect(readFileSync(path.join(dir, name))).toEqual(bytes);
  }
  expect(readdirSync(dir).sort()).toEqual(Object.keys(expected).sort());
  expect(readdirSync(dir).filter((name) => name.includes('.woc-txn-'))).toEqual([]);
  expect(existsSync(path.join(cwd, '.woc-converter-recovery'))).toBe(false);
};

let cwd = '';
const makeCase = (files: Record<string, Buffer>): string => {
  cwd = mkdtempSync(path.join(tmpdir(), 'woc-skill-icons-'));
  const mage = path.join(cwd, 'public/ui/skills/mage');
  mkdirSync(mage, { recursive: true });
  for (const [name, buffer] of Object.entries(files)) writeFileSync(path.join(mage, name), buffer);
  return mage;
};
const run = (
  failAt?: string,
  args: readonly string[] = [],
): { status: number | null; stderr: string; stdout: string } => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(failAt ? { WOC_TEST_CONVERTER_FAIL_AT: failAt } : {}),
    },
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

afterEach(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
  cwd = '';
});

describe('convert_skill_icons_webp', () => {
  it('refuses a recursive destination collision before touching the sources', () => {
    const mage = makeCase({ 'arcane_power.png': PNG_1X1, 'arcane_power.jpg': JPEG_1X1 });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('multiple sources map to the same .webp');
    expect(existsSync(path.join(mage, 'arcane_power.png'))).toBe(true);
    expect(existsSync(path.join(mage, 'arcane_power.jpg'))).toBe(true);
    expect(existsSync(path.join(mage, 'arcane_power.webp'))).toBe(false);
  });

  it('forces even a smaller source to an exact 128px sRGB webp, then deletes it', async () => {
    const mage = makeCase({ 'arcane_power.png': PNG_1X1 });

    expect(run().status).toBe(0);

    expect(readdirSync(mage)).toEqual(['arcane_power.webp']);
    expect(sha256(readFileSync(path.join(mage, 'arcane_power.webp')))).toBe(Q82_PNG_1X1_SHA256);
    const metadata = await sharp(path.join(mage, 'arcane_power.webp')).metadata();
    expect({ width: metadata.width, height: metadata.height, space: metadata.space }).toEqual({
      width: 128,
      height: 128,
      space: 'srgb',
    });
  });

  it('preserves the --quality CLI and legacy success summary', () => {
    const mage = makeCase({ 'arcane_power.png': PNG_1X1 });

    const result = run(undefined, ['--quality', '90']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[assets:skills] converted 1 image(s) to webp at q90');
    expect(sha256(readFileSync(path.join(mage, 'arcane_power.webp')))).toBe(Q90_PNG_1X1_SHA256);
  });

  it('retries an over-cap q82 encode at q75 and writes that deterministic result', async () => {
    const source = await noisyPng(0.1);
    const mage = makeCase({ 'arcane_power.png': source });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('q75');
    expect(sha256(readFileSync(path.join(mage, 'arcane_power.webp')))).toBe(Q75_NOISY_SHA256);
    expect(existsSync(path.join(mage, 'arcane_power.png'))).toBe(false);
  });

  it('hard-fails when q75 remains over cap without touching source or prior webp', async () => {
    const source = await noisyPng(1);
    const priorValid = Buffer.from('prior valid webp bytes');
    const priorOversized = Buffer.from('prior oversized webp bytes');
    const mage = makeCase({
      'a_valid.png': PNG_1X1,
      'a_valid.webp': priorValid,
      'z_oversized.png': source,
      'z_oversized.webp': priorOversized,
    });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('q75');
    expect(result.stderr).toContain('15 KiB cap');
    expect(readFileSync(path.join(mage, 'a_valid.png')).equals(PNG_1X1)).toBe(true);
    expect(readFileSync(path.join(mage, 'a_valid.webp')).equals(priorValid)).toBe(true);
    expect(readFileSync(path.join(mage, 'z_oversized.png')).equals(source)).toBe(true);
    expect(readFileSync(path.join(mage, 'z_oversized.webp')).equals(priorOversized)).toBe(true);
  });

  it.each([
    ['stage write', 'stage:2'],
    ['destination backup', 'backup:2'],
    ['destination install', 'install:2'],
    ['source quarantine', 'source:2'],
  ] as const)('restores the whole batch when the second %s fails', async (_, failAt) => {
    const priorA = Buffer.from('prior a webp');
    const priorZ = Buffer.from('prior z webp');
    const sourceZ = await alternatePng();
    const mage = makeCase({
      'a_spell.png': PNG_1X1,
      'a_spell.webp': priorA,
      'z_spell.png': sourceZ,
      'z_spell.webp': priorZ,
    });

    const result = run(failAt);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `injected ${failAt.slice(0, failAt.indexOf(':'))} failure at operation 2`,
    );
    expectCleanRollback(mage, {
      'a_spell.png': PNG_1X1,
      'a_spell.webp': priorA,
      'z_spell.png': sourceZ,
      'z_spell.webp': priorZ,
    });
  });

  it('removes a newly created webp when later source quarantine fails', async () => {
    const prior = Buffer.from('prior existing skill webp');
    const sourceNew = await alternatePng();
    const mage = makeCase({
      'a_existing.png': PNG_1X1,
      'a_existing.webp': prior,
      'z_new.png': sourceNew,
    });

    const result = run('source:2');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected source failure at operation 2');
    expect(existsSync(path.join(mage, 'z_new.webp'))).toBe(false);
    expectCleanRollback(mage, {
      'a_existing.png': PNG_1X1,
      'a_existing.webp': prior,
      'z_new.png': sourceNew,
    });
  });

  it.each([
    ['source restore', 'rollback-source'],
    ['installed destination removal', 'rollback-install'],
    ['destination backup restore', 'rollback-backup'],
    ['staged output cleanup', 'rollback-stage'],
  ] as const)(
    'surfaces a failed rollback %s and leaves every input byte discoverable',
    async (_, phase) => {
      const priorA = Buffer.from('recoverable prior a skill webp');
      const priorZ = Buffer.from('recoverable prior z skill webp');
      const sourceZ = await alternatePng();
      const mage = makeCase({
        'a_spell.png': PNG_1X1,
        'a_spell.webp': priorA,
        'z_spell.png': sourceZ,
        'z_spell.webp': priorZ,
      });

      const result = run(`source:2,${phase}:1`);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('injected source failure at operation 2');
      expect(result.stderr).toContain('rollback incomplete');
      expect(result.stderr).toContain(`injected ${phase} failure at operation 1`);
      const residues = filesUnder(mage).filter((file) => path.basename(file).includes('.woc-txn-'));
      expect(residues.length).toBeGreaterThan(0);
      for (const bytes of [PNG_1X1, sourceZ, priorA, priorZ]) {
        expectBytesDiscoverable(cwd, bytes);
      }
      const discovery = run();
      expect(discovery.status).toBe(1);
      expect(discovery.stderr).toContain('stranded transaction files require manual recovery');
      for (const residue of residues) expect(discovery.stderr).toContain(path.basename(residue));
    },
  );

  it('retries a transient cleanup failure and leaves no transaction residue', async () => {
    const mage = makeCase({
      'a_spell.png': PNG_1X1,
      'a_spell.webp': Buffer.from('prior a webp'),
      'z_spell.png': PNG_1X1,
      'z_spell.webp': Buffer.from('prior z webp'),
    });

    const result = run('cleanup:1');

    expect(result.status).toBe(0);
    expect(sha256(readFileSync(path.join(mage, 'a_spell.webp')))).toBe(Q82_PNG_1X1_SHA256);
    expect(sha256(readFileSync(path.join(mage, 'z_spell.webp')))).toBe(Q82_PNG_1X1_SHA256);
    expect(readdirSync(mage).sort()).toEqual(['a_spell.webp', 'z_spell.webp']);
    expect(existsSync(path.join(cwd, '.woc-converter-recovery'))).toBe(false);
  });

  it('preserves persistent cleanup recovery outside the shipping tree', async () => {
    const prior = Buffer.from('prior skill webp');
    const mage = makeCase({
      'arcane_power.png': PNG_1X1,
      'arcane_power.webp': prior,
    });

    const result = run('cleanup:*');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('destinations committed, but recovery temp cleanup failed');
    expect(sha256(readFileSync(path.join(mage, 'arcane_power.webp')))).toBe(Q82_PNG_1X1_SHA256);
    expect(readFileSync(path.join(mage, 'arcane_power.png'))).toEqual(PNG_1X1);
    expect(readdirSync(mage).sort()).toEqual(['arcane_power.png', 'arcane_power.webp']);
    const recoveryRoot = path.join(cwd, '.woc-converter-recovery');
    const transactionDirs = readdirSync(recoveryRoot);
    expect(transactionDirs).toHaveLength(1);
    const recoveryFiles = readdirSync(path.join(recoveryRoot, transactionDirs[0]));
    expect(recoveryFiles).toHaveLength(1);
    expect(readFileSync(path.join(recoveryRoot, transactionDirs[0], recoveryFiles[0]))).toEqual(
      prior,
    );
  });

  it.each([
    ['source restore', 'recovery-restore'],
    ['recovery directory creation', 'recovery-mkdir'],
    ['recovery move', 'recovery-move'],
  ] as const)('surfaces a failed fallback %s without losing recoverable bytes', (_, phase) => {
    const prior = Buffer.from('prior skill bytes for recovery injection');
    const mage = makeCase({
      'arcane_power.png': PNG_1X1,
      'arcane_power.webp': prior,
    });

    const result = run(`cleanup:*,${phase}:1`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`injected ${phase} failure at operation 1`);
    expect(sha256(readFileSync(path.join(mage, 'arcane_power.webp')))).toBe(Q82_PNG_1X1_SHA256);
    expectBytesDiscoverable(cwd, PNG_1X1);
    expectBytesDiscoverable(cwd, prior);
    const residues = filesUnder(mage).filter((file) => path.basename(file).includes('.woc-txn-'));
    if (residues.length > 0) {
      const discovery = run();
      expect(discovery.status).toBe(1);
      expect(discovery.stderr).toContain('stranded transaction files require manual recovery');
      for (const residue of residues) expect(discovery.stderr).toContain(path.basename(residue));
    } else {
      expect(result.stderr).toContain('.woc-converter-recovery/');
    }
  });

  it('refuses stranded transaction siblings instead of silently shipping them', () => {
    const residue = Buffer.from('recoverable prior bytes');
    const mage = makeCase({
      '.arcane_power.webp.woc-txn-crash-0-old': residue,
      'arcane_power.webp': Buffer.from('current webp'),
    });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stranded transaction files require manual recovery');
    expect(readFileSync(path.join(mage, '.arcane_power.webp.woc-txn-crash-0-old'))).toEqual(
      residue,
    );
  });

  it('is a no-op over an already-webp tree', () => {
    const accepted = Buffer.from('RIFF____WEBPVP8 accepted skill bytes');
    const mage = makeCase({ 'arcane_power.webp': accepted });
    const beforeHash = sha256(readFileSync(path.join(mage, 'arcane_power.webp')));

    expect(run().status).toBe(0);

    expect(readdirSync(mage)).toEqual(['arcane_power.webp']);
    const after = readFileSync(path.join(mage, 'arcane_power.webp'));
    expect(sha256(after)).toBe(beforeHash);
    expect(after).toEqual(accepted);
  });
});
