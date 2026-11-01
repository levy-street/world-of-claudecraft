import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve('app-builder-lib'));
const universal = createRequire(builder.resolve('@electron/universal'));
const asar = createRequire(builder.resolve('@electron/asar'));
const ejs = createRequire(builder.resolve('ejs'));
const jake = createRequire(ejs.resolve('jake'));
const filelist = createRequire(jake.resolve('filelist'));

describe('glob security upgrades and the legacy minimatch advisory boundary', () => {
  it('allows only the reviewed legacy matchers or patched versions under the advisory exception', () => {
    const lock = readFileSync('pnpm-lock.yaml', 'utf8');
    const versions = new Set([...lock.matchAll(/^ {2}minimatch@([^:]+):$/gm)].map((m) => m[1]));
    expect(versions.size).toBeGreaterThanOrEqual(3);
    for (const version of versions) {
      if (version === '3.1.5' || version === '5.1.9') continue;
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      const [major, minor, patch] = version.split('.').map(Number);
      expect(
        major > 11 || (major === 11 && (minor > 0 || patch >= 1)),
        `unreviewed minimatch ${version} would be hidden by the advisory-wide exception`,
      ).toBe(true);
    }
  });

  it.each([
    ['asar', asar, '3.1.5'],
    ['filelist', filelist, '5.1.9'],
  ] as const)(
    'keeps %s on its reviewed legacy implementation without the vulnerable preprocessor',
    (_name, consumer, version) => {
      const matcher = consumer('minimatch');
      const entry = consumer.resolve('minimatch');
      const pkg = consumer('minimatch/package.json');
      expect(pkg.version).toBe(version);
      expect(readFileSync(entry, 'utf8')).not.toMatch(/firstPhasePreProcess|optimizationLevel/);
      expect(matcher.Minimatch.prototype.firstPhasePreProcess).toBeUndefined();
      expect(typeof matcher).toBe('function');
      expect(matcher('assets/icon.png', '**/*.png')).toBe(true);
      expect(matcher.match(['icon.png', 'code.js'], '*.png')).toEqual(['icon.png']);
    },
  );

  it.each([
    ['app-builder-lib', builder],
    ['@electron/universal', universal],
  ] as const)(
    'preserves %s named matcher exports and directory traversal matching',
    (_name, consumer) => {
      const { minimatch, Minimatch } = consumer('minimatch');
      expect(minimatch('assets/icon.png', '**/*.png')).toBe(true);
      expect(minimatch('assets/code.js', '**/*.png')).toBe(false);
      const matcher = new Minimatch('assets/**/*.png');
      expect(matcher.set.length).toBeGreaterThan(0);
      expect(matcher.match('assets', true)).toBe(true);
      expect(matcher.match('assets/icon.png')).toBe(true);
      expect(matcher.match('assets/code.js')).toBe(false);
    },
  );

  it.each([
    [
      'rimraf',
      () => createRequire(createRequire(require.resolve('@capacitor/cli')).resolve('rimraf')),
    ],
    [
      'caporal',
      // The glTF CLI consumes caporal's ESM entry; its published CJS entry is absent.
      () => createRequire(import.meta.resolve('@donmccurdy/caporal')),
    ],
  ] as const)(
    'preserves %s glob APIs and honors an already aborted traversal',
    async (_name, load) => {
      const { glob, globSync } = load()('glob');
      const dir = mkdtempSync(path.join(tmpdir(), 'woc-glob-security-'));
      try {
        writeFileSync(path.join(dir, 'asset.glb'), 'fixture');
        writeFileSync(path.join(dir, 'ignore.txt'), 'fixture');
        expect(globSync('*.glb', { cwd: dir })).toEqual(['asset.glb']);
        expect(await glob('*.glb', { cwd: dir })).toEqual(['asset.glb']);
        const controller = new AbortController();
        controller.abort();
        await expect(glob('**/*', { cwd: dir, signal: controller.signal })).rejects.toMatchObject({
          name: 'AbortError',
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
