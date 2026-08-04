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
const script = path.join(repoRoot, 'scripts/convert_deed_icons_webp.mjs');
const Q82_REGULAR_SHA256 = '1d45f91b34c063e6660fb3bf4d8f1092da1111ebd7bf981dbf3b9317a17b8357';
const Q82_KEYED_SHA256 = '733223aef79cefc94687bed5d0af741d45adb107c16bb4bfc44b76efd55e4ede';
const Q75_NOISY_SHA256 = '00dec47c74af65caaa37aeded7700c950343c20ce10a1aaa6b46a866a1535651';
const KEPT_NEW_REGISTRY_SHA256 = 'e381e55d44d780e284d3ea94bacef6ff282187f7b05716e81589aefa1202816d';
const MODULE_SENTINEL = 'prior deed image registry\n';

interface Layer {
  left: number;
  top: number;
  right: number;
  bottom: number;
  alpha: number;
  rgb?: readonly [number, number, number];
}

interface Fixture {
  root: string;
  sourceDir: string;
  deedsDir: string;
  moduleFile: string;
}

interface InvalidCase {
  label: string;
  messages: readonly string[];
  source: () => Promise<Buffer>;
}

const scratch: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function fixture(liveIds: readonly string[], existing: Record<string, Buffer> = {}): Fixture {
  const root = tempDir('woc-deed-converter-repo-');
  const sourceDir = tempDir('woc-deed-converter-source-');
  const deedsDir = path.join(root, 'public/ui/deeds');
  const contentDir = path.join(root, 'src/sim/content');
  const uiDir = path.join(root, 'src/ui');
  mkdirSync(deedsDir, { recursive: true });
  mkdirSync(contentDir, { recursive: true });
  mkdirSync(uiDir, { recursive: true });
  writeFileSync(
    path.join(contentDir, 'deeds.ts'),
    `export const DEED_ORDER = ${JSON.stringify(liveIds)} as const;\n`,
  );
  for (const [name, bytes] of Object.entries(existing))
    writeFileSync(path.join(deedsDir, name), bytes);
  const moduleFile = path.join(uiDir, 'deed_image_ids.ts');
  writeFileSync(moduleFile, MODULE_SENTINEL);
  return { root, sourceDir, deedsDir, moduleFile };
}

function run(
  f: Fixture,
  failAt?: string,
): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [script, f.sourceDir], {
    cwd: f.root,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      ...(failAt ? { WOC_TEST_CONVERTER_FAIL_AT: failAt } : {}),
    },
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

async function rgbaPng(
  width = 512,
  height = 512,
  layers: readonly Layer[] = [{ left: 64, top: 64, right: 447, bottom: 447, alpha: 255 }],
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (const layer of layers) {
    const [r, g, b] = layer.rgb ?? [90, 140, 210];
    for (let y = layer.top; y <= layer.bottom; y++) {
      for (let x = layer.left; x <= layer.right; x++) {
        const offset = (y * width + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = layer.alpha;
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function rgbRaster(format: 'jpeg' | 'png'): Promise<Buffer> {
  const data = Buffer.alloc(512 * 512 * 3, 120);
  const image = sharp(data, { raw: { width: 512, height: 512, channels: 3 } });
  return format === 'jpeg' ? image.jpeg().toBuffer() : image.png().toBuffer();
}

async function noisyPng(
  randomAlphaFraction: number,
  visibleMin = 16,
  visibleMax = 111,
): Promise<Buffer> {
  const size = 128;
  const data = Buffer.alloc(size * size * 4);
  let state = 0x12345678;
  const next = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      data[offset] = next() >>> 24;
      data[offset + 1] = next() >>> 24;
      data[offset + 2] = next() >>> 24;
      if (x >= visibleMin && x <= visibleMax && y >= visibleMin && y <= visibleMax) {
        const randomizeAlpha = next() / 2 ** 32 < randomAlphaFraction;
        data[offset + 3] = randomizeAlpha ? 8 + (next() % 248) : 255;
      }
    }
  }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .resize(512, 512, { kernel: 'nearest' })
    .png()
    .toBuffer();
}

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

function expectNoTransactionSiblings(...dirs: readonly string[]): void {
  const residues = dirs.flatMap((dir) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.includes('.woc-txn-'))
          .map((name) => path.join(dir, name))
      : [],
  );
  expect(residues).toEqual([]);
}

function expectRepositoryRollback(
  f: Fixture,
  expectedSources: Readonly<Record<string, Buffer>>,
  expectedDeeds: Readonly<Record<string, Buffer>>,
): void {
  for (const [name, bytes] of Object.entries(expectedDeeds)) {
    expect(readFileSync(path.join(f.deedsDir, name))).toEqual(bytes);
  }
  expect(readdirSync(f.deedsDir).sort()).toEqual(Object.keys(expectedDeeds).sort());
  expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
  expect(readdirSync(path.dirname(f.moduleFile))).toEqual(['deed_image_ids.ts']);
  for (const [name, bytes] of Object.entries(expectedSources)) {
    expect(readFileSync(path.join(f.sourceDir, name))).toEqual(bytes);
  }
  expect(readdirSync(f.sourceDir).sort()).toEqual(Object.keys(expectedSources).sort());
  expectNoTransactionSiblings(f.deedsDir, path.dirname(f.moduleFile));
  expect(existsSync(path.join(f.root, '.woc-converter-recovery'))).toBe(false);
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('convert_deed_icons_webp', () => {
  const invalidCases: InvalidCase[] = [
    {
      label: 'a non-PNG payload with a .png name',
      messages: ['actual PNG'],
      source: () => rgbRaster('jpeg'),
    },
    {
      label: 'dimensions other than 512x512',
      messages: ['512x512'],
      source: () => rgbaPng(256, 256, [{ left: 32, top: 32, right: 223, bottom: 223, alpha: 255 }]),
    },
    {
      label: 'a PNG without four RGBA channels',
      messages: ['RGBA'],
      source: () => rgbRaster('png'),
    },
    ...(
      [
        ['top-left', 0, 0],
        ['top-right', 511, 0],
        ['bottom-left', 0, 511],
        ['bottom-right', 511, 511],
      ] as const
    ).map(
      ([corner, x, y]): InvalidCase => ({
        label: `a non-transparent ${corner} corner`,
        messages: ['corner', `failed ${corner}`],
        source: () =>
          rgbaPng(512, 512, [
            { left: 64, top: 64, right: 447, bottom: 447, alpha: 255 },
            { left: x, top: y, right: x, bottom: y, alpha: 255 },
          ]),
      }),
    ),
    {
      label: 'art without a fully opaque pixel',
      messages: ['fully opaque'],
      source: () => rgbaPng(512, 512, [{ left: 64, top: 64, right: 447, bottom: 447, alpha: 254 }]),
    },
    ...(
      [
        ['left', { left: 27, top: 96, right: 468, bottom: 415, alpha: 255 }],
        ['right', { left: 43, top: 96, right: 484, bottom: 415, alpha: 255 }],
        ['top', { left: 96, top: 27, right: 415, bottom: 468, alpha: 255 }],
        ['bottom', { left: 96, top: 43, right: 415, bottom: 484, alpha: 255 }],
      ] as const
    ).map(
      ([side, layer]): InvalidCase => ({
        label: `geometry with only 27px ${side} source padding`,
        messages: ['source padding', `${side}=27px`],
        source: () => rgbaPng(512, 512, [layer]),
      }),
    ),
    ...(
      [
        ['left', { left: 28, top: 96, right: 466, bottom: 415, alpha: 255 }, '(247, 255.5)'],
        ['right', { left: 45, top: 96, right: 483, bottom: 415, alpha: 255 }, '(264, 255.5)'],
        ['up', { left: 96, top: 28, right: 415, bottom: 466, alpha: 255 }, '(255.5, 247)'],
        ['down', { left: 96, top: 45, right: 415, bottom: 483, alpha: 255 }, '(255.5, 264)'],
      ] as const
    ).map(
      ([direction, layer, center]): InvalidCase => ({
        label: `geometry centered too far ${direction}`,
        messages: ['bounds center', `decoded ${center}`],
        source: () => rgbaPng(512, 512, [layer]),
      }),
    ),
    {
      label: 'alpha>=8 coverage below 0.34',
      messages: ['coverage'],
      source: () =>
        rgbaPng(512, 512, [
          { left: 64, top: 64, right: 447, bottom: 447, alpha: 7 },
          { left: 176, top: 176, right: 335, bottom: 335, alpha: 255 },
        ]),
    },
    {
      label: 'alpha>=8 coverage above 0.61',
      messages: ['coverage'],
      source: () => rgbaPng(512, 512, [{ left: 56, top: 56, right: 455, bottom: 455, alpha: 255 }]),
    },
  ];

  it.each(invalidCases)('rejects $label', async ({ messages, source }) => {
    const f = fixture(['live'], {
      'live.webp': Buffer.from('prior live webp'),
      'stale.webp': Buffer.from('prior stale webp'),
    });
    const delivered = await source();
    writeFileSync(path.join(f.sourceDir, 'live.png'), delivered);

    const result = run(f);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('live.png');
    for (const message of messages) expect(result.stderr).toContain(message);
    expect(readFileSync(path.join(f.sourceDir, 'live.png'))).toEqual(delivered);
    expect(readFileSync(path.join(f.deedsDir, 'live.webp'))).toEqual(
      Buffer.from('prior live webp'),
    );
    expect(readFileSync(path.join(f.deedsDir, 'stale.webp'))).toEqual(
      Buffer.from('prior stale webp'),
    );
    expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
  });

  it('counts alpha exactly 8 as visible source geometry', async () => {
    const f = fixture(['live']);
    const source = await rgbaPng(512, 512, [
      { left: 64, top: 64, right: 447, bottom: 447, alpha: 8 },
      { left: 248, top: 248, right: 263, bottom: 263, alpha: 255 },
    ]);
    writeFileSync(path.join(f.sourceDir, 'live.png'), source);

    expect(run(f).status).toBe(0);
    expect(existsSync(path.join(f.deedsDir, 'live.webp'))).toBe(true);
  });

  it('preflights the whole delivered batch before changing any repository file', async () => {
    const f = fixture(['a_valid', 'z_invalid'], {
      'a_valid.webp': Buffer.from('prior valid webp'),
      'stale.webp': Buffer.from('prior stale webp'),
    });
    const valid = await rgbaPng();
    const invalid = await rgbRaster('jpeg');
    writeFileSync(path.join(f.sourceDir, 'a_valid.png'), valid);
    writeFileSync(path.join(f.sourceDir, 'z_invalid.png'), invalid);

    expect(run(f).status).toBe(1);

    expect(readFileSync(path.join(f.deedsDir, 'a_valid.webp'))).toEqual(
      Buffer.from('prior valid webp'),
    );
    expect(existsSync(path.join(f.deedsDir, 'z_invalid.webp'))).toBe(false);
    expect(readFileSync(path.join(f.deedsDir, 'stale.webp'))).toEqual(
      Buffer.from('prior stale webp'),
    );
    expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
    expect(readFileSync(path.join(f.sourceDir, 'a_valid.png'))).toEqual(valid);
    expect(readFileSync(path.join(f.sourceDir, 'z_invalid.png'))).toEqual(invalid);
  });

  it.each([
    ['registry stage write', 'stage:2'],
    ['registry backup', 'backup:2'],
    ['second stale quarantine', 'remove:2'],
    ['registry install', 'install:2'],
  ] as const)(
    'rolls back overlay, stale cleanup, and registry when the %s fails',
    async (_, failAt) => {
      const priorLive = Buffer.from('prior live webp');
      const priorStaleA = Buffer.from('prior stale a webp');
      const priorStaleZ = Buffer.from('prior stale z webp');
      const f = fixture(['live'], {
        'live.webp': priorLive,
        'stale_a.webp': priorStaleA,
        'stale_z.webp': priorStaleZ,
      });
      const source = await rgbaPng();
      writeFileSync(path.join(f.sourceDir, 'live.png'), source);

      const result = run(f, failAt);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `injected ${failAt.slice(0, failAt.indexOf(':'))} failure at operation 2`,
      );
      expectRepositoryRollback(
        f,
        { 'live.png': source },
        {
          'live.webp': priorLive,
          'stale_a.webp': priorStaleA,
          'stale_z.webp': priorStaleZ,
        },
      );
    },
  );

  it('removes a newly created deed webp when the later registry install fails', async () => {
    const kept = Buffer.from('existing kept deed webp');
    const stale = Buffer.from('existing stale deed webp');
    const f = fixture(['kept', 'new'], {
      'kept.webp': kept,
      'stale.webp': stale,
    });
    const source = await rgbaPng(512, 512, [
      { left: 64, top: 64, right: 447, bottom: 447, alpha: 255, rgb: [210, 90, 130] },
    ]);
    writeFileSync(path.join(f.sourceDir, 'new.png'), source);

    const result = run(f, 'install:2');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected install failure at operation 2');
    expect(existsSync(path.join(f.deedsDir, 'new.webp'))).toBe(false);
    expectRepositoryRollback(
      f,
      { 'new.png': source },
      {
        'kept.webp': kept,
        'stale.webp': stale,
      },
    );
  });

  it.each([
    ['installed destination removal', 'rollback-install'],
    ['destination backup restore', 'rollback-backup'],
    ['stale file restore', 'rollback-remove'],
    ['staged output cleanup', 'rollback-stage'],
  ] as const)(
    'surfaces a failed rollback %s and leaves every prior byte discoverable',
    async (_, phase) => {
      const priorLive = Buffer.from('recoverable prior live deed webp');
      const priorStale = Buffer.from('recoverable prior stale deed webp');
      const f = fixture(['live'], {
        'live.webp': priorLive,
        'stale.webp': priorStale,
      });
      const source = await rgbaPng();
      writeFileSync(path.join(f.sourceDir, 'live.png'), source);

      const result = run(f, `install:2,${phase}:1`);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('injected install failure at operation 2');
      expect(result.stderr).toContain('rollback incomplete');
      expect(result.stderr).toContain(`injected ${phase} failure at operation 1`);
      expect(readFileSync(path.join(f.sourceDir, 'live.png'))).toEqual(source);
      const residues = [
        ...filesUnder(f.deedsDir),
        ...filesUnder(path.dirname(f.moduleFile)),
      ].filter((file) => path.basename(file).includes('.woc-txn-'));
      expect(residues.length).toBeGreaterThan(0);
      for (const bytes of [priorLive, priorStale, Buffer.from(MODULE_SENTINEL)]) {
        expectBytesDiscoverable(f.root, bytes);
      }
      const discovery = run(f);
      expect(discovery.status).toBe(1);
      expect(discovery.stderr).toContain('stranded transaction files require manual recovery');
      for (const residue of residues) expect(discovery.stderr).toContain(path.basename(residue));
    },
  );

  it('retries transient cleanup and leaves the committed tree residue-free', async () => {
    const f = fixture(['live'], {
      'live.webp': Buffer.from('prior live webp'),
      'stale.webp': Buffer.from('prior stale webp'),
    });
    const source = await rgbaPng();
    writeFileSync(path.join(f.sourceDir, 'live.png'), source);

    const result = run(f, 'cleanup:1');

    expect(result.status).toBe(0);
    expect(sha256(readFileSync(path.join(f.deedsDir, 'live.webp')))).toBe(Q82_REGULAR_SHA256);
    expect(readdirSync(f.deedsDir)).toEqual(['live.webp']);
    expect(readFileSync(f.moduleFile, 'utf8')).toContain("  'live',");
    expect(readdirSync(path.dirname(f.moduleFile))).toEqual(['deed_image_ids.ts']);
    expect(readFileSync(path.join(f.sourceDir, 'live.png'))).toEqual(source);
    expectNoTransactionSiblings(f.deedsDir, path.dirname(f.moduleFile));
    expect(existsSync(path.join(f.root, '.woc-converter-recovery'))).toBe(false);
  });

  it('keeps persistent cleanup recovery bytes outside public and reports failure', async () => {
    const priorLive = Buffer.from('prior live webp');
    const priorStale = Buffer.from('prior stale webp');
    const f = fixture(['live'], {
      'live.webp': priorLive,
      'stale.webp': priorStale,
    });
    const source = await rgbaPng();
    writeFileSync(path.join(f.sourceDir, 'live.png'), source);

    const result = run(f, 'cleanup:*');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'repository changes committed, but recovery temp cleanup failed',
    );
    expect(sha256(readFileSync(path.join(f.deedsDir, 'live.webp')))).toBe(Q82_REGULAR_SHA256);
    expect(readdirSync(f.deedsDir)).toEqual(['live.webp']);
    expect(readFileSync(f.moduleFile, 'utf8')).toContain("  'live',");
    expect(readdirSync(path.dirname(f.moduleFile))).toEqual(['deed_image_ids.ts']);
    expect(readFileSync(path.join(f.sourceDir, 'live.png'))).toEqual(source);
    expectNoTransactionSiblings(f.deedsDir, path.dirname(f.moduleFile));

    const recoveryRoot = path.join(f.root, '.woc-converter-recovery');
    const transactionDirs = readdirSync(recoveryRoot);
    expect(transactionDirs).toHaveLength(1);
    const recoveryDir = path.join(recoveryRoot, transactionDirs[0]);
    const recovered = readdirSync(recoveryDir).map((file) =>
      readFileSync(path.join(recoveryDir, file)),
    );
    expect(recovered.some((bytes) => bytes.equals(priorLive))).toBe(true);
    expect(recovered.some((bytes) => bytes.equals(priorStale))).toBe(true);
    expect(recovered.some((bytes) => bytes.equals(Buffer.from(MODULE_SENTINEL)))).toBe(true);
  });

  it.each([
    ['recovery directory creation', 'recovery-mkdir'],
    ['recovery move', 'recovery-move'],
  ] as const)(
    'surfaces a failed fallback %s without losing recoverable bytes',
    async (_, phase) => {
      const priorLive = Buffer.from('prior live deed bytes for recovery injection');
      const priorStale = Buffer.from('prior stale deed bytes for recovery injection');
      const f = fixture(['live'], {
        'live.webp': priorLive,
        'stale.webp': priorStale,
      });
      const source = await rgbaPng();
      writeFileSync(path.join(f.sourceDir, 'live.png'), source);

      const result = run(f, `cleanup:*,${phase}:1`);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`injected ${phase} failure at operation 1`);
      expect(sha256(readFileSync(path.join(f.deedsDir, 'live.webp')))).toBe(Q82_REGULAR_SHA256);
      expect(readFileSync(path.join(f.sourceDir, 'live.png'))).toEqual(source);
      for (const bytes of [priorLive, priorStale, Buffer.from(MODULE_SENTINEL)]) {
        expectBytesDiscoverable(f.root, bytes);
      }
      const residues = [
        ...filesUnder(f.deedsDir),
        ...filesUnder(path.dirname(f.moduleFile)),
      ].filter((file) => path.basename(file).includes('.woc-txn-'));
      expect(residues.length).toBeGreaterThan(0);
      const discovery = run(f);
      expect(discovery.status).toBe(1);
      expect(discovery.stderr).toContain('stranded transaction files require manual recovery');
      for (const residue of residues) expect(discovery.stderr).toContain(path.basename(residue));
    },
  );

  it('refuses a live webp path that is not a regular file', async () => {
    const f = fixture(['live']);
    mkdirSync(path.join(f.deedsDir, 'live.webp'));
    const source = await rgbaPng();
    writeFileSync(path.join(f.sourceDir, 'live.png'), source);

    const result = run(f);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('expected regular webp files');
    expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
    expect(readFileSync(path.join(f.sourceDir, 'live.png'))).toEqual(source);
    expect(readdirSync(f.deedsDir)).toEqual(['live.webp']);
  });

  it.each([
    ['shipping', 'public/ui/deeds', '.live.webp.woc-txn-crash-0-old'],
    ['registry', 'src/ui', '.deed_image_ids.ts.woc-txn-crash-0-old'],
  ] as const)('refuses stranded transaction siblings in the %s tree', async (_, dir, file) => {
    const f = fixture(['live']);
    const source = await rgbaPng();
    const residue = Buffer.from('recoverable stale bytes');
    writeFileSync(path.join(f.sourceDir, 'live.png'), source);
    const residuePath = path.join(f.root, dir, file);
    writeFileSync(residuePath, residue);

    const result = run(f);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stranded transaction files require manual recovery');
    expect(result.stderr).toContain(`${dir}/${file}`);
    expect(readFileSync(residuePath)).toEqual(residue);
    expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
    expect(readFileSync(path.join(f.sourceDir, 'live.png'))).toEqual(source);
  });

  it.each([
    ['left', { left: 28, top: 96, right: 467, bottom: 415, alpha: 255 }, 'left=6px'],
    ['right', { left: 44, top: 96, right: 483, bottom: 415, alpha: 255 }, 'right=6px'],
    ['top', { left: 96, top: 28, right: 415, bottom: 467, alpha: 255 }, 'top=6px'],
    ['bottom', { left: 96, top: 44, right: 415, bottom: 483, alpha: 255 }, 'bottom=6px'],
  ] as const)(
    'rejects source-valid art whose encoded webp has only 6px %s padding',
    async (_, layer, selectedField) => {
      const priorLive = Buffer.from('prior live webp');
      const f = fixture(['live'], { 'live.webp': priorLive });
      const source = await rgbaPng(512, 512, [layer]);
      writeFileSync(path.join(f.sourceDir, 'live.png'), source);

      const result = run(f);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('encoded webp padding');
      expect(result.stderr).toContain(selectedField);
      expect(readFileSync(path.join(f.deedsDir, 'live.webp'))).toEqual(priorLive);
      expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
    },
  );

  it.each([
    [
      'left',
      [
        { left: 32, top: 96, right: 451, bottom: 415, alpha: 255 },
        { left: 479, top: 96, right: 479, bottom: 415, alpha: 8 },
      ],
      '(60, 63.5)',
    ],
    [
      'right',
      [
        { left: 60, top: 96, right: 479, bottom: 415, alpha: 255 },
        { left: 32, top: 96, right: 32, bottom: 415, alpha: 8 },
      ],
      '(67, 63.5)',
    ],
    [
      'up',
      [
        { left: 96, top: 32, right: 415, bottom: 451, alpha: 255 },
        { left: 96, top: 479, right: 415, bottom: 479, alpha: 8 },
      ],
      '(63.5, 60)',
    ],
    [
      'down',
      [
        { left: 96, top: 60, right: 415, bottom: 479, alpha: 255 },
        { left: 96, top: 32, right: 415, bottom: 32, alpha: 8 },
      ],
      '(63.5, 67)',
    ],
  ] as const)(
    'rejects source-valid art whose encoded webp is centered too far %s',
    async (_, layers, decodedCenter) => {
      const priorLive = Buffer.from('prior live webp');
      const f = fixture(['live'], { 'live.webp': priorLive });
      const source = await rgbaPng(512, 512, layers);
      writeFileSync(path.join(f.sourceDir, 'live.png'), source);

      const result = run(f);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('encoded webp center');
      expect(result.stderr).toContain(`decoded ${decodedCenter}`);
      expect(readFileSync(path.join(f.deedsDir, 'live.webp'))).toEqual(priorLive);
      expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
    },
  );

  it('rejects decoded alpha geometry for an over-cap fixture before changing the repository', async () => {
    const source = await noisyPng(0.2, 15, 112);
    const priorLive = Buffer.from('prior live webp');
    const f = fixture(['live'], { 'live.webp': priorLive });
    writeFileSync(path.join(f.sourceDir, 'live.png'), source);

    const result = run(f);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('encoded webp coverage');
    expect(readFileSync(path.join(f.deedsDir, 'live.webp'))).toEqual(priorLive);
    expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
  });

  it('preserves the keyed canvas at q82 and retains overlay, cleanup, and registry behavior', async () => {
    const f = fixture(['kept', 'new'], {
      'kept.webp': Buffer.from('existing live webp'),
      'stale.webp': Buffer.from('stale webp'),
    });
    const source = await rgbaPng(512, 512, [
      {
        left: 68,
        top: 60,
        right: 451,
        bottom: 451,
        alpha: 255,
        rgb: [255, 0, 255],
      },
    ]);
    writeFileSync(path.join(f.sourceDir, 'new.png'), source);
    writeFileSync(path.join(f.sourceDir, 'orphan.png'), Buffer.from('not even a PNG'));

    const first = run(f);

    expect(first.status).toBe(0);
    expect(first.stdout).toContain('skipped 1 orphan');
    expect(sha256(readFileSync(path.join(f.deedsDir, 'new.webp')))).toBe(Q82_KEYED_SHA256);
    expect(readFileSync(path.join(f.deedsDir, 'kept.webp'))).toEqual(
      Buffer.from('existing live webp'),
    );
    expect(readdirSync(f.deedsDir).sort()).toEqual(['kept.webp', 'new.webp']);
    expect(readFileSync(f.moduleFile, 'utf8')).toContain("  'kept',\n  'new',");
    expect(readFileSync(path.join(f.sourceDir, 'new.png'))).toEqual(source);
    expect(existsSync(path.join(f.sourceDir, 'orphan.png'))).toBe(true);

    const firstWebp = readFileSync(path.join(f.deedsDir, 'new.webp'));
    const firstRegistry = readFileSync(f.moduleFile);
    expect(sha256(firstWebp)).toBe(Q82_KEYED_SHA256);
    expect(sha256(firstRegistry)).toBe(KEPT_NEW_REGISTRY_SHA256);

    const second = run(f);
    const secondWebp = readFileSync(path.join(f.deedsDir, 'new.webp'));
    const secondRegistry = readFileSync(f.moduleFile);

    expect(second.status).toBe(0);
    expect(secondWebp).toEqual(firstWebp);
    expect(secondRegistry).toEqual(firstRegistry);
    expect(sha256(secondWebp)).toBe(Q82_KEYED_SHA256);
    expect(sha256(secondRegistry)).toBe(KEPT_NEW_REGISTRY_SHA256);
  });

  it('retries an over-cap q82 encode at q75 and writes the deterministic retry', async () => {
    const source = await noisyPng(0.25);
    const f = fixture(['live']);
    writeFileSync(path.join(f.sourceDir, 'live.png'), source);

    const result = run(f);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('re-encoded at q75');
    expect(sha256(readFileSync(path.join(f.deedsDir, 'live.webp')))).toBe(Q75_NOISY_SHA256);
    expect(readFileSync(path.join(f.sourceDir, 'live.png'))).toEqual(source);
  });

  it('hard-fails an over-cap q75 batch without changing outputs, stale files, or registry', async () => {
    const source = await noisyPng(0.4);
    const f = fixture(['a_valid', 'z_heavy'], {
      'a_valid.webp': Buffer.from('prior valid webp'),
      'z_heavy.webp': Buffer.from('prior heavy webp'),
      'stale.webp': Buffer.from('prior stale webp'),
    });
    const valid = await rgbaPng();
    writeFileSync(path.join(f.sourceDir, 'a_valid.png'), valid);
    writeFileSync(path.join(f.sourceDir, 'z_heavy.png'), source);

    const result = run(f);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('z_heavy.png');
    expect(result.stderr).toContain('q75');
    expect(result.stderr).toContain('15 KiB cap');
    expect(readFileSync(path.join(f.deedsDir, 'a_valid.webp'))).toEqual(
      Buffer.from('prior valid webp'),
    );
    expect(readFileSync(path.join(f.deedsDir, 'z_heavy.webp'))).toEqual(
      Buffer.from('prior heavy webp'),
    );
    expect(readFileSync(path.join(f.deedsDir, 'stale.webp'))).toEqual(
      Buffer.from('prior stale webp'),
    );
    expect(readFileSync(f.moduleFile, 'utf8')).toBe(MODULE_SENTINEL);
    expect(readFileSync(path.join(f.sourceDir, 'a_valid.png'))).toEqual(valid);
    expect(readFileSync(path.join(f.sourceDir, 'z_heavy.png'))).toEqual(source);
  });
});
