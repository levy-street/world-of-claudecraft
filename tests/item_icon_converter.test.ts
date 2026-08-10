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
// Tiny valid fixtures are retained for intake-refusal and collision tests.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/AP7+KKKKAP/Z',
  'base64',
);

const PNG_512_OPAQUE = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 3,
    background: { r: 44, g: 72, b: 110 },
  },
})
  .png()
  .toBuffer();

const PNG_512_NONSQUARE = await sharp({
  create: {
    width: 512,
    height: 640,
    channels: 3,
    background: { r: 44, g: 72, b: 110 },
  },
})
  .png()
  .toBuffer();

const PNG_511_BY_640 = await sharp({
  create: {
    width: 511,
    height: 640,
    channels: 3,
    background: { r: 44, g: 72, b: 110 },
  },
})
  .png()
  .toBuffer();

const PNG_640_BY_511 = await sharp({
  create: {
    width: 640,
    height: 511,
    channels: 3,
    background: { r: 44, g: 72, b: 110 },
  },
})
  .png()
  .toBuffer();

const PNG_512_TRANSPARENT = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 44, g: 72, b: 110, alpha: 0.5 },
  },
})
  .png()
  .toBuffer();

const PNG_512_OPAQUE_RGBA = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 44, g: 72, b: 110, alpha: 1 },
  },
})
  .png()
  .toBuffer();

const animatedGifPixels = Buffer.alloc(512 * 512 * 3 * 2);
animatedGifPixels.fill(44, 0, 512 * 512 * 3);
animatedGifPixels.fill(110, 512 * 512 * 3);
const GIF_512_ANIMATED = await sharp(animatedGifPixels, {
  raw: { width: 512, height: 1024, channels: 3, pageHeight: 512 },
})
  .gif({ delay: [100, 100], loop: 0 })
  .toBuffer();

const TIFF_512_CMYK = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 3,
    background: { r: 44, g: 72, b: 110 },
  },
})
  .toColorspace('cmyk')
  .tiff()
  .toBuffer();

const noisyPng = async (randomPixelFraction: number): Promise<Buffer> => {
  const sampleSize = 128;
  const data = Buffer.alloc(sampleSize * sampleSize * 4);
  let state = 0x12345678;
  const next = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
  for (let pixel = 0; pixel < sampleSize * sampleSize; pixel++) {
    const offset = pixel * 4;
    const randomize = next() / 2 ** 32 < randomPixelFraction;
    data[offset] = randomize ? next() >>> 24 : 48;
    data[offset + 1] = randomize ? next() >>> 24 : 64;
    data[offset + 2] = randomize ? next() >>> 24 : 84;
    data[offset + 3] = 255;
  }
  return sharp(data, { raw: { width: sampleSize, height: sampleSize, channels: 4 } })
    .resize(512, 512, { kernel: 'nearest' })
    .png()
    .toBuffer();
};

const alternatePng = (): Promise<Buffer> =>
  sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: { r: 20, g: 70, b: 230 },
    },
  })
    .png()
    .toBuffer();

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const Q82_PNG_512_SHA256 = 'c000db00b4b2a47ba70b20d4b8e9f3e5d96d9642eb1e255154de03540747bd67';
const Q82_PNG_512_BYTES = 104;
const Q75_NOISY_PNG_SHA256 = '8cfb263fb7e98c196fbdd4aa1ea5d18fb595d01e446f10ad9d729940de327924';
const Q75_NOISY_PNG_BYTES = 9_338;

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
  expect(readdirSync(dir).sort()).toEqual([...Object.keys(expected), 'mapping.json'].sort());
  expect(readdirSync(dir).filter((name) => name.includes('.woc-txn-'))).toEqual([]);
  expect(existsSync(path.join(cwd, '.woc-converter-recovery'))).toBe(false);
};

let cwd = '';
const makeCase = (files: Record<string, Buffer>): string => {
  cwd = mkdtempSync(path.join(tmpdir(), 'woc-item-icons-'));
  const items = path.join(cwd, 'public/ui/items');
  mkdirSync(items, { recursive: true });
  for (const [name, buf] of Object.entries(files)) writeFileSync(path.join(items, name), buf);
  const itemIds = [
    ...new Set(
      Object.keys(files)
        .filter((name) => !name.includes('.woc-txn-'))
        .map((name) => path.basename(name, path.extname(name))),
    ),
  ];
  writeFileSync(
    path.join(items, 'mapping.json'),
    `${JSON.stringify({
      iconSize: 128,
      entries: itemIds.map((itemId) => ({
        itemId,
        name: itemId,
        sourcePack: 'test-fixture',
        sourceFile: `${itemId}.png`,
        license: 'test fixture',
      })),
      generatedBatches: [],
    })}\n`,
  );
  return items;
};
const run = (
  failAt?: string,
  args: string[] = [],
): { status: number | null; stderr: string; stdout: string } => {
  const r = spawnSync(process.execPath, [script, ...args], {
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

  it('refuses an undersized source without deleting or replacing anything', () => {
    const items = makeCase({ 'linen_pouch.png': PNG_1X1 });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('at least 512x512');
    expect(readFileSync(path.join(items, 'linen_pouch.png'))).toEqual(PNG_1X1);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it.each([
    ['width', PNG_511_BY_640, '511x640'],
    ['height', PNG_640_BY_511, '640x511'],
  ] as const)('independently enforces the minimum source %s', (_, source, dimensions) => {
    const items = makeCase({ 'linen_pouch.png': source });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('at least 512x512');
    expect(result.stderr).toContain(dimensions);
    expect(readFileSync(path.join(items, 'linen_pouch.png'))).toEqual(source);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('refuses a non-square source instead of silently center-cropping it', () => {
    const items = makeCase({ 'linen_pouch.png': PNG_512_NONSQUARE });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be square');
    expect(readFileSync(path.join(items, 'linen_pouch.png'))).toEqual(PNG_512_NONSQUARE);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('refuses transparent source art instead of preserving a cutout item', () => {
    const items = makeCase({ 'linen_pouch.png': PNG_512_TRANSPARENT });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be fully opaque');
    expect(readFileSync(path.join(items, 'linen_pouch.png'))).toEqual(PNG_512_TRANSPARENT);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('accepts an opaque RGBA master and strips its redundant alpha channel', async () => {
    const items = makeCase({ 'linen_pouch.png': PNG_512_OPAQUE_RGBA });

    const result = run();

    expect(result.status).toBe(0);
    expect(existsSync(path.join(items, 'linen_pouch.png'))).toBe(false);
    const metadata = await sharp(path.join(items, 'linen_pouch.webp')).metadata();
    expect(metadata.hasAlpha).toBe(false);
  });

  it('refuses a multi-frame master instead of silently shipping only one frame', () => {
    const items = makeCase({ 'linen_pouch.gif': GIF_512_ANIMATED });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('single-frame still image');
    expect(readFileSync(path.join(items, 'linen_pouch.gif'))).toEqual(GIF_512_ANIMATED);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('refuses a non-sRGB master instead of silently changing its authored color space', () => {
    const items = makeCase({ 'linen_pouch.tiff': TIFF_512_CMYK });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must decode as sRGB');
    expect(readFileSync(path.join(items, 'linen_pouch.tiff'))).toEqual(TIFF_512_CMYK);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('refuses art without a current mapping owner before deleting its source', () => {
    const items = makeCase({ 'linen_pouch.png': PNG_512_OPAQUE });
    writeFileSync(
      path.join(items, 'mapping.json'),
      `${JSON.stringify({ iconSize: 128, entries: [], generatedBatches: [] })}\n`,
    );

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exactly one current provenance owner');
    expect(readFileSync(path.join(items, 'linen_pouch.png'))).toEqual(PNG_512_OPAQUE);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('refuses art with duplicate current mapping owners before deleting its source', () => {
    const items = makeCase({ 'linen_pouch.png': PNG_512_OPAQUE });
    writeFileSync(
      path.join(items, 'mapping.json'),
      `${JSON.stringify({
        iconSize: 128,
        entries: [
          {
            itemId: 'linen_pouch',
            name: 'linen_pouch',
            sourcePack: 'test-fixture',
            sourceFile: 'linen_pouch.png',
            license: 'test fixture',
          },
        ],
        generatedBatches: [{ batchId: 'duplicate-test-owner', itemIds: ['linen_pouch'] }],
      })}\n`,
    );

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exactly one current provenance owner');
    expect(result.stderr).toContain('found 2');
    expect(readFileSync(path.join(items, 'linen_pouch.png'))).toEqual(PNG_512_OPAQUE);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('converts a valid reviewed master to exact opaque 128px WebP, then deletes the source', async () => {
    const items = makeCase({ 'linen_pouch.png': PNG_512_OPAQUE });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      '[assets:items] converted 1 image(s) to 128px webp at q82 and deleted the originals',
    );

    expect(readdirSync(items).sort()).toEqual(['linen_pouch.webp', 'mapping.json']);
    const shipped = readFileSync(path.join(items, 'linen_pouch.webp'));
    expect(shipped.length).toBe(Q82_PNG_512_BYTES);
    expect(sha256(shipped)).toBe(Q82_PNG_512_SHA256);
    const metadata = await sharp(path.join(items, 'linen_pouch.webp')).metadata();
    expect({ width: metadata.width, height: metadata.height, space: metadata.space }).toEqual({
      width: 128,
      height: 128,
      space: 'srgb',
    });
  });

  it('retries an over-cap custom-quality encode at q75 and writes that deterministic result', async () => {
    const source = await noisyPng(0.3);
    const items = makeCase({ 'linen_pouch.png': source });

    const result = run(undefined, ['--quality', '100']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('q75');
    const shipped = readFileSync(path.join(items, 'linen_pouch.webp'));
    expect(shipped.length).toBe(Q75_NOISY_PNG_BYTES);
    expect(sha256(shipped)).toBe(Q75_NOISY_PNG_SHA256);
    expect(existsSync(path.join(items, 'linen_pouch.png'))).toBe(false);
  });

  it('hard-fails when q75 remains over the configured cap without touching the batch', async () => {
    const source = await noisyPng(1);
    const priorValid = Buffer.from('prior valid webp bytes');
    const priorOversized = Buffer.from('prior oversized webp bytes');
    const items = makeCase({
      'a_valid.png': PNG_512_OPAQUE,
      'a_valid.webp': priorValid,
      'z_oversized.png': source,
      'z_oversized.webp': priorOversized,
    });

    const result = run('size-cap:100');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('q75');
    expect(result.stderr).toContain('100 B cap');
    expect(readFileSync(path.join(items, 'a_valid.png')).equals(PNG_512_OPAQUE)).toBe(true);
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
      'a_item.png': PNG_512_OPAQUE,
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
      'a_item.png': PNG_512_OPAQUE,
      'a_item.webp': priorA,
      'z_item.png': sourceZ,
      'z_item.webp': priorZ,
    });
  });

  it('removes a newly created webp when later source quarantine fails', async () => {
    const prior = Buffer.from('prior existing item webp');
    const sourceNew = await alternatePng();
    const items = makeCase({
      'a_existing.png': PNG_512_OPAQUE,
      'a_existing.webp': prior,
      'z_new.png': sourceNew,
    });

    const result = run('source:2');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected source failure at operation 2');
    expect(existsSync(path.join(items, 'z_new.webp'))).toBe(false);
    expectCleanRollback(items, {
      'a_existing.png': PNG_512_OPAQUE,
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
        'a_item.png': PNG_512_OPAQUE,
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
      for (const bytes of [PNG_512_OPAQUE, sourceZ, priorA, priorZ]) {
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
      'a_item.png': PNG_512_OPAQUE,
      'a_item.webp': Buffer.from('prior a webp'),
      'z_item.png': PNG_512_OPAQUE,
      'z_item.webp': Buffer.from('prior z webp'),
    });

    const result = run('cleanup:1');

    expect(result.status).toBe(0);
    expect(sha256(readFileSync(path.join(items, 'a_item.webp')))).toBe(Q82_PNG_512_SHA256);
    expect(sha256(readFileSync(path.join(items, 'z_item.webp')))).toBe(Q82_PNG_512_SHA256);
    expect(readdirSync(items).sort()).toEqual(['a_item.webp', 'mapping.json', 'z_item.webp']);
    expect(existsSync(path.join(cwd, '.woc-converter-recovery'))).toBe(false);
  });

  it('surfaces persistent cleanup failure without leaving recovery bytes in public', async () => {
    const prior = Buffer.from('prior item webp');
    const items = makeCase({
      'linen_pouch.png': PNG_512_OPAQUE,
      'linen_pouch.webp': prior,
    });

    const result = run('cleanup:*');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('destinations committed, but recovery temp cleanup failed');
    expect(sha256(readFileSync(path.join(items, 'linen_pouch.webp')))).toBe(Q82_PNG_512_SHA256);
    expect(readFileSync(path.join(items, 'linen_pouch.png'))).toEqual(PNG_512_OPAQUE);
    expect(readdirSync(items).sort()).toEqual([
      'linen_pouch.png',
      'linen_pouch.webp',
      'mapping.json',
    ]);
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
      'linen_pouch.png': PNG_512_OPAQUE,
      'linen_pouch.webp': prior,
    });

    const result = run(`cleanup:*,${phase}:1`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`injected ${phase} failure at operation 1`);
    expect(sha256(readFileSync(path.join(items, 'linen_pouch.webp')))).toBe(Q82_PNG_512_SHA256);
    expectBytesDiscoverable(cwd, PNG_512_OPAQUE);
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

    expect(readdirSync(items).sort()).toEqual(['linen_pouch.webp', 'mapping.json']);
    const after = readFileSync(path.join(items, 'linen_pouch.webp'));
    expect(sha256(after)).toBe(beforeHash);
    expect(after).toEqual(accepted);
  });
});
