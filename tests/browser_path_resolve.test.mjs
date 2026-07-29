import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findBrowserPath, playwrightBrowserCandidates } from '../scripts/browser_path_resolve.mjs';

const tmpDirs = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-browser-path-'));
  tmpDirs.push(dir);
  return dir;
}

describe('browser path resolver', () => {
  it('discovers Chromium installed by Playwright in the user cache', () => {
    const home = tempHome();
    const chrome = path.join(
      home,
      '.cache',
      'ms-playwright',
      'chromium-1200',
      'chrome-linux',
      'chrome',
    );
    fs.mkdirSync(path.dirname(chrome), { recursive: true });
    fs.writeFileSync(chrome, '');

    expect(playwrightBrowserCandidates({ homeDir: home })).toContain(chrome);
    expect(findBrowserPath(playwrightBrowserCandidates({ homeDir: home }))).toBe(chrome);
  });

  it('keeps returning null when no candidate exists', () => {
    const home = tempHome();

    expect(findBrowserPath(playwrightBrowserCandidates({ homeDir: home }))).toBeNull();
  });
});
