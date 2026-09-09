// Owned-directory guard for one-shot puppeteer capture scripts (see
// scripts/lib/perf_hitch_browser.mjs for the same guard on the long-lived profiler
// session path). A capture script must never let an externally supplied path drive
// a recursive delete: this helper always mints its own directory under os.tmpdir()
// and refuses to remove anything that isn't that exact, prefix-tagged, tmpdir-relative
// path, so a misconfigured or malicious CHROME_PROFILE_DIR can never reach fs.rmSync.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @param {string} profileDir
 * @param {string} prefix
 * @returns {boolean}
 */
export function isOwnedProfileDir(profileDir, prefix) {
  const relative = path.relative(os.tmpdir(), profileDir);
  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    path.basename(profileDir).startsWith(prefix)
  );
}

/**
 * @param {string} prefix
 * @returns {string}
 */
export function createOwnedProfileDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * @param {string} profileDir
 * @param {string} prefix
 * @returns {void}
 */
export function cleanupOwnedProfileDir(profileDir, prefix) {
  if (isOwnedProfileDir(profileDir, prefix)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}
