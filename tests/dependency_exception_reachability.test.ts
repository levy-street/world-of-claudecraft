import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('documented dependency advisory boundaries', () => {
  it('keeps the Solana browser RPC client outside stream-json server utilities', () => {
    const solanaRequire = createRequire(require.resolve('@solana/web3.js'));
    const browserBundle = readFileSync(
      solanaRequire.resolve('@solana/web3.js/lib/index.browser.esm.js'),
      'utf8',
    );
    expect(browserBundle).toContain("from 'jayson/lib/client/browser'");
    const browserClient = solanaRequire.resolve('jayson/lib/client/browser');
    // A fresh process makes this the actual browser client's dependency closure,
    // independent of what other tests have already imported into require.cache.
    const loaded = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          'require(process.argv[1]); process.stdout.write(JSON.stringify(Object.keys(require.cache)))',
          browserClient,
        ],
        { encoding: 'utf8' },
      ),
    ) as string[];
    expect(loaded).toContain(browserClient);
    const normalized = loaded.map((file) => file.replaceAll('\\', '/'));
    expect(normalized.some((file) => file.includes('/stream-json/'))).toBe(false);
    expect(normalized.some((file) => file.endsWith('/jayson/lib/utils.js'))).toBe(false);
  });

  it('keeps Electron packaging downloads on Got without HTTP caching', () => {
    const builderRequire = createRequire(require.resolve('app-builder-lib'));
    const electronGetEntry = builderRequire.resolve('@electron/get');
    const electronRequire = createRequire(electronGetEntry);
    const got = electronRequire('got');
    expect(got.defaults.options.cache).toBeUndefined();
    const downloader = readFileSync(
      path.join(path.dirname(electronGetEntry), 'GotDownloader.js'),
      'utf8',
    );
    expect(downloader).toContain('got_1.default.stream(url, gotOptions)');
    expect(downloader).not.toMatch(/\bcache\s*:/);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.build?.electronDownload?.cache).toBeUndefined();
  });
});
