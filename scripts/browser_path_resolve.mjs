// Non-throwing Chromium-family browser resolver. `browser_path.mjs` wraps this
// with a load-time throw for scripts that REQUIRE a browser; callers that can
// degrade gracefully (the asset pipeline's optional headless preview render)
// import this directly and handle a null result. Keeping the candidate list in
// one place means the two entry points never drift.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function playwrightCacheRoots(env = process.env, homeDir = os.homedir()) {
  return unique([
    env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0'
      ? env.PLAYWRIGHT_BROWSERS_PATH
      : null,
    path.join(homeDir, '.cache', 'ms-playwright'),
  ]);
}

export function playwrightBrowserCandidates(options = {}) {
  const out = [];
  for (const root of playwrightCacheRoots(options.env, options.homeDir)) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('chromium-')) continue;
      const dir = path.join(root, entry.name);
      out.push(
        path.join(dir, 'chrome-linux', 'chrome'),
        path.join(dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(dir, 'chrome-win', 'chrome.exe'),
      );
    }
  }
  return unique(out).sort().reverse();
}

export const BROWSER_CANDIDATES = [
  process.env.BROWSER_PATH,
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Windows
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  ...playwrightBrowserCandidates(),
].filter(Boolean);

/** Resolve a local browser binary, or null if none is installed. Never throws. */
export function findBrowserPath(candidates = BROWSER_CANDIDATES) {
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
