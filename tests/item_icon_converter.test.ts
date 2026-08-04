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

// scripts/convert_item_icons_webp.mjs is the pre-commit tool that turns hand-authored item art
// into the committed 128px WebP (npm run assets:items). It DELETES the source after a
// successful encode and no lossless original is kept, so its refusal path is the one branch
// whose failure mode is unrecoverable data loss: two foreign sources sharing a basename
// (foo.png + foo.jpg) both map to foo.webp, and a naive run would overwrite the first encode
// and unlink BOTH originals. It must refuse the whole batch before touching disk.
//
// The script resolves public/ui/items from process.cwd(), so each case runs it in a temp cwd.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts/convert_item_icons_webp.mjs');
const Q82_PNG_1X1_SHA256 = '6fc7c24837963e73225c4923dfa94a0e25f3318f8eda90bc5c7d5420a8d0571e';
const Q75_NOISY_SHA256 = '0d9908b50eda31a187d9d7fcbe44ccdfc9b729c5cb82eb790b8c579cd1a04221';

// A tiny valid PNG (1x1) and JPEG, so sharp has something real to decode.
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
  cwd = mkdtempSync(path.join(tmpdir(), 'woc-item-icons-'));
  const items = path.join(cwd, 'public/ui/items');
  mkdirSync(items, { recursive: true });
  for (const [name, buf] of Object.entries(files)) writeFileSync(path.join(items, name), buf);
  return items;
};
const run = (failAt?: string): { status: number | null; stderr: string; stdout: string } => {
  const r = spawnSync(process.execPath, [script], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(failAt ? { WOC_TEST_CONVERTER_FAIL_AT: failAt } : {}),
    },
  });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
};

afterEach(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
  cwd = '';
});

describe('convert_item_icons_webp', () => {
  it('refuses the whole batch on a destination collision, destroying nothing', () => {
    const items = makeCase({ 'linen_pouch.png': PNG_1X1, 'linen_pouch.jpg': JPEG_1X1 });

    const { status, stderr } = run();

    expect(status, 'a colliding batch must exit non-zero').toBe(1);
    expect(stderr).toContain('multiple sources map to the same .webp');
    // The point of the refusal: BOTH originals survive and nothing was encoded, so the art is
    // still recoverable. (A converted-then-clobbered run would leave one .webp and no sources.)
    expect(existsSync(path.join(items, 'linen_pouch.png'))).toBe(true);
    expect(existsSync(path.join(items, 'linen_pouch.jpg'))).toBe(true);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('forces even a smaller source to an exact 128px webp, then deletes the original', async () => {
    const items = makeCase({ 'linen_pouch.png': PNG_1X1 });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      '[assets:items] converted 1 image(s) to 128px webp at q82 and deleted the originals',
    );

    expect(readdirSync(items)).toEqual(['linen_pouch.webp']);
    expect(sha256(readFileSync(path.join(items, 'linen_pouch.webp')))).toBe(Q82_PNG_1X1_SHA256);
    const metadata = await sharp(path.join(items, 'linen_pouch.webp')).metadata();
    expect({ width: metadata.width, height: metadata.height, space: metadata.space }).toEqual({
      width: 128,
      height: 128,
      space: 'srgb',
    });
  });

  it('retries an over-cap q82 encode at q75 and writes that deterministic result', async () => {
    const source = await noisyPng(0.1);
    const items = makeCase({ 'linen_pouch.png': source });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('q75');
    expect(sha256(readFileSync(path.join(items, 'linen_pouch.webp')))).toBe(Q75_NOISY_SHA256);
    expect(existsSync(path.join(items, 'linen_pouch.png'))).toBe(false);
  });

  it('hard-fails when q75 remains over cap without touching source or prior webp', async () => {
    const source = await noisyPng(1);
    const priorValid = Buffer.from('prior valid webp bytes');
    const priorOversized = Buffer.from('prior oversized webp bytes');
    const items = makeCase({
      'a_valid.png': PNG_1X1,
      'a_valid.webp': priorValid,
      'z_oversized.png': source,
      'z_oversized.webp': priorOversized,
    });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('q75');
    expect(result.stderr).toContain('15 KiB cap');
    expect(readFileSync(path.join(items, 'a_valid.png')).equals(PNG_1X1)).toBe(true);
    expect(readFileSync(path.join(items, 'a_valid.webp')).equals(priorValid)).toBe(true);
    expect(readFileSync(path.join(items, 'z_oversized.png')).equals(source)).toBe(true);
    expect(readFileSync(path.join(items, 'z_oversized.webp')).equals(priorOversized)).toBe(true);
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
    const items = makeCase({
      'a_item.png': PNG_1X1,
      'a_item.webp': priorA,
      'z_item.png': sourceZ,
      'z_item.webp': priorZ,
    });

    const result = run(failAt);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `injected ${failAt.slice(0, failAt.indexOf(':'))} failure at operation 2`,
    );
    expectCleanRollback(items, {
      'a_item.png': PNG_1X1,
      'a_item.webp': priorA,
      'z_item.png': sourceZ,
      'z_item.webp': priorZ,
    });
  });

  it('removes a newly created webp when later source quarantine fails', async () => {
    const prior = Buffer.from('prior existing item webp');
    const sourceNew = await alternatePng();
    const items = makeCase({
      'a_existing.png': PNG_1X1,
      'a_existing.webp': prior,
      'z_new.png': sourceNew,
    });

    const result = run('source:2');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected source failure at operation 2');
    expect(existsSync(path.join(items, 'z_new.webp'))).toBe(false);
    expectCleanRollback(items, {
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
      const priorA = Buffer.from('recoverable prior a item webp');
      const priorZ = Buffer.from('recoverable prior z item webp');
      const sourceZ = await alternatePng();
      const items = makeCase({
        'a_item.png': PNG_1X1,
        'a_item.webp': priorA,
        'z_item.png': sourceZ,
        'z_item.webp': priorZ,
      });

      const result = run(`source:2,${phase}:1`);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('injected source failure at operation 2');
      expect(result.stderr).toContain('rollback incomplete');
      expect(result.stderr).toContain(`injected ${phase} failure at operation 1`);
      const residues = filesUnder(items).filter((file) =>
        path.basename(file).includes('.woc-txn-'),
      );
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

  it('retries transient cleanup failure after committing the whole batch', async () => {
    const items = makeCase({
      'a_item.png': PNG_1X1,
      'a_item.webp': Buffer.from('prior a webp'),
      'z_item.png': PNG_1X1,
      'z_item.webp': Buffer.from('prior z webp'),
    });

    const result = run('cleanup:1');

    expect(result.status).toBe(0);
    expect(sha256(readFileSync(path.join(items, 'a_item.webp')))).toBe(Q82_PNG_1X1_SHA256);
    expect(sha256(readFileSync(path.join(items, 'z_item.webp')))).toBe(Q82_PNG_1X1_SHA256);
    expect(readdirSync(items).sort()).toEqual(['a_item.webp', 'z_item.webp']);
    expect(existsSync(path.join(cwd, '.woc-converter-recovery'))).toBe(false);
  });

  it('surfaces persistent cleanup failure without leaving recovery bytes in public', async () => {
    const prior = Buffer.from('prior item webp');
    const items = makeCase({
      'linen_pouch.png': PNG_1X1,
      'linen_pouch.webp': prior,
    });

    const result = run('cleanup:*');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('destinations committed, but recovery temp cleanup failed');
    expect(sha256(readFileSync(path.join(items, 'linen_pouch.webp')))).toBe(Q82_PNG_1X1_SHA256);
    expect(readFileSync(path.join(items, 'linen_pouch.png'))).toEqual(PNG_1X1);
    expect(readdirSync(items).sort()).toEqual(['linen_pouch.png', 'linen_pouch.webp']);
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
    const prior = Buffer.from('prior item bytes for recovery injection');
    const items = makeCase({
      'linen_pouch.png': PNG_1X1,
      'linen_pouch.webp': prior,
    });

    const result = run(`cleanup:*,${phase}:1`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`injected ${phase} failure at operation 1`);
    expect(sha256(readFileSync(path.join(items, 'linen_pouch.webp')))).toBe(Q82_PNG_1X1_SHA256);
    expectBytesDiscoverable(cwd, PNG_1X1);
    expectBytesDiscoverable(cwd, prior);
    const residues = filesUnder(items).filter((file) => path.basename(file).includes('.woc-txn-'));
    if (residues.length > 0) {
      const discovery = run();
      expect(discovery.status).toBe(1);
      expect(discovery.stderr).toContain('stranded transaction files require manual recovery');
      for (const residue of residues) expect(discovery.stderr).toContain(path.basename(residue));
    } else {
      expect(result.stderr).toContain('.woc-converter-recovery/');
    }
  });

  it('refuses stranded transaction siblings instead of treating the tree as a no-op', () => {
    const residue = Buffer.from('recoverable prior bytes');
    const items = makeCase({
      '.linen_pouch.webp.woc-txn-crash-0-old': residue,
      'linen_pouch.webp': Buffer.from('current webp'),
    });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stranded transaction files require manual recovery');
    expect(readFileSync(path.join(items, '.linen_pouch.webp.woc-txn-crash-0-old'))).toEqual(
      residue,
    );
  });

  it('is a no-op over an already-webp tree (safe to re-run)', () => {
    const items = makeCase({});
    // A committed .webp must never be re-encoded (generation loss) or deleted.
    const accepted = Buffer.from('RIFF____WEBPVP8 accepted item bytes');
    writeFileSync(path.join(items, 'linen_pouch.webp'), accepted);
    const beforeHash = sha256(readFileSync(path.join(items, 'linen_pouch.webp')));

    expect(run().status).toBe(0);

    expect(readdirSync(items)).toEqual(['linen_pouch.webp']);
    const after = readFileSync(path.join(items, 'linen_pouch.webp'));
    expect(sha256(after)).toBe(beforeHash);
    expect(after).toEqual(accepted);
  });
});
