import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupOwnedProfileDir,
  createOwnedProfileDir,
  isOwnedProfileDir,
} from '../scripts/lib/chrome_profile_dir.mjs';

const PREFIX = 'woc-chrome-profile-dir-test-';
const created: string[] = [];

afterEach(() => {
  while (created.length) {
    const dir = created.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('createOwnedProfileDir', () => {
  it('mints a fresh directory under os.tmpdir() tagged with the given prefix', () => {
    const dir = createOwnedProfileDir(PREFIX);
    created.push(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(path.relative(os.tmpdir(), dir).startsWith('..')).toBe(false);
    expect(path.basename(dir).startsWith(PREFIX)).toBe(true);
  });
});

describe('cleanupOwnedProfileDir: the P2 regression (arbitrary CHROME_PROFILE_DIR deletion)', () => {
  it('removes a directory this process actually minted', () => {
    const dir = createOwnedProfileDir(PREFIX);
    fs.writeFileSync(path.join(dir, 'marker.txt'), 'x');
    cleanupOwnedProfileDir(dir, PREFIX);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('refuses to delete a path outside os.tmpdir(), such as an operator-supplied CHROME_PROFILE_DIR', () => {
    const outsideDir = fs.mkdtempSync(path.join(process.cwd(), 'woc-outside-tmpdir-'));
    created.push(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'important.txt'), 'do not delete me');

    cleanupOwnedProfileDir(outsideDir, PREFIX);

    expect(fs.existsSync(outsideDir)).toBe(true);
    expect(fs.existsSync(path.join(outsideDir, 'important.txt'))).toBe(true);
  });

  it('refuses to delete a tmpdir-relative path that lacks the expected prefix', () => {
    const unrelatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'some-other-tool-'));
    created.push(unrelatedDir);

    cleanupOwnedProfileDir(unrelatedDir, PREFIX);

    expect(fs.existsSync(unrelatedDir)).toBe(true);
  });

  it('refuses to delete os.tmpdir() itself when handed an empty relative path', () => {
    expect(isOwnedProfileDir(os.tmpdir(), PREFIX)).toBe(false);
  });

  it('refuses a path traversal attempt disguised as a prefixed tmpdir child', () => {
    const traversal = path.join(os.tmpdir(), `${PREFIX}escape`, '..', '..', 'etc');
    expect(isOwnedProfileDir(traversal, PREFIX)).toBe(false);
  });
});
